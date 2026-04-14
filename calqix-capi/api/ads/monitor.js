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
var { apiGet, apiPost, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');
var insights = require('../../lib/meta-insights-source');
var store = require('../../lib/store');
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var eventState = require('../../lib/event-state');
var dates = require('../../lib/dates');
var crypto = require('crypto');

var adCopyAuditor = require('../../lib/ad-copy-auditor');

var PURCHASE_TYPES = insights.PURCHASE_TYPES;
var ATC_TYPES = insights.ATC_TYPES;
var IC_TYPES = insights.IC_TYPES;
var VC_TYPES = insights.VC_TYPES;

// Auto-action config (all disabled by default — safe)
var AUTO_PAUSE = process.env.META_OPTIMIZER_AUTO_PAUSE === 'true';
var AUTO_BUDGET_ADJUST = process.env.META_OPTIMIZER_AUTO_BUDGET_ADJUST === 'true';
var BILLING_ALERT_PCT = 90;

var ENDPOINT_PATH = '/api/ads/monitor';

/**
 * Determine the optimizer slot based on current Amsterdam hour.
 * Returns hourly slot like 'h07', 'h09', 'h11', etc.
 * This supports the 9x/day schedule (every 2h from 07-23).
 */
function getSlot(now) {
  var amsterdamHour;
  try {
    var fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Amsterdam' });
    amsterdamHour = parseInt(fmt.format(now), 10);
  } catch (e) {
    amsterdamHour = (now.getUTCHours() + 2) % 24;
  }
  return 'h' + (amsterdamHour < 10 ? '0' : '') + amsterdamHour;
}

/**
 * Get human-readable slot label for Telegram.
 */
function getSlotLabel(now) {
  var amsterdamHour;
  try {
    var fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Amsterdam' });
    amsterdamHour = parseInt(fmt.format(now), 10);
  } catch (e) {
    amsterdamHour = (now.getUTCHours() + 2) % 24;
  }
  if (amsterdamHour < 10) return 'morning';
  if (amsterdamHour < 16) return 'afternoon';
  return 'evening';
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function generateRunId(today) {
  return 'run_' + today + '_' + crypto.randomBytes(4).toString('hex');
}

async function handler(req, res) {
  // Accept both GET (Vercel Cron / manual) and POST (QStash)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for QStash signature verification (body parser disabled)
  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  // Auth: try QStash first, then CRON_SECRET
  var auth = await authenticate(req, rawBody, ENDPOINT_PATH);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  var authSource = auth.source;

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

  // Determine slot (morning or evening)
  var slot = getSlot(now);

  // 1. Durable idempotency check (per-slot)
  if (!forceRun) {
    var previousRun = await store.getOptimizerRun(today, slot);
    if (previousRun) {
      console.log('[Monitor] Already ran this slot, skipping.', { date: today, slot: slot, runId: runId });
      return res.status(200).json({
        timestamp: now.toISOString(),
        run_id: runId,
        slot: slot,
        skipped: true,
        reason: 'already_ran_slot',
        previous_run: previousRun
      });
    }
  }

  // 2. Distributed lock (5 minute TTL, per-slot)
  var lockAcquired = await store.acquireOptimizerLock(slot);
  if (!lockAcquired) {
    console.log('[Monitor] Lock held by another instance.', { date: today, slot: slot, runId: runId });
    return res.status(200).json({
      timestamp: now.toISOString(),
      run_id: runId,
      slot: slot,
      skipped: true,
      reason: 'lock_held'
    });
  }

  try {
    // 3. Execute monitoring logic
    var result = await runMonitor(now);

    // 4. Persist run metadata (per-slot)
    var runMeta = {
      run_id: runId,
      slot: slot,
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
    await store.setOptimizerRun(today, slot, runMeta);

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
      slot: slot,
      triggers: result.triggers_fired,
      notification: result.notification_sent
    });

    result.run_id = runId;
    result.slot = slot;
    result.auth_source = authSource;

    // Include recovery queue stats
    try {
      result.recovery_queue_length = await eventState.getRecoveryQueueLength();
    } catch (e) { result.recovery_queue_length = -1; }

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
    await store.setOptimizerRun(today, slot, {
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
    await store.releaseOptimizerLock(slot);
  }
}

async function runMonitor(now) {
  var triggers = [];
  var autoActions = [];

  // --- Fetch all data via meta-insights-source ---
  var snap = await insights.fetchFullSnapshot(now);
  var apiErrors = snap.errors || [];
  var adInsights = snap.ads || [];
  var adsets = snap.activeAdsets || [];
  var adsetInsights = snap.adsetInsights3d || [];
  var adsetInsights7d = snap.adsetInsights7d || [];
  var todayAdsets = snap.todayAdsets || [];
  var billing = snap.billing;

  // --- Evaluate triggers ---

  // TRIGGER 1: AD KILLER
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;
    if (impressions >= 1000 && ctr < 0.8) {
      triggers.push({
        severity: 'URGENT', rule: 'AD_KILLER', target: ad.ad_name, target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft " + impressions + " impressies maar CTR van " + ctr.toFixed(2) + "%. Pauzeer deze ad."
      });
    }
  });

  // TRIGGER 2: CREATIVE FATIGUE
  adInsights.forEach(function (ad) {
    var frequency = parseFloat(ad.frequency) || 0;
    if (frequency > 3.0) {
      triggers.push({
        severity: 'URGENT', rule: 'CREATIVE_FATIGUE', target: ad.ad_name, target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft frequency " + frequency.toFixed(1) + ". Maak nieuwe creative aan."
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
        severity: 'WARNING', rule: 'BUDGET_UNDERUTILIZED', target: adset.name, target_id: adset.id,
        message: "Ad set '" + adset.name + "' besteedt slechts " + pct.toFixed(0) + "% van budget."
      });
    }
  });

  // TRIGGER 4: LEARNING LIMITED
  adsets.forEach(function (adset) {
    if (adset.effective_status === 'LEARNING_LIMITED') {
      triggers.push({
        severity: 'WARNING', rule: 'LEARNING_LIMITED', target: adset.name, target_id: adset.id,
        message: "Ad set '" + adset.name + "' zit vast in Learning Limited."
      });
    }
  });

  // TRIGGER 5: WINNER
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
        severity: 'INFO', rule: 'WINNER', target: ad.ad_name, target_id: ad.ad_id,
        message: "Winner: '" + ad.ad_name + "' (CTR " + ctr.toFixed(1) + "%, Cost/ATC €" + costPerAtc.toFixed(2) + ")."
      });
    }
  });

  // TRIGGER 6: SPENDING SPIKE
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var todayRow = todayAdsets.find(function (i) { return i.adset_id === adset.id; });
    var todaySpendVal = todayRow ? parseFloat(todayRow.spend) || 0 : 0;
    if (todaySpendVal > dailyBudgetEur * 1.5 && todaySpendVal > 0) {
      triggers.push({
        severity: 'URGENT', rule: 'SPENDING_SPIKE', target: adset.name, target_id: adset.id,
        message: "Spend alert: €" + todaySpendVal.toFixed(2) + " vandaag bij budget €" + dailyBudgetEur.toFixed(2) + "."
      });
    }
  });

  // TRIGGER 7: SPEND IMBALANCE (ads within same adset)
  var adsByAdset = {};
  adInsights.forEach(function (ad) {
    if (!adsByAdset[ad.adset_id]) adsByAdset[ad.adset_id] = [];
    adsByAdset[ad.adset_id].push(ad);
  });
  Object.keys(adsByAdset).forEach(function (adsetId) {
    var siblings = adsByAdset[adsetId];
    if (siblings.length < 2) return;
    var totalSpend = siblings.reduce(function (s, a) { return s + (parseFloat(a.spend) || 0); }, 0);
    if (totalSpend < 5) return;
    siblings.forEach(function (ad) {
      var adSpend = parseFloat(ad.spend) || 0;
      var pct = (adSpend / totalSpend) * 100;
      var impressions = parseInt(ad.impressions) || 0;
      if (pct < 5 && impressions < 100 && totalSpend > 10) {
        triggers.push({
          severity: 'WARNING', rule: 'SPEND_STARVED', target: ad.ad_name, target_id: ad.ad_id,
          message: "Ad '" + ad.ad_name + "' krijgt slechts " + pct.toFixed(0) + "% van adset spend (" + impressions + " impressies). Niet genoeg data om creative te beoordelen."
        });
      }
    });
  });

  // --- Funnel triggers from 7-day data ---
  var f7 = snap.sevenDays;

  // TRIGGER 8: CHECKOUT DROP-OFF
  if (f7.ic >= 5 && f7.purchases > 0) {
    var icToPurchaseRate = (f7.purchases / f7.ic * 100);
    if (icToPurchaseRate < 25) {
      triggers.push({
        severity: 'WARNING', rule: 'CHECKOUT_DROPOFF', target: 'Website funnel', target_id: null,
        message: 'Checkout drop-off: ' + icToPurchaseRate.toFixed(0) + '% IC→Purchase (' + f7.purchases + '/' + f7.ic + ').'
      });
    }
  }

  // TRIGGER 9: CART ABANDONMENT
  if (f7.atc >= 5) {
    var atcToIcRate = f7.ic > 0 ? (f7.ic / f7.atc * 100) : 0;
    if (atcToIcRate < 30) {
      triggers.push({
        severity: 'WARNING', rule: 'CART_ABANDONMENT', target: 'Website funnel', target_id: null,
        message: 'Cart abandonment: ' + atcToIcRate.toFixed(0) + '% ATC→IC (' + f7.ic + '/' + f7.atc + ').'
      });
    }
  }

  // TRIGGER 10: LOW VC→ATC
  if (f7.vc >= 20) {
    var vcToAtcRate = f7.atc > 0 ? (f7.atc / f7.vc * 100) : 0;
    if (vcToAtcRate < 5) {
      triggers.push({
        severity: 'WARNING', rule: 'LOW_PRODUCT_CONVERSION', target: 'Website funnel', target_id: null,
        message: 'Productpagina: ' + vcToAtcRate.toFixed(1) + '% VC→ATC (' + f7.atc + '/' + f7.vc + ').'
      });
    }
  }

  // TRIGGER 11: HIGH CPC
  if (f7.clicks > 0 && f7.cpc > 2.0) {
    triggers.push({
      severity: 'INFO', rule: 'HIGH_CPC', target: 'Ads overall', target_id: null,
      message: 'Gemiddelde CPC €' + f7.cpc.toFixed(2) + '. Overweeg nieuwe creatives.'
    });
  }

  // TRIGGER 12: BILLING
  if (billing) {
    var threshold = billing.billing_threshold;
    var balance = billing.balance || 0;
    if (threshold > 0 && balance > 0) {
      var billingPct = (balance / threshold * 100);
      if (billingPct >= BILLING_ALERT_PCT) {
        triggers.push({
          severity: 'URGENT', rule: 'BILLING_THRESHOLD', target: 'Account billing', target_id: null,
          message: 'Facturatie: €' + balance.toFixed(2) + '/€' + threshold + ' (' + billingPct.toFixed(0) + '%).'
        });
      }
    }
  }

  // --- Auto-actions (only when config allows) ---
  if (AUTO_PAUSE) {
    var adKillTriggers = triggers.filter(function (t) { return t.rule === 'AD_KILLER'; });
    for (var ak = 0; ak < adKillTriggers.length; ak++) {
      try {
        var pauseResult = await apiPost(adKillTriggers[ak].target_id, { status: 'PAUSED' });
        autoActions.push({
          action: 'PAUSE_AD', target: adKillTriggers[ak].target, target_id: adKillTriggers[ak].target_id,
          success: Boolean(pauseResult && pauseResult.ok)
        });
      } catch (e) {
        autoActions.push({ action: 'PAUSE_AD', target: adKillTriggers[ak].target, target_id: adKillTriggers[ak].target_id, success: false, error: e.message });
      }
    }
  }

  // --- Build top ads performance table ---
  var topAds = adInsights.slice(0, 10).map(function (ad) {
    var adSpend = parseFloat(ad.spend) || 0;
    var adCtr = parseFloat(ad.ctr) || 0;
    var adCpc = parseFloat(ad.cpc) || 0;
    var actions = ad.actions || [];
    var adAtc = parseActionValue(actions, ATC_TYPES);
    var adPurchases = parseActionValue(actions, PURCHASE_TYPES);
    return {
      name: (ad.ad_name || '').substring(0, 25),
      spend: adSpend,
      ctr: adCtr,
      cpc: adCpc,
      atc: adAtc,
      purchases: adPurchases
    };
  });

  // --- Build notification ---
  var urgentTriggers = triggers.filter(function (t) { return t.severity === 'URGENT'; });
  var warningTriggers = triggers.filter(function (t) { return t.severity === 'WARNING'; });
  var infoTriggers = triggers.filter(function (t) { return t.severity === 'INFO'; });

  // --- Fetch EMQ match_keys + country data (morning only to save API calls) ---
  var emqData = null;
  var countryData = null;
  var slotLabel = getSlotLabel(now);
  if (slotLabel === 'morning') {
    try {
      var emqCountryResults = await Promise.all([
        insights.fetchMatchKeysStats(now),
        insights.fetchCountryBreakdown(now)
      ]);
      emqData = emqCountryResults[0];
      countryData = emqCountryResults[1];
    } catch (e) {
      console.warn('[Monitor] EMQ/country fetch error:', e.message);
    }
  }

  // --- Send compact Ad Pulse message (every run) ---
  var pulseMsg = await formatPulseMessage(now, snap);
  var pulseResult = await sendTelegram(pulseMsg);

  // --- Send full monitor report only on morning slot ---
  var telegramResult = pulseResult;
  if (slotLabel === 'morning' && (urgentTriggers.length > 0 || warningTriggers.length > 0 || infoTriggers.length > 0)) {
    var msg = formatMessage(now, urgentTriggers, warningTriggers, infoTriggers, apiErrors, snap, topAds, autoActions);
    telegramResult = await sendTelegram(msg);
  }

  // --- Send EMQ + Country report (morning only, separate message) ---
  if (slotLabel === 'morning' && (emqData || countryData)) {
    var emqMsg = formatEmqCountryMessage(now, emqData, countryData);
    if (emqMsg) {
      await sendTelegram(emqMsg);
    }
  }

  // --- Ad copy audit (morning slot only, 1x/day) ---
  if (slotLabel === 'morning') {
    try {
      var auditResult = await adCopyAuditor.runAudit();
      console.log('[Monitor] Ad copy audit:', auditResult.skipped ? 'skipped (' + auditResult.reason + ')' : auditResult.ads_analyzed + ' ads analyzed');
    } catch (auditErr) {
      console.warn('[Monitor] Ad copy audit error:', auditErr.message);
    }
  }

  // --- Cache today's data for tomorrow's comparison ---
  var todayCache = {
    spend: snap.today ? snap.today.spend : 0,
    purchases: snap.today ? snap.today.purchases : 0,
    revenue: snap.today ? snap.today.revenue : 0,
    impressions: snap.today ? snap.today.impressions : 0,
    clicks: snap.today ? snap.today.clicks : 0
  };
  await store.set('pulse:daily:' + dates.todayKey(now), JSON.stringify(todayCache), 172800);

  // --- Cache EMQ coverage for trend tracking (30 days) ---
  if (emqData && emqData.ok) {
    await store.set('emq:daily:' + dates.todayKey(now), JSON.stringify({
      coverage: emqData.coverage,
      total: emqData.total,
      ts: now.toISOString()
    }), 30 * 86400);
  }

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
    auto_actions: autoActions.length,
    notification_sent: true,
    telegram_response: telegramResult,
    windsurf_task: taskGenerated,
    triggers: triggers
  };
}

/**
 * Build compact Ad Pulse message for Telegram (5-second phone read).
 */
async function formatPulseMessage(now, snap) {
  var dtStr = dates.formatDateTimeAmsterdam(now);
  var tf = snap.today;

  if (!tf || tf.spend === 0) {
    return 'CALQIX Ad Pulse - ' + dtStr + '\nNo active spend today.';
  }

  // Daily budget from active adsets
  var dailyBudget = 0;
  (snap.activeAdsets || []).forEach(function (a) {
    if (a.daily_budget) dailyBudget += parseInt(a.daily_budget, 10) / 100;
  });
  // Fallback to campaign-level if no adset budgets
  if (dailyBudget === 0) dailyBudget = 40;

  // Spend pacing adjusted for time of day
  var amHour = dates.getAmsterdamHour(now);
  var hoursElapsed = Math.max(amHour, 1);
  var expectedPct = hoursElapsed / 24;
  var pacing = expectedPct > 0 ? Math.round((tf.spend / dailyBudget) / expectedPct * 100) : 0;

  var lines = [
    '<b>CALQIX Ad Pulse</b> - ' + dtStr,
    '',
    'Spend: EUR ' + tf.spend.toFixed(2) + ' / EUR ' + dailyBudget.toFixed(0) + ' (' + pacing + '%)',
    'Impressions: ' + formatNum(tf.impressions) + ' | Clicks: ' + formatNum(tf.clicks),
    'CTR: ' + tf.ctr.toFixed(2) + '% | CPC: EUR ' + tf.cpc.toFixed(2),
    'Purchases: ' + tf.purchases + ' | CPA: ' + (tf.purchases > 0 ? 'EUR ' + tf.costPerPurchase.toFixed(2) : 'n/a'),
    'ROAS: ' + tf.roas.toFixed(2) + 'x'
  ];

  // Best and worst ad (from 3d data since today may have no ad-level yet)
  var adRows = snap.ads || [];
  if (adRows.length > 0) {
    var sorted = adRows.slice().sort(function (a, b) {
      return (parseFloat(b.ctr) || 0) - (parseFloat(a.ctr) || 0);
    });
    var best = sorted[0];
    var worst = sorted[sorted.length - 1];
    var bestPurch = parseActionValue(best.actions || [], PURCHASE_TYPES);
    var worstPurch = parseActionValue(worst.actions || [], PURCHASE_TYPES);
    lines.push('');
    lines.push('Best: "' + truncateName(best.ad_name, 30) + '" CTR ' + (parseFloat(best.ctr) || 0).toFixed(2) + '%, ' + bestPurch + ' purch');
    if (worst.ad_id !== best.ad_id) {
      lines.push('Worst: "' + truncateName(worst.ad_name, 30) + '" CTR ' + (parseFloat(worst.ctr) || 0).toFixed(2) + '%, ' + worstPurch + ' purch');
    }
  }

  // vs yesterday comparison
  try {
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    var yKey = 'pulse:daily:' + dates.todayKey(yesterday);
    var yData = await store.get(yKey);
    if (yData) {
      var yd = typeof yData === 'string' ? JSON.parse(yData) : yData;
      var spendDiff = yd.spend > 0 ? Math.round((tf.spend - yd.spend) / yd.spend * 100) : 0;
      var purchDiff = tf.purchases - (yd.purchases || 0);
      lines.push('');
      lines.push('vs yesterday: spend ' + (spendDiff >= 0 ? '+' : '') + spendDiff + '%, purchases ' + (purchDiff >= 0 ? '+' : '') + purchDiff);
    }
  } catch (e) { /* skip comparison */ }

  return lines.join('\n');
}

function formatNum(n) {
  if (!n) return '0';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function truncateName(s, len) {
  if (!s) return '';
  return s.length > len ? s.substring(0, len - 3) + '...' : s;
}

function formatMessage(now, urgent, warning, info, apiErrors, snap, topAds, autoActions) {
  var iso = now.toISOString().split('T')[0].split('-');
  var dateStr = iso[2] + '-' + iso[1] + '-' + iso[0];
  var lines = ['\ud83d\udcca <b>CALQIX Ads Monitor - ' + dateStr + '</b>\n'];

  // API errors
  if (apiErrors.length > 0) {
    lines.push('\u2699\ufe0f <b>API WARNINGS:</b>');
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
    lines.push('\ud83d\udd34 <b>ACTIE NODIG:</b>');
    urgent.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (adWarnings.length > 0) {
    lines.push('\u26a0\ufe0f <b>ADS - LET OP:</b>');
    adWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (websiteWarnings.length > 0) {
    lines.push('\ud83c\udf10 <b>WEBSITE OPTIMALISATIE:</b>');
    websiteWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (info.length > 0) {
    lines.push('\ud83c\udfc6 <b>WINNERS:</b>');
    info.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  // Auto-actions executed
  if (autoActions && autoActions.length > 0) {
    lines.push('\ud83e\udd16 <b>AUTO-ACTIES:</b>');
    autoActions.forEach(function (a) {
      var status = a.success ? '\u2705' : '\u274c';
      lines.push('- ' + status + ' ' + a.action + ': ' + a.target);
    });
    lines.push('');
  }

  // TODAY real-time funnel (Meta-attributed)
  var tf = snap.today;
  if (tf) {
    lines.push('\u26a1 <b>VANDAAG (Meta-attributed):</b>');
    lines.push('- Spend: \u20ac' + tf.spend.toFixed(2));
    lines.push('- VC\u2192ATC\u2192IC\u2192Purchase: ' + tf.vc + '\u2192' + tf.atc + '\u2192' + tf.ic + '\u2192' + tf.purchases);
    if (tf.revenue > 0) {
      lines.push('- Revenue: \u20ac' + tf.revenue.toFixed(2));
      if (tf.spend > 0) lines.push('- ROAS: ' + tf.roas.toFixed(2) + 'x');
    }
    if (tf.atc > 0) lines.push('- Cost/ATC: \u20ac' + tf.costPerAtc.toFixed(2));
    if (tf.purchases > 0) lines.push('- Cost/Purchase: \u20ac' + tf.costPerPurchase.toFixed(2));
    lines.push('');
  }

  // 7-day funnel summary (Meta-attributed)
  var f7 = snap.sevenDays;
  if (f7) {
    lines.push('\ud83d\udcc8 <b>7-DAG FUNNEL (Meta-attributed):</b>');
    lines.push('- Spend: \u20ac' + f7.spend.toFixed(2));
    lines.push('- VC\u2192ATC\u2192IC\u2192Purchase: ' + f7.vc + '\u2192' + f7.atc + '\u2192' + f7.ic + '\u2192' + f7.purchases);
    if (f7.revenue > 0) {
      lines.push('- Revenue: \u20ac' + f7.revenue.toFixed(2));
      if (f7.spend > 0) lines.push('- ROAS: ' + f7.roas.toFixed(2) + 'x');
    }
    if (f7.atc > 0) lines.push('- Cost/ATC: \u20ac' + f7.costPerAtc.toFixed(2));
    if (f7.purchases > 0) lines.push('- Cost/Purchase: \u20ac' + f7.costPerPurchase.toFixed(2));
    lines.push('');
  }

  // Top ads performance (3d)
  if (topAds && topAds.length > 0) {
    lines.push('\ud83c\udfaf <b>TOP ADS (3d):</b>');
    topAds.forEach(function (ad) {
      var line = '\u2022 ' + ad.name;
      line += ' | \u20ac' + ad.spend.toFixed(2);
      line += ' | CTR ' + ad.ctr.toFixed(1) + '%';
      if (ad.atc > 0) line += ' | ATC ' + ad.atc;
      if (ad.purchases > 0) line += ' | Purch ' + ad.purchases;
      lines.push(line);
    });
    lines.push('');
  }

  // Billing section
  var billing = snap.billing;
  if (billing) {
    lines.push('\ud83d\udcb3 <b>ACCOUNT & BILLING:</b>');
    if (billing.balance !== null) lines.push('- Openstaand: \u20ac' + billing.balance.toFixed(2));
    if (billing.amount_spent !== null) lines.push('- Totaal uitgegeven: \u20ac' + billing.amount_spent.toFixed(2));
    lines.push('- Drempel: \u20ac' + billing.billing_threshold + ' (' + billing.billing_threshold_source + ')');
    if (billing.spend_cap !== null) lines.push('- Spend cap: \u20ac' + billing.spend_cap.toFixed(2));
    lines.push('');
  }

  // All-clear
  if (urgent.length === 0 && warning.length === 0) {
    lines.push('\u2705 Geen urgente acties nodig.');
  }

  // Auto-action config status
  lines.push('\n\ud83d\udd27 Auto: pause=' + (AUTO_PAUSE ? 'ON' : 'OFF') + ' budget=' + (AUTO_BUDGET_ADJUST ? 'ON' : 'OFF'));

  // Operator action instructions
  if (urgent.length > 0 || warning.length > 0) {
    var dateStr2 = now.toISOString().split('T')[0];
    lines.push('\n\ud83d\udcdd <b>ACTIE VEREIST:</b>');
    lines.push('1. <code>.windsurf/tasks/ads-' + dateStr2 + '.md</code>');
    lines.push('2. <code>/ads-optimize</code> in Windsurf');
    lines.push('3. Of handmatig via Meta Ads Manager.');
  }

  return lines.join('\n');
}

/**
 * Format EMQ coverage + Country performance Telegram message.
 * Sent once daily (morning slot) for continuous optimization insights.
 */
function formatEmqCountryMessage(now, emqData, countryData) {
  var dtStr = now.toISOString().split('T')[0];
  var lines = ['<b>CALQIX Data Quality Report</b> - ' + dtStr, ''];

  // EMQ Coverage section
  if (emqData && emqData.ok) {
    lines.push('<b>Match Keys Coverage (24h):</b>');
    lines.push('Total events: ' + formatNum(emqData.total));
    var cov = emqData.coverage;
    var emqKeys = [
      { k: 'external_id', label: 'External ID' },
      { k: 'email', label: 'Email' },
      { k: 'ph', label: 'Phone' },
      { k: 'fn', label: 'First name' },
      { k: 'ln', label: 'Last name' },
      { k: 'country', label: 'Country' },
      { k: 'ct', label: 'City' },
      { k: 'zip', label: 'Postal code' }
    ];
    emqKeys.forEach(function (item) {
      var pct = cov[item.k] || 0;
      var icon = pct >= 50 ? '\u2705' : pct >= 20 ? '\u26a0\ufe0f' : '\u274c';
      lines.push(icon + ' ' + item.label + ': ' + pct + '% (' + (emqData.keys[item.k] || 0) + ')');
    });

    // Overall EMQ estimate (weighted)
    var emqScore = Math.min(10, Math.round(
      ((cov.email || 0) * 0.25 +
       (cov.external_id || 0) * 0.15 +
       (cov.ph || 0) * 0.20 +
       (cov.fn || 0) * 0.10 +
       (cov.ln || 0) * 0.10 +
       (cov.country || 0) * 0.10 +
       (cov.ct || 0) * 0.05 +
       (cov.zip || 0) * 0.05) / 10
    ));
    lines.push('');
    lines.push('Estimated EMQ: ' + emqScore + '/10');
    lines.push('');
  } else if (emqData) {
    lines.push('EMQ data unavailable: ' + (emqData.error || 'unknown'));
    lines.push('');
  }

  // Country breakdown section
  if (countryData && countryData.ok && countryData.countries.length > 0) {
    lines.push('<b>Country Performance (7d):</b>');
    var topCountries = countryData.countries.slice(0, 8);
    topCountries.forEach(function (c) {
      var roas = c.roas > 0 ? c.roas.toFixed(1) + 'x' : '-';
      var cpa = c.cpa > 0 ? 'EUR ' + c.cpa.toFixed(2) : '-';
      lines.push(
        c.country.toUpperCase() +
        ' | EUR ' + c.spend.toFixed(2) +
        ' | ' + c.purchases + ' purch' +
        ' | ROAS ' + roas +
        ' | CPA ' + cpa
      );
    });

    // Highlight best and worst
    var withPurchases = countryData.countries.filter(function (c) { return c.purchases > 0; });
    if (withPurchases.length > 0) {
      var bestRoas = withPurchases.reduce(function (a, b) { return a.roas > b.roas ? a : b; });
      var worstRoas = withPurchases.reduce(function (a, b) { return a.roas < b.roas ? a : b; });
      lines.push('');
      lines.push('Best ROAS: ' + bestRoas.country.toUpperCase() + ' ' + bestRoas.roas.toFixed(1) + 'x');
      if (worstRoas.country !== bestRoas.country) {
        lines.push('Lowest ROAS: ' + worstRoas.country.toUpperCase() + ' ' + worstRoas.roas.toFixed(1) + 'x');
      }
    }
  }

  // Only return if we have content
  if (lines.length <= 2) return null;
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
module.exports.config = { api: { bodyParser: false } };
