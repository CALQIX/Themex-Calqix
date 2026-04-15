/**
 * TikTok Events API — server-side event sending.
 *
 * Env vars:
 *   TIKTOK_PIXEL_ID      — TikTok pixel ID
 *   TIKTOK_ACCESS_TOKEN  — TikTok Events API access token
 *   TIKTOK_ENABLED       — 'true' to enable (default: false, logging only)
 *
 * Dedup:
 *   Uses Redis key `processed:tt:{event_id}` with 48h TTL.
 *
 * Docs: https://business-api.tiktok.com/portal/docs?id=1741601162187777
 */
var rlFetch = require('./rate-limited-fetch');
var store = require('./store');
var hash = require('./hash');

var PIXEL_ID = function () { return process.env.TIKTOK_PIXEL_ID || ''; };
var ACCESS_TOKEN = function () { return process.env.TIKTOK_ACCESS_TOKEN || ''; };
var ENABLED = function () { return process.env.TIKTOK_ENABLED === 'true'; };
var API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
var DEDUP_TTL = 48 * 3600;

/**
 * Send an event to TikTok Events API.
 *
 * @param {object} opts
 * @param {string} opts.eventName — Meta-style name, mapped internally
 * @param {string} opts.eventId — shared event_id for dedup
 * @param {object} [opts.userData] — { email, phone, externalId, ip, userAgent, ttclid, ttp }
 * @param {object} [opts.properties] — event-specific data
 * @param {string} [opts.sourceUrl] — page URL
 * @returns {Promise<{ok: boolean, deduped: boolean, status: number|null, error: string|null}>}
 */
async function sendEvent(opts) {
  if (!PIXEL_ID() || !ACCESS_TOKEN()) {
    console.log('[TikTok] Niet geconfigureerd (TIKTOK_PIXEL_ID of TIKTOK_ACCESS_TOKEN ontbreekt)');
    return { ok: false, deduped: false, status: null, error: 'not_configured' };
  }

  // Dedup check
  if (opts.eventId) {
    var dedupKey = 'processed:tt:' + opts.eventId;
    var existing = await store.get(dedupKey);
    if (existing) {
      console.log('[TikTok] Gededupliceerd:', opts.eventId);
      return { ok: true, deduped: true, status: null, error: null };
    }
  }

  if (!ENABLED()) {
    console.log('[TikTok] Logging only (TIKTOK_ENABLED != true):', opts.eventName, opts.eventId);
    return { ok: true, deduped: false, status: null, error: 'logging_only' };
  }

  var ttEventName = mapToTikTok(opts.eventName);

  // Build user data
  var user = {};
  if (opts.userData) {
    if (opts.userData.email) user.email = hash.hash(hash.normalizeEmail(opts.userData.email));
    if (opts.userData.phone) user.phone = hash.hash(hash.normalizePhone(opts.userData.phone, opts.userData.country));
    if (opts.userData.externalId) user.external_id = hash.hash(String(opts.userData.externalId));
    if (opts.userData.ip) user.ip = opts.userData.ip;
    if (opts.userData.userAgent) user.user_agent = opts.userData.userAgent;
    if (opts.userData.ttclid) user.ttclid = opts.userData.ttclid;
    if (opts.userData.ttp) user.ttp = opts.userData.ttp;
  }

  // Build properties
  var properties = {};
  if (opts.properties) {
    if (opts.properties.value !== undefined) properties.value = String(opts.properties.value);
    if (opts.properties.currency) properties.currency = opts.properties.currency;
    if (opts.properties.content_ids) {
      properties.contents = opts.properties.content_ids.map(function (id) {
        return { content_id: String(id), content_type: 'product', quantity: 1 };
      });
    }
    if (opts.properties.contents) {
      properties.contents = opts.properties.contents.map(function (c) {
        return {
          content_id: String(c.id || ''),
          content_type: 'product',
          quantity: c.quantity || 1,
          price: c.item_price || 0
        };
      });
    }
    if (opts.properties.orderId) properties.order_id = opts.properties.orderId;
    if (opts.properties.numItems) properties.num_items = opts.properties.numItems;
  }

  var event = {
    pixel_code: PIXEL_ID(),
    event: ttEventName,
    event_id: opts.eventId || undefined,
    timestamp: new Date().toISOString(),
    context: {
      user: user,
      page: {
        url: opts.sourceUrl || 'https://calqix.com'
      }
    },
    properties: properties
  };

  var payload = {
    pixel_code: PIXEL_ID(),
    partner_name: 'CALQIX',
    data: [event]
  };

  var result = await rlFetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': ACCESS_TOKEN()
    },
    body: JSON.stringify(payload),
    label: 'TikTok',
    maxRetries: 2,
    timeout: 10000
  });

  var success = result.ok && result.data && result.data.code === 0;

  if (success && opts.eventId) {
    await store.set('processed:tt:' + opts.eventId, '1', DEDUP_TTL);
  }

  if (!success) {
    var errMsg = result.data && result.data.message ? result.data.message : result.error;
    console.error('[TikTok] Verzending mislukt:', opts.eventName, errMsg);
    return { ok: false, deduped: false, status: result.status, error: errMsg };
  }

  console.log('[TikTok] Verzonden:', ttEventName, opts.eventId);
  return { ok: true, deduped: false, status: result.status, error: null };
}

/**
 * Map Meta event names to TikTok event names.
 */
function mapToTikTok(metaEventName) {
  var mapping = {
    'ViewContent': 'ViewContent',
    'AddToCart': 'AddToCart',
    'InitiateCheckout': 'InitiateCheckout',
    'Purchase': 'CompletePayment',
    'Lead': 'SubmitForm'
  };
  return mapping[metaEventName] || metaEventName;
}

module.exports = {
  sendEvent: sendEvent,
  mapToTikTok: mapToTikTok,
  ENABLED: ENABLED
};
