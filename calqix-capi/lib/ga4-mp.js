/**
 * GA4 Measurement Protocol — server-side event sending to Google Analytics 4.
 *
 * Env vars:
 *   GA4_MEASUREMENT_ID   — e.g. G-99R7FCM5H1
 *   GA4_API_SECRET       — MP API secret from GA4 admin
 *   GA4_ENABLED          — 'true' to enable (default: false, logging only)
 *
 * Dedup:
 *   Uses Redis key `processed:ga:{event_id}` with 48h TTL.
 *
 * Docs: https://developers.google.com/analytics/devguides/collection/protocol/ga4
 */
var rlFetch = require('./rate-limited-fetch');
var store = require('./store');

var MEASUREMENT_ID = function () { return process.env.GA4_MEASUREMENT_ID || ''; };
var API_SECRET = function () { return process.env.GA4_API_SECRET || ''; };
var ENABLED = function () { return process.env.GA4_ENABLED === 'true'; };
var MP_URL = 'https://www.google-analytics.com/mp/collect';
var DEBUG_URL = 'https://www.google-analytics.com/debug/mp/collect';
var DEDUP_TTL = 48 * 3600;

/**
 * Send an event to GA4 via Measurement Protocol.
 *
 * @param {object} opts
 * @param {string} opts.eventName — GA4 event name (e.g. 'purchase', 'add_to_cart')
 * @param {string} opts.clientId — GA4 client_id (_ga cookie value or generated)
 * @param {string} [opts.userId] — user_id (Shopify customer ID or hashed email)
 * @param {string} opts.eventId — for dedup across browser/server
 * @param {object} [opts.params] — event parameters
 * @param {object} [opts.userProperties] — user properties
 * @param {boolean} [opts.debug] — use debug endpoint
 * @returns {Promise<{ok: boolean, deduped: boolean, status: number|null, error: string|null}>}
 */
async function sendEvent(opts) {
  if (!MEASUREMENT_ID() || !API_SECRET()) {
    console.log('[GA4-MP] Niet geconfigureerd (GA4_MEASUREMENT_ID of GA4_API_SECRET ontbreekt)');
    return { ok: false, deduped: false, status: null, error: 'not_configured' };
  }

  // Dedup check
  if (opts.eventId) {
    var dedupKey = 'processed:ga:' + opts.eventId;
    var existing = await store.get(dedupKey);
    if (existing) {
      console.log('[GA4-MP] Gededupliceerd:', opts.eventId);
      return { ok: true, deduped: true, status: null, error: null };
    }
  }

  if (!ENABLED()) {
    console.log('[GA4-MP] Logging only (GA4_ENABLED != true):', opts.eventName, opts.eventId);
    return { ok: true, deduped: false, status: null, error: 'logging_only' };
  }

  var url = (opts.debug ? DEBUG_URL : MP_URL) +
    '?measurement_id=' + encodeURIComponent(MEASUREMENT_ID()) +
    '&api_secret=' + encodeURIComponent(API_SECRET());

  var event = {
    name: opts.eventName,
    params: Object.assign({}, opts.params || {})
  };

  // Ensure transaction_id for purchase dedup in GA4
  if (opts.params && opts.params.transaction_id) {
    event.params.transaction_id = opts.params.transaction_id;
  }

  var payload = {
    client_id: opts.clientId || generateClientId(),
    events: [event]
  };

  if (opts.userId) {
    payload.user_id = opts.userId;
  }

  if (opts.userProperties) {
    payload.user_properties = {};
    var keys = Object.keys(opts.userProperties);
    for (var i = 0; i < keys.length; i++) {
      payload.user_properties[keys[i]] = { value: opts.userProperties[keys[i]] };
    }
  }

  var result = await rlFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    label: 'GA4-MP',
    maxRetries: 2,
    timeout: 10000
  });

  // GA4 MP returns 204 No Content on success (no body)
  var success = result.status === 204 || result.status === 200 || result.ok;

  if (success && opts.eventId) {
    await store.set('processed:ga:' + opts.eventId, '1', DEDUP_TTL);
  }

  if (!success) {
    console.error('[GA4-MP] Verzending mislukt:', opts.eventName, result.status, result.error);
  } else {
    console.log('[GA4-MP] Verzonden:', opts.eventName, opts.eventId);
  }

  return { ok: success, deduped: false, status: result.status, error: success ? null : result.error };
}

/**
 * Map a Meta-style event to GA4 event format.
 */
function mapMetaToGA4(eventName, customData, transactionId) {
  var ga4Name = {
    'ViewContent': 'view_item',
    'AddToCart': 'add_to_cart',
    'InitiateCheckout': 'begin_checkout',
    'Purchase': 'purchase',
    'Lead': 'generate_lead'
  }[eventName] || eventName.toLowerCase();

  var params = {};

  if (customData) {
    if (customData.value !== undefined) params.value = customData.value;
    if (customData.currency) params.currency = customData.currency;
    if (transactionId) params.transaction_id = transactionId;

    if (customData.contents && customData.contents.length > 0) {
      params.items = customData.contents.map(function (c) {
        return {
          item_id: c.id || '',
          quantity: c.quantity || 1,
          price: c.item_price || 0
        };
      });
    } else if (customData.content_ids) {
      params.items = customData.content_ids.map(function (id) {
        return { item_id: String(id) };
      });
    }
  }

  return { eventName: ga4Name, params: params };
}

function generateClientId() {
  return Math.floor(Math.random() * 2147483647) + '.' + Math.floor(Date.now() / 1000);
}

module.exports = {
  sendEvent: sendEvent,
  mapMetaToGA4: mapMetaToGA4,
  ENABLED: ENABLED
};
