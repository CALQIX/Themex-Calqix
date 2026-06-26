/**
 * Meta Dataset Quality + receive-side stats (READ-ONLY).
 *
 * Single source of truth for pulling the REAL Event Match Quality from Meta
 * (not our send-side estimate in api/cron/emq-deep.js). Used by both the CLI
 * tool (scripts/meta-emq-report.js) and the weekly cron (api/cron/emq-quality.js).
 *
 * Endpoints (verified working 2026-06-26 on pixel 934134615770602):
 *   GET /{v}/dataset_quality?dataset_id={PIXEL}&fields=web{event_match_quality,event_name}
 *       -> per-event composite_score (0-10) + per-identifier coverage %. No agent_name needed.
 *   GET /{v}/{PIXEL}/stats?aggregation={event_source|had_pii|event_total_counts}&start&end
 *
 * No state mutation, no events sent.
 */
var fetch = require('node-fetch');

function ver() { return (process.env.META_API_VERSION || 'v22.0').replace(/^v?/, 'v'); }
function pixelId() { return process.env.META_PIXEL_ID || '934134615770602'; }

async function gj(url) {
  var sep = url.indexOf('?') > -1 ? '&' : '?';
  var r = await fetch(url + sep + 'access_token=' + encodeURIComponent(process.env.META_ACCESS_TOKEN || ''), { timeout: 30000 });
  var t = await r.text();
  var j; try { j = JSON.parse(t); } catch (e) { j = { _raw: String(t).slice(0, 300) }; }
  return { status: r.status, json: j };
}

// Fold a /stats aggregation across its hourly buckets.
// perEvent=false -> { value: count }; perEvent=true -> { event: { value: count } }
function foldStats(statsJson, perEvent) {
  var out = {};
  var buckets = (statsJson && statsJson.data) || [];
  buckets.forEach(function (b) {
    (b.data || []).forEach(function (row) {
      if (perEvent) {
        var ev = row.event || '(none)';
        out[ev] = out[ev] || {};
        out[ev][row.value] = (out[ev][row.value] || 0) + (row.count || 0);
      } else {
        out[row.value] = (out[row.value] || 0) + (row.count || 0);
      }
    });
  });
  return out;
}

/**
 * Returns a structured, fully-resolved EMQ report. Throws only on network error;
 * a Graph error is surfaced as report.dq_error (so callers always get a shape).
 */
async function fetchEmqReport() {
  var V = ver(), PIXEL = pixelId();
  var G = 'https://graph.facebook.com/' + V;
  var now = Math.floor(Date.now() / 1000), wk = now - 7 * 86400;

  var dq = await gj(G + '/dataset_quality?dataset_id=' + PIXEL + '&fields=' + encodeURIComponent('web{event_match_quality,event_name}'));
  var src = await gj(G + '/' + PIXEL + '/stats?aggregation=event_source&start=' + wk + '&end=' + now);
  var pii = await gj(G + '/' + PIXEL + '/stats?aggregation=had_pii&start=' + wk + '&end=' + now);
  var vol = await gj(G + '/' + PIXEL + '/stats?aggregation=event_total_counts&start=' + wk + '&end=' + now);

  var web = (dq.json && dq.json.web) || [];
  var events = web.map(function (e) {
    var emq = e.event_match_quality;
    if (!emq) return { event_name: e.event_name, score: null, keys: [] };
    var keys = (emq.match_key_feedback || []).map(function (k) {
      return { id: k.identifier, pct: (k.coverage && k.coverage.percentage) };
    }).sort(function (a, b) { return a.pct - b.pct; });
    return { event_name: e.event_name, score: emq.composite_score, keys: keys };
  });

  return {
    captured_at: new Date().toISOString(),
    pixel_id: PIXEL,
    api_version: V,
    dq_error: (dq.json && dq.json.error) ? dq.json.error.message : null,
    events: events,
    event_source_7d: foldStats(src.json, false),
    had_pii_7d: foldStats(pii.json, true),
    event_total_counts: (vol.json && vol.json.data && vol.json.data[0] && vol.json.data[0].data) || []
  };
}

// Lowest fbc coverage across scored events (the research-identified lever).
function fbcLow(report) {
  var min = null;
  (report.events || []).forEach(function (e) {
    if (e.score == null) return;
    (e.keys || []).forEach(function (k) {
      if (k.id === 'fbc' && (min === null || k.pct < min.pct)) min = { event: e.event_name, pct: k.pct };
    });
  });
  return min;
}

module.exports = { fetchEmqReport: fetchEmqReport, foldStats: foldStats, fbcLow: fbcLow };
