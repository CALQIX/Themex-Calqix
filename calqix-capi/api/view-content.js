const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');
const { isDuplicate, markProcessed } = require('../lib/dedup-guard');
const eventState = require('../lib/event-state');
const store = require('../lib/store');
const multiPlatform = require('../lib/multi-platform-send');
const capiDiag = require('../lib/capi-diagnostics');
const bridgeVersionTracker = require('../lib/bridge-version-tracker');

const SOURCE_URL_BASE = 'https://calqix.com/products/';
const ALLOWED_ORIGINS = ['https://calqix.com', 'https://www.calqix.com'];

async function handler(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : 'https://www.calqix.com'
  );
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    if (body.bridge_version) {
      bridgeVersionTracker.recordVersion(body.bridge_version).catch(function () { /* non-critical */ });
    }

    const productId = body.product_id;
    const productHandle = body.product_handle || '';
    const productTitle = body.product_title || '';
    const variantId = body.variant_id;
    const sku = body.sku;
    const price = body.price;
    const currency = body.currency || 'EUR';

    if (!productId && !variantId) {
      return res.status(400).json({ error: 'product_id or variant_id required' });
    }

    const eventId = body.event_id || ('vc_' + (productId || variantId) + '_' + Date.now());
    const sourceUrl = productHandle
      ? SOURCE_URL_BASE + productHandle
      : SOURCE_URL_BASE;

    // Dedup check using event_id
    if (await isDuplicate('ViewContent', eventId)) {
      return res.status(200).json({ received: true, processed: false, reason: 'duplicate', eventId: eventId });
    }

    const customerData = {};
    if (body.fbc) customerData.fbc = body.fbc;
    if (body.fbp) customerData.fbp = body.fbp;
    if (body.email) customerData.email = body.email;
    if (body.phone) customerData.phone = body.phone;
    if (body.external_id) customerData.external_id = body.external_id;
    if (body.country_code) customerData.country_code = body.country_code;

    const clientIp =
      (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
      (req.socket && req.socket.remoteAddress) ||
      undefined;
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      undefined;

    const userData = formatUserData(customerData, clientIp, clientUserAgent);

    console.log('[ViewContent] browser-side event', {
      eventId,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasCountry: Boolean(userData.country)
    });

    // CALQIX Meta Commerce catalog uses variant-level retailer_ids (variant_id or
    // SKU). Send all catalog candidates so Meta's matching succeeds for either
    // format. product_id is kept only as fallback when no variant signal exists.
    const catalogIds = [];
    if (variantId) catalogIds.push(String(variantId));
    if (sku) catalogIds.push(String(sku));
    if (catalogIds.length === 0 && productId) catalogIds.push(String(productId));
    const contentType = (variantId || sku) ? 'product' : 'product_group';

    const customData = {
      content_ids: catalogIds,
      content_type: contentType,
      content_name: productTitle || undefined,
      value: price !== undefined ? Number(parseFloat(price).toFixed(2)) : undefined,
      currency: price !== undefined ? currency : undefined
    };

    var matchKeys = {
      fbc: Boolean(userData.fbc),
      fbp: Boolean(userData.fbp),
      em: Boolean(userData.em),
      ph: Boolean(userData.ph),
      ip: Boolean(userData.client_ip_address),
      ua: Boolean(userData.client_user_agent),
      external_id: Boolean(userData.external_id)
    };

    await eventState.recordReceived(eventId, 'ViewContent', 'browser_bridge', eventId);
    await eventState.storeEventPayload(eventId, userData, customData, sourceUrl);
    const result = await sendEvent('ViewContent', eventId, sourceUrl, userData, customData);
    await eventState.recordSent(eventId, result);
    await markProcessed('ViewContent', eventId);

    // Store parameter diagnostics (rolling, TTL 24h)
    try {
      await store.set('diag:vc:' + eventId, JSON.stringify({
        ts: new Date().toISOString(),
        match_keys: matchKeys,
        source: 'browser_bridge',
        ok: Boolean(result && result.ok)
      }), 86400);
    } catch (e) { /* diagnostics are non-critical */ }

    // Daily summary for coverage reporting (see scripts/check-pixel-sources.js).
    try {
      await capiDiag.recordCoverage('ViewContent', eventId, 'browser_bridge', userData, {
        ok: Boolean(result && result.ok)
      });
    } catch (e) { /* diagnostics are non-critical */ }

    // Multi-platform: Klaviyo + GA4 (non-blocking)
    try {
      await multiPlatform.sendViewContent({
        eventId: eventId,
        customData: customData,
        sourceUrl: sourceUrl,
        userData: {
          email: body.email || undefined,
          phone: body.phone || undefined,
          external_id: body.external_id || undefined,
          country_code: body.country_code || undefined
        },
        userId: body.external_id || undefined
      });
    } catch (e) { /* non-fatal */ }

    return res.status(200).json({
      received: true,
      processed: Boolean(result && result.ok),
      event: 'ViewContent',
      eventId,
      match_keys: matchKeys
    });
  } catch (error) {
    console.error('[ViewContent] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false });
  }
}

module.exports = handler;
