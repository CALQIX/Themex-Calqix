/**
 * Multi-platform event dispatcher — sends events to GA4 and Google Ads
 * alongside the existing Meta CAPI pipeline.
 *
 * Called by webhook handlers after Meta send to fan out to other platforms.
 * Non-blocking: failures in one platform don't affect others.
 *
 * Env vars:
 *   GOOGLE_ENABLED — 'true' to enable Google layer (GA4 + Ads)
 */
var ga4 = require('./ga4-mp');
var googleAds = require('./google-ads-oci');
var store = require('./store');

var GOOGLE_ENABLED = function () { return process.env.GOOGLE_ENABLED === 'true'; };

/**
 * Send a purchase event to all enabled platforms.
 *
 * @param {object} opts
 * @param {string} opts.eventId — canonical event ID (e.g. purchase_{token})
 * @param {string} opts.orderId — Shopify order ID
 * @param {number} opts.value — total value in EUR
 * @param {string} opts.currency — currency code
 * @param {string} opts.conversionDateTime — ISO 8601
 * @param {object} opts.userData — raw (unhashed) user data for Google Ads enhanced conversions
 * @param {object} opts.customData — Meta-style custom data (contents, content_ids, etc.)
 * @param {string} [opts.clientId] — GA4 client_id (_ga cookie value)
 * @param {string} [opts.userId] — user_id (Shopify customer ID)
 * @param {string} [opts.gclid] — Google click ID
 * @param {string} [opts.gbraid] — Google app click ID
 * @param {string} [opts.wbraid] — Google web click ID
 * @returns {Promise<{ga4: object|null, googleAds: object|null}>}
 */
async function sendPurchase(opts) {
  var results = { ga4: null, googleAds: null };

  if (!GOOGLE_ENABLED()) return results;

  // GA4 Measurement Protocol
  try {
    var ga4Map = ga4.mapMetaToGA4('Purchase', opts.customData, opts.orderId);
    results.ga4 = await ga4.sendEvent({
      eventName: ga4Map.eventName,
      clientId: opts.clientId || opts.userId || undefined,
      userId: opts.userId || undefined,
      eventId: opts.eventId,
      params: ga4Map.params
    });
  } catch (e) {
    console.error('[MultiPlatform] GA4 purchase fout:', e.message);
    results.ga4 = { ok: false, error: e.message };
  }

  // Google Ads OCI (queue for batch upload)
  try {
    results.googleAds = await googleAds.uploadConversion({
      eventId: opts.eventId,
      gclid: opts.gclid,
      gbraid: opts.gbraid,
      wbraid: opts.wbraid,
      conversionValue: opts.value,
      currencyCode: opts.currency || 'EUR',
      conversionDateTime: opts.conversionDateTime || new Date().toISOString(),
      orderId: String(opts.orderId),
      userData: opts.userData
    });
  } catch (e) {
    console.error('[MultiPlatform] Google Ads purchase fout:', e.message);
    results.googleAds = { ok: false, error: e.message };
  }

  return results;
}

/**
 * Send an add_to_cart event to GA4.
 * Google Ads OCI typically only tracks purchases, not ATC.
 */
async function sendAddToCart(opts) {
  var results = { ga4: null };

  if (!GOOGLE_ENABLED()) return results;

  try {
    var ga4Map = ga4.mapMetaToGA4('AddToCart', opts.customData);
    results.ga4 = await ga4.sendEvent({
      eventName: ga4Map.eventName,
      clientId: opts.clientId || opts.userId || undefined,
      userId: opts.userId || undefined,
      eventId: opts.eventId,
      params: ga4Map.params
    });
  } catch (e) {
    console.error('[MultiPlatform] GA4 add_to_cart fout:', e.message);
    results.ga4 = { ok: false, error: e.message };
  }

  return results;
}

/**
 * Send a begin_checkout event to GA4.
 */
async function sendCheckout(opts) {
  var results = { ga4: null };

  if (!GOOGLE_ENABLED()) return results;

  try {
    var ga4Map = ga4.mapMetaToGA4('InitiateCheckout', opts.customData);
    results.ga4 = await ga4.sendEvent({
      eventName: ga4Map.eventName,
      clientId: opts.clientId || opts.userId || undefined,
      userId: opts.userId || undefined,
      eventId: opts.eventId,
      params: ga4Map.params
    });
  } catch (e) {
    console.error('[MultiPlatform] GA4 checkout fout:', e.message);
    results.ga4 = { ok: false, error: e.message };
  }

  return results;
}

/**
 * Send a generate_lead event to GA4.
 */
async function sendLead(opts) {
  var results = { ga4: null };

  if (!GOOGLE_ENABLED()) return results;

  try {
    var ga4Map = ga4.mapMetaToGA4('Lead', opts.customData);
    results.ga4 = await ga4.sendEvent({
      eventName: ga4Map.eventName,
      clientId: opts.clientId || opts.userId || undefined,
      userId: opts.userId || undefined,
      eventId: opts.eventId,
      params: ga4Map.params
    });
  } catch (e) {
    console.error('[MultiPlatform] GA4 lead fout:', e.message);
    results.ga4 = { ok: false, error: e.message };
  }

  return results;
}

/**
 * Extract Google click IDs from enrichment data (identity store).
 * Returns { gclid, gbraid, wbraid, clientId }.
 */
async function extractGoogleIds(checkoutToken) {
  var ids = { gclid: null, gbraid: null, wbraid: null, clientId: null };

  if (!checkoutToken) return ids;

  try {
    var redis = store._getRedis();
    if (!redis) return ids;

    // Try identity store (from /api/identity/capture)
    var identity = await redis.get('identity:' + checkoutToken);
    if (identity) {
      try {
        var parsed = typeof identity === 'string' ? JSON.parse(identity) : identity;
        ids.gclid = parsed.gclid || null;
        ids.gbraid = parsed.gbraid || null;
        ids.wbraid = parsed.wbraid || null;
        ids.clientId = parsed.ga_client_id || parsed.client_id || null;
      } catch (e) {}
    }

    // Also try cart attributes (bridge stores these in cookies → Shopify cart)
    var enrichment = await store.getEnrichment(String(checkoutToken));
    if (enrichment) {
      if (!ids.gclid && enrichment.gclid) ids.gclid = enrichment.gclid;
      if (!ids.gbraid && enrichment.gbraid) ids.gbraid = enrichment.gbraid;
      if (!ids.wbraid && enrichment.wbraid) ids.wbraid = enrichment.wbraid;
      if (!ids.clientId && enrichment.ga_client_id) ids.clientId = enrichment.ga_client_id;
    }
  } catch (e) {
    console.error('[MultiPlatform] Google ID extractie fout:', e.message);
  }

  return ids;
}

module.exports = {
  sendPurchase: sendPurchase,
  sendAddToCart: sendAddToCart,
  sendCheckout: sendCheckout,
  sendLead: sendLead,
  extractGoogleIds: extractGoogleIds,
  GOOGLE_ENABLED: GOOGLE_ENABLED
};
