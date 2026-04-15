/**
 * Google Ads Offline Conversion Import (OCI) — Enhanced Conversions.
 *
 * Two-phase approach:
 *   1. uploadConversion() — queues conversion in Redis batch
 *   2. flushBatch() — uploads batch via Google Ads REST API (called by cron)
 *
 * Uses gclid/gbraid/wbraid + hashed user data for matching.
 * OAuth tokens managed by lib/google-oauth.js (Redis-backed refresh).
 *
 * Env vars:
 *   GOOGLE_ADS_CUSTOMER_ID         — e.g. 5348494850
 *   GOOGLE_ADS_CONVERSION_ACTION_ID — e.g. AW-18050194876
 *   GOOGLE_ADS_DEVELOPER_TOKEN     — API developer token from MCC
 *   GOOGLE_ADS_MANAGER_ID          — MCC login-customer-id (e.g. 5140035966)
 *   GOOGLE_ADS_ENABLED             — 'true' to enable uploads (default: false)
 *
 * Dedup:
 *   Uses Redis key `processed:gads:{event_id}` with 48h TTL.
 *
 * Google Ads REST API v17:
 *   POST https://googleads.googleapis.com/v17/customers/{id}:uploadClickConversions
 */
var rlFetch = require('./rate-limited-fetch');
var store = require('./store');
var hash = require('./hash');
var googleOAuth = require('./google-oauth');

var API_VERSION = 'v17';
var API_BASE = 'https://googleads.googleapis.com/' + API_VERSION;

var CUSTOMER_ID = function () { return (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''); };
var CONVERSION_ACTION_RAW = function () { return process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || ''; };
var DEVELOPER_TOKEN = function () { return process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''; };
var MANAGER_ID = function () { return (process.env.GOOGLE_ADS_MANAGER_ID || '').replace(/-/g, ''); };
var ENABLED = function () { return (process.env.GOOGLE_ADS_ENABLED || '').trim() === 'true'; };
var DEDUP_TTL = 48 * 3600;
var BATCH_KEY_PREFIX = 'gads:batch:';

/**
 * Build the conversion action resource name for the API.
 * Handles both raw ID (AW-18050194876) and full resource name formats.
 */
function getConversionActionResourceName() {
  var raw = CONVERSION_ACTION_RAW();
  if (!raw) return '';

  // Already a resource name
  if (raw.startsWith('customers/')) return raw;

  // Extract numeric ID from AW-XXXXXXX format
  var numericId = raw.replace(/^AW-/, '');

  return 'customers/' + CUSTOMER_ID() + '/conversionActions/' + numericId;
}

/**
 * Queue an offline conversion for batch upload.
 *
 * @param {object} opts
 * @param {string} opts.eventId — for dedup
 * @param {string} [opts.gclid] — Google click ID
 * @param {string} [opts.gbraid] — Google app click ID
 * @param {string} [opts.wbraid] — Google web click ID
 * @param {number} opts.conversionValue — in EUR
 * @param {string} opts.currencyCode — e.g. 'EUR'
 * @param {string} opts.conversionDateTime — ISO 8601
 * @param {string} [opts.orderId] — for dedup in Google Ads
 * @param {object} [opts.userData] — { email, phone, firstName, lastName, city, zip, country }
 * @returns {Promise<{ok: boolean, deduped: boolean, queued: boolean, error: string|null}>}
 */
async function uploadConversion(opts) {
  if (!CUSTOMER_ID() || !CONVERSION_ACTION_RAW()) {
    console.log('[GoogleAds-OCI] Niet geconfigureerd (CUSTOMER_ID of CONVERSION_ACTION_ID ontbreekt)');
    return { ok: false, deduped: false, queued: false, error: 'not_configured' };
  }

  // Dedup
  if (opts.eventId) {
    var dedupKey = 'processed:gads:' + opts.eventId;
    var existing = await store.get(dedupKey);
    if (existing) {
      console.log('[GoogleAds-OCI] Gededupliceerd:', opts.eventId);
      return { ok: true, deduped: true, queued: false, error: null };
    }
  }

  // Build conversion payload
  var conversion = {
    conversionAction: getConversionActionResourceName(),
    conversionDateTime: formatGoogleDateTime(opts.conversionDateTime),
    conversionValue: opts.conversionValue || 0,
    currencyCode: opts.currencyCode || 'EUR'
  };

  if (opts.gclid) conversion.gclid = opts.gclid;
  if (opts.gbraid) conversion.gbraid = opts.gbraid;
  if (opts.wbraid) conversion.wbraid = opts.wbraid;
  if (opts.orderId) conversion.orderId = opts.orderId;

  // Enhanced Conversions user identifiers (hashed)
  if (opts.userData) {
    var identifiers = [];
    if (opts.userData.email) {
      identifiers.push({ hashedEmail: hash.hash(hash.normalizeEmail(opts.userData.email)) });
    }
    if (opts.userData.phone) {
      identifiers.push({ hashedPhoneNumber: hash.hash(hash.normalizePhone(opts.userData.phone, opts.userData.country)) });
    }
    if (opts.userData.firstName && opts.userData.lastName) {
      var addr = {};
      addr.hashedFirstName = hash.hash(hash.normalizeText(opts.userData.firstName));
      addr.hashedLastName = hash.hash(hash.normalizeText(opts.userData.lastName));
      if (opts.userData.city) addr.city = opts.userData.city;
      if (opts.userData.zip) addr.postalCode = opts.userData.zip;
      if (opts.userData.country) addr.countryCode = opts.userData.country;
      identifiers.push({ addressInfo: addr });
    }

    if (identifiers.length > 0) {
      conversion.userIdentifiers = identifiers;
    }
  }

  console.log('[GoogleAds-OCI] Conversion in queue:', {
    eventId: opts.eventId,
    value: conversion.conversionValue,
    hasGclid: Boolean(opts.gclid),
    hasGbraid: Boolean(opts.gbraid),
    hasWbraid: Boolean(opts.wbraid),
    hasUserData: Boolean(conversion.userIdentifiers),
    enabled: ENABLED()
  });

  // Store in Redis batch queue (keyed by hour for batch grouping)
  var batchKey = BATCH_KEY_PREFIX + new Date().toISOString().slice(0, 13);
  try {
    var redis = store._getRedis();
    if (redis) {
      await redis.lpush(batchKey, JSON.stringify(conversion));
      await redis.expire(batchKey, 86400);
    }
  } catch (e) {
    console.error('[GoogleAds-OCI] Redis batch queue fout:', e.message);
  }

  if (opts.eventId) {
    await store.set('processed:gads:' + opts.eventId, '1', DEDUP_TTL);
  }

  return { ok: true, deduped: false, queued: true, error: null };
}

/**
 * Flush all pending batches to Google Ads API.
 * Called by /api/cron/gads-upload (every 15 min).
 *
 * @returns {Promise<{ok: boolean, uploaded: number, failed: number, batches: number, errors: string[]}>}
 */
async function flushBatch() {
  if (!ENABLED()) {
    return { ok: true, uploaded: 0, failed: 0, batches: 0, errors: ['disabled'] };
  }

  if (!DEVELOPER_TOKEN()) {
    return { ok: false, uploaded: 0, failed: 0, batches: 0, errors: ['GOOGLE_ADS_DEVELOPER_TOKEN ontbreekt'] };
  }

  // Get OAuth access token
  var tokenResult = await googleOAuth.getAccessToken();
  if (!tokenResult.token) {
    return { ok: false, uploaded: 0, failed: 0, batches: 0, errors: ['OAuth token: ' + tokenResult.error] };
  }

  var redis = store._getRedis();
  if (!redis) {
    return { ok: false, uploaded: 0, failed: 0, batches: 0, errors: ['Redis niet beschikbaar'] };
  }

  // Find all batch keys (last 24h of hourly keys)
  var now = new Date();
  var batchKeys = [];
  for (var h = 0; h < 24; h++) {
    var d = new Date(now.getTime() - h * 3600000);
    batchKeys.push(BATCH_KEY_PREFIX + d.toISOString().slice(0, 13));
  }

  var totalUploaded = 0;
  var totalFailed = 0;
  var batchesProcessed = 0;
  var errors = [];

  for (var k = 0; k < batchKeys.length; k++) {
    var key = batchKeys[k];
    var length = await redis.llen(key);
    if (!length || length === 0) continue;

    // Pop all items from the batch
    var items = [];
    for (var i = 0; i < length; i++) {
      var item = await redis.rpop(key);
      if (item) {
        try { items.push(JSON.parse(item)); } catch (e) {}
      }
    }

    if (items.length === 0) continue;
    batchesProcessed++;

    // Upload batch (max 2000 per request per Google docs)
    var chunks = [];
    for (var c = 0; c < items.length; c += 2000) {
      chunks.push(items.slice(c, c + 2000));
    }

    for (var ci = 0; ci < chunks.length; ci++) {
      var result = await uploadBatchToAPI(chunks[ci], tokenResult.token);
      if (result.ok) {
        totalUploaded += result.uploaded;
        totalFailed += result.failed;
        if (result.errors.length > 0) {
          errors = errors.concat(result.errors.slice(0, 3)); // cap errors
        }
      } else {
        // Put items back in queue for retry
        for (var ri = 0; ri < chunks[ci].length; ri++) {
          try { await redis.lpush(key, JSON.stringify(chunks[ci][ri])); } catch (e) {}
        }
        await redis.expire(key, 86400);
        totalFailed += chunks[ci].length;
        errors.push(result.error);
      }
    }
  }

  return {
    ok: errors.length === 0 || totalUploaded > 0,
    uploaded: totalUploaded,
    failed: totalFailed,
    batches: batchesProcessed,
    errors: errors
  };
}

/**
 * Upload a batch of conversions to Google Ads REST API.
 */
async function uploadBatchToAPI(conversions, accessToken) {
  var customerId = CUSTOMER_ID();
  var url = API_BASE + '/customers/' + customerId + ':uploadClickConversions';

  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + accessToken,
    'developer-token': DEVELOPER_TOKEN()
  };

  // If using MCC, include login-customer-id
  var managerId = MANAGER_ID();
  if (managerId) {
    headers['login-customer-id'] = managerId;
  }

  var body = {
    conversions: conversions,
    partialFailure: true
  };

  var result = await rlFetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    label: 'GoogleAds-OCI-Upload',
    maxRetries: 2,
    timeout: 30000
  });

  if (!result.ok) {
    var errMsg = 'API fout: ' + result.status;
    try {
      var errBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
      if (errBody && errBody.error) errMsg = errBody.error.message || errMsg;
    } catch (e) {}
    console.error('[GoogleAds-OCI] Upload mislukt:', errMsg);
    return { ok: false, uploaded: 0, failed: conversions.length, error: errMsg, errors: [] };
  }

  var response = result.body;
  if (typeof response === 'string') {
    try { response = JSON.parse(response); } catch (e) {
      return { ok: true, uploaded: conversions.length, failed: 0, error: null, errors: [] };
    }
  }

  // Handle partial failures
  var uploaded = conversions.length;
  var failed = 0;
  var partialErrors = [];

  if (response.partialFailureError) {
    var details = response.partialFailureError.details || [];
    for (var d = 0; d < details.length; d++) {
      var errs = details[d].errors || [];
      for (var e = 0; e < errs.length; e++) {
        failed++;
        partialErrors.push(errs[e].message || 'unknown');
      }
    }
    uploaded = conversions.length - failed;
  }

  console.log('[GoogleAds-OCI] Batch upload resultaat:', {
    uploaded: uploaded,
    failed: failed,
    total: conversions.length
  });

  return { ok: true, uploaded: uploaded, failed: failed, error: null, errors: partialErrors };
}

/**
 * Get batch queue stats (for health/diagnostics).
 */
async function getBatchStats() {
  var redis = store._getRedis();
  if (!redis) return { pending: 0, batches: 0 };

  var now = new Date();
  var total = 0;
  var batches = 0;
  for (var h = 0; h < 24; h++) {
    var d = new Date(now.getTime() - h * 3600000);
    var key = BATCH_KEY_PREFIX + d.toISOString().slice(0, 13);
    var len = await redis.llen(key);
    if (len > 0) {
      total += len;
      batches++;
    }
  }
  return { pending: total, batches: batches };
}

/**
 * Format datetime for Google Ads API (yyyy-mm-dd hh:mm:ss+|-hh:mm).
 */
function formatGoogleDateTime(isoString) {
  if (!isoString) return new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');
  return isoString.replace('T', ' ').replace('Z', '+00:00');
}

module.exports = {
  uploadConversion: uploadConversion,
  flushBatch: flushBatch,
  getBatchStats: getBatchStats,
  ENABLED: ENABLED
};
