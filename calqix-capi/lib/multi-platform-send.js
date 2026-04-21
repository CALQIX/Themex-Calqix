/**
 * Multi-platform event dispatcher — sends events to GA4, Google Ads, and Klaviyo
 * alongside the existing Meta CAPI pipeline.
 *
 * Called by webhook handlers after Meta send to fan out to other platforms.
 * Non-blocking: failures in one platform don't affect others.
 *
 * Env vars:
 *   GOOGLE_ENABLED              — 'true' to enable Google layer (GA4 + Ads)
 *   KLAVIYO_ENABLED             — anything other than 'false' enables Klaviyo (default enabled)
 *   KLAVIYO_PRIVATE_API_KEY     — pk_... (required for Klaviyo)
 *   KLAVIYO_NEWSLETTER_LIST_ID  — list id for customer-create → subscribe flow
 */
var ga4 = require('./ga4-mp');
var googleAds = require('./google-ads-oci');
var klaviyo = require('./klaviyo');
var store = require('./store');

var GOOGLE_ENABLED = function () { return (process.env.GOOGLE_ENABLED || '').trim() === 'true'; };
var KLAVIYO_ENABLED = function () { return klaviyo.isEnabled() && Boolean(process.env.KLAVIYO_PRIVATE_API_KEY); };
var NEWSLETTER_LIST_ID = function () { return (process.env.KLAVIYO_NEWSLETTER_LIST_ID || '').trim(); };

/**
 * Klaviyo's official Shopify integration already emits Placed Order, Added to Cart,
 * Checkout Started, and related metrics from the Shopify side. If the integration
 * is installed (default assumption), our server-side CAPI must NOT duplicate those.
 * Set KLAVIYO_SHOPIFY_APP_INSTALLED=false to force our CAPI to own the ecommerce
 * metrics (e.g. if the Shopify integration is uninstalled).
 */
var KLAVIYO_SHOPIFY_APP_INSTALLED = function () {
  return (process.env.KLAVIYO_SHOPIFY_APP_INSTALLED || 'true').trim() !== 'false';
};

/**
 * Map Meta-style customData to Klaviyo event properties.
 * Klaviyo uses conventional property names: $value, ItemNames, Items, OrderId, etc.
 */
function mapToKlaviyoProps(metaEvent, customData, extra) {
  var cd = customData || {};
  var props = {};
  if (cd.value !== undefined && cd.value !== null) props['$value'] = Number(cd.value);
  if (cd.currency) props['Currency'] = cd.currency;
  if (Array.isArray(cd.content_ids) && cd.content_ids.length) props['ProductIDs'] = cd.content_ids;
  if (cd.content_name) props['ProductName'] = cd.content_name;
  if (Array.isArray(cd.contents) && cd.contents.length) {
    props['Items'] = cd.contents.map(function (c) {
      return {
        ProductID: c.id ? String(c.id) : undefined,
        Quantity: c.quantity || 1,
        ItemPrice: c.item_price !== undefined ? Number(c.item_price) : undefined
      };
    });
    props['ItemCount'] = cd.contents.reduce(function (n, c) { return n + (c.quantity || 1); }, 0);
  } else if (cd.num_items) {
    props['ItemCount'] = cd.num_items;
  }
  if (cd.order_id) props['OrderId'] = String(cd.order_id);
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null) props[k] = extra[k];
    });
  }
  return props;
}

/**
 * Send an event to Klaviyo. Non-blocking wrapper with logging.
 * Requires at least email OR phone OR external_id on the profile; otherwise skipped.
 */
async function sendKlaviyoEvent(metricName, profile, properties, opts) {
  if (!KLAVIYO_ENABLED()) return { ok: false, skipped: true, reason: 'klaviyo_disabled' };
  var hasIdentity = profile && (profile.email || profile.phone_number || profile.external_id);
  if (!hasIdentity) {
    return { ok: false, skipped: true, reason: 'no_profile_identity' };
  }
  try {
    var res = await klaviyo.trackEvent(metricName, profile, properties || {}, opts || {});
    if (!res.ok && !res.skipped) {
      console.error('[Klaviyo] ' + metricName + ' failed', {
        status: res.status,
        error: typeof res.error === 'string' ? res.error.slice(0, 200) : res.error
      });
    } else if (res.ok && !res.skipped) {
      console.log('[Klaviyo] ' + metricName + ' sent', {
        uniqueId: opts && opts.unique_id,
        hasEmail: Boolean(profile.email),
        hasPhone: Boolean(profile.phone_number),
        hasExternalId: Boolean(profile.external_id)
      });
    }
    return res;
  } catch (err) {
    console.error('[Klaviyo] ' + metricName + ' exception', { message: err.message });
    return { ok: false, status: 0, error: err.message };
  }
}

function buildKlaviyoProfile(raw) {
  var p = raw || {};
  return {
    email: p.email || undefined,
    phone_number: p.phone || p.phone_number || undefined,
    external_id: p.external_id || p.userId || undefined,
    first_name: p.first_name || p.firstName || undefined,
    last_name: p.last_name || p.lastName || undefined,
    properties: (function () {
      var extra = {};
      if (p.city) extra['$city'] = p.city;
      if (p.zip) extra['$zip'] = p.zip;
      if (p.country_code || p.country) extra['$country'] = p.country_code || p.country;
      return Object.keys(extra).length ? extra : undefined;
    })()
  };
}

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
  var results = { ga4: null, googleAds: null, klaviyo: null };

  // Klaviyo — independent of Google. Skipped if Shopify app handles Placed Order natively.
  if (KLAVIYO_ENABLED() && !KLAVIYO_SHOPIFY_APP_INSTALLED()) {
    try {
      results.klaviyo = await sendKlaviyoEvent(
        'Placed Order',
        buildKlaviyoProfile(opts.userData),
        mapToKlaviyoProps('Purchase', opts.customData, { CheckoutURL: opts.checkoutUrl }),
        {
          unique_id: opts.eventId,
          value: opts.value,
          value_currency: opts.currency || 'EUR',
          time: opts.conversionDateTime
        }
      );
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo purchase fout:', e.message);
      results.klaviyo = { ok: false, error: e.message };
    }
  }

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
  var results = { ga4: null, klaviyo: null };

  // Klaviyo — skipped if Shopify app handles Added to Cart natively.
  if (KLAVIYO_ENABLED() && !KLAVIYO_SHOPIFY_APP_INSTALLED()) {
    try {
      results.klaviyo = await sendKlaviyoEvent(
        'Added to Cart',
        buildKlaviyoProfile(opts.userData || { external_id: opts.userId }),
        mapToKlaviyoProps('AddToCart', opts.customData),
        {
          unique_id: opts.eventId,
          value: opts.customData && opts.customData.value,
          value_currency: (opts.customData && opts.customData.currency) || 'EUR'
        }
      );
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo add_to_cart fout:', e.message);
      results.klaviyo = { ok: false, error: e.message };
    }
  }

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
 * Send a view_item event to Klaviyo (and GA4 if enabled).
 */
async function sendViewContent(opts) {
  var results = { ga4: null, klaviyo: null };

  if (KLAVIYO_ENABLED()) {
    try {
      results.klaviyo = await sendKlaviyoEvent(
        'Viewed Product',
        buildKlaviyoProfile(opts.userData || { external_id: opts.userId }),
        mapToKlaviyoProps('ViewContent', opts.customData, { URL: opts.sourceUrl }),
        {
          unique_id: opts.eventId,
          value: opts.customData && opts.customData.value,
          value_currency: (opts.customData && opts.customData.currency) || 'EUR'
        }
      );
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo view_content fout:', e.message);
      results.klaviyo = { ok: false, error: e.message };
    }
  }

  if (!GOOGLE_ENABLED()) return results;

  try {
    var ga4Map = ga4.mapMetaToGA4('ViewContent', opts.customData);
    if (ga4Map && ga4Map.eventName) {
      results.ga4 = await ga4.sendEvent({
        eventName: ga4Map.eventName,
        clientId: opts.clientId || opts.userId || undefined,
        userId: opts.userId || undefined,
        eventId: opts.eventId,
        params: ga4Map.params
      });
    }
  } catch (e) {
    console.error('[MultiPlatform] GA4 view_content fout:', e.message);
    results.ga4 = { ok: false, error: e.message };
  }

  return results;
}

/**
 * Send a begin_checkout event to GA4.
 */
async function sendCheckout(opts) {
  var results = { ga4: null, klaviyo: null };

  // Skipped if Shopify app handles Checkout Started natively (different metric name but same event).
  if (KLAVIYO_ENABLED() && !KLAVIYO_SHOPIFY_APP_INSTALLED()) {
    try {
      results.klaviyo = await sendKlaviyoEvent(
        'Started Checkout',
        buildKlaviyoProfile(opts.userData || { external_id: opts.userId }),
        mapToKlaviyoProps('InitiateCheckout', opts.customData, { CheckoutURL: opts.checkoutUrl }),
        {
          unique_id: opts.eventId,
          value: opts.customData && opts.customData.value,
          value_currency: (opts.customData && opts.customData.currency) || 'EUR'
        }
      );
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo checkout fout:', e.message);
      results.klaviyo = { ok: false, error: e.message };
    }
  }

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
  var results = { ga4: null, klaviyo: null, klaviyoSubscribe: null };

  if (KLAVIYO_ENABLED()) {
    var profile = buildKlaviyoProfile(opts.userData || { external_id: opts.userId });

    // 1. Subscribe to newsletter list (creates/updates profile + sets SUBSCRIBED consent)
    try {
      var listId = NEWSLETTER_LIST_ID();
      if (listId && profile.email) {
        results.klaviyoSubscribe = await klaviyo.subscribeToList(
          listId,
          [{ email: profile.email, phone_number: profile.phone_number }],
          { consentMethod: 'Shopify Customer Registration', listSource: 'calqix-capi' }
        );
        if (results.klaviyoSubscribe && !results.klaviyoSubscribe.ok) {
          console.error('[MultiPlatform] Klaviyo subscribe fout:', {
            status: results.klaviyoSubscribe.status,
            error: typeof results.klaviyoSubscribe.error === 'string'
              ? results.klaviyoSubscribe.error.slice(0, 200)
              : results.klaviyoSubscribe.error
          });
        } else if (results.klaviyoSubscribe && results.klaviyoSubscribe.ok) {
          console.log('[MultiPlatform] Klaviyo subscribe ok', { listId: listId, hasEmail: true });
        }
      } else if (!listId) {
        results.klaviyoSubscribe = { ok: false, skipped: true, reason: 'missing_KLAVIYO_NEWSLETTER_LIST_ID' };
      } else {
        results.klaviyoSubscribe = { ok: false, skipped: true, reason: 'no_email' };
      }
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo subscribe exception:', e.message);
      results.klaviyoSubscribe = { ok: false, error: e.message };
    }

    // 2. Track "Subscribed to Newsletter" event (for flow triggers)
    try {
      results.klaviyo = await sendKlaviyoEvent(
        'Subscribed to Newsletter',
        profile,
        mapToKlaviyoProps('Lead', opts.customData, { Source: 'Shopify Customer Registration' }),
        { unique_id: opts.eventId }
      );
    } catch (e) {
      console.error('[MultiPlatform] Klaviyo lead fout:', e.message);
      results.klaviyo = { ok: false, error: e.message };
    }
  }

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
  sendViewContent: sendViewContent,
  sendCheckout: sendCheckout,
  sendLead: sendLead,
  extractGoogleIds: extractGoogleIds,
  GOOGLE_ENABLED: GOOGLE_ENABLED,
  KLAVIYO_ENABLED: KLAVIYO_ENABLED
};
