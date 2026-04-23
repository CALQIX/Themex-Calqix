/**
 * Alert Deduplication & Priority — prevents alert spam in Telegram.
 *
 * Priority levels:
 *   P0 (kritiek): no rate limit, 5 min dedup window. Triggers AI incident analysis.
 *   P1 (hoog): max 1x per uur per probleem. Triggers AI incident analysis.
 *   P2 (info): bundled in daily reports only.
 *
 * Redis keys:
 *   alert:dedup:{hash}       → JSON { count, firstSeen, lastSeen }  TTL varies by priority
 *   alert:history:{date}     → JSON array of alert summaries         TTL 14d
 *
 * Usage:
 *   var alertDedup = require('./alert-dedup');
 *   var result = await alertDedup.shouldAlert('bridge-health', 'meta', 'ViewContent', 'capture_drop_50pct', 'P0');
 *   if (result.send) { sendTelegram(...); }
 */
var store = require('./store');
var crypto = require('crypto');
var dates = require('./dates');

var PRIORITY = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2'
};

var DIGEST_QUEUE_KEY = 'alert:digest:pending';
var DIGEST_QUEUE_TTL = 7 * 86400;
var DIGEST_QUEUE_MAX = 200;

function digestModeEnabled() {
  // Central toggle that lets the daily-digest cron batch all non-P0 alerts.
  // Default: off (preserves legacy behavior). Flip on when you want a single
  // morning Telegram rollup instead of per-cron pings.
  return process.env.ALERT_DIGEST_MODE === 'true';
}

async function pushDigestEntry(entry) {
  try {
    var raw = await store.get(DIGEST_QUEUE_KEY);
    var list = [];
    if (raw) {
      try { list = JSON.parse(raw); if (!Array.isArray(list)) list = []; }
      catch (e) { list = []; }
    }
    list.push(entry);
    if (list.length > DIGEST_QUEUE_MAX) list = list.slice(-DIGEST_QUEUE_MAX);
    await store.set(DIGEST_QUEUE_KEY, JSON.stringify(list), DIGEST_QUEUE_TTL);
  } catch (e) { /* digest buffering must never break the caller */ }
}

async function flushDigestQueue() {
  var raw = await store.get(DIGEST_QUEUE_KEY);
  if (!raw) return [];
  var list = [];
  try { list = JSON.parse(raw); if (!Array.isArray(list)) list = []; }
  catch (e) { list = []; }
  await store.del(DIGEST_QUEUE_KEY);
  return list;
}

async function peekDigestQueue() {
  var raw = await store.get(DIGEST_QUEUE_KEY);
  if (!raw) return [];
  try { var list = JSON.parse(raw); return Array.isArray(list) ? list : []; }
  catch (e) { return []; }
}

var DEDUP_TTL = {
  P0: 5 * 60,       // 5 minutes
  P1: 60 * 60,      // 1 hour
  P2: 24 * 60 * 60  // 24 hours (bundled)
};

var PREFIX = {
  P0: '\uD83D\uDD34',  // 🔴
  P1: '\uD83D\uDFE1',  // 🟡
  P2: '\u2139\uFE0F'   // ℹ️
};

/**
 * Check if an alert should be sent, respecting dedup windows.
 *
 * @param {string} cron — source cron name
 * @param {string} platform — 'meta' | 'google' | 'tiktok' | 'system'
 * @param {string} eventType — event type or '*'
 * @param {string} issue — short issue identifier
 * @param {string} priority — 'P0' | 'P1' | 'P2'
 * @returns {Promise<{send: boolean, suppressed: number, priority: string, prefix: string, hash: string}>}
 */
async function shouldAlert(cron, platform, eventType, issue, priority) {
  var p = priority || PRIORITY.P2;
  var hash = generateHash(cron, platform, eventType, issue);
  var dedupKey = 'alert:dedup:' + hash;
  var ttl = DEDUP_TTL[p] || DEDUP_TTL.P2;

  // P2 alerts are never sent individually — always bundled
  if (p === PRIORITY.P2) {
    await recordAlert(hash, p, cron, platform, eventType, issue);
    return { send: false, suppressed: 0, priority: p, prefix: PREFIX[p], hash: hash, reason: 'P2 bundled in daily report' };
  }

  var existing = await getJSON(dedupKey);

  if (existing) {
    // Within dedup window — suppress but increment counter
    existing.count = (existing.count || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    await setJSON(dedupKey, existing, ttl);
    await recordAlert(hash, p, cron, platform, eventType, issue);
    return { send: false, suppressed: existing.count, priority: p, prefix: PREFIX[p], hash: hash, reason: 'Dedup window active' };
  }

  // New alert or window expired — allow send
  await setJSON(dedupKey, {
    count: 1,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    cron: cron,
    platform: platform,
    eventType: eventType,
    issue: issue,
    priority: p
  }, ttl);
  await recordAlert(hash, p, cron, platform, eventType, issue);

  // Digest mode: P1 alerts are rolled up into the daily digest instead of
  // firing a Telegram message each time. P0 keeps firing immediately — those
  // are the actual production fires we can't sit on.
  if (p === PRIORITY.P1 && digestModeEnabled()) {
    await pushDigestEntry({
      priority: p,
      cron: cron,
      platform: platform,
      eventType: eventType,
      issue: issue,
      hash: hash,
      timestamp: new Date().toISOString()
    });
    return {
      send: false,
      suppressed: 0,
      priority: p,
      prefix: PREFIX[p],
      hash: hash,
      digested: true,
      reason: 'P1 buffered into daily digest'
    };
  }

  return { send: true, suppressed: 0, priority: p, prefix: PREFIX[p], hash: hash };
}

/**
 * Get the suppressed count for a specific alert (for "Nx voorgekomen" messages).
 */
async function getSuppressedCount(hash) {
  var data = await getJSON('alert:dedup:' + hash);
  return data ? (data.count || 0) : 0;
}

/**
 * Get all P2 alerts for today (for daily report bundling).
 */
async function getTodayAlerts() {
  var key = 'alert:history:' + dates.todayKey();
  var alerts = await getJSON(key);
  return alerts || [];
}

/**
 * Record alert in daily history.
 */
async function recordAlert(hash, priority, cron, platform, eventType, issue) {
  var key = 'alert:history:' + dates.todayKey();
  var history = (await getJSON(key)) || [];
  history.push({
    hash: hash,
    priority: priority,
    cron: cron,
    platform: platform,
    eventType: eventType,
    issue: issue,
    timestamp: new Date().toISOString()
  });
  // Keep max 500 entries per day
  if (history.length > 500) history = history.slice(-500);
  await setJSON(key, history, 14 * 86400);
}

/**
 * Format alert prefix with suppression info.
 */
function formatAlertPrefix(priority, suppressed) {
  var prefix = PREFIX[priority] || PREFIX.P2;
  var label = prefix + ' ' + priority;
  if (suppressed > 0) {
    label += ' (' + suppressed + 'x voorgekomen sinds laatste melding)';
  }
  return label;
}

/**
 * Check if a priority level should trigger AI incident analysis.
 */
function shouldTriggerIncidentAnalysis(priority) {
  return priority === PRIORITY.P0 || priority === PRIORITY.P1;
}

function generateHash(cron, platform, eventType, issue) {
  var raw = [cron, platform, eventType, issue].join(':');
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 12);
}

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

module.exports = {
  PRIORITY: PRIORITY,
  PREFIX: PREFIX,
  shouldAlert: shouldAlert,
  getSuppressedCount: getSuppressedCount,
  getTodayAlerts: getTodayAlerts,
  formatAlertPrefix: formatAlertPrefix,
  shouldTriggerIncidentAnalysis: shouldTriggerIncidentAnalysis,
  digestModeEnabled: digestModeEnabled,
  flushDigestQueue: flushDigestQueue,
  peekDigestQueue: peekDigestQueue,
  pushDigestEntry: pushDigestEntry
};
