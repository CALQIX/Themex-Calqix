/**
 * Durable key-value store for CALQIX CAPI.
 *
 * PRODUCTION: Upstash Redis (via @upstash/redis REST client)
 * LOCAL DEV:  In-memory Map fallback (only when NODE_ENV !== 'production')
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL   — Upstash Redis REST endpoint
 *   UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST token
 *
 * Key namespaces and TTLs:
 *   dedup:{eventName}:{identifier}  → "1"          TTL 48h   (webhook retry dedup)
 *   enrich:{checkout_token}         → JSON string   TTL 24h   (checkout enrichment)
 *   cron:run:{YYYY-MM-DD}           → JSON string   TTL 48h   (idempotency)
 *   cron:lock                       → "1"           TTL 300s  (concurrency lock)
 *   notify:{runId}                  → JSON string   TTL 48h   (notification status)
 *   artifact:{runId}                → JSON string   TTL 7d    (run artifact metadata)
 */
var redis = null;
var memoryFallback = null;
var storeType = 'none';
var initAttempted = false;

function initRedis() {
  if (redis) return true;
  if (initAttempted) return false;
  initAttempted = true;

  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    var isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    if (isProduction) {
      console.error('[Store] CRITICAL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production. Durable state is DISABLED.');
    }
    return false;
  }

  try {
    var Redis = require('@upstash/redis').Redis;
    redis = new Redis({ url: url, token: token });
    storeType = 'redis';
    console.log('[Store] Upstash Redis connected');
    return true;
  } catch (err) {
    console.error('[Store] Failed to init Redis:', err.message);
    return false;
  }
}

function getMemoryFallback() {
  if (!memoryFallback) {
    memoryFallback = new Map();
    storeType = 'memory';
    console.warn('[Store] Using in-memory fallback (local dev only).');
  }
  return memoryFallback;
}

// Periodic cleanup for memory fallback
var cleanupTimer = setInterval(function () {
  if (!memoryFallback) return;
  var now = Date.now();
  memoryFallback.forEach(function (entry, key) {
    if (entry.expiresAt && now > entry.expiresAt) {
      memoryFallback.delete(key);
    }
  });
}, 60000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

/**
 * Set a key with optional TTL (seconds).
 * @param {string} key
 * @param {string} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
async function set(key, value, ttlSeconds) {
  if (initRedis()) {
    try {
      if (ttlSeconds) {
        await redis.set(key, value, { ex: ttlSeconds });
      } else {
        await redis.set(key, value);
      }
      return true;
    } catch (err) {
      console.error('[Store] Redis SET failed:', key, err.message);
      return false;
    }
  }

  var mem = getMemoryFallback();
  mem.set(key, {
    value: value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
  return true;
}

/**
 * Get a key's value.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function get(key) {
  if (initRedis()) {
    try {
      var val = await redis.get(key);
      if (val === null || val === undefined) return null;
      // Upstash REST client auto-deserializes JSON — re-serialize objects
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    } catch (err) {
      console.error('[Store] Redis GET failed:', key, err.message);
      return null;
    }
  }

  var mem = getMemoryFallback();
  var entry = mem.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Delete a key.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function del(key) {
  if (initRedis()) {
    try {
      await redis.del(key);
      return true;
    } catch (err) {
      console.error('[Store] Redis DEL failed:', key, err.message);
      return false;
    }
  }

  var mem = getMemoryFallback();
  mem.delete(key);
  return true;
}

/**
 * Set a key only if it does not exist (atomic lock).
 * @param {string} key
 * @param {string} value
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>} true if the key was set (lock acquired)
 */
async function setnx(key, value, ttlSeconds) {
  if (initRedis()) {
    try {
      var result = await redis.set(key, value, { nx: true, ex: ttlSeconds });
      return result === 'OK' || result === true;
    } catch (err) {
      console.error('[Store] Redis SETNX failed:', key, err.message);
      return false;
    }
  }

  var mem = getMemoryFallback();
  var existing = mem.get(key);
  if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt)) {
    return false;
  }
  mem.set(key, {
    value: value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
  return true;
}

/**
 * Get the current store type.
 * @returns {string} 'redis' | 'memory' | 'none'
 */
function getStoreType() {
  return storeType;
}

// --- Namespaced helpers ---

var TTL_DEDUP = 48 * 3600;      // 48 hours
var TTL_ENRICH = 24 * 3600;     // 24 hours
var TTL_CRON_RUN = 48 * 3600;   // 48 hours
var TTL_CRON_LOCK = 300;        // 5 minutes

async function isDuplicate(eventName, identifier) {
  if (!eventName || !identifier) return false;
  var key = 'dedup:' + eventName + ':' + identifier;
  var val = await get(key);
  return val !== null;
}

async function markProcessed(eventName, identifier) {
  if (!eventName || !identifier) return;
  var key = 'dedup:' + eventName + ':' + identifier;
  await set(key, '1', TTL_DEDUP);
}

async function getEnrichment(checkoutToken) {
  if (!checkoutToken) return null;
  var key = 'enrich:' + checkoutToken;
  var val = await get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch (e) { return null; }
}

async function setEnrichment(checkoutToken, data) {
  if (!checkoutToken || !data) return;
  var key = 'enrich:' + checkoutToken;
  await set(key, JSON.stringify(data), TTL_ENRICH);
}

async function getCronRun(dateKey) {
  var key = 'cron:run:' + dateKey;
  var val = await get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch (e) { return val; }
}

async function setCronRun(dateKey, result) {
  var key = 'cron:run:' + dateKey;
  await set(key, JSON.stringify(result), TTL_CRON_RUN);
}

async function acquireCronLock() {
  return setnx('cron:lock', '1', TTL_CRON_LOCK);
}

async function releaseCronLock() {
  return del('cron:lock');
}

var TTL_NOTIFY = 48 * 3600;     // 48 hours
var TTL_ARTIFACT = 7 * 24 * 3600; // 7 days

async function setNotifyStatus(runId, data) {
  if (!runId || !data) return;
  var key = 'notify:' + runId;
  await set(key, JSON.stringify(data), TTL_NOTIFY);
}

async function getNotifyStatus(runId) {
  if (!runId) return null;
  var key = 'notify:' + runId;
  var val = await get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch (e) { return val; }
}

async function setArtifact(runId, data) {
  if (!runId || !data) return;
  var key = 'artifact:' + runId;
  await set(key, JSON.stringify(data), TTL_ARTIFACT);
}

async function getArtifact(runId) {
  if (!runId) return null;
  var key = 'artifact:' + runId;
  var val = await get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch (e) { return val; }
}

function isRedisActive() {
  return storeType === 'redis';
}

module.exports = {
  set: set,
  get: get,
  del: del,
  setnx: setnx,
  getStoreType: getStoreType,
  isRedisActive: isRedisActive,
  isDuplicate: isDuplicate,
  markProcessed: markProcessed,
  getEnrichment: getEnrichment,
  setEnrichment: setEnrichment,
  getCronRun: getCronRun,
  setCronRun: setCronRun,
  acquireCronLock: acquireCronLock,
  releaseCronLock: releaseCronLock,
  setNotifyStatus: setNotifyStatus,
  getNotifyStatus: getNotifyStatus,
  setArtifact: setArtifact,
  getArtifact: getArtifact
};
