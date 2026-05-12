/**
 * Tracking Hub Cron - every 15 minutes.
 *
 * Reviews tracking quality and ads performance with OpenAI/fallback rules.
 * It does not emit synthetic CAPI events. Budget changes are approval-gated.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var strategist = require('../../lib/tracking-hub-strategist');
var eventStats = require('../../lib/event-stats');
var fetch = require('node-fetch');
var metaQuality = require('../../lib/meta-capi-quality');

var ENDPOINT_PATH = '/api/cron/tracking-hub';
var LOCK_KEY = 'cron:lock:tracking-hub';
var LOCK_TTL = 10 * 60;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, ENDPOINT_PATH);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var dryRun = (req.query && (req.query.dryRun === '1' || req.query.dry_run === '1'));

  try {
    if (!dryRun) {
      var locked = await store.setnx(LOCK_KEY, '1', LOCK_TTL);
      if (!locked) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
      }
    }

    var context = dryRun ? buildSmokeContext() : await buildContext();
    var result = await strategist.analyzeAndNotify(context, { dryRun: dryRun });

    if (!dryRun) await store.del(LOCK_KEY);

    return res.status(200).json({
      ok: true,
      auth_source: auth.source,
      dryRun: dryRun,
      source: result.source,
      model: result.model,
      tracking_recommendations: (result.tracking_recommendations || []).length,
      ad_recommendations: (result.ad_recommendations || []).length,
      queued: (result.queued || []).length,
      telegram: result.telegram,
      ai_error: result.ai_error || null
    });
  } catch (err) {
    console.error('[TrackingHub] Error:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function buildContext() {
  var coverageRaw = await latestDailyCoverage();
  var emq = await latestByScan('emq_hourly:*');
  var bridge = await latestByScan('bridge:health:*');
  var catalog = await latestByScan('catalog:sync:*');
  var resubmit = await aggregateResubmitRuns();
  var events = await aggregateEvents();
  var operationalAudits = await buildOperationalAudits(coverageRaw || {}, resubmit, events);
  var snapshot = await insightsFetcher.fetchOptimizationSnapshot();
  var adPerformance = strategist.summarizeAdSnapshot(snapshot);

  return {
    timestamp: dates.formatDateTimeAmsterdam(),
    coverage: { raw: coverageRaw || {}, computed: summarizeCoverage(coverageRaw || {}) },
    emq_latest: emq,
    bridge: bridge,
    catalog: catalog,
    identity_resubmit_24h: resubmit,
    events_24h: events,
    operational_audits: operationalAudits,
    ad_performance: adPerformance
  };
}

function buildSmokeContext() {
  var coverage = {
    Purchase: { total: 12, em: 8, ph: 3, fbp: 11, fbc: 4, external_id: 10, fn: 6, ln: 6 },
    AddToCart: { total: 42, em: 3, ph: 0, fbp: 38, fbc: 9, external_id: 14, fn: 1, ln: 1 }
  };
  return {
    timestamp: dates.formatDateTimeAmsterdam(),
    coverage: { raw: coverage, computed: summarizeCoverage(coverage) },
    emq_latest: { available: true, estimatedEMQ: 7.2, totalEvents: 54 },
    bridge: { available: true, status: 'healthy', current: 91, baseline: 100 },
    catalog: { available: true, match_rate: 100 },
    identity_resubmit_24h: { runs_24h: 4, scanned: 40, resubmitted: 3, meta_failures: 0 },
    events_24h: { total: 54, retry_pending: 0, failed_terminal: 0 },
    operational_audits: {
      meta_backfill: { status: 'ok', pending: 1, resubmitted_24h: 3, failures_24h: 0 },
      platform_sales: { status: 'ok', latest_match_rate: 99, mismatch_count: 0 },
      dashboard_reconciliation: { status: 'warn', gaps: [{ event: 'Purchase', source: 12, emq: 9, delta: 3 }] },
      capture_checks: { status: 'warn', weak: [{ event: 'AddToCart', field: 'fbc', pct: 21 }] },
      schedule_checks: {
        available: true,
        tracking_hub_15m: true,
        recovery_1m: true,
        identity_backfill_15m: true,
        identity_resubmit_15m: true
      },
      sales_risk: { status: 'warn', upstream_events: 42, purchases: 0 },
      meta_capi_quality: {
        status: 'warn',
        score: 75,
        highest_priority: 'P1',
        funnel_events_seen: ['AddToCart', 'Purchase'],
        recommendations: [{
          priority: 'P1',
          code: 'meta_fbc_coverage',
          title: 'AddToCart _fbc/click-id onder Meta norm',
          action: 'fbclid vanaf landing persistenter opslaan als _fbc en bij elke funnelstap meesturen.',
          metric: '_fbc 21% over 42 events'
        }]
      },
      deterministic_fixes: {
        threshold_broken: true,
        severity: 'P1',
        deploy_allowed: true,
        actions: ['Refresh bridge capture if fbp/fbc gap persists 2 runs'],
        auto_deploy: { enabled: false, triggered: false, reason: 'dry_run' }
      }
    },
    ad_performance: {
      totals: { spend: 38.4, purchases: 3, revenue: 147, roas: 3.83 },
      counts: { ads: 4, adsets: 2, campaigns: 1 },
      spend_starved: [{
        ad_id: 'ad_smoke_1',
        ad_name: 'OralBiome Angle B',
        adset_id: 'as_smoke',
        spend_share_pct: 2,
        impressions: 48
      }],
      under_delivery: [],
      scale_candidates: [{
        type: 'scale_adset',
        entity_id: 'as_smoke',
        entity_name: 'NL Broad - OralBiome',
        current_budget_eur: 20,
        suggested_budget_eur: 23,
        new_budget_cents: 2300,
        roas: 3.83,
        cpa: 12.8,
        purchases: 3,
        reason: 'Smoke winner under budget caps.'
      }],
      errors: []
    }
  };
}

async function buildOperationalAudits(coverageRaw, resubmit, events) {
  var stats = await getTodayStats();
  var pending = await countKeys('backfill:pending:*', 5000);
  var latestReconciliation = await latestByScan('reconciliation:*');
  var scheduleAudit = await buildScheduleAudit();
  var dashboard = buildDashboardReconciliation(coverageRaw, stats);
  var salesRisk = buildSalesRisk(coverageRaw, stats);
  var capture = buildCaptureChecks(coverageRaw, salesRisk);
  var quality = metaQuality.evaluate({
    coverageRaw: coverageRaw,
    events: events,
    resubmit: resubmit,
    salesRisk: salesRisk,
    scheduleAudit: scheduleAudit
  });
  var qualityTrend = await buildQualityTrend(quality);
  var autoSync = await maybeRunCustomerDataSync(quality, events);
  var deterministic = buildDeterministicFixGate(dashboard, capture, events, resubmit, quality);
  deterministic.auto_deploy = await maybeTriggerAutoDeploy(deterministic);
  var optimizationActions = buildOptimizationActions(autoSync, deterministic, events, resubmit, quality);

  return {
    meta_backfill: {
      status: (events.retry_pending || 0) > 0 || (resubmit.meta_failures || 0) > 0 ? 'warn' : 'ok',
      pending: pending,
      retry_pending: events.retry_pending || 0,
      failed_terminal: events.failed_terminal || 0,
      resubmitted_24h: resubmit.resubmitted || 0,
      failures_24h: resubmit.meta_failures || 0
    },
    platform_sales: {
      status: latestReconciliation && latestReconciliation.available === false ? 'unknown' : 'ok',
      latest_key: latestReconciliation.key || null,
      latest_match_rate: latestReconciliation.matchRate,
      mismatch_count: latestReconciliation.mismatchCount,
      shopify_meta_drift: latestReconciliation.shopifyMetaDrift || null
    },
    dashboard_reconciliation: dashboard,
    capture_checks: capture,
    schedule_checks: scheduleAudit,
    quality_trend: qualityTrend,
    meta_standard_check: {
      version: metaQuality.standardVersion,
      prompt: metaQuality.buildStandardPrompt(),
      matches_current_run: quality.highest_priority === 'OK',
      highest_priority: quality.highest_priority,
      score: quality.score
    },
    sales_risk: salesRisk,
    meta_capi_quality: quality,
    auto_sync_customer_data: autoSync,
    optimization_actions: optimizationActions,
    deterministic_fixes: deterministic
  };
}

async function getTodayStats() {
  try {
    var rows = await eventStats.getEventStats(1);
    return (rows[0] && rows[0].events) || {};
  } catch (e) {
    return {};
  }
}

async function countKeys(pattern, max) {
  var redis = store._getRedis();
  if (!redis) return 0;
  var cursor = '0';
  var count = 0;
  var limit = max || 5000;
  do {
    var out = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = String(out[0]);
    count += (out[1] || []).length;
  } while (cursor !== '0' && count < limit);
  return count;
}

async function buildScheduleAudit() {
  var cacheKey = 'tracking_hub:schedule_audit:last';
  var cached = await store.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* refresh */ }
  }

  var token = process.env.QSTASH_TOKEN;
  if (!token) {
    return { available: false, reason: 'QSTASH_TOKEN missing in runtime' };
  }

  try {
    var response = await fetch('https://qstash.upstash.io/v2/schedules', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      timeout: 15000
    });
    var schedules = await response.json().catch(function () { return []; });
    if (!response.ok || !Array.isArray(schedules)) {
      return { available: false, reason: 'qstash_schedule_list_failed_' + response.status };
    }

    function findSchedule(id) {
      return schedules.find(function (schedule) {
        return schedule.scheduleId === id || schedule.id === id;
      }) || null;
    }

    var tracking = findSchedule('calqix-tracking-hub');
    var recovery = findSchedule('calqix-recovery');
    var identityBackfill = findSchedule('calqix-identity-backfill');
    var identityResubmit = findSchedule('calqix-identity-resubmit');
    var audit = {
      available: true,
      checked_at: new Date().toISOString(),
      total_schedules: schedules.length,
      tracking_hub_15m: hasCron(tracking, '*/15'),
      recovery_1m: hasCron(recovery, '* * * * *'),
      identity_backfill_15m: hasCron(identityBackfill, '*/15'),
      identity_resubmit_15m: hasCron(identityResubmit, '7,22,37,52'),
      schedules: {
        tracking_hub: scheduleSummary(tracking),
        recovery: scheduleSummary(recovery),
        identity_backfill: scheduleSummary(identityBackfill),
        identity_resubmit: scheduleSummary(identityResubmit)
      }
    };
    await store.set(cacheKey, JSON.stringify(audit), 10 * 60);
    return audit;
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

function hasCron(schedule, needle) {
  if (!schedule) return false;
  var cron = String(schedule.cron || schedule.schedule || '');
  return cron.indexOf(needle) !== -1;
}

function scheduleSummary(schedule) {
  if (!schedule) return null;
  return {
    id: schedule.scheduleId || schedule.id || null,
    cron: schedule.cron || schedule.schedule || null,
    destination: schedule.destination || schedule.url || null
  };
}

function buildDashboardReconciliation(coverageRaw, stats) {
  var names = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];
  var gaps = [];
  names.forEach(function (eventName) {
    var row = stats[eventName] || {};
    var source = Math.max(Number(row.browser) || 0, Number(row.server) || 0);
    var emq = coverageRaw[eventName] ? Number(coverageRaw[eventName].total) || 0 : 0;
    var delta = source - emq;
    if (source > 0 && (emq === 0 || Math.abs(delta) >= Math.max(3, Math.ceil(source * 0.15)))) {
      gaps.push({
        event: eventName,
        source: source,
        emq: emq,
        delta: delta,
        priority: eventName === 'Purchase' || eventName === 'InitiateCheckout' ? 'P1' : 'P2'
      });
    }
  });
  return { status: gaps.length ? 'warn' : 'ok', gaps: gaps.slice(0, 8) };
}

function buildSalesRisk(coverageRaw, stats) {
  var upstreamNames = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo'];
  var upstream = 0;
  upstreamNames.forEach(function (eventName) {
    var row = stats[eventName] || {};
    var source = Math.max(Number(row.browser) || 0, Number(row.server) || 0);
    var emqTotal = coverageRaw[eventName] ? Number(coverageRaw[eventName].total) || 0 : 0;
    upstream += Math.max(source, emqTotal);
  });

  var purchaseStats = stats.Purchase || {};
  var purchaseSource = Math.max(Number(purchaseStats.browser) || 0, Number(purchaseStats.server) || 0);
  var purchaseEmq = coverageRaw.Purchase ? Number(coverageRaw.Purchase.total) || 0 : 0;
  var purchases = Math.max(purchaseSource, purchaseEmq);

  return {
    status: upstream >= 5 && purchases === 0 ? 'warn' : 'ok',
    upstream_events: upstream,
    purchases: purchases
  };
}

async function buildQualityTrend(currentQuality) {
  var history = await loadQualityHistory(8);
  var latestRaw = await store.get('tracking_hub:latest');
  if (!latestRaw) {
    return {
      direction: 'unknown',
      rolling_direction: rollingDirection(history),
      history: history,
      score_delta: null,
      previous_score: null,
      current_score: currentQuality && currentQuality.score,
      previous_priority: null,
      current_priority: currentQuality && currentQuality.highest_priority,
      message: 'Nog geen vorige Tracking Hub run om tegen te vergelijken.'
    };
  }

  var latest;
  try { latest = typeof latestRaw === 'string' ? JSON.parse(latestRaw) : latestRaw; }
  catch (e) { latest = null; }

  var prevQuality = latest && latest.operational_audits && latest.operational_audits.meta_capi_quality || {};
  var prevScore = Number(prevQuality.score);
  var currentScore = Number(currentQuality && currentQuality.score);
  if (!Number.isFinite(prevScore) || !Number.isFinite(currentScore)) {
    return {
      direction: 'unknown',
      rolling_direction: rollingDirection(history),
      history: history,
      score_delta: null,
      previous_score: Number.isFinite(prevScore) ? prevScore : null,
      current_score: Number.isFinite(currentScore) ? currentScore : null,
      previous_priority: prevQuality.highest_priority || null,
      current_priority: currentQuality && currentQuality.highest_priority,
      message: 'Trend niet betrouwbaar genoeg om te beoordelen.'
    };
  }

  var delta = currentScore - prevScore;
  var prevRank = priorityRank(prevQuality.highest_priority);
  var currentRank = priorityRank(currentQuality && currentQuality.highest_priority);
  var direction = 'stable';
  if (delta >= 5 || currentRank < prevRank) direction = 'improving';
  if (delta <= -5 || currentRank > prevRank) direction = 'worsening';

  return {
    direction: direction,
    rolling_direction: rollingDirection(history.concat([{
      timestamp: new Date().toISOString(),
      score: currentScore,
      priority: currentQuality && currentQuality.highest_priority
    }])),
    history: history,
    score_delta: delta,
    previous_score: prevScore,
    current_score: currentScore,
    previous_priority: prevQuality.highest_priority || null,
    current_priority: currentQuality && currentQuality.highest_priority,
    message: formatTrendMessage(direction, delta, prevQuality.highest_priority, currentQuality && currentQuality.highest_priority)
  };
}

async function loadQualityHistory(limit) {
  var redis = store._getRedis();
  if (!redis) return [];
  var cursor = '0';
  var keys = [];
  do {
    var out = await redis.scan(cursor, { match: 'tracking_hub:run:*', count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0' && keys.length < 250);
  keys.sort();
  var selected = keys.slice(-(limit || 8));
  var history = [];
  for (var i = 0; i < selected.length; i++) {
    var raw = await store.get(selected[i]);
    if (!raw) continue;
    try {
      var run = typeof raw === 'string' ? JSON.parse(raw) : raw;
      var quality = run.operational_audits && run.operational_audits.meta_capi_quality || {};
      if (quality.score !== undefined) {
        history.push({
          timestamp: run.timestamp || null,
          score: quality.score,
          priority: quality.highest_priority || null
        });
      }
    } catch (e) { /* skip */ }
  }
  return history;
}

function rollingDirection(history) {
  if (!history || history.length < 3) return 'unknown';
  var first = Number(history[0].score);
  var last = Number(history[history.length - 1].score);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 'unknown';
  var delta = last - first;
  if (delta >= 5) return 'improving';
  if (delta <= -5) return 'worsening';
  return 'stable';
}

function formatTrendMessage(direction, delta, previousPriority, currentPriority) {
  var sign = delta > 0 ? '+' : '';
  if (direction === 'improving') {
    return 'Kwaliteit verbetert (' + sign + delta + ' punten, ' + previousPriority + ' -> ' + currentPriority + ').';
  }
  if (direction === 'worsening') {
    return 'Kwaliteit verslechtert (' + sign + delta + ' punten, ' + previousPriority + ' -> ' + currentPriority + ').';
  }
  return 'Kwaliteit stabiel (' + sign + delta + ' punten, ' + currentPriority + ').';
}

function buildOptimizationActions(autoSync, deterministic, events, resubmit, quality) {
  var actions = [];
  if (autoSync && autoSync.attempted) {
    actions.push({
      type: 'auto_sync',
      status: isActionOk(autoSync.backfill) && isActionOk(autoSync.resubmit) && (!autoSync.recovery || isActionOk(autoSync.recovery)) ? 'ok' : 'warn',
      message: 'Klantdata auto-sync uitgevoerd: ' + formatAutoSyncAction(autoSync)
    });
  }
  if (deterministic && deterministic.auto_deploy && deterministic.auto_deploy.triggered) {
    actions.push({
      type: 'auto_deploy',
      status: 'ok',
      message: 'Deploy hook gestart voor ' + (deterministic.severity || 'P1') + ' trackingfix.'
    });
  }
  if ((events && events.retry_pending || 0) > 0 || (resubmit && resubmit.meta_failures || 0) > 0) {
    actions.push({
      type: 'recovery_watch',
      status: 'warn',
      message: 'Recovery/backfill bewaakt: retry_pending ' + (events.retry_pending || 0) + ', resubmit failures ' + (resubmit.meta_failures || 0) + '.'
    });
  }
  if (!actions.length) {
    actions.push({
      type: 'none_needed',
      status: (quality && quality.highest_priority) === 'OK' ? 'ok' : 'standby',
      message: (quality && quality.highest_priority) === 'OK'
        ? 'Aanpassingen waren niet nodig; geen kritische fixes nodig geweest.'
        : 'Geen automatische optimalisatie uitgevoerd; monitoren of deploy-cooldown actief.'
    });
  }
  return actions;
}

function isActionOk(action) {
  if (!action) return true;
  return action.ok !== false;
}

function formatAutoSyncAction(autoSync) {
  var backfill = autoSync.backfill || {};
  var resubmit = autoSync.resubmit || {};
  var recovery = autoSync.recovery || {};
  var parts = [];
  parts.push('backfill ' + (backfill.enriched !== undefined ? backfill.enriched : (backfill.reason || 'ok')));
  parts.push('resubmit ' + (resubmit.resubmitted !== undefined ? resubmit.resubmitted : (resubmit.reason || 'ok')));
  if (autoSync.recovery) parts.push('recovery ' + (recovery.retried !== undefined ? recovery.retried : (recovery.reason || 'ok')));
  return parts.join(', ');
}

function buildCaptureChecks(coverageRaw, salesRisk) {
  var weak = [];
  Object.keys(coverageRaw || {}).forEach(function (eventName) {
    var row = coverageRaw[eventName] || {};
    var total = row.total || 0;
    if (!total) return;
    var fbp = Math.round(((row.fbp || 0) / total) * 100);
    var fbc = Math.round(((row.fbc || 0) / total) * 100);
    var ip = Math.round(((row.client_ip_address || 0) / total) * 100);
    var ua = Math.round(((row.client_user_agent || 0) / total) * 100);
    if (fbp < 80) weak.push(captureIssue(eventName, 'fbp', fbp, total, salesRisk));
    if (fbc < 20 && total >= 5) weak.push(captureIssue(eventName, 'fbc', fbc, total, salesRisk));
    if (ip < 80) weak.push(captureIssue(eventName, 'ip', ip, total, salesRisk));
    if (ua < 80) weak.push(captureIssue(eventName, 'ua', ua, total, salesRisk));
  });
  return { status: weak.length ? 'warn' : 'ok', weak: weak.slice(0, 10) };
}

function captureIssue(eventName, field, pct, total, salesRisk) {
  var priority = 'P2';
  var commercialRisk = salesRisk && salesRisk.status === 'warn';
  var upperFunnel = eventName === 'ViewContent' || eventName === 'AddToCart';
  var checkoutFunnel = eventName === 'InitiateCheckout' || eventName === 'AddPaymentInfo' || eventName === 'Purchase';

  if (field === 'fbp' && pct < 50 && total >= 5) priority = 'P1';
  if ((field === 'ip' || field === 'ua') && pct < 50 && total >= 5) priority = 'P1';
  if (field === 'fbc' && pct === 0 && total >= 5 && (checkoutFunnel || (commercialRisk && upperFunnel))) priority = 'P1';

  return {
    event: eventName,
    field: field,
    pct: pct,
    total: total,
    priority: priority
  };
}

function buildDeterministicFixGate(dashboard, capture, events, resubmit, quality) {
  var actionItems = [];
  var thresholdBroken = false;

  if ((events.failed_terminal || 0) > 0 || (resubmit.meta_failures || 0) > 0) {
    thresholdBroken = true;
    actionItems.push({
      priority: 'P0',
      deployable: false,
      action: 'Meta backfill/recovery failures inspecteren voor retry route.'
    });
  }
  (dashboard.gaps || []).forEach(function (gap) {
    if (priorityRank(gap.priority) >= priorityRank('P1')) thresholdBroken = true;
    actionItems.push({
      priority: gap.priority || 'P2',
      deployable: true,
      action: gap.event + ': dashboard reconciliation gap ' + gap.delta + ' oplossen.'
    });
  });
  (capture.weak || []).forEach(function (weak) {
    if (priorityRank(weak.priority) >= priorityRank('P1')) {
      thresholdBroken = true;
    }
    actionItems.push({
      priority: weak.priority || 'P2',
      deployable: weak.field === 'fbp' || weak.field === 'fbc' || weak.field === 'ip' || weak.field === 'ua',
      action: weak.event + ': ' + weak.field + ' capture onder threshold (' + weak.pct + '% over ' + weak.total + ' events).'
    });
  });
  ((quality && quality.recommendations) || []).forEach(function (rec) {
    if (priorityRank(rec.priority) >= priorityRank('P1')) {
      thresholdBroken = true;
    }
    actionItems.push({
      priority: rec.priority || 'P2',
      deployable: isDeployableQualityIssue(rec.code),
      action: rec.title + ': ' + rec.action
    });
  });

  var severity = maxPriority(actionItems.map(function (item) { return item.priority; }));
  var deployAllowed = thresholdBroken && priorityRank(severity) >= priorityRank('P1') &&
    actionItems.some(function (item) { return item.deployable && priorityRank(item.priority) >= priorityRank('P1'); });

  return {
    threshold_broken: thresholdBroken,
    severity: severity,
    deploy_allowed: deployAllowed,
    deploy_policy: deployAllowed
      ? 'Auto-deploy mag alleen via deploy hook bij P0/P1 en alleen voor deterministische trackingfixes.'
      : 'Niet deployen; monitor-only.',
    action_items: actionItems.slice(0, 8),
    actions: uniqueStrings(actionItems.map(function (item) { return item.action; })).slice(0, 8)
  };
}

function isDeployableQualityIssue(code) {
  return code === 'meta_fbp_coverage' ||
    code === 'meta_fbc_coverage' ||
    code === 'meta_ip_coverage' ||
    code === 'meta_ua_coverage' ||
    code === 'meta_dedup_event_id' ||
    code === 'meta_server_source_missing' ||
    code === 'meta_browser_source_missing' ||
    code === 'meta_event_source_url' ||
    code === 'meta_funnel_gap_initiate_checkout' ||
    code === 'meta_funnel_gap_add_payment_info' ||
    code === 'meta_sales_gap_purchase' ||
    /^meta_custom_data_/.test(String(code || '')) ||
    /^meta_preferred_custom_data_/.test(String(code || ''));
}

async function maybeRunCustomerDataSync(quality, events) {
  var enabled = process.env.TRACKING_HUB_AUTO_SYNC_ENABLED !== 'false';
  if (!enabled) return { enabled: false, attempted: false, reason: 'TRACKING_HUB_AUTO_SYNC_ENABLED=false' };

  var relevant = relevantSyncReasons(quality, events);
  if (!relevant.length) return { enabled: true, attempted: false, reason: 'no_relevant_identity_or_recovery_issue' };

  var cooldownKey = 'tracking_hub:auto_sync:cooldown';
  var locked = await store.setnx(cooldownKey, new Date().toISOString(), 10 * 60);
  if (!locked) return { enabled: true, attempted: false, reason: 'cooldown_active', triggers: relevant };

  var result = {
    enabled: true,
    attempted: true,
    triggers: relevant,
    backfill: await callInternalCron('/api/cron/identity-backfill'),
    resubmit: await callInternalCron('/api/cron/identity-resubmit')
  };
  if ((events.retry_pending || 0) > 0 || (events.failed_terminal || 0) > 0) {
    result.recovery = await callInternalCron('/api/recovery/run');
  }
  await store.set('tracking_hub:auto_sync:last', JSON.stringify(Object.assign({
    timestamp: new Date().toISOString()
  }, result)), 7 * 86400);
  return result;
}

function relevantSyncReasons(quality, events) {
  var out = [];
  ((quality && quality.recommendations) || []).forEach(function (rec) {
    var high = priorityRank(rec.priority) >= priorityRank('P1');
    var mediumIdentity = rec.priority === 'P2' &&
      (rec.code === 'meta_contact_identity_coverage' || rec.code === 'meta_external_id_coverage');
    if (high || mediumIdentity) {
      if (rec.code === 'meta_contact_identity_coverage' || rec.code === 'meta_external_id_coverage' ||
        rec.code === 'meta_retry_pending' || rec.code === 'meta_delivery_failure') {
        out.push(rec.priority + ':' + rec.code);
      }
    }
  });
  if ((events.retry_pending || 0) > 0) out.push('P1:retry_pending');
  if ((events.failed_terminal || 0) > 0) out.push('P0:failed_terminal');
  return uniqueStrings(out).slice(0, 6);
}

async function callInternalCron(path) {
  var secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, skipped: true, reason: 'CRON_SECRET missing' };
  var base = process.env.TRACKING_HUB_INTERNAL_BASE_URL ||
    process.env.QSTASH_VERIFY_URL ||
    'https://calqix-capi.vercel.app';
  try {
    var response = await fetch(base.replace(/\/$/, '') + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + secret },
      timeout: 60000
    });
    var body = await response.json().catch(function () { return {}; });
    return {
      ok: response.ok && body.ok !== false,
      status: response.status,
      skipped: Boolean(body.skipped),
      reason: body.reason || body.error || null,
      scanned: body.scanned || (body.stats && body.stats.scanned) || undefined,
      enriched: body.enriched || undefined,
      resubmitted: body.stats && body.stats.resubmitted,
      meta_failures: body.stats && body.stats.meta_failures,
      retried: body.retried
    };
  } catch (err) {
    return { ok: false, status: 0, reason: err.message };
  }
}

async function maybeTriggerAutoDeploy(fixes) {
  var enabled = process.env.TRACKING_HUB_AUTO_DEPLOY_ENABLED === 'true';
  var hook = process.env.VERCEL_TRACKING_FIX_DEPLOY_HOOK_URL;
  var cooldownMinutes = parseInt(process.env.TRACKING_HUB_AUTO_DEPLOY_COOLDOWN_MIN || '60', 10);
  if (!fixes || !fixes.deploy_allowed) {
    return { enabled: enabled, triggered: false, reason: 'threshold_not_deployable' };
  }
  if (!enabled) {
    return { enabled: false, triggered: false, reason: 'TRACKING_HUB_AUTO_DEPLOY_ENABLED!=true' };
  }
  if (!hook) {
    return { enabled: true, triggered: false, reason: 'missing VERCEL_TRACKING_FIX_DEPLOY_HOOK_URL' };
  }

  var ttl = Math.max(cooldownMinutes, 15) * 60;
  var cooldownKey = 'tracking_hub:auto_deploy:cooldown';
  var locked = await store.setnx(cooldownKey, new Date().toISOString(), ttl);
  if (!locked) {
    return { enabled: true, triggered: false, reason: 'cooldown_active', cooldown_min: cooldownMinutes };
  }

  try {
    var response = await fetch(hook, { method: 'POST', timeout: 15000 });
    var payload = {
      timestamp: new Date().toISOString(),
      ok: response.ok,
      status: response.status,
      severity: fixes.severity,
      actions: (fixes.actions || []).slice(0, 4)
    };
    await store.set('tracking_hub:auto_deploy:last', JSON.stringify(payload), 30 * 86400);
    return {
      enabled: true,
      triggered: response.ok,
      reason: response.ok ? 'deploy_hook_triggered' : 'deploy_hook_failed_' + response.status,
      status: response.status,
      cooldown_min: cooldownMinutes
    };
  } catch (err) {
    await store.set('tracking_hub:auto_deploy:last', JSON.stringify({
      timestamp: new Date().toISOString(),
      ok: false,
      error: err.message,
      severity: fixes.severity,
      actions: (fixes.actions || []).slice(0, 4)
    }), 30 * 86400);
    return { enabled: true, triggered: false, reason: err.message, cooldown_min: cooldownMinutes };
  }
}

function priorityRank(priority) {
  if (priority === 'P0') return 3;
  if (priority === 'P1') return 2;
  if (priority === 'P2') return 1;
  return 0;
}

function maxPriority(priorities) {
  var max = 'OK';
  (priorities || []).forEach(function (priority) {
    if (priorityRank(priority) > priorityRank(max)) max = priority;
  });
  return max;
}

function uniqueStrings(items) {
  var seen = {};
  return (items || []).filter(function (item) {
    if (!item || seen[item]) return false;
    seen[item] = true;
    return true;
  });
}

function summarizeCoverage(summary) {
  var out = {};
  Object.keys(summary || {}).forEach(function (eventName) {
    var row = summary[eventName] || {};
    var total = row.total || 0;
    out[eventName] = {
      total: total,
      email: total ? Math.round(((row.em || 0) / total) * 100) : 0,
      phone: total ? Math.round(((row.ph || 0) / total) * 100) : 0,
      fbp: total ? Math.round(((row.fbp || 0) / total) * 100) : 0,
      fbc: total ? Math.round(((row.fbc || 0) / total) * 100) : 0,
      external_id: total ? Math.round(((row.external_id || 0) / total) * 100) : 0
    };
  });
  return out;
}

async function latestDailyCoverage() {
  var raw = await store.get('diag:summary:' + new Date().toISOString().split('T')[0]);
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return {}; }
}

async function latestByScan(pattern) {
  var redis = store._getRedis();
  if (!redis) return { available: false, reason: 'redis_unavailable' };
  var cursor = '0';
  var keys = [];
  do {
    var out = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  if (!keys.length) return { available: false };
  keys.sort();
  var key = keys[keys.length - 1];
  var raw = await store.get(key);
  if (!raw) return { available: false, key: key };
  try {
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.assign({ available: true, key: key }, data);
  } catch (e) {
    return { available: false, key: key, reason: 'parse_error' };
  }
}

async function aggregateResubmitRuns() {
  var redis = store._getRedis();
  if (!redis) return { runs_24h: 0, scanned: 0, resubmitted: 0, meta_failures: 0 };
  var cursor = '0';
  var keys = [];
  do {
    var out = await redis.scan(cursor, { match: 'backfill:resubmit:run:*', count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  var cutoff = Date.now() - 24 * 3600 * 1000;
  var totals = { runs_24h: 0, scanned: 0, resubmitted: 0, meta_failures: 0 };
  for (var i = 0; i < keys.length; i++) {
    var raw = await store.get(keys[i]);
    if (!raw) continue;
    try {
      var run = typeof raw === 'string' ? JSON.parse(raw) : raw;
      var ts = new Date((run.timestamp || '').toString().replace(' ', 'T')).getTime() || 0;
      if (ts && ts < cutoff) continue;
      totals.runs_24h++;
      totals.scanned += run.scanned || 0;
      totals.resubmitted += run.resubmitted || 0;
      totals.meta_failures += run.meta_failures || 0;
    } catch (e) { /* skip */ }
  }
  return totals;
}

async function aggregateEvents() {
  var redis = store._getRedis();
  if (!redis) return { total: 0, retry_pending: 0, failed_terminal: 0 };
  var cursor = '0';
  var cutoff = Date.now() - 24 * 3600 * 1000;
  var counts = {
    total: 0,
    retry_pending: 0,
    failed_terminal: 0,
    confirmed: 0,
    recovered: 0,
    by_event_name: {},
    source_counts: {},
    payload_quality: {},
    event_id_quality: { total: 0, missing: 0, invalid: 0 }
  };
  var scanned = 0;
  do {
    var out = await redis.scan(cursor, { match: 'meta:event:*', count: 100 });
    cursor = String(out[0]);
    var keys = out[1] || [];
    for (var i = 0; i < keys.length && scanned < 1000; i++) {
      scanned++;
      var raw = await redis.get(keys[i]);
      if (!raw) continue;
      try {
        var ev = typeof raw === 'string' ? JSON.parse(raw) : raw;
        var ts = new Date(ev.created_at || 0).getTime();
        if (ts && ts < cutoff) continue;
        counts.total++;
        if (!counts.by_event_name[ev.event_name]) counts.by_event_name[ev.event_name] = 0;
        counts.by_event_name[ev.event_name]++;
        updateSourceCounts(counts.source_counts, ev);
        updateEventIdQuality(counts.event_id_quality, ev);
        var payloadRaw = ev.event_id ? await store.get('meta:payload:' + ev.event_id) : null;
        updatePayloadQuality(counts.payload_quality, ev, payloadRaw);
        if (counts[ev.state] !== undefined) counts[ev.state]++;
      } catch (e) { /* skip */ }
    }
  } while (cursor !== '0' && scanned < 1000);
  counts.scanned = scanned;
  return counts;
}

function updateSourceCounts(sourceCounts, ev) {
  var eventName = ev && ev.event_name || 'unknown';
  if (!sourceCounts[eventName]) {
    sourceCounts[eventName] = {
      total: 0,
      browser: 0,
      server: 0,
      recovery: 0,
      webhook: 0,
      custom_pixel: 0,
      browser_bridge: 0,
      shopify_web_pixel: 0,
      other: 0
    };
  }
  var row = sourceCounts[eventName];
  var source = String(ev.source || 'other');
  row.total++;
  if (row[source] !== undefined) row[source]++;
  else row.other++;
  if (source === 'browser_bridge' || source === 'custom_pixel' || source === 'shopify_web_pixel') row.browser++;
  else if (source === 'webhook' || source === 'recovery') row.server++;
  if (source === 'recovery') row.recovery++;
}

function updatePayloadQuality(payloadQuality, ev, payloadRaw) {
  var eventName = ev && ev.event_name || 'unknown';
  if (!payloadQuality[eventName]) {
    payloadQuality[eventName] = {
      total: 0,
      payload_missing: 0,
      source_url_missing: 0,
      content_ids: 0,
      content_type: 0,
      contents: 0,
      value: 0,
      currency: 0,
      num_items: 0,
      order_id: 0
    };
  }
  var row = payloadQuality[eventName];
  row.total++;
  if (!payloadRaw) {
    row.payload_missing++;
    return;
  }
  var payload;
  try { payload = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw; }
  catch (e) {
    row.payload_missing++;
    return;
  }
  if (!payload.source_url) row.source_url_missing++;
  var customData = payload.custom_data || {};
  ['content_ids', 'content_type', 'contents', 'value', 'currency', 'num_items', 'order_id'].forEach(function (field) {
    if (hasCustomField(customData, field)) row[field]++;
  });
}

function hasCustomField(customData, field) {
  var value = customData && customData[field];
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
}

function updateEventIdQuality(quality, ev) {
  quality.total++;
  var eventId = ev && ev.event_id;
  var eventName = ev && ev.event_name;
  if (!eventId) {
    quality.missing++;
    return;
  }
  var value = String(eventId);
  var expected = {
    ViewContent: /^vc_/,
    AddToCart: /^atc_/,
    InitiateCheckout: /^ic_/,
    AddPaymentInfo: /^add_payment_info_/,
    Purchase: /^purchase_/,
    Lead: /^lead_/
  };
  if (expected[eventName] && !expected[eventName].test(value)) {
    quality.invalid++;
  }
}

module.exports.config = { api: { bodyParser: false } };
