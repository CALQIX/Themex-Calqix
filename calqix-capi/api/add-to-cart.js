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
const qualityLedger = require('../lib/meta-quality-ledger');

const DEFAULT_SOURCE_URL = 'https://www.calqix.com/cart';
const ALLOWED_ORIGINS = ['https://calqix.com', 'https://www.calqix.com'];

function cleanCatalogId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return String(value);
}

function uniqueIds(values) {
  const seen = new Set();
  return values.reduce(function (ids, value) {
    const id = cleanCatalogId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, []);
}

function isNumericCatalogId(value) {
  return /^\d+$/.test(String(value || ''));
}

function normalizeCatalogPayload(rawContentIds, rawContentType, rawContents) {
  const contentIds = uniqueIds(Array.isArray(rawContentIds) ? rawContentIds : []);
  const contentType = rawContentType || 'product_group';
  const contents = (Array.isArray(rawContents) ? rawContents : [])
    .map(function (item) {
      if (!item || typeof item !== 'object') return null;
      const id = cleanCatalogId(item.id);
      if (!id) return null;
      return Object.assign({}, item, { id: id });
    })
    .filter(Boolean);

  if (contentType !== 'product') {
    return { contentIds: contentIds, contentType: contentType, contents: contents };
  }

  // Backward compatibility: older browser payloads sent [variant_id, sku].
  // Keep both identifiers when present. Meta can match on any valid catalog
  // reference, and preserving SKU avoids losing a valid retailer_id on feeds
  // where SKU is the stronger match key.
  const numericContentIds = contentIds.filter(isNumericCatalogId);
  if (numericContentIds.length === 0) {
    return { contentIds: contentIds, contentType: contentType, contents: contents };
  }

  return {
    contentIds: contentIds,
    contentType: 'product',
    contents: contents
  };
}

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

    const catalogPayload = normalizeCatalogPayload(body.content_ids, body.content_type, body.contents);
    const contentIds = catalogPayload.contentIds;
    const contentType = catalogPayload.contentType;
    const contents = catalogPayload.contents;
    const value = body.value !== undefined ? Number(parseFloat(body.value).toFixed(2)) : undefined;
    const currency = body.currency || 'EUR';

    if (contentIds.length === 0) {
      return res.status(400).json({ error: 'content_ids required' });
    }

    if (!body.event_id) {
      return res.status(422).json({
        received: true,
        processed: false,
        error: 'event_id required for browser_bridge dedup'
      });
    }

    const eventId = body.event_id;
    const eventTime = body.event_time || body.eventTime || body.timestamp || body.event_timestamp;
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
    if (body.city || body.ct || body.town) customerData.city = body.city || body.ct || body.town;
    if (body.state || body.st || body.province || body.province_code) customerData.state = body.state || body.st || body.province || body.province_code;
    if (body.date_of_birth || body.birthday || body.db) customerData.date_of_birth = body.date_of_birth || body.birthday || body.db;
    if (body.zip || body.zp || body.postal_code) customerData.zip = body.zip || body.zp || body.postal_code;
    if (body.external_id) customerData.external_id = body.external_id;
    if (body.country_code || body.country) customerData.country_code = body.country_code || body.country;

    const clientIp = extractClientIP(req, body.client_ipv6 || body.client_ip || body.ip);
    const clientUserAgent =
      body.browser_user_agent ||
      body.client_user_agent ||
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
      db: Boolean(userData.db),
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

    await eventState.recordReceived(eventId, 'AddToCart', 'browser_bridge', eventId, eventTime);
    await eventStats.incrementEventStat('AddToCart', 'browser');
    await eventState.storeEventPayload(eventId, userData, customData, sourceUrl, eventTime);
    const result = await sendEvent('AddToCart', eventId, sourceUrl, userData, customData, { eventTime: eventTime });
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

    try {
      await qualityLedger.recordServerEvent({
        event_name: 'AddToCart',
        event_id: eventId,
        event_time: eventTime,
        source: 'browser_bridge',
        user_data: userData,
        custom_data: customData,
        source_url: sourceUrl,
        meta_result: result
      });
    } catch (e) { /* ledger is non-critical for event delivery */ }

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
          client_user_agent: clientUserAgent,
          email: body.email,
          phone: body.phone,
          first_name: body.first_name,
          last_name: body.last_name,
          city: body.city || body.ct || body.town,
          state: body.state || body.st || body.province || body.province_code,
          date_of_birth: body.date_of_birth || body.birthday || body.db,
          zip: body.zip || body.zp || body.postal_code,
          country_code: body.country_code || body.country
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
          city: body.city || body.ct || body.town || undefined,
          state: body.state || body.st || body.province || body.province_code || undefined,
          date_of_birth: body.date_of_birth || body.birthday || body.db || undefined,
          zip: body.zip || body.zp || body.postal_code || undefined,
          external_id: body.external_id || undefined,
          country_code: body.country_code || body.country || undefined
        },
        userId: body.external_id || undefined,
        clientId: body.ga_client_id || body.client_id || undefined
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
