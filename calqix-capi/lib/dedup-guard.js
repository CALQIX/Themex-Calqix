/**
 * Deduplication guard for Shopify webhook retries.
 *
 * Uses durable store (Upstash Redis) when available, falls back to in-memory.
 * Prevents the same event from being sent to Meta twice within the 48-hour window.
 *
 * All functions are async because the durable store uses network calls.
 */
var store = require('./store');

// In-memory tracking for diagnostics visibility (complements durable Redis store)
var recentKeysList = [];
var MAX_RECENT_KEYS = 100;

function trackKey(key) {
  recentKeysList.unshift(key);
  if (recentKeysList.length > MAX_RECENT_KEYS) {
    recentKeysList.length = MAX_RECENT_KEYS;
  }
}

/**
 * Return the number of recently tracked dedup keys (in-memory, this instance only).
 * @returns {number}
 */
function cacheSize() {
  return recentKeysList.length;
}

/**
 * Return the N most recent dedup keys (in-memory, this instance only).
 * Keys are truncated to avoid leaking full identifiers.
 * @param {number} n
 * @returns {string[]}
 */
function recentKeys(n) {
  var count = n || 5;
  return recentKeysList.slice(0, count).map(function (k) {
    return k.length > 30 ? k.substring(0, 30) + '...' : k;
  });
}

/**
 * Check whether this event was already processed recently.
 * @param {string} eventName  e.g. 'Purchase'
 * @param {string} identifier e.g. order id, checkout token
 * @returns {Promise<boolean>} true if duplicate
 */
async function isDuplicate(eventName, identifier) {
  return store.isDuplicate(eventName, identifier);
}

/**
 * Mark an event as processed (TTL 48h).
 * @param {string} eventName
 * @param {string} identifier
 * @returns {Promise<void>}
 */
async function markProcessed(eventName, identifier) {
  trackKey(eventName + ':' + identifier);
  return store.markProcessed(eventName, identifier);
}

module.exports = {
  isDuplicate,
  markProcessed,
  cacheSize,
  recentKeys
};
