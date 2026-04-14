/**
 * Meta Event Lifecycle State Machine
 *
 * Tracks each logical Meta event through its lifecycle:
 *   received → prepared → sent → confirmed
 *                              → retry_pending → (sent again)
 *                              → failed_terminal
 *                              → recovered
 *
 * Redis key patterns:
 *   meta:event:{event_id}    → JSON state object       TTL 7d
 *   meta:pending:{event_id}  → "1"                     TTL 7d
 *   meta:failed:{event_id}   → "1"                     TTL 7d
 *   recovery:queue            → Redis list of event_ids
 *
 * No PII is stored — only event metadata and delivery status.
 */
var store = require('./store');

var STATES = {
  RECEIVED: 'received',
  PREPARED: 'prepared',
  SENT: 'sent',
  CONFIRMED: 'confirmed',
  RETRY_PENDING: 'retry_pending',
  FAILED_TERMINAL: 'failed_terminal',
  RECOVERED: 'recovered'
};

var TTL_EVENT = 7 * 24 * 3600;      // 7 days
var TTL_PENDING = 7 * 24 * 3600;    // 7 days
var TTL_FAILED = 7 * 24 * 3600;     // 7 days
var MAX_RETRY_ATTEMPTS = 5;
var STALE_SENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — treat "sent" as lost after this

function eventKey(eventId) { return 'meta:event:' + eventId; }
function pendingKey(eventId) { return 'meta:pending:' + eventId; }
function failedKey(eventId) { return 'meta:failed:' + eventId; }
function payloadKey(eventId) { return 'meta:payload:' + eventId; }
var RECOVERY_QUEUE_KEY = 'recovery:queue';

/**
 * Record that an event was received from a source.
 * @param {string} eventId — deterministic event ID (e.g. purchase_abc123)
 * @param {string} eventName — Meta event name (e.g. Purchase)
 * @param {string} source — 'webhook' | 'custom_pixel' | 'recovery'
 * @param {string} shopifyId — Shopify resource identifier
 * @returns {Promise<object>} the event state object
 */
async function recordReceived(eventId, eventName, source, shopifyId) {
  var now = new Date().toISOString();
  var state = {
    event_id: eventId,
    event_name: eventName,
    state: STATES.RECEIVED,
    source: source,
    shopify_id: shopifyId || null,
    attempts: 0,
    last_attempt: null,
    meta_response: null,
    created_at: now,
    updated_at: now
  };
  await store.set(eventKey(eventId), JSON.stringify(state), TTL_EVENT);
  await store.set(pendingKey(eventId), '1', TTL_PENDING);
  return state;
}

/**
 * Record that an event was sent to Meta CAPI.
 * @param {string} eventId
 * @param {object} metaResponse — { ok, status, result } from meta-capi.sendEvent
 * @returns {Promise<object|null>} updated state or null if event not found
 */
async function recordSent(eventId, metaResponse) {
  var raw = await store.get(eventKey(eventId));
  if (!raw) return null;

  var state;
  try { state = JSON.parse(raw); } catch (e) { return null; }

  var now = new Date().toISOString();
  state.attempts = (state.attempts || 0) + 1;
  state.last_attempt = now;
  state.updated_at = now;
  state.meta_response = metaResponse ? { ok: metaResponse.ok, status: metaResponse.status } : null;

  if (metaResponse && metaResponse.ok) {
    state.state = STATES.CONFIRMED;
    // Remove from pending and failed sets
    await store.del(pendingKey(eventId));
    await store.del(failedKey(eventId));
  } else if (state.attempts >= MAX_RETRY_ATTEMPTS) {
    state.state = STATES.FAILED_TERMINAL;
    await store.del(pendingKey(eventId));
    await store.set(failedKey(eventId), '1', TTL_FAILED);
  } else {
    state.state = STATES.RETRY_PENDING;
    // Keep in pending set, also add to failed
    await store.set(failedKey(eventId), '1', TTL_FAILED);
    // Push to recovery queue for retry
    await pushToRecoveryQueue(eventId);
  }

  await store.set(eventKey(eventId), JSON.stringify(state), TTL_EVENT);
  return state;
}

/**
 * Record that a recovery attempt succeeded.
 * @param {string} eventId
 * @returns {Promise<object|null>}
 */
async function recordRecovered(eventId) {
  var raw = await store.get(eventKey(eventId));
  if (!raw) return null;

  var state;
  try { state = JSON.parse(raw); } catch (e) { return null; }

  state.state = STATES.RECOVERED;
  state.updated_at = new Date().toISOString();

  await store.del(pendingKey(eventId));
  await store.del(failedKey(eventId));
  await store.set(eventKey(eventId), JSON.stringify(state), TTL_EVENT);
  return state;
}

/**
 * Get the current state of an event.
 * @param {string} eventId
 * @returns {Promise<object|null>}
 */
async function getEventState(eventId) {
  var raw = await store.get(eventKey(eventId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * Check if an event has already been confirmed or recovered.
 * @param {string} eventId
 * @returns {Promise<boolean>}
 */
async function isConfirmed(eventId) {
  var state = await getEventState(eventId);
  if (!state) return false;
  return state.state === STATES.CONFIRMED || state.state === STATES.RECOVERED;
}

/**
 * Push an event ID to the recovery queue.
 * @param {string} eventId
 * @returns {Promise<void>}
 */
async function pushToRecoveryQueue(eventId) {
  if (store.isRedisActive()) {
    try {
      // Use raw Redis LPUSH via store's internal redis
      var redis = store._getRedis();
      if (redis) {
        await redis.lpush(RECOVERY_QUEUE_KEY, eventId);
      }
    } catch (err) {
      console.error('[EventState] Failed to push to recovery queue:', err.message);
    }
  }
}

/**
 * Pop an event ID from the recovery queue.
 * @returns {Promise<string|null>}
 */
async function popFromRecoveryQueue() {
  if (store.isRedisActive()) {
    try {
      var redis = store._getRedis();
      if (redis) {
        return await redis.rpop(RECOVERY_QUEUE_KEY);
      }
    } catch (err) {
      console.error('[EventState] Failed to pop from recovery queue:', err.message);
    }
  }
  return null;
}

/**
 * Store hashed event payload for recovery replay.
 * Only stores already-hashed user_data (no PII) + custom_data + source_url.
 * @param {string} eventId
 * @param {object} userData — already hashed by formatUserData
 * @param {object} customData
 * @param {string} sourceUrl
 * @returns {Promise<void>}
 */
async function storeEventPayload(eventId, userData, customData, sourceUrl) {
  try {
    var payload = {
      user_data: userData || {},
      custom_data: customData || {},
      source_url: sourceUrl || 'https://calqix.com'
    };
    await store.set(payloadKey(eventId), JSON.stringify(payload), TTL_EVENT);
  } catch (err) {
    console.warn('[EventState] Failed to store payload:', err.message);
  }
}

/**
 * Get stored event payload for recovery replay.
 * @param {string} eventId
 * @returns {Promise<object|null>} { user_data, custom_data, source_url }
 */
async function getEventPayload(eventId) {
  try {
    var raw = await store.get(payloadKey(eventId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Get the length of the recovery queue.
 * @returns {Promise<number>}
 */
async function getRecoveryQueueLength() {
  if (store.isRedisActive()) {
    try {
      var redis = store._getRedis();
      if (redis) {
        return await redis.llen(RECOVERY_QUEUE_KEY) || 0;
      }
    } catch (err) {
      console.error('[EventState] Failed to get queue length:', err.message);
    }
  }
  return 0;
}

module.exports = {
  STATES: STATES,
  MAX_RETRY_ATTEMPTS: MAX_RETRY_ATTEMPTS,
  STALE_SENT_THRESHOLD_MS: STALE_SENT_THRESHOLD_MS,
  recordReceived: recordReceived,
  recordSent: recordSent,
  recordRecovered: recordRecovered,
  getEventState: getEventState,
  isConfirmed: isConfirmed,
  storeEventPayload: storeEventPayload,
  getEventPayload: getEventPayload,
  pushToRecoveryQueue: pushToRecoveryQueue,
  popFromRecoveryQueue: popFromRecoveryQueue,
  getRecoveryQueueLength: getRecoveryQueueLength
};
