/**
 * CALQIX Ads Monitor — Daily Job Endpoint
 *
 * Scheduling: Upstash QStash (primary) or Vercel Cron (legacy fallback)
 * QStash cron: "CRON_TZ=Europe/Amsterdam 0 7 * * *" = 07:00 Amsterdam time
 *
 * Auth priority:
 *   1. QStash signature (Upstash-Signature header) — production
 *   2. CRON_SECRET (Bearer or query param) — manual testing / Vercel Cron fallback
 *
 * Lifecycle:
 *   1. Verify request (QStash sig or CRON_SECRET)
 *   2. Acquire distributed lock
 *   3. Check idempotency
 *   4. Execute ad monitoring logic
 *   5. Persist run metadata + artifact
 *   6. Send notification
 *   7. Release lock
 *   8. Return structured response
 */
var { sendTelegram } = require('../../lib/telegram');
var { apiGet, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');
var store = require('../../lib/store');
var crypto = require('crypto');

var PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase'];
var ATC_TYPES = ['offsite_conversion.fb_pixel_add_to_cart'];
var IC_TYPES = ['offsite_conversion.fb_pixel_initiate_checkout'];
var VC_TYPES = ['offsite_conversion.fb_pixel_view_content'];
var BILLING_THRESHOLD = parseInt(process.env.BILLING_THRESHOLD || '74', 10);
var BILLING_ALERT_PCT = 95;

/**
 * Verify QStash signature using the Receiver class.
 * Returns true if signature is valid.
 */
async function verifyQStashSignature(req, body) {
  var currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  var nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) return false;

  var signature = req.headers && req.headers['upstash-signature'];
  if (!signature) return false;

  try {
    var { Receiver } = require('@upstash/qstash');
    var receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
    var isValid = await receiver.verify({
      signature: signature,
      body: body || '',
      url: (process.env.QSTASH_VERIFY_URL || 'https://calqix-capi.vercel.app') + '/api/ads/monitor'
    });
    return isValid;
  } catch (err) {
    console.warn('[Monitor] QStash signature verification failed:', err.message);
    return false;
  }
}

function authCronSecret(req) {
  var secret = process.env.CRON_SECRET;
  if (!secret) return false;
  var querySecret = req.query && req.query.secret;
  if (querySecret === secret) return true;
  var authHeader = req.headers && req.headers['authorization'];
  if (authHeader === 'Bearer ' + secret) return true;
  return false;
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function generateRunId(today) {
  return 'run_' + today + '_' + crypto.randomBytes(4).toString('hex');
}

async function safeApiGet(path, params, label) {
  try {
    var result = await apiGet(path, params);
    if (!result.ok) {
      console.warn('[Monitor] API call failed: ' + label, { error: result.error });
    }
    return result;
  } catch (err) {
    console.error('[Monitor] API exception: ' + label, { message: err.message });
    return { ok: false, data: null, error: err.message };
  }
}

async function handler(req, res) {
  // Accept both GET (Vercel Cron / manual) and POST (QStash)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for QStash signature verification
  var rawBody = '';
  if (req.method === 'POST' && req.body) {
    rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  // Auth: try QStash first, then CRON_SECRET
  var authSource = 'none';
  var qstashValid = await verifyQStashSignature(req, rawBody);
  if (qstashValid) {
    authSource = 'qstash';
  } else if (authCronSecret(req)) {
    authSource = 'cron_secret';
  } else {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var forceRun = req.query && req.query.force === '1';
  var now = new Date();
  var today = todayKey();
  var runId = generateRunId(today);
  var startTime = Date.now();

  console.log('[Monitor] Run started', {
    runId: runId,
    date: today,
    force: forceRun,
    authSource: authSource,
    storeType: store.getStoreType(),
    redisActive: store.isRedisActive()
  });

  // 1. Durable idempotency check
  if (!forceRun) {
    var previousRun = await store.getCronRun(today);
    if (previousRun) {
      console.log('[Monitor] Already ran today, skipping.', { date: today, runId: runId });
      return res.status(200).json({
        timestamp: now.toISOString(),
        run_id: runId,
        skipped: true,
        reason: 'already_ran_today',
        previous_run: previousRun
      });
    }
  }

  // 2. Distributed lock (5 minute TTL)
  var lockAcquired = await store.acquireCronLock();
  if (!lockAcquired) {
    console.log('[Monitor] Lock held by another instance.', { date: today, runId: runId });
    return res.status(200).json({
      timestamp: now.toISOString(),
      run_id: runId,
      skipped: true,
      reason: 'lock_held'
    });
  }

  try {
    // 3. Execute monitoring logic
    var result = await runMonitor(now);

    // 4. Persist run metadata
    var runMeta = {
      run_id: runId,
      timestamp: now.toISOString(),
      auth_source: authSource,
      triggers_fired: result.triggers_fired,
      urgent: result.urgent,
      warning: result.warning,
      info: result.info,
      api_errors: result.api_errors,
      notification_sent: result.notification_sent,
      windsurf_task: result.windsurf_task,
      elapsed_ms: Date.now() - startTime
    };
    await store.setCronRun(today, runMeta);

    // 5. Persist artifact if triggers fired
    if (result.triggers_fired > 0) {
      await store.setArtifact(runId, {
        date: today,
        triggers: result.triggers,
        summary: result.urgent + ' urgent, ' + result.warning + ' warning, ' + result.info + ' info'
      });
    }

    // 6. Persist notification status
    await store.setNotifyStatus(runId, {
      telegram_sent: result.notification_sent,
      task_created: result.windsurf_task,
      timestamp: now.toISOString()
    });

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[Monitor] Completed in ' + elapsed + 's', {
      runId: runId,
      triggers: result.triggers_fired,
      notification: result.notification_sent
    });

    result.run_id = runId;
    result.auth_source = authSource;
    return res.status(200).json(result);

  } catch (err) {
    console.error('[Monitor] CRITICAL FAILURE', { runId: runId, message: err.message, stack: err.stack });

    var failMsg = '\ud83d\udd34 <b>CALQIX Monitor FOUT</b>\n\n'
      + 'Run ID: <code>' + runId + '</code>\n'
      + 'De dagelijkse ads monitor is gecrasht:\n'
      + '<code>' + (err.message || 'Unknown error').substring(0, 500) + '</code>\n\n'
      + 'Controleer Vercel logs.';

    var notifySent = false;
    try {
      await sendTelegram(failMsg);
      notifySent = true;
    } catch (e) {
      console.error('[Monitor] Telegram notification failed', e.message);
    }

    if (!notifySent) {
      console.error('[Monitor] FALLBACK_NOTIFICATION', {
        type: 'monitor_failure',
        run_id: runId,
        error: err.message,
        date: today
      });
    }

    // Persist failure metadata
    await store.setCronRun(today, {
      run_id: runId,
      timestamp: now.toISOString(),
      error: err.message,
      notification_sent: notifySent
    });

    return res.status(200).json({
      timestamp: now.toISOString(),
      run_id: runId,
      error: err.message,
      notification_sent: notifySent,
      notification_type: 'failure'
    });
  } finally {
    await store.releaseCronLock();
  }
}

async function runMonitor(now) {
  var triggers = [];
  var apiErrors = [];

  // --- Fetch data (each call is isolated) ---

  var adInsightsResult = await safeApiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'ad_name,ad_id,adset_name,adset_id,impressions,clicks,ctr,cpc,spend,frequency,actions,cost_per_action_type',
    date_preset: 'last_3d',
    level: 'ad',
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '0' }],
    limit: 200
  }, 'ad_insights_3d');
  var adInsights = adInsightsResult.ok && Array.isArray(adInsightsResult.data) ? adInsightsResult.data : [];
  if (!adInsightsResult.ok) apiErrors.push('ad_insights_3d: ' + adInsightsResult.error);

  var adsetsResult = await safeApiGet(AD_ACCOUNT_ID + '/adsets', {
    fields: 'name,status,effective_status,optimization_goal,daily_budget',
    filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'] }],
    limit: 50
  }, 'adsets_active');
  var adsets = adsetsResult.ok && Array.isArray(adsetsResult.data) ? adsetsResult.data : [];
  if (!adsetsResult.ok) apiErrors.push('adsets_active: ' + adsetsResult.error);

  var adsetInsightsResult = await safeApiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend,actions,action_values',
    date_preset: 'last_3d',
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  }, 'adset_insights_3d');
  var adsetInsights = adsetInsightsResult.ok && Array.isArray(adsetInsightsResult.data) ? adsetInsightsResult.data : [];

  var adsetInsights7dResult = await safeApiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend,actions,action_values',
    date_preset: 'last_7d',
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  }, 'adset_insights_7d');
  var adsetInsights7d = adsetInsights7dResult.ok && Array.isArray(adsetInsights7dResult.data) ? adsetInsights7dResult.data : [];

  var todayInsightsResult = await safeApiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend',
    date_preset: 'today',
    level: 'adset',
    limit: 100
  }, 'adset_insights_today');
  var todayInsights = todayInsightsResult.ok && Array.isArray(todayInsightsResult.data) ? todayInsightsResult.data : [];

  // --- Evaluate triggers ---

  // TRIGGER 1: AD KILLER
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;
    if (impressions >= 1000 && ctr < 0.8) {
      triggers.push({
        severity: 'URGENT',
        rule: 'AD_KILLER',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft " + impressions + " impressies maar CTR van " + ctr.toFixed(2) + "%. Pauzeer deze ad."
      });
    }
  });

  // TRIGGER 2: CREATIVE FATIGUE
  adInsights.forEach(function (ad) {
    var frequency = parseFloat(ad.frequency) || 0;
    if (frequency > 3.0) {
      triggers.push({
        severity: 'URGENT',
        rule: 'CREATIVE_FATIGUE',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft frequency " + frequency.toFixed(1) + ". Maak nieuwe creative aan in Predis.ai."
      });
    }
  });

  // TRIGGER 3: BUDGET NIET BESTEED
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var expectedSpend3d = dailyBudgetEur * 3;
    var insightRow = adsetInsights.find(function (i) { return i.adset_id === adset.id; });
    var actualSpend3d = insightRow ? parseFloat(insightRow.spend) || 0 : 0;
    var pct = expectedSpend3d > 0 ? (actualSpend3d / expectedSpend3d * 100) : 0;

    if (pct < 50 && actualSpend3d > 0) {
      triggers.push({
        severity: 'WARNING',
        rule: 'BUDGET_UNDERUTILIZED',
        target: adset.name,
        target_id: adset.id,
        message: "Ad set '" + adset.name + "' besteedt slechts " + pct.toFixed(0) + "% van budget. Check audience grootte of bid."
      });
    }
  });

  // TRIGGER 4: LEARNING LIMITED
  adsets.forEach(function (adset) {
    if (adset.effective_status === 'LEARNING_LIMITED') {
      triggers.push({
        severity: 'WARNING',
        rule: 'LEARNING_LIMITED',
        target: adset.name,
        target_id: adset.id,
        message: "Ad set '" + adset.name + "' zit vast in Learning Limited. Overweeg hoger-funnel optimalisatie event."
      });
    }
  });

  // TRIGGER 5: WINNER GEVONDEN
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;
    var costPerAtc = null;
    if (ad.cost_per_action_type) {
      for (var c = 0; c < ad.cost_per_action_type.length; c++) {
        if (ATC_TYPES.indexOf(ad.cost_per_action_type[c].action_type) !== -1) {
          costPerAtc = parseFloat(ad.cost_per_action_type[c].value) || null;
          break;
        }
      }
    }
    if (impressions >= 500 && ctr > 3 && costPerAtc !== null && costPerAtc < 10) {
      triggers.push({
        severity: 'INFO',
        rule: 'WINNER',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Winner: '" + ad.ad_name + "' presteert goed (CTR " + ctr.toFixed(1) + "%, ATC " + costPerAtc.toFixed(2) + " euro). Overweeg budget verhoging."
      });
    }
  });

  // TRIGGER 6: SPENDING SPIKE
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var todayRow = todayInsights.find(function (i) { return i.adset_id === adset.id; });
    var todaySpend = todayRow ? parseFloat(todayRow.spend) || 0 : 0;

    if (todaySpend > dailyBudgetEur * 1.5 && todaySpend > 0) {
      triggers.push({
        severity: 'URGENT',
        rule: 'SPENDING_SPIKE',
        target: adset.name,
        target_id: adset.id,
        message: "Spend alert: " + todaySpend.toFixed(2) + " euro uitgegeven vandaag bij budget van " + dailyBudgetEur.toFixed(2) + " euro."
      });
    }
  });

  // --- Website / Funnel Optimization Triggers ---

  var totalVC = 0, totalATC = 0, totalIC = 0, totalPurchases = 0, totalSpend7d = 0;
  adsetInsights7d.forEach(function (row) {
    var actions = row.actions || [];
    totalVC += parseActionValue(actions, VC_TYPES);
    totalATC += parseActionValue(actions, ATC_TYPES);
    totalIC += parseActionValue(actions, IC_TYPES);
    totalPurchases += parseActionValue(actions, PURCHASE_TYPES);
    totalSpend7d += parseFloat(row.spend) || 0;
  });

  // TRIGGER 7: CHECKOUT DROP-OFF
  if (totalIC >= 5 && totalPurchases > 0) {
    var icToPurchaseRate = (totalPurchases / totalIC * 100);
    if (icToPurchaseRate < 25) {
      triggers.push({
        severity: 'WARNING',
        rule: 'CHECKOUT_DROPOFF',
        target: 'Website funnel',
        target_id: null,
        message: 'Checkout drop-off: slechts ' + icToPurchaseRate.toFixed(0) + '% van InitiateCheckout converteert naar Purchase (' + totalPurchases + '/' + totalIC + '). Check: verzendkosten, betaalmethoden, checkout flow.'
      });
    }
  }

  // TRIGGER 8: LOW ATC-TO-IC RATIO
  if (totalATC >= 5) {
    var atcToIcRate = totalIC > 0 ? (totalIC / totalATC * 100) : 0;
    if (atcToIcRate < 30) {
      triggers.push({
        severity: 'WARNING',
        rule: 'CART_ABANDONMENT',
        target: 'Website funnel',
        target_id: null,
        message: 'Cart abandonment hoog: slechts ' + atcToIcRate.toFixed(0) + '% van AddToCart start checkout (' + totalIC + '/' + totalATC + '). Check: winkelwagen UX, trust signals, urgentie-elementen.'
      });
    }
  }

  // TRIGGER 9: LOW VC-TO-ATC RATIO
  if (totalVC >= 20) {
    var vcToAtcRate = totalATC > 0 ? (totalATC / totalVC * 100) : 0;
    if (vcToAtcRate < 5) {
      triggers.push({
        severity: 'WARNING',
        rule: 'LOW_PRODUCT_CONVERSION',
        target: 'Website funnel',
        target_id: null,
        message: 'Productpagina converteert slecht: slechts ' + vcToAtcRate.toFixed(1) + '% van ViewContent naar ATC (' + totalATC + '/' + totalVC + '). Check: productpagina copy, prijs, reviews, CTA button.'
      });
    }
  }

  // TRIGGER 10: HIGH CPC
  var totalClicks = 0;
  adInsights.forEach(function (ad) { totalClicks += parseInt(ad.clicks) || 0; });
  if (totalClicks > 0 && totalSpend7d > 0) {
    var avgCpc = totalSpend7d / totalClicks;
    if (avgCpc > 2.0) {
      triggers.push({
        severity: 'INFO',
        rule: 'HIGH_CPC',
        target: 'Ads overall',
        target_id: null,
        message: 'Gemiddelde CPC is ' + avgCpc.toFixed(2) + ' euro. Overweeg: nieuwe creatives, bredere targeting, of lagere-funnel landingspagina.'
      });
    }
  }

  // TRIGGER 11: BILLING THRESHOLD
  var billingResult = await safeApiGet(AD_ACCOUNT_ID, { fields: 'balance' }, 'billing');
  if (billingResult.ok && billingResult.data && billingResult.data.balance) {
    var currentBalance = parseInt(billingResult.data.balance, 10) / 100;
    var billingPct = (currentBalance / BILLING_THRESHOLD * 100);
    if (billingPct >= BILLING_ALERT_PCT) {
      triggers.push({
        severity: 'URGENT',
        rule: 'BILLING_THRESHOLD',
        target: 'Account billing',
        target_id: null,
        message: 'Facturatie alert: ' + currentBalance.toFixed(2) + '/' + BILLING_THRESHOLD + ' euro (' + billingPct.toFixed(0) + '%). Vul je creditcard aan!'
      });
    }
  }

  // --- Build notification ---

  var urgentTriggers = triggers.filter(function (t) { return t.severity === 'URGENT'; });
  var warningTriggers = triggers.filter(function (t) { return t.severity === 'WARNING'; });
  var infoTriggers = triggers.filter(function (t) { return t.severity === 'INFO'; });

  // Always notify — either with triggers or with all-clear status
  var msg = formatMessage(now, urgentTriggers, warningTriggers, infoTriggers, adsetInsights7d, adsets, apiErrors, {
    totalVC: totalVC, totalATC: totalATC, totalIC: totalIC, totalPurchases: totalPurchases, totalSpend7d: totalSpend7d
  });
  var telegramResult = await sendTelegram(msg);

  // --- Generate Windsurf task file if there are actionable triggers ---
  var taskGenerated = false;
  if (urgentTriggers.length > 0 || warningTriggers.length > 0) {
    taskGenerated = await generateWindsurfTask(now, urgentTriggers, warningTriggers, infoTriggers);
  }

  return {
    timestamp: now.toISOString(),
    triggers_fired: triggers.length,
    urgent: urgentTriggers.length,
    warning: warningTriggers.length,
    info: infoTriggers.length,
    api_errors: apiErrors.length,
    notification_sent: true,
    telegram_response: telegramResult,
    windsurf_task: taskGenerated,
    triggers: triggers
  };
}

function formatMessage(now, urgent, warning, info, weeklyInsights, adsets, apiErrors, funnel) {
  var iso = now.toISOString().split('T')[0].split('-');
  var dateStr = iso[2] + '-' + iso[1] + '-' + iso[0];
  var lines = ['📊 <b>CALQIX Ads Monitor - ' + dateStr + '</b>\n'];

  // API errors
  if (apiErrors.length > 0) {
    lines.push('⚙️ <b>API WARNINGS:</b>');
    apiErrors.forEach(function (e) { lines.push('- ' + e.substring(0, 100)); });
    lines.push('');
  }

  // Split warnings
  var adWarnings = [];
  var websiteWarnings = [];
  warning.forEach(function (t) {
    if (['CHECKOUT_DROPOFF', 'CART_ABANDONMENT', 'LOW_PRODUCT_CONVERSION'].indexOf(t.rule) !== -1) {
      websiteWarnings.push(t);
    } else {
      adWarnings.push(t);
    }
  });

  if (urgent.length > 0) {
    lines.push('🔴 <b>ACTIE NODIG:</b>');
    urgent.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (adWarnings.length > 0) {
    lines.push('⚠️ <b>ADS - LET OP:</b>');
    adWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (websiteWarnings.length > 0) {
    lines.push('🌐 <b>WEBSITE OPTIMALISATIE:</b>');
    websiteWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (info.length > 0) {
    lines.push('🏆 <b>WINNERS:</b>');
    info.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  // Always show funnel summary
  lines.push('📈 <b>7-DAG FUNNEL:</b>');
  lines.push('- Spend: €' + funnel.totalSpend7d.toFixed(2));
  lines.push('- VC→ATC→IC→Purchase: ' + funnel.totalVC + '→' + funnel.totalATC + '→' + funnel.totalIC + '→' + funnel.totalPurchases);
  if (funnel.totalATC > 0) {
    lines.push('- Cost/ATC: €' + (funnel.totalSpend7d / funnel.totalATC).toFixed(2));
  }
  lines.push('');

  // All-clear
  if (urgent.length === 0 && warning.length === 0) {
    lines.push('✅ Geen urgente acties nodig.');
  }

  // Operator action instructions (not auto-executed)
  if (urgent.length > 0 || warning.length > 0) {
    var dateStr2 = now.toISOString().split('T')[0];
    lines.push('\n📝 <b>ACTIE VEREIST:</b>');
    lines.push('1. Taakbestand: <code>.windsurf/tasks/ads-' + dateStr2 + '.md</code>');
    lines.push('2. Open Windsurf en voer uit: <code>/ads-optimize</code>');
    lines.push('3. Of handle handmatig via Meta Ads Manager.');
  }

  return lines.join('\n');
}

/**
 * Generate a Windsurf task file via GitHub API.
 * This creates a markdown file in .windsurf/tasks/ that Windsurf can pick up.
 */
async function generateWindsurfTask(now, urgent, warning, info) {
  var ghToken = process.env.GITHUB_TOKEN;
  var ghRepo = process.env.GITHUB_REPO || 'CALQIX/Themex-Calqix';

  if (!ghToken) {
    console.log('[Monitor] GITHUB_TOKEN not set, skipping Windsurf task generation');
    return false;
  }

  var date = now.toISOString().split('T')[0];
  var filePath = '.windsurf/tasks/ads-' + date + '.md';

  var lines = [
    '---',
    'description: Daily ads optimization actions for ' + date,
    '---',
    '',
    '# Ads Monitor Actions — ' + date,
    '',
    'Auto-generated by the CALQIX Ads Monitor cron job.',
    ''
  ];

  if (urgent.length > 0) {
    lines.push('## Urgent Actions');
    urgent.forEach(function (t) {
      lines.push('- [ ] **' + t.rule + '**: ' + t.message + (t.target_id ? ' (ID: `' + t.target_id + '`)' : ''));
    });
    lines.push('');
  }

  if (warning.length > 0) {
    lines.push('## Warnings');
    warning.forEach(function (t) {
      lines.push('- [ ] **' + t.rule + '**: ' + t.message + (t.target_id ? ' (ID: `' + t.target_id + '`)' : ''));
    });
    lines.push('');
  }

  if (info.length > 0) {
    lines.push('## Info');
    info.forEach(function (t) {
      lines.push('- ' + t.message);
    });
    lines.push('');
  }

  lines.push('## How to execute');
  lines.push('Use the `/ads-optimize` Windsurf workflow or handle manually via Meta Ads Manager.');

  var content = Buffer.from(lines.join('\n')).toString('base64');
  var fetch = require('node-fetch');

  try {
    var response = await fetch('https://api.github.com/repos/' + ghRepo + '/contents/' + filePath, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + ghToken,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: 'chore: ads monitor task ' + date,
        content: content,
        branch: 'main'
      })
    });

    if (response.ok || response.status === 201) {
      console.log('[Monitor] Windsurf task created: ' + filePath);
      return true;
    } else {
      var errBody = await response.text();
      // 422 means file already exists — that's fine (idempotent)
      if (response.status === 422) {
        console.log('[Monitor] Windsurf task already exists for today');
        return true;
      }
      console.warn('[Monitor] GitHub API error', { status: response.status, body: errBody.substring(0, 200) });
      return false;
    }
  } catch (err) {
    console.warn('[Monitor] GitHub task creation failed', { message: err.message });
    return false;
  }
}

module.exports = handler;
