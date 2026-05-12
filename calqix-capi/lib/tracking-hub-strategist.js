/**
 * Tracking Hub Strategist
 *
 * Uses OpenAI for a 15-minute tracking + ads quality review, with deterministic
 * fallback rules when OpenAI is unavailable. This module never sends synthetic
 * CAPI events and never executes ad writes directly; executable ad changes are
 * queued for Telegram/operator approval.
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');
var approvalQueue = require('./approval-queue');
var rulesEngine = require('./ad-rules-engine');
var { sendTelegram } = require('./telegram');

var OPENAI_URL = 'https://api.openai.com/v1/responses';
var DEFAULT_MODEL = process.env.OPENAI_TRACKING_MODEL || 'gpt-5.5';
var FALLBACK_MODEL = process.env.OPENAI_TRACKING_FALLBACK_MODEL || 'gpt-5.2';
var RESULT_TTL = 14 * 86400;

function isEnabled() {
  return process.env.TRACKING_HUB_ENABLED !== 'false';
}

function hasOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function getNumber(value) {
  var n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function summarizeCoverage(summary) {
  var out = {};
  Object.keys(summary || {}).forEach(function (eventName) {
    var row = summary[eventName] || {};
    var total = row.total || 0;
    out[eventName] = {
      total: total,
      email: pct(row.em || 0, total),
      phone: pct(row.ph || 0, total),
      fbp: pct(row.fbp || 0, total),
      fbc: pct(row.fbc || 0, total),
      external_id: pct(row.external_id || 0, total),
      name: pct((row.fn || 0) + (row.ln || 0), total * 2)
    };
  });
  return out;
}

function summarizeAdSnapshot(snapshot) {
  var adRows = (snapshot && snapshot.adRows) || [];
  var adsetRows = (snapshot && snapshot.adsetRows) || [];
  var campaignRows = (snapshot && snapshot.campaignRows) || [];
  var adsetConfigs = (snapshot && snapshot.adsetConfigs) || [];
  var campaignConfigs = (snapshot && snapshot.campaignConfigs) || [];

  var totalSpend = adRows.reduce(function (sum, row) { return sum + getNumber(row.spend); }, 0);
  var purchases = adRows.reduce(function (sum, row) { return sum + (parseInt(row.purchases, 10) || 0); }, 0);
  var revenue = adRows.reduce(function (sum, row) { return sum + getNumber(row.revenue); }, 0);

  var adsetConfigMap = {};
  adsetConfigs.forEach(function (adset) { adsetConfigMap[adset.id] = adset; });
  var campaignConfigMap = {};
  campaignConfigs.forEach(function (campaign) { campaignConfigMap[campaign.id] = campaign; });

  var adsByAdset = {};
  adRows.forEach(function (ad) {
    var key = ad.adset_id || 'unknown';
    if (!adsByAdset[key]) adsByAdset[key] = [];
    adsByAdset[key].push(ad);
  });

  var spendStarved = [];
  Object.keys(adsByAdset).forEach(function (adsetId) {
    var siblings = adsByAdset[adsetId];
    if (siblings.length < 2) return;
    var adsetSpend = siblings.reduce(function (sum, ad) { return sum + getNumber(ad.spend); }, 0);
    if (adsetSpend < 10) return;
    siblings.forEach(function (ad) {
      var share = adsetSpend ? (getNumber(ad.spend) / adsetSpend) * 100 : 0;
      if (share < 5 && (parseInt(ad.impressions, 10) || 0) < 100) {
        spendStarved.push({
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          adset_id: adsetId,
          adset_name: ad.adset_name,
          campaign_id: ad.campaign_id,
          campaign_name: ad.campaign_name,
          spend: getNumber(ad.spend),
          spend_share_pct: Math.round(share),
          impressions: parseInt(ad.impressions, 10) || 0,
          recommendation: 'Niet beoordelen als verliezer; eerst delivery/creative test aanpassen.'
        });
      }
    });
  });

  var underDelivery = adsetRows.map(function (adset) {
    var config = adsetConfigMap[adset.adset_id] || {};
    var dailyBudget = config.daily_budget ? parseInt(config.daily_budget, 10) / 100 : 0;
    var expected = dailyBudget * Math.max(snapshot.lookbackDays || 3, 1);
    var spend = getNumber(adset.spend);
    var deliveryPct = expected ? Math.round((spend / expected) * 100) : null;
    if (!dailyBudget || deliveryPct === null || deliveryPct >= 45) return null;
    return {
      adset_id: adset.adset_id,
      adset_name: adset.adset_name,
      campaign_id: adset.campaign_id,
      campaign_name: adset.campaign_name,
      spend: spend,
      expected_spend: Math.round(expected * 100) / 100,
      delivery_pct: deliveryPct,
      status: config.effective_status || 'unknown',
      optimization_goal: config.optimization_goal || 'unknown'
    };
  }).filter(Boolean);

  var scaleCandidates = adsetRows.map(function (adset) {
    var config = adsetConfigMap[adset.adset_id] || {};
    var campaign = campaignConfigMap[adset.campaign_id] || {};
    var currentAdsetBudget = config.daily_budget ? parseInt(config.daily_budget, 10) / 100 : 0;
    var currentCampaignBudget = campaign.daily_budget ? parseInt(campaign.daily_budget, 10) / 100 : 0;
    var cpa = getNumber(adset.cost_per_purchase);
    var roas = getNumber(adset.roas);
    var spend = getNumber(adset.spend);
    var purchases = parseInt(adset.purchases, 10) || 0;
    var targetCpa = rulesEngine.TARGET_CPA();
    var strong = (purchases >= 2 && roas >= 2.0 && spend >= 15) ||
      (purchases >= 2 && cpa > 0 && cpa <= targetCpa);
    if (!strong) return null;

    var isCbo = currentCampaignBudget > 0;
    var baseBudget = isCbo ? currentCampaignBudget : currentAdsetBudget;
    if (!baseBudget) return null;
    var maxBudget = isCbo ? 200 : rulesEngine.MAX_ADSET_BUDGET();
    var increasePct = purchases >= 3 ? 1.2 : 1.15;
    var newBudget = Math.min(baseBudget * increasePct, maxBudget);
    if (newBudget <= baseBudget) return null;

    return {
      type: isCbo ? 'scale_campaign' : 'scale_adset',
      entity_id: isCbo ? adset.campaign_id : adset.adset_id,
      entity_name: isCbo ? adset.campaign_name : adset.adset_name,
      source_adset_id: adset.adset_id,
      source_adset_name: adset.adset_name,
      current_budget_eur: Math.round(baseBudget * 100) / 100,
      suggested_budget_eur: Math.round(newBudget * 100) / 100,
      new_budget_cents: Math.round(newBudget * 100),
      roas: Math.round(roas * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      purchases: purchases,
      reason: 'Sterke performer: ROAS ' + roas.toFixed(2) + 'x, CPA EUR ' + cpa.toFixed(2) + ', ' + purchases + ' purchases.'
    };
  }).filter(Boolean);

  return {
    totals: {
      spend: Math.round(totalSpend * 100) / 100,
      purchases: purchases,
      revenue: Math.round(revenue * 100) / 100,
      roas: totalSpend > 0 ? Math.round((revenue / totalSpend) * 100) / 100 : 0
    },
    counts: {
      ads: adRows.length,
      adsets: adsetRows.length,
      campaigns: campaignRows.length
    },
    spend_starved: spendStarved.slice(0, 8),
    under_delivery: underDelivery.slice(0, 8),
    scale_candidates: scaleCandidates.slice(0, 8),
    errors: (snapshot && snapshot.errors) || []
  };
}

function buildDeterministicPlan(context) {
  var coverage = summarizeCoverage(context.coverage && context.coverage.raw);
  var tracking = [];
  Object.keys(coverage).forEach(function (eventName) {
    var row = coverage[eventName];
    if (row.total <= 0) return;
    if (eventName === 'Purchase' && row.email < 80) {
      tracking.push({
        priority: 'P1',
        title: 'Purchase email coverage verbeteren',
        action: 'Controleer checkout contact_info_submitted enrichment en identity-resubmit output.',
        metric: 'Purchase email ' + row.email + '%'
      });
    }
    if (row.fbp < 80) {
      tracking.push({
        priority: 'P1',
        title: eventName + ' mist _fbp browser identity',
        action: 'Controleer Custom Pixel cookie access en browser bridge payloads.',
        metric: eventName + ' fbp ' + row.fbp + '%'
      });
    }
    if (row.external_id < 80 && (eventName === 'Purchase' || eventName === 'InitiateCheckout')) {
      tracking.push({
        priority: 'P2',
        title: eventName + ' external_id coverage verhogen',
        action: 'Vul Shopify customer/order identifiers consequent in enrichment en webhook merge.',
        metric: eventName + ' external_id ' + row.external_id + '%'
      });
    }
  });

  if (!tracking.length) {
    tracking.push({
      priority: 'OK',
      title: 'Trackingkwaliteit stabiel',
      action: 'Blijf EMQ, dedup en identity-resubmit elk kwartier monitoren.',
      metric: 'Geen P0/P1 patroon in huidige snapshot'
    });
  }

  var ad = context.ad_performance || {};
  var ops = context.operational_audits || {};
  var metaQuality = ops.meta_capi_quality || {};
  (metaQuality.recommendations || []).slice(0, 6).forEach(function (rec) {
    tracking.push({
      priority: rec.priority || 'P2',
      title: rec.title || 'Meta CAPI quality check',
      action: rec.action || 'Verwerk volgens Meta CAPI baseline.',
      metric: (rec.metric || '') + (metaQuality.score !== undefined ? ' | norm-score ' + metaQuality.score + '/100' : '')
    });
  });

  var scheduleChecks = ops.schedule_checks || {};
  if (scheduleChecks.available !== false &&
      (scheduleChecks.tracking_hub_15m === false || scheduleChecks.recovery_1m === false)) {
    tracking.push({
      priority: 'P1',
      title: 'Continuous checks schedule niet volledig',
      action: 'Herstel QStash schedules voor tracking-hub kwartiercheck en recovery 1-minuut retry worker.',
      metric: 'tracking ' + Boolean(scheduleChecks.tracking_hub_15m) + ', recovery ' + Boolean(scheduleChecks.recovery_1m)
    });
  }

  var adSuggestions = [];
  (ad.spend_starved || []).forEach(function (item) {
    adSuggestions.push({
      type: 'creative_refresh',
      priority: 'P2',
      title: 'Ad krijgt geen eerlijke delivery',
      entity_id: item.ad_id,
      entity_name: item.ad_name,
      recommendation: 'Ping voor nieuwe angle of dupliceren in aparte test/adset; nog niet pauzeren op performance.',
      reason: item.spend_share_pct + '% adset spend en ' + item.impressions + ' impressies.'
    });
  });
  (ad.under_delivery || []).forEach(function (item) {
    adSuggestions.push({
      type: 'delivery_review',
      priority: 'P2',
      title: 'Adset besteedt budget niet',
      entity_id: item.adset_id,
      entity_name: item.adset_name,
      recommendation: 'Analyseer CBO dupliceren vs adset targeting/bid/budget aanpassen voordat creative wordt beoordeeld.',
      reason: item.delivery_pct + '% delivery vs verwacht budget.'
    });
  });
  (ad.scale_candidates || []).forEach(function (item) {
    adSuggestions.push({
      type: item.type,
      priority: 'P1',
      title: 'Budget naar winnaar verplaatsen',
      entity_id: item.entity_id,
      entity_name: item.entity_name,
      recommendation: 'Schaal naar EUR ' + item.suggested_budget_eur + ' per dag na Telegram akkoord.',
      reason: item.reason,
      new_budget_cents: item.new_budget_cents
    });
  });

  var metaBackfill = ops.meta_backfill || {};
  if (metaBackfill.status === 'warn') {
    tracking.push({
      priority: metaBackfill.failed_terminal > 0 ? 'P0' : 'P1',
      title: 'Meta backfill/recovery aandacht nodig',
      action: 'Controleer retry_pending, backfill:pending en identity-resubmit failures; verwerk alleen echte pending enrichment.',
      metric: 'pending ' + (metaBackfill.pending || 0) + ', retry ' + (metaBackfill.retry_pending || 0) + ', failures ' + (metaBackfill.failures_24h || 0)
    });
  }

  var platformSales = ops.platform_sales || {};
  if (platformSales.status === 'warn' || (platformSales.mismatch_count || 0) > 0) {
    tracking.push({
      priority: 'P1',
      title: 'Platform-sales audit mismatch',
      action: 'Vergelijk Shopify orders met Meta/Google/TikTok confirmed events en herstel ontbrekende platform fan-out.',
      metric: 'match ' + (platformSales.latest_match_rate || 'n/a') + '%, mismatches ' + (platformSales.mismatch_count || 0)
    });
  }

  var dashboardRecon = ops.dashboard_reconciliation || {};
  (dashboardRecon.gaps || []).forEach(function (gap) {
    tracking.push({
      priority: 'P1',
      title: gap.event + ' dashboard reconciliation gap',
      action: 'CAPI ingang, EMQ registratie en Meta lifecycle naast elkaar controleren.',
      metric: 'source ' + gap.source + ', EMQ ' + gap.emq + ', delta ' + gap.delta
    });
  });

  var capture = ops.capture_checks || {};
  (capture.weak || []).slice(0, 6).forEach(function (weak) {
    tracking.push({
      priority: weak.priority || (weak.field === 'fbp' ? 'P1' : 'P2'),
      title: weak.event + ' ' + weak.field + ' capture laag',
      action: 'Controleer bridge payload, request headers en cookie/click-id persistence.',
      metric: weak.field + ' ' + weak.pct + '% over ' + (weak.total || '?') + ' events'
    });
  });

  var fixes = ops.deterministic_fixes || {};
  if (fixes.threshold_broken) {
    var autoDeploy = fixes.auto_deploy || {};
    tracking.push({
      priority: fixes.severity || 'P1',
      title: 'Deterministische fix gate open',
      action: fixes.deploy_policy || 'Deploy alleen als fix direct een gebroken threshold oplost.',
      metric: (fixes.actions || []).slice(0, 2).join(' | ') + autoDeployMetric(autoDeploy)
    });
  }

  var autoSync = ops.auto_sync_customer_data || {};
  if (autoSync.attempted) {
    tracking.push({
      priority: autoSync.backfill && autoSync.backfill.ok === false ? 'P1' : 'P2',
      title: 'Klantdata auto-sync uitgevoerd',
      action: 'Identity backfill/resubmit verwerkt alleen bestaande events met betere identifiers.',
      metric: autoSyncMetric(autoSync)
    });
  } else if (autoSync.enabled && autoSync.reason && autoSync.reason !== 'no_relevant_identity_or_recovery_issue') {
    tracking.push({
      priority: 'P2',
      title: 'Klantdata auto-sync overgeslagen',
      action: 'Controleer cooldown of cron-auth als identity issues blijven staan.',
      metric: autoSync.reason
    });
  }

  if (tracking.length > 1) {
    tracking = tracking.filter(function (item) { return item.priority !== 'OK'; });
  }
  if (!tracking.length) {
    tracking.push({
      priority: 'OK',
      title: 'Trackingkwaliteit stabiel',
      action: 'Blijf EMQ, dedup en identity-resubmit elk kwartier monitoren.',
      metric: 'Geen P0/P1 patroon in huidige snapshot'
    });
  }

  return {
    source: 'deterministic',
    summary_nl: compactSummary(context, tracking, adSuggestions),
    tracking_recommendations: dedupeRecommendations(tracking).slice(0, 7),
    ad_recommendations: dedupeRecommendations(adSuggestions).slice(0, 8),
    no_action_needed: tracking.length === 1 && tracking[0].priority === 'OK' && adSuggestions.length === 0
  };
}

function compactSummary(context, tracking, ads) {
  var ops = context.operational_audits || {};
  var meta = ops.meta_backfill || {};
  var recon = ops.dashboard_reconciliation || {};
  var capture = ops.capture_checks || {};
  var fixes = ops.deterministic_fixes || {};
  var sales = ops.sales_risk || {};
  var quality = ops.meta_capi_quality || {};
  var autoSync = ops.auto_sync_customer_data || {};
  var schedules = ops.schedule_checks || {};
  var trend = ops.quality_trend || {};
  var standard = ops.meta_standard_check || {};
  var optimizations = ops.optimization_actions || [];
  var auto = fixes.auto_deploy || {};
  var status = fixes.threshold_broken ? 'actie nodig' : 'stabiel';
  return 'Kwartiercheck ' + status + ': backfill pending ' + (meta.pending || 0) +
    ', retry ' + (meta.retry_pending || 0) +
    ', Meta CAPI norm ' + (quality.score !== undefined ? quality.score + '/100' : 'n/a') +
    ', trend ' + (trend.direction || 'unknown') + '/' + (trend.rolling_direction || 'rolling unknown') +
    ', dashboard gaps ' + ((recon.gaps || []).length) +
    ', capture issues ' + ((capture.weak || []).length) +
    ', schedules ' + scheduleStatus(schedules) +
    ', normcheck ' + (standard.matches_current_run ? 'match' : (standard.highest_priority || 'warn')) +
    ', gedaan ' + optimizationStatus(optimizations) +
    ', sales risk ' + (sales.status || 'ok') +
    ', auto-sync ' + (autoSync.attempted ? 'gedraaid' : (autoSync.reason || 'standby')) +
    ', auto-deploy ' + (auto.triggered ? 'gestart' : (auto.reason || 'uit')) +
    ', ad punten ' + (ads || []).length + '.';
}

function optimizationStatus(actions) {
  if (!actions || !actions.length) return 'geen automatische actie';
  return actions.slice(0, 2).map(function (item) {
    return item.message || item.type || 'actie';
  }).join(' | ');
}

function scheduleStatus(schedules) {
  if (!schedules || schedules.available === false) return 'unknown';
  if (schedules.tracking_hub_15m && schedules.recovery_1m &&
      schedules.identity_backfill_15m && schedules.identity_resubmit_15m) {
    return 'ok';
  }
  return 'warn';
}

function autoDeployMetric(autoDeploy) {
  if (!autoDeploy) return '';
  if (autoDeploy.triggered) return ' | auto-deploy gestart';
  if (autoDeploy.reason) return ' | auto-deploy: ' + autoDeploy.reason;
  return '';
}

function autoSyncMetric(autoSync) {
  var backfill = autoSync.backfill || {};
  var resubmit = autoSync.resubmit || {};
  var recovery = autoSync.recovery || {};
  var parts = [];
  parts.push('backfill ' + (backfill.enriched !== undefined ? backfill.enriched : (backfill.reason || 'ok')));
  parts.push('resubmit ' + (resubmit.resubmitted !== undefined ? resubmit.resubmitted : (resubmit.reason || 'ok')));
  if (autoSync.recovery) parts.push('recovery ' + (recovery.retried !== undefined ? recovery.retried : (recovery.reason || 'ok')));
  return parts.join(', ');
}

function dedupeRecommendations(items) {
  var seen = {};
  return (items || []).filter(function (item) {
    var key = [
      item.priority || '',
      item.type || '',
      item.title || '',
      item.entity_id || '',
      item.metric || item.reason || item.recommendation || ''
    ].join('|').toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

async function runOpenAIAnalysis(context) {
  if (!hasOpenAI()) {
    return { ok: false, error: 'OPENAI_API_KEY missing', result: null };
  }

  var instructions = [
    'You are the CALQIX Tracking Hub agent. Output strict JSON only.',
    'Analyze Shopify to Meta tracking quality, EMQ identifiers, CAPI/Web Pixel/server webhook differences, and Meta ad performance.',
    'Use Meta CAPI standards: website action_source, event_source_url, stable event_id for dedup, fbp/fbc, IP/UA, hashed customer information parameters, and event-specific custom_data.',
    'Use telemetry.operational_audits.meta_standard_check.prompt as the internal requirements checklist for this run and state whether telemetry matches it.',
    'Compare telemetry.operational_audits.quality_trend and say if quality is improving, stable, or worsening.',
    'Report what automated optimization was executed from telemetry.operational_audits.optimization_actions; if none were needed, say no critical fixes were needed.',
    'Audit every funnel event: ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase.',
    'Separate data gaps from real zero-sales signals; do not invent Purchase events when Shopify has no order.',
    'Never recommend fake/redundant Meta events. Only retry events already in retry_pending/pending enrichment flows.',
    'Never log or expose raw PII. Talk only about identifier presence percentages.',
    'Never recommend ad budget above EUR 200 campaign daily budget or EUR 50 adset daily budget.',
    'Never pause campaigns. Budget changes must be approval-gated.',
    'For ads with no spend, decide whether CBO duplication, adset adjustment, or creative/angle refresh is the best next operator action.',
    'Return JSON with: summary_nl, tracking_recommendations[], ad_recommendations[], no_action_needed.'
  ].join('\n');

  var input = JSON.stringify({
    timestamp: dates.formatDateTimeAmsterdam(),
    telemetry: context
  });

  async function call(model) {
    var response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: model,
        instructions: instructions,
        input: input,
        max_output_tokens: 1800
      }),
      timeout: 60000
    });
    var data = await response.json();
    if (!response.ok) {
      return { ok: false, error: (data.error && data.error.message) || response.statusText, model: model };
    }
    var text = data.output_text || extractOutputText(data);
    var parsed = parseJson(text);
    if (!parsed) return { ok: false, error: 'JSON parse failed', model: model };
    return { ok: true, result: parsed, model: model };
  }

  var first = await call(DEFAULT_MODEL);
  if (first.ok) return first;
  if (DEFAULT_MODEL !== FALLBACK_MODEL && /model|not found|does not exist|unsupported/i.test(first.error || '')) {
    return call(FALLBACK_MODEL);
  }
  return first;
}

function extractOutputText(data) {
  var out = data && data.output;
  if (!Array.isArray(out)) return '';
  var parts = [];
  out.forEach(function (item) {
    if (Array.isArray(item.content)) {
      item.content.forEach(function (c) {
        if (c.text) parts.push(c.text);
      });
    }
  });
  return parts.join('\n');
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch (e2) {}
  }
  return null;
}

async function queueScaleRecommendation(rec, dryRun) {
  if (!rec || (rec.type !== 'scale_adset' && rec.type !== 'scale_campaign')) return null;
  if (!rec.entity_id || !rec.new_budget_cents) return null;

  var budgetEur = rec.new_budget_cents / 100;
  if (rec.type === 'scale_adset' && budgetEur > rulesEngine.MAX_ADSET_BUDGET()) return null;
  if (rec.type === 'scale_campaign' && budgetEur > 200) return null;

  var idemKey = 'tracking_hub:queued:' + dates.todayKey() + ':' + rec.type + ':' + rec.entity_id + ':' + rec.new_budget_cents;
  if (await store.get(idemKey)) return null;
  if (dryRun) return { dryRun: true, id: 'dry_run_' + rec.entity_id };

  var item = await approvalQueue.createItem({
    type: rec.type,
    entityName: rec.entity_name || rec.entity_id,
    entityId: rec.entity_id,
    reason: rec.reason || rec.recommendation || 'Tracking Hub scale recommendation',
    metrics: {
      source: 'tracking_hub',
      priority: rec.priority || 'P1',
      roas: rec.roas,
      cpa: rec.cpa,
      purchases: rec.purchases
    },
    expectedEffect: rec.recommendation || 'Budget gecontroleerd opschalen na akkoord.',
    sourceRule: 'tracking_hub_scale',
    payload: { newBudgetCents: rec.new_budget_cents }
  });
  await store.set(idemKey, item.id, 86400);
  return item;
}

async function notify(plan, queued, dryRun) {
  if (dryRun) return { sent: false, reason: 'dry_run' };

  var tracking = dedupeRecommendations(plan.tracking_recommendations || []);
  var ads = dedupeRecommendations(plan.ad_recommendations || []);
  if (plan.no_action_needed && !ads.length && process.env.TRACKING_HUB_NOTIFY_OK === 'false') {
    return { sent: false, reason: 'no_action_needed' };
  }

  var signature = buildTelegramSignature(plan, tracking, ads, queued);
  var dedupKey = 'tracking_hub:telegram:' + signature;
  if (await store.get(dedupKey)) {
    return { sent: false, reason: 'duplicate_compact_report' };
  }
  await store.set(dedupKey, '1', 14 * 60);

  return sendTelegram(buildCompactTelegramLines(plan, tracking, ads, queued).join('\n'), buildApprovalKeyboard(queued));

  var lines = [
    '<b>CALQIX kwartiercheck</b> ' + dates.formatDateTimeAmsterdam(),
    compactText(plan.summary_nl || 'Tracking en ads gecontroleerd.', 220)
  ];

  if (tracking.length) {
    lines.push('');
    lines.push('<b>Tracking</b>');
    tracking.slice(0, 3).forEach(function (rec) {
      lines.push('• ' + (rec.priority || 'P2') + ' ' + compactLine(rec.title || 'Tracking punt', rec.metric || rec.action || 'controleer'));
    });
  }

  if (ads.length) {
    lines.push('');
    lines.push('<b>Ads</b>');
    ads.slice(0, 3).forEach(function (rec) {
      lines.push('• ' + (rec.priority || 'P2') + ' ' + compactLine(rec.title || rec.type || 'Ad punt', rec.recommendation || rec.reason || 'review'));
    });
  }

  if (queued && queued.length) {
    lines.push('');
    lines.push('<b>Approval queue</b>');
    queued.slice(0, 3).forEach(function (item) {
      lines.push('• ' + item.id + ' → ' + item.entityName);
    });
  }

  var keyboard = null;
  if (queued && queued.length) {
    keyboard = {
      inline_keyboard: queued.slice(0, 3).map(function (item) {
        return [
          { text: 'Akkoord + uitvoeren', callback_data: 'execute:' + item.id },
          { text: 'Afwijzen', callback_data: 'reject:' + item.id }
        ];
      })
    };
  }

  return sendTelegram(lines.join('\n'), keyboard);
}

function buildCompactTelegramLines(plan, tracking, ads, queued) {
  var topTracking = highestPriorityItem(tracking);
  var topAd = highestPriorityItem(ads);
  var top = topTracking || topAd;
  var severity = (top && top.priority) || 'OK';
  var high = isHighPriority(severity);
  var ops = plan.operational_audits || {};
  var trend = ops.quality_trend || {};
  var standard = ops.meta_standard_check || {};
  var optimizations = ops.optimization_actions || [];
  var lines = [
    '<b>CALQIX kwartiercheck</b> ' + dates.formatDateTimeAmsterdam(),
    compactText(compactTelegramSummary(plan.summary_nl || 'Tracking en ads gecontroleerd.', tracking, ads), high ? 220 : 150)
  ];

  lines.push('Trend: ' + compactText((trend.message || trend.direction || 'unknown') + '; 8-run ' + (trend.rolling_direction || 'unknown'), 125));
  lines.push('Norm: Meta CAPI ' + (standard.version || 'actueel') + ' -> ' +
    (standard.matches_current_run ? 'match' : ((standard.highest_priority || 'warn') + ', score ' + (standard.score !== undefined ? standard.score + '/100' : 'n/a'))));
  lines.push('Gedaan: ' + compactText(optimizationStatus(optimizations), high ? 180 : 120));

  if (top) {
    lines.push((high ? '<b>Top punt</b> ' : 'Top: ') + (top.priority || 'P2') + ' ' +
      compactLine(top.title || top.type || 'Punt', top.metric || top.recommendation || top.reason || top.action || 'controleer', high ? 180 : 110));
  } else {
    lines.push('Top: OK Aanpassingen waren niet nodig; geen kritische fixes nodig geweest.');
  }

  if (high && top) {
    lines.push('Waarom: ' + compactText(explainHighPriority(top), 210));
  }

  if (!high && tracking.length + ads.length > 1) {
    lines.push('Overig: ' + Math.max((tracking.length + ads.length) - 1, 0) + ' lage/middel punten.');
  }

  if (queued && queued.length) {
    lines.push('Approval: ' + queued.slice(0, 2).map(function (item) {
      return item.id + ' -> ' + item.entityName;
    }).join(' | '));
  }

  return lines;
}

function buildApprovalKeyboard(queued) {
  if (!queued || !queued.length) return null;
  return {
    inline_keyboard: queued.slice(0, 3).map(function (item) {
      return [
        { text: 'Akkoord + uitvoeren', callback_data: 'execute:' + item.id },
        { text: 'Afwijzen', callback_data: 'reject:' + item.id }
      ];
    })
  };
}

function compactTelegramSummary(summary, tracking, ads) {
  var p0 = countPriority(tracking, ads, 'P0');
  var p1 = countPriority(tracking, ads, 'P1');
  var suffix = ' P0 ' + p0 + ', P1 ' + p1 + ', tracking ' + (tracking || []).length + ', ads ' + (ads || []).length + '.';
  var text = String(summary || '').replace(/\s+/g, ' ').trim();
  var scoreMatch = text.match(/Meta CAPI norm [^,.;]+/i);
  if (scoreMatch) return scoreMatch[0] + '.' + suffix;
  return text + suffix;
}

function countPriority(tracking, ads, priority) {
  return (tracking || []).concat(ads || []).filter(function (item) {
    return item.priority === priority;
  }).length;
}

function highestPriorityItem(items) {
  var best = null;
  (items || []).forEach(function (item) {
    if (!best || priorityRank(item.priority) > priorityRank(best.priority)) {
      best = item;
    }
  });
  return best;
}

function priorityRank(priority) {
  if (priority === 'P0') return 3;
  if (priority === 'P1') return 2;
  if (priority === 'P2') return 1;
  return 0;
}

function isHighPriority(priority) {
  return priority === 'P0' || priority === 'P1';
}

function explainHighPriority(item) {
  var title = String((item && item.title) || '').toLowerCase();
  var metric = String((item && item.metric) || '').toLowerCase();
  if (title.indexOf('_fbc') !== -1 || title.indexOf('click-id') !== -1 || metric.indexOf('_fbc') !== -1) {
    return 'Meta kan betaalde kliks minder goed aan events koppelen. Dit raakt attributie, optimalisatie en sales learning.';
  }
  if (title.indexOf('_fbp') !== -1 || title.indexOf('browser identity') !== -1) {
    return 'Meta mist browser-identiteit. Daardoor zakt match quality en wordt optimalisatie op kopers zwakker.';
  }
  if (title.indexOf('dedup') !== -1 || title.indexOf('event_id') !== -1) {
    return 'Browser Pixel en CAPI moeten dezelfde event_id delen. Anders ontstaan dubbele of ontbrekende conversies.';
  }
  if (title.indexOf('custom_data') !== -1 || title.indexOf('source_url') !== -1) {
    return 'Meta gebruikt deze velden voor website context, catalog matching, value optimization en diagnostiek. Zonder dit wordt optimalisatie minder scherp.';
  }
  if (title.indexOf('schedule') !== -1 || title.indexOf('continuous') !== -1) {
    return 'De kwartiercheck en recovery worker zijn het veiligheidsnet. Als die niet lopen, blijven trackingbreuken of pending retries te lang openstaan.';
  }
  if (title.indexOf('server') !== -1 || title.indexOf('browser') !== -1) {
    return 'Meta CAPI hoort browser, webhook en server signalen met gedeelde event_id te combineren. Mist een bron, dan zakt dedup of attributie.';
  }
  if (title.indexOf('delivery') !== -1 || title.indexOf('faalt') !== -1 || title.indexOf('recovery') !== -1) {
    return 'Events bereiken Meta niet betrouwbaar. Recovery moet echte pending events verwerken zonder duplicates.';
  }
  if (item && item.reason) return item.reason;
  return (item && item.action) || 'Dit punt staat op P0/P1 en kan trackingkwaliteit of advertentie-optimalisatie direct raken.';
}

function compactLine(title, detail, max) {
  var value = String(title || '').trim();
  var d = String(detail || '').trim();
  if (d) value += ': ' + d;
  var limit = max || 150;
  return value.length > limit ? value.slice(0, limit - 3) + '...' : value;
}

function compactText(value, max) {
  var text = String(value || '').replace(/\s+/g, ' ').trim();
  var limit = max || 220;
  return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
}

function buildTelegramSignature(plan, tracking, ads, queued) {
  var source = JSON.stringify({
    s: plan.summary_nl || '',
    t: (tracking || []).slice(0, 4).map(function (r) { return [r.priority, r.title, r.metric].join('|'); }),
    a: (ads || []).slice(0, 4).map(function (r) { return [r.priority, r.title, r.entity_id, r.reason].join('|'); }),
    q: (queued || []).map(function (q) { return q.id; })
  });
  var hash = 0;
  for (var i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function analyzeAndNotify(context, opts) {
  opts = opts || {};
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: 'TRACKING_HUB_ENABLED=false' };
  }

  var deterministic = buildDeterministicPlan(context);
  var ai = opts.dryRun ? { ok: false, error: 'dry_run' } : await runOpenAIAnalysis(context);
  var plan = ai.ok ? Object.assign({}, deterministic, ai.result, { source: 'openai', model: ai.model }) : deterministic;
  plan.tracking_recommendations = dedupeRecommendations(
    (deterministic.tracking_recommendations || []).concat(plan.tracking_recommendations || [])
  ).slice(0, 8);
  plan.ad_recommendations = dedupeRecommendations(
    (deterministic.ad_recommendations || []).concat(plan.ad_recommendations || [])
  ).slice(0, 8);
  plan.operational_audits = context.operational_audits || null;
  if (!ai.ok) {
    plan.ai_error = ai.error;
  }

  // Keep deterministic executable scale candidates even if the model only
  // rewrites the narrative, because those include validated budget caps.
  var executableAds = (deterministic.ad_recommendations || []).filter(function (rec) {
    return rec.type === 'scale_adset' || rec.type === 'scale_campaign';
  });

  var queued = [];
  for (var i = 0; i < executableAds.length; i++) {
    var item = await queueScaleRecommendation(executableAds[i], opts.dryRun);
    if (item) queued.push(item);
  }

  var notification = await notify(plan, queued.filter(function (q) { return !q.dryRun; }), opts.dryRun);

  var result = {
    ok: true,
    timestamp: new Date().toISOString(),
    source: plan.source,
    model: plan.model || null,
    ai_error: plan.ai_error || null,
    summary_nl: plan.summary_nl,
    tracking_recommendations: plan.tracking_recommendations || [],
    ad_recommendations: plan.ad_recommendations || [],
    operational_audits: context.operational_audits || null,
    queued: queued,
    telegram: notification,
    no_action_needed: Boolean(plan.no_action_needed)
  };

  if (!opts.dryRun) {
    await store.set('tracking_hub:latest', JSON.stringify(result), RESULT_TTL);
    await store.set('tracking_hub:run:' + new Date().toISOString().replace(/[:.]/g, '-'), JSON.stringify(result), RESULT_TTL);
  }

  return result;
}

module.exports = {
  analyzeAndNotify: analyzeAndNotify,
  buildDeterministicPlan: buildDeterministicPlan,
  summarizeAdSnapshot: summarizeAdSnapshot,
  runOpenAIAnalysis: runOpenAIAnalysis
};
