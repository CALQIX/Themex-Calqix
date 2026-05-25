/**
 * CAPI Parameter Coverage Diagnostics
 *
 * Stores per-event diagnostics in Redis for debugging match quality.
 * Rolling window: last 100 events per type, TTL 24h per entry.
 *
 * Redis keys:
 *   diag:coverage:{eventName}:{eventId} → JSON  TTL 24h
 *   diag:summary:{YYYY-MM-DD}           → JSON  TTL 7d  (daily aggregated summary)
 */
var store = require('./store');
var dates = require('./dates');

var TTL_ENTRY = 24 * 3600;      // 24 hours per diagnostic entry
var TTL_SUMMARY = 7 * 24 * 3600; // 7 days for daily summary

/**
 * Record parameter coverage for a single event.
 * @param {string} eventName - e.g. 'AddToCart', 'Purchase'
 * @param {string} eventId
 * @param {string} source - 'browser_bridge' | 'custom_pixel' | 'webhook'
 * @param {object} userData - the user_data object sent to Meta
 * @param {object} [extra] - additional diagnostics
 */
async function recordCoverage(eventName, eventId, source, userData, extra) {
  try {
    var ud = userData || {};
    var coverage = {
      em: Boolean(ud.em),
      ph: Boolean(ud.ph),
      fn: Boolean(ud.fn),
      ln: Boolean(ud.ln),
      ct: Boolean(ud.ct),
      st: Boolean(ud.st),
      zp: Boolean(ud.zp),
      country: Boolean(ud.country),
      fbc: Boolean(ud.fbc),
      fbp: Boolean(ud.fbp),
      external_id: Boolean(ud.external_id),
      client_ip_address: Boolean(ud.client_ip_address),
      client_user_agent: Boolean(ud.client_user_agent)
    };

    var entry = {
      event_name: eventName,
      event_id: eventId,
      source: source,
      coverage: coverage,
      ts: new Date().toISOString()
    };
    if (extra) entry.extra = extra;

    var key = 'diag:coverage:' + eventName + ':' + eventId;
    await store.set(key, JSON.stringify(entry), TTL_ENTRY);

    // Update daily summary counters
    await incrementDailySummary(eventName, coverage);
  } catch (e) {
    // Diagnostics should never break the main flow
    console.warn('[Diagnostics] recordCoverage error:', e.message);
  }
}

/**
 * Increment daily summary counters for parameter coverage.
 */
async function incrementDailySummary(eventName, coverage) {
  var today = dates.toISODateAmsterdam();
  var key = 'diag:summary:' + today;

  var raw = await store.get(key);
  var summary = store.parseJsonValue(raw, {});

  if (!summary[eventName]) {
    summary[eventName] = {
      total: 0,
      em: 0,
      ph: 0,
      fn: 0,
      ln: 0,
      ct: 0,
      st: 0,
      zp: 0,
      country: 0,
      fbp: 0,
      fbc: 0,
      external_id: 0,
      client_ip_address: 0,
      client_user_agent: 0
    };
  }

  var s = summary[eventName];
  s.total++;
  Object.keys(coverage).forEach(function (field) {
    if (coverage[field]) s[field] = (s[field] || 0) + 1;
    else if (s[field] === undefined) s[field] = 0;
  });

  await store.set(key, JSON.stringify(summary), TTL_SUMMARY);
}

/**
 * Get daily summary for a given date.
 * @param {string} [dateStr] - YYYY-MM-DD, defaults to today
 * @returns {Promise<object|null>}
 */
async function getDailySummary(dateStr) {
  var d = dateStr || dates.toISODateAmsterdam();
  var key = 'diag:summary:' + d;
  var raw = await store.get(key);
  var parsed = store.parseJsonValue(raw, null);
  if (parsed) return parsed;

  // Transition fallback for summaries written before the Amsterdam-day fix.
  var legacyUtcDay = dates.toISODate();
  if (d === dates.toISODateAmsterdam() && legacyUtcDay !== d) {
    var legacyRaw = await store.get('diag:summary:' + legacyUtcDay);
    return store.parseJsonValue(legacyRaw, null);
  }

  return null;
}

module.exports = {
  recordCoverage: recordCoverage,
  getDailySummary: getDailySummary
};
