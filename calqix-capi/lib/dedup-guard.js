/**
 * In-memory deduplication guard for Shopify webhook retries.
 *
 * Shopify retries webhooks on timeout/failure. This guard prevents the same
 * event from being sent to Meta twice within Meta's 48-hour dedup window.
 *
 * NOTE: This is NOT for deduplicating between Shopify native CAPI and custom
 * CAPI — Meta handles that via event_id. This is purely for webhook retries.
 */

const TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map();

function buildKey(eventName, identifier) {
  return eventName + '_' + identifier;
}

/**
 * Check whether this event was already processed recently.
 * @param {string} eventName  e.g. 'Purchase'
 * @param {string} identifier e.g. order id, checkout token, cart id, customer id
 * @returns {boolean} true if duplicate (already processed within TTL)
 */
function isDuplicate(eventName, identifier) {
  if (!eventName || !identifier) return false;
  var key = buildKey(eventName, identifier);
  var entry = cache.get(key);
  if (!entry) return false;
  if (Date.now() - entry > TTL_MS) {
    cache.delete(key);
    return false;
  }
  return true;
}

/**
 * Mark an event as processed.
 * @param {string} eventName
 * @param {string} identifier
 */
function markProcessed(eventName, identifier) {
  if (!eventName || !identifier) return;
  cache.set(buildKey(eventName, identifier), Date.now());
}

/**
 * Return current cache size (for diagnostics).
 * @returns {number}
 */
function cacheSize() {
  return cache.size;
}

/**
 * Return the last N processed keys (no PII — keys are event_name + id).
 * @param {number} n
 * @returns {string[]}
 */
function recentKeys(n) {
  var keys = Array.from(cache.keys());
  return keys.slice(-Math.min(n, keys.length));
}

// Periodic cleanup of expired entries
var cleanupTimer = setInterval(function () {
  var now = Date.now();
  cache.forEach(function (timestamp, key) {
    if (now - timestamp > TTL_MS) {
      cache.delete(key);
    }
  });
}, CLEANUP_INTERVAL_MS);

// Allow Node to exit cleanly without waiting for the timer
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

module.exports = {
  isDuplicate,
  markProcessed,
  cacheSize,
  recentKeys
};
