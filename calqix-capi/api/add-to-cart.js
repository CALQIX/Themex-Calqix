// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');
const { extractClientIP } = require('../lib/ip-extract');
const { isDuplicate, markProcessed } = require('../lib/dedup-guard');
const eventState = require('../lib/event-state');
const store = require('../lib/store');
const multiPlatform = require('../lib/multi-platform-send');
const capiDiag = require('../lib/capi-diagnostics');
const bridgeVersionTracker = require('../lib/bridge-version-tracker');
const eventStats = require('../lib/event-stats');

const DEFAULT_SOURCE_URL = 'https://www.calqix.com/cart';
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

    const contentIds = Array.isArray(body.content_ids) ? body.content_ids : [];
    const contentType = body.content_type || 'product_group';
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const value = body.value !== undefined ? Number(parseFloat(body.value).toFixed(2)) : undefined;
    const currency = body.currency || 'EUR';

    if (contentIds.length === 0) {
      return res.status(400).json({ error: 'content_ids required' });
    }

    const eventId = body.event_id || ('atc_' + contentIds[0] + '_' + Date.now());
    const sourceUrl = body.source_url || DEFAULT_SOURCE_URL;

    // Dedup check using event_id
    if (await isDuplicate('AddToCart', eventId)) {
      return res.status(200).json({ received: true, processed: false, reason: 'duplicate', eventId: eventId });
    }

    const customerData = {};
    if (body.fbc) customerData.fbc = body.fbc;
    if (body.fbp) customerData.fbp = body.fbp;
    if (body.email) customerData.email = body.email;
    if (body.phone) customerData.phone = body.phone;
    if (body.first_name) customerData.first_name = body.first_name;
    if (body.last_name) customerData.last_name = body.last_name;
    if (body.city) customerData.city = body.city;
    if (body.state) customerData.state = body.state;
    if (body.zip) customerData.zip = body.zip;
    if (body.external_id) customerData.external_id = body.external_id;
    if (body.country_code) customerData.country_code = body.country_code;

    const clientIp = extractClientIP(req, body.client_ip);
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      undefined;

    const userData = formatUserData(customerData, clientIp, clientUserAgent);

    const customData = {
      content_ids: contentIds,
      content_type: contentType,
      contents: contents.length > 0 ? contents : undefined,
      value: Number.isFinite(value) ? value : undefined,
      currency: Number.isFinite(value) ? currency : undefined,
      num_items: contents.reduce(function (sum, c) { return sum + (c.quantity || 1); }, 0) || contentIds.length
    };

    const hasUserSignals = Boolean(userData.fbc || userData.fbp || userData.em || userData.ph);

    var matchKeys = {
      fbc: Boolean(userData.fbc),
      fbp: Boolean(userData.fbp),
      em: Boolean(userData.em),
      ph: Boolean(userData.ph),
      fn: Boolean(userData.fn),
      ln: Boolean(userData.ln),
      ct: Boolean(userData.ct),
      st: Boolean(userData.st),
      zp: Boolean(userData.zp),
      ip: Boolean(userData.client_ip_address),
      ua: Boolean(userData.client_user_agent),
      external_id: Boolean(userData.external_id)
    };

    console.log('[AddToCart] browser-side event', {
      eventId: eventId,
      contentIds: contentIds.length,
      hasFbc: matchKeys.fbc,
      hasFbp: matchKeys.fbp,
      hasEmail: matchKeys.em,
      hasPhone: matchKeys.ph,
      hasIp: matchKeys.ip,
      hasUa: matchKeys.ua,
      hasExternalId: matchKeys.external_id
    });

    await eventState.recordReceived(eventId, 'AddToCart', 'browser_bridge', eventId);
    await eventStats.incrementEventStat('AddToCart', 'browser');
    await eventState.storeEventPayload(eventId, userData, customData, sourceUrl);
    const result = await sendEvent('AddToCart', eventId, sourceUrl, userData, customData);
    await eventState.recordSent(eventId, result);
    await markProcessed('AddToCart', eventId);

    // Store parameter diagnostics (rolling, TTL 24h)
    try {
      await store.set('diag:atc:' + eventId, JSON.stringify({
        ts: new Date().toISOString(),
        match_keys: matchKeys,
        source: 'browser_bridge',
        ok: Boolean(result && result.ok)
      }), 86400);
    } catch (e) { /* diagnostics are non-critical */ }

    // Daily summary for coverage reporting (see scripts/check-pixel-sources.js).
    try {
      await capiDiag.recordCoverage('AddToCart', eventId, 'browser_bridge', userData, {
        ok: Boolean(result && result.ok)
      });
    } catch (e) { /* diagnostics are non-critical */ }

    // Persist customer identity for later subscription-renewal enrichment.
    // Only when we have an external_id (Shopify customer.id) AND a browser-side signal
    // (fbc or fbp). These are the only signals worth carrying forward — email/phone
    // are already on the order at renewal time.
    try {
      if (body.external_id && (body.fbc || body.fbp)) {
        await store.setCustomerIdentity(String(body.external_id), {
          fbc: body.fbc,
          fbp: body.fbp,
          client_ip: clientIp,
          client_user_agent: clientUserAgent
        });
      }
    } catch (e) { /* identity store is non-critical */ }

    // Multi-platform: Klaviyo + GA4 (non-blocking)
    try {
      await multiPlatform.sendAddToCart({
        eventId: eventId,
        customData: customData,
        userData: {
          email: body.email || undefined,
          phone: body.phone || undefined,
          first_name: body.first_name || undefined,
          last_name: body.last_name || undefined,
          city: body.city || undefined,
          state: body.state || undefined,
          zip: body.zip || undefined,
          external_id: body.external_id || undefined,
          country_code: body.country_code || undefined
        },
        userId: body.external_id || undefined
      });
    } catch (e) { /* non-fatal */ }

    return res.status(200).json({
      received: true,
      processed: Boolean(result && result.ok),
      event: 'AddToCart',
      eventId: eventId,
      match_keys: matchKeys
    });
  } catch (error) {
    console.error('[AddToCart] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false });
  }
}

module.exports = handler;
