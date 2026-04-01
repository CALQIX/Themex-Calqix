/**
 * Deduplication guard for Shopify webhook retries.
 *
 * Uses durable store (Upstash Redis) when available, falls back to in-memory.
 * Prevents the same event from being sent to Meta twice within the 48-hour window.
 *
 * All functions are async because the durable store uses network calls.
 */
var store = require('./store');

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
  return store.markProcessed(eventName, identifier);
}

module.exports = {
  isDuplicate,
  markProcessed
};
