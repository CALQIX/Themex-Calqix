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
var RETRY_DELAYS_MS = [0, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

function eventKey(eventId) { return 'meta:event:' + eventId; }
function pendingKey(eventId) { return 'meta:pending:' + eventId; }
function failedKey(eventId) { return 'meta:failed:' + eventId; }
function payloadKey(eventId) { return 'meta:payload:' + eventId; }
var RECOVERY_QUEUE_KEY = 'recovery:queue';
var RECOVERY_DELAYED_KEY = 'recovery:delayed';

function stableJitterMs(eventId, delayMs) {
  var source = String(eventId || '');
  var hash = 0;
  for (var i = 0; i < source.length; i++) {
    hash = (hash + source.charCodeAt(i) * (i + 1)) % 1000;
  }
  var maxJitter = Math.min(30 * 1000, Math.round(delayMs * 0.15));
  return Math.round((hash / 1000) * maxJitter);
}

function calculateRetryDelayMs(attempts, eventId) {
  var index = Math.max(1, Math.min(Number(attempts) || 1, RETRY_DELAYS_MS.length - 1));
  var delay = RETRY_DELAYS_MS[index];
  return delay + stableJitterMs(eventId, delay);
}

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
    state.next_retry_at = null;
    state.retry_delay_ms = null;
    // Remove from pending and failed sets
    await store.del(pendingKey(eventId));
    await store.del(failedKey(eventId));
  } else if (state.attempts >= MAX_RETRY_ATTEMPTS) {
    state.state = STATES.FAILED_TERMINAL;
    await store.del(pendingKey(eventId));
    await store.set(failedKey(eventId), '1', TTL_FAILED);
  } else {
    state.state = STATES.RETRY_PENDING;
    state.retry_delay_ms = calculateRetryDelayMs(state.attempts, eventId);
    state.next_retry_at = new Date(Date.now() + state.retry_delay_ms).toISOString();
    // Keep in pending set, also add to failed
    await store.set(failedKey(eventId), '1', TTL_FAILED);
    await pushToRecoveryQueue(eventId, state.retry_delay_ms);
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
  state.next_retry_at = null;
  state.retry_delay_ms = null;
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
async function pushToRecoveryQueue(eventId, delayMs) {
  if (store.isRedisActive()) {
    try {
      var redis = store._getRedis();
      if (redis) {
        var delay = Math.max(0, Number(delayMs) || 0);
        if (delay > 0) {
          await redis.zadd(RECOVERY_DELAYED_KEY, {
            score: Date.now() + delay,
            member: eventId
          });
        } else {
          await redis.lpush(RECOVERY_QUEUE_KEY, eventId);
        }
      }
    } catch (err) {
      console.error('[EventState] Failed to push to recovery queue:', err.message);
      try {
        var fallbackRedis = store._getRedis();
        if (fallbackRedis) await fallbackRedis.lpush(RECOVERY_QUEUE_KEY, eventId);
      } catch (fallbackErr) {
        console.error('[EventState] Failed to push fallback recovery queue:', fallbackErr.message);
      }
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
        var due = await redis.zrange(RECOVERY_DELAYED_KEY, 0, Date.now(), {
          byScore: true,
          offset: 0,
          count: 1
        });
        if (Array.isArray(due) && due.length > 0) {
          await redis.zrem(RECOVERY_DELAYED_KEY, due[0]);
          return due[0];
        }
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
      source_url: sourceUrl || 'https://www.calqix.com'
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
        var listLength = await redis.llen(RECOVERY_QUEUE_KEY) || 0;
        var delayedLength = await redis.zcard(RECOVERY_DELAYED_KEY) || 0;
        return listLength + delayedLength;
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
  RETRY_DELAYS_MS: RETRY_DELAYS_MS,
  STALE_SENT_THRESHOLD_MS: STALE_SENT_THRESHOLD_MS,
  calculateRetryDelayMs: calculateRetryDelayMs,
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
