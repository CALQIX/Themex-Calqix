/**
 * Dashboard Metrics Endpoint — GET /api/dashboard/metrics?token=...
 *
 * Aggregates Redis counters produced by every observability cron into a
 * single JSON payload for public/dashboard.html to render.
 *
 * Auth: DASHBOARD_TOKEN env var matched against ?token= query parameter.
 *       (Kept separate from CRON_SECRET so the dashboard can be shared
 *        without handing out cron-trigger rights.)
 *
 * Data sources (all read-only, no mutations):
 *   meta:event:*                 — event lifecycle state
 *   diag:coverage:*              — per-event match-key coverage (24h rolling)
 *   diag:summary:{date}          — daily coverage summary
 *   emq_hourly:{YYYY-MM-DD-HH}   — from emq-deep cron
 *   catalog:sync:{YYYY-MM-DD}    — from catalog-sync-monitor cron
 *   bridge:health:{hour}         — from bridge-health cron
 *   anomaly:result:{slot}        — from anomaly-watch cron
 *   backfill:resubmit:run:*      — from identity-resubmit cron
 *   predis:daily:{date}          — content job list (provider-agnostic in UI)
 *   alert:history:{date}         — alert feed
 *
 * Provider-agnostic design for content generation:
 *   The dashboard reads predis:daily:{date} + predis:job:{id} today but only
 *   surfaces counts {submitted, completed, failed, draft_only} and
 *   last-activity timestamp. When the content provider is swapped (future),
 *   the new provider can write to the same key namespace or this endpoint
 *   can be switched to read content:job:* / content:daily:* — the dashboard
 *   UI stays unchanged.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');

var redis = null;
function getRedis() {
  if (!redis) redis = store._getRedis();
  return redis;
}

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  var expected = process.env.DASHBOARD_TOKEN;
  var provided =
    (req.query && req.query.token) ||
    (req.headers && req.headers['x-dashboard-token']);

  if (!expected || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized', hint: 'Set DASHBOARD_TOKEN env and pass ?token=' });
  }

  var r = getRedis();
  if (!r) {
    return res.status(500).json({ error: 'Redis not available' });
  }

  try {
    var metrics = {};

    metrics.generated_at = new Date().toISOString();
    metrics.timestamp = dates.formatDateTimeAmsterdam();

    // --- 1. Event counts + states (last 24h from meta:event:*) ---
    metrics.events = await aggregateEvents(r);

    // --- 2. EMQ snapshot from the latest emq_hourly: key ---
    metrics.emq = await latestEmq(r);

    // --- 3. Daily coverage summary per event type ---
    metrics.coverage = await latestDailySummary();

    // --- 4. Catalog sync snapshot (latest catalog:sync:* key) ---
    metrics.catalog = await latestCatalogSync(r);

    // --- 5. Bridge health (latest bridge:health:* key) ---
    metrics.bridge = await latestBridgeHealth(r);

    // --- 6. Identity resubmit activity (last 24h of backfill:resubmit:run:*) ---
    metrics.resubmit = await resubmitStats(r);

    // --- 7. Content generation (provider-agnostic view of predis:daily:*) ---
    metrics.content = await contentStats(r);

    // --- 8. Alert feed from today's alert:history: ---
    metrics.alerts = await alertFeed(r);

    // --- 9. Last Purchase event (newest meta:event:purchase_*) ---
    metrics.last_purchase = await lastPurchase(r);

    return res.status(200).json({ ok: true, metrics: metrics });

  } catch (err) {
    console.error('[DashboardMetrics] Error:', err && err.message, err && err.stack);
    return res.status(500).json({ ok: false, error: err && err.message });
  }
};

async function aggregateEvents(r) {
  // Scan meta:event:* and bucket by event_name + state + age
  var now = Date.now();
  var states = { confirmed: 0, received: 0, sent: 0, retry_pending: 0, failed_terminal: 0, recovered: 0 };
  var perName = {};
  var sources = {};
  var last1h = 0;
  var last24h = 0;
  var cursor = '0';
  var scanned = 0;

  do {
    var result = await r.scan(cursor, { match: 'meta:event:*', count: 200 });
    cursor = String(result[0]);
    var keys = result[1] || [];
    for (var i = 0; i < keys.length && scanned < 1500; i++) {
      scanned++;
      var raw = await r.get(keys[i]);
      if (!raw) continue;
      var ev = typeof raw === 'object' ? raw : null;
      if (!ev) { try { ev = JSON.parse(raw); } catch (e) { continue; } }
      var name = ev.event_name || 'Unknown';
      var st = ev.state || 'unknown';
      if (states[st] !== undefined) states[st]++;
      if (!perName[name]) perName[name] = { total: 0, confirmed: 0, failed: 0, pending: 0 };
      perName[name].total++;
      if (st === 'confirmed' || st === 'recovered') perName[name].confirmed++;
      if (st === 'failed_terminal') perName[name].failed++;
      if (st === 'retry_pending' || st === 'received' || st === 'sent') perName[name].pending++;
      if (ev.source) sources[ev.source] = (sources[ev.source] || 0) + 1;
      var ageMs = now - new Date(ev.created_at || 0).getTime();
      if (ageMs <= 3600 * 1000) last1h++;
      if (ageMs <= 24 * 3600 * 1000) last24h++;
    }
  } while (cursor !== '0' && scanned < 1500);

  return {
    scanned: scanned,
    last_hour: last1h,
    last_24h: last24h,
    by_state: states,
    by_event_name: perName,
    by_source: sources
  };
}

async function latestEmq(r) {
  // emq_hourly keys: emq_hourly:DD-MM-YYYY-HH (from dates.formatDateTimeAmsterdam)
  var cursor = '0';
  var keys = [];
  do {
    var out = await r.scan(cursor, { match: 'emq_hourly:*', count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  if (keys.length === 0) return { available: false };
  keys.sort();
  var newest = keys[keys.length - 1];
  var raw = await store.get(newest);
  if (!raw) return { available: false };
  try {
    var data = JSON.parse(raw);
    return Object.assign({ available: true, key: newest }, data);
  } catch (e) {
    return { available: false, reason: 'parse_error' };
  }
}

async function latestDailySummary() {
  var today = new Date().toISOString().split('T')[0];
  var raw = await store.get('diag:summary:' + today);
  if (!raw) return { available: false, date: today };
  try {
    var summary = JSON.parse(raw);
    var computed = {};
    Object.keys(summary).forEach(function (eventName) {
      var s = summary[eventName];
      var total = s.total || 0;
      computed[eventName] = {
        total: total,
        em_pct: total ? Math.round((s.em / total) * 100) : 0,
        ph_pct: total ? Math.round((s.ph / total) * 100) : 0,
        fbp_pct: total ? Math.round((s.fbp / total) * 100) : 0,
        fbc_pct: total ? Math.round((s.fbc / total) * 100) : 0,
        external_id_pct: total ? Math.round((s.external_id / total) * 100) : 0,
        fn_pct: total ? Math.round((s.fn / total) * 100) : 0,
        ln_pct: total ? Math.round((s.ln / total) * 100) : 0
      };
    });
    return { available: true, date: today, by_event: computed };
  } catch (e) {
    return { available: false, reason: 'parse_error' };
  }
}

async function latestCatalogSync(r) {
  var cursor = '0';
  var keys = [];
  do {
    var out = await r.scan(cursor, { match: 'catalog:sync:*', count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  if (keys.length === 0) return { available: false };
  keys.sort();
  var newest = keys[keys.length - 1];
  var raw = await store.get(newest);
  if (!raw) return { available: false };
  try {
    var data = JSON.parse(raw);
    return Object.assign({ available: true, key: newest }, data);
  } catch (e) {
    return { available: false, reason: 'parse_error' };
  }
}

async function latestBridgeHealth(r) {
  var cursor = '0';
  var keys = [];
  do {
    var out = await r.scan(cursor, { match: 'bridge:health:*', count: 50 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  if (keys.length === 0) return { available: false };
  keys.sort();
  var newest = keys[keys.length - 1];
  var raw = await store.get(newest);
  if (!raw) return { available: false };
  try {
    return Object.assign({ available: true, key: newest }, JSON.parse(raw));
  } catch (e) {
    return { available: false, reason: 'parse_error' };
  }
}

async function resubmitStats(r) {
  var cursor = '0';
  var keys = [];
  do {
    var out = await r.scan(cursor, { match: 'backfill:resubmit:run:*', count: 100 });
    cursor = String(out[0]);
    keys = keys.concat(out[1] || []);
  } while (cursor !== '0');
  if (keys.length === 0) {
    return { available: true, runs_24h: 0, resubmitted: 0, meta_failures: 0, scanned: 0 };
  }
  // Aggregate last 24h by parsing timestamp in key name
  var cutoff = Date.now() - 24 * 3600 * 1000;
  var totals = { runs_24h: 0, resubmitted: 0, meta_failures: 0, scanned: 0 };
  for (var i = 0; i < keys.length; i++) {
    var raw = await store.get(keys[i]);
    if (!raw) continue;
    try {
      var run = JSON.parse(raw);
      var ts = new Date((run.timestamp || '').toString().replace(' ', 'T')).getTime() || 0;
      if (ts && ts < cutoff) continue;
      totals.runs_24h++;
      totals.resubmitted += run.resubmitted || 0;
      totals.meta_failures += run.meta_failures || 0;
      totals.scanned += run.scanned || 0;
    } catch (e) { /* skip bad entry */ }
  }
  return Object.assign({ available: true }, totals);
}

async function contentStats(r) {
  // Provider-agnostic: surface only counts + last activity, not provider-specific fields.
  var today = new Date().toISOString().split('T')[0];
  var raw = await store.get('predis:daily:' + today);
  if (!raw) {
    return { available: true, today: 0, submitted: 0, completed: 0, failed: 0, draft_only: 0 };
  }
  var jobIds = [];
  try { jobIds = JSON.parse(raw); if (!Array.isArray(jobIds)) jobIds = []; }
  catch (e) { jobIds = []; }
  var counts = { submitted: 0, completed: 0, failed: 0, draft_only: 0 };
  var lastActivity = null;
  for (var i = 0; i < jobIds.length; i++) {
    var jobRaw = await store.get('predis:job:' + jobIds[i]);
    if (!jobRaw) continue;
    try {
      var job = JSON.parse(jobRaw);
      var st = job.status || 'unknown';
      if (st === 'submitted') counts.submitted++;
      else if (st === 'completed') counts.completed++;
      else if (st === 'failed') counts.failed++;
      if (job.draftOnly) counts.draft_only++;
      var ts = job.completedAt || job.submittedAt || null;
      if (ts && (!lastActivity || ts > lastActivity)) lastActivity = ts;
    } catch (e) { /* skip */ }
  }
  return Object.assign({ available: true, today: jobIds.length, last_activity: lastActivity }, counts);
}

async function alertFeed(r) {
  var today = new Date().toISOString().split('T')[0];
  var key = 'alert:history:' + today;
  var raw = await store.get(key);
  if (!raw) return { available: true, date: today, total: 0, by_priority: { P0: 0, P1: 0, P2: 0 }, recent: [] };
  try {
    var history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
    var byPriority = { P0: 0, P1: 0, P2: 0 };
    for (var i = 0; i < history.length; i++) {
      var p = history[i].priority || 'P2';
      if (byPriority[p] !== undefined) byPriority[p]++;
    }
    var recent = history.slice(-20).reverse();
    return { available: true, date: today, total: history.length, by_priority: byPriority, recent: recent };
  } catch (e) {
    return { available: false, reason: 'parse_error' };
  }
}

async function lastPurchase(r) {
  var cursor = '0';
  var best = null;
  var bestTime = 0;
  var scanned = 0;
  do {
    var out = await r.scan(cursor, { match: 'meta:event:purchase_*', count: 200 });
    cursor = String(out[0]);
    var keys = out[1] || [];
    for (var i = 0; i < keys.length && scanned < 500; i++) {
      scanned++;
      var raw = await r.get(keys[i]);
      if (!raw) continue;
      var ev = typeof raw === 'object' ? raw : null;
      if (!ev) { try { ev = JSON.parse(raw); } catch (e) { continue; } }
      var t = new Date(ev.created_at || 0).getTime();
      if (t > bestTime) { bestTime = t; best = ev; }
    }
  } while (cursor !== '0' && scanned < 500);

  if (!best) return { available: false };
  return {
    available: true,
    event_id: best.event_id,
    state: best.state,
    source: best.source,
    created_at: best.created_at,
    shopify_id: best.shopify_id,
    meta_response: best.meta_response && best.meta_response.ok
  };
}
