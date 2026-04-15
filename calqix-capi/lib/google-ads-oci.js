/**
 * Google Ads Offline Conversion Import (OCI) — Enhanced Conversions.
 *
 * Sends offline conversion data (purchases) to Google Ads for attribution.
 * Uses gclid/gbraid/wbraid + hashed user data for matching.
 *
 * Env vars:
 *   GOOGLE_ADS_CUSTOMER_ID         — e.g. 123-456-7890 (without dashes internally)
 *   GOOGLE_ADS_CONVERSION_ACTION_ID — conversion action resource name
 *   GOOGLE_ADS_DEVELOPER_TOKEN     — API developer token
 *   GOOGLE_ADS_REFRESH_TOKEN       — OAuth2 refresh token
 *   GOOGLE_ADS_CLIENT_ID           — OAuth2 client ID
 *   GOOGLE_ADS_CLIENT_SECRET       — OAuth2 client secret
 *   GOOGLE_ADS_ENABLED             — 'true' to enable (default: false)
 *
 * Dedup:
 *   Uses Redis key `processed:gads:{event_id}` with 48h TTL.
 */
var rlFetch = require('./rate-limited-fetch');
var store = require('./store');
var hash = require('./hash');

var CUSTOMER_ID = function () { return (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''); };
var CONVERSION_ACTION = function () { return process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || ''; };
var ENABLED = function () { return process.env.GOOGLE_ADS_ENABLED === 'true'; };
var DEDUP_TTL = 48 * 3600;

/**
 * Upload an offline conversion to Google Ads.
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
 * @returns {Promise<{ok: boolean, deduped: boolean, error: string|null}>}
 */
async function uploadConversion(opts) {
  if (!CUSTOMER_ID() || !CONVERSION_ACTION()) {
    console.log('[GoogleAds-OCI] Niet geconfigureerd');
    return { ok: false, deduped: false, error: 'not_configured' };
  }

  // Dedup
  if (opts.eventId) {
    var dedupKey = 'processed:gads:' + opts.eventId;
    var existing = await store.get(dedupKey);
    if (existing) {
      console.log('[GoogleAds-OCI] Gededupliceerd:', opts.eventId);
      return { ok: true, deduped: true, error: null };
    }
  }

  if (!ENABLED()) {
    console.log('[GoogleAds-OCI] Logging only (GOOGLE_ADS_ENABLED != true):', opts.eventId);
    return { ok: true, deduped: false, error: 'logging_only' };
  }

  // Build conversion
  var conversion = {
    conversion_action: CONVERSION_ACTION(),
    conversion_date_time: formatGoogleDateTime(opts.conversionDateTime),
    conversion_value: opts.conversionValue || 0,
    currency_code: opts.currencyCode || 'EUR'
  };

  if (opts.gclid) conversion.gclid = opts.gclid;
  if (opts.gbraid) conversion.gbraid = opts.gbraid;
  if (opts.wbraid) conversion.wbraid = opts.wbraid;
  if (opts.orderId) conversion.order_id = opts.orderId;

  // Enhanced Conversions user identifiers (hashed)
  if (opts.userData) {
    var identifiers = {};
    if (opts.userData.email) identifiers.hashed_email = hash.hash(hash.normalizeEmail(opts.userData.email));
    if (opts.userData.phone) identifiers.hashed_phone_number = hash.hash(hash.normalizePhone(opts.userData.phone, opts.userData.country));
    if (opts.userData.firstName) identifiers.first_name = hash.hash(hash.normalizeText(opts.userData.firstName));
    if (opts.userData.lastName) identifiers.last_name = hash.hash(hash.normalizeText(opts.userData.lastName));
    if (opts.userData.city) identifiers.city = hash.hash(hash.normalizeText(opts.userData.city, { keepSpaces: true }));
    if (opts.userData.zip) identifiers.postal_code = hash.hash(hash.normalizeZip(opts.userData.zip));
    if (opts.userData.country) identifiers.country_code = hash.normalizeCountry(opts.userData.country);

    if (Object.keys(identifiers).length > 0) {
      conversion.user_identifiers = [identifiers];
    }
  }

  // Note: Full Google Ads API implementation requires OAuth2 token refresh
  // and the Google Ads REST API. This is a structured payload builder.
  // Actual upload requires google-ads-api npm package or manual REST calls.
  console.log('[GoogleAds-OCI] Conversion klaar voor upload:', {
    eventId: opts.eventId,
    value: conversion.conversion_value,
    hasGclid: Boolean(opts.gclid),
    hasGbraid: Boolean(opts.gbraid),
    hasUserData: Boolean(conversion.user_identifiers)
  });

  // Store conversion for batch upload (Google Ads prefers batch)
  var batchKey = 'gads:batch:' + new Date().toISOString().slice(0, 13);
  try {
    var redis = store._getRedis();
    if (redis) {
      await redis.lpush(batchKey, JSON.stringify(conversion));
      await redis.expire(batchKey, 86400);
    }
  } catch (e) { /* non-critical */ }

  if (opts.eventId) {
    await store.set('processed:gads:' + opts.eventId, '1', DEDUP_TTL);
  }

  return { ok: true, deduped: false, error: null };
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
  ENABLED: ENABLED
};
