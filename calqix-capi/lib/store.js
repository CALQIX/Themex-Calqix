/**
 * Durable key-value store for CALQIX CAPI.
 *
 * Primary: Upstash Redis (via @upstash/redis REST client)
 * Fallback: In-memory Map (logged warning on startup)
 *
 * Requires env vars for Redis:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Key namespaces and TTLs:
 *   dedup:{eventName}:{identifier}  → "1"          TTL 48h   (webhook retry dedup)
 *   enrich:{checkout_token}         → JSON string   TTL 24h   (checkout enrichment)
 *   cron:run:{YYYY-MM-DD}           → JSON string   TTL 48h   (idempotency)
 *   cron:lock                       → "1"           TTL 300s  (concurrency lock)
 */
var redis = null;
var memoryFallback = null;
var storeType = 'none';

function initRedis() {
  if (redis) return true;

  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return false;
  }

  try {
    var Redis = require('@upstash/redis').Redis;
    redis = new Redis({ url: url, token: token });
    storeType = 'redis';
    console.log('[Store] Using Upstash Redis');
    return true;
  } catch (err) {
    console.warn('[Store] Failed to init Redis, falling back to memory:', err.message);
    return false;
  }
}

function getMemoryFallback() {
  if (!memoryFallback) {
    memoryFallback = new Map();
    storeType = 'memory';
    console.warn('[Store] Using in-memory fallback — state will not survive cold starts. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for durable storage.');
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
      return val !== null && val !== undefined ? String(val) : null;
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

module.exports = {
  set: set,
  get: get,
  del: del,
  setnx: setnx,
  getStoreType: getStoreType,
  isDuplicate: isDuplicate,
  markProcessed: markProcessed,
  getEnrichment: getEnrichment,
  setEnrichment: setEnrichment,
  getCronRun: getCronRun,
  setCronRun: setCronRun,
  acquireCronLock: acquireCronLock,
  releaseCronLock: releaseCronLock
};
