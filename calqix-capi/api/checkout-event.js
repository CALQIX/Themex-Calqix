/**
 * Checkout Event Endpoint — receives events from the Shopify Custom Pixel.
 *
 * Handles three event types:
 *   checkout_started          → sends InitiateCheckout to Meta CAPI
 *   contact_info_submitted    → stores enrichment (email, phone) keyed by checkout_token
 *   checkout_completed        → sends Purchase to Meta CAPI (enriched)
 *
 * Event ID strategy (deterministic dedup with webhooks):
 *   InitiateCheckout: ic_{checkout_token}
 *   Purchase:         purchase_{checkout_token}
 *
 * Both Custom Pixel and webhook use the same event_id format so Meta
 * deduplicates correctly regardless of which fires first.
 */
const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');
const { extractClientIP } = require('../lib/ip-extract');
const { isDuplicate, markProcessed } = require('../lib/dedup-guard');
const store = require('../lib/store');
const eventState = require('../lib/event-state');
const eventStats = require('../lib/event-stats');
const capiDiag = require('../lib/capi-diagnostics');
const qualityLedger = require('../lib/meta-quality-ledger');

async function handler(req, res) {
  // CORS — Custom Pixel sandbox may run on various origins
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const eventType = body.event_type;
    const checkoutToken = body.checkout_token;
    const eventTime = body.event_time || body.eventTime || body.timestamp || body.event_timestamp;

    if (!eventType || !checkoutToken) {
      return res.status(400).json({ error: 'event_type and checkout_token required' });
    }

    const clientIp = extractClientIP(req, body.client_ip);
    const clientUserAgent =
      body.browser_user_agent ||
      body.client_user_agent ||
      (req.headers && req.headers['user-agent']) ||
      undefined;

    if (eventType === 'contact_info_submitted') {
      return handleContactInfo(res, body, checkoutToken);
    }

    if (eventType === 'checkout_started') {
      return handleCheckoutStarted(res, body, checkoutToken, clientIp, clientUserAgent, eventTime);
    }

    if (eventType === 'payment_info_submitted') {
      return handlePaymentInfo(res, body, checkoutToken, clientIp, clientUserAgent, eventTime);
    }

    if (eventType === 'checkout_completed') {
      return handleCheckoutCompleted(res, body, checkoutToken, clientIp, clientUserAgent, eventTime);
    }

    return res.status(400).json({ error: 'Unknown event_type: ' + eventType });
  } catch (error) {
    console.error('[CheckoutEvent] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false, error: error.message });
  }
}

/**
 * Store enrichment data for later use by checkout_completed.
 */
async function handleContactInfo(res, body, checkoutToken) {
  var enrichment = buildEnrichmentData(body);

  if (Object.keys(enrichment).length === 0) {
    return res.status(200).json({ received: true, stored: false, reason: 'no_enrichment_data' });
  }

  await store.setEnrichment(checkoutToken, enrichment);

  console.log('[CheckoutEvent] contact_info stored', {
    checkoutToken: checkoutToken.substring(0, 8) + '...',
    hasEmail: Boolean(enrichment.email),
    hasPhone: Boolean(enrichment.phone),
    hasFbc: Boolean(enrichment.fbc),
    hasProvince: Boolean(enrichment.state || enrichment.province_code),
    hasDateOfBirth: Boolean(enrichment.date_of_birth || enrichment.db)
  });

  return res.status(200).json({ received: true, stored: true, event: 'contact_info_submitted' });
}

/**
 * Send InitiateCheckout to Meta CAPI.
 * event_id = ic_{checkout_token} — shared with checkouts-create webhook.
 */
async function handleCheckoutStarted(res, body, checkoutToken, clientIp, clientUserAgent, eventTime) {
  var eventId = 'ic_' + checkoutToken;
  var eventSource = body.source === 'shopify_web_pixel' ? 'shopify_web_pixel' : 'custom_pixel';

  if (await isDuplicate('InitiateCheckout', checkoutToken)) {
    console.log('[CheckoutEvent] InitiateCheckout already sent', { checkoutToken: checkoutToken.substring(0, 8) + '...' });
    return res.status(200).json({ received: true, processed: false, reason: 'duplicate', eventId: eventId });
  }

  var customerData = buildCustomerData(body);
  var userData = formatUserData(customerData, clientIp, clientUserAgent);

  var lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  var customData = buildCustomDataFromLineItems(lineItems, body);

  console.log('[CheckoutEvent] InitiateCheckout', {
    eventId: eventId,
    hasFbc: Boolean(userData.fbc),
    hasFbp: Boolean(userData.fbp),
    hasEmail: Boolean(userData.em),
    hasPhone: Boolean(userData.ph),
    hasIp: Boolean(userData.client_ip_address),
    hasUa: Boolean(userData.client_user_agent),
    contentIds: customData.content_ids.length,
    source: 'custom_pixel'
  });

  var sourceUrl = body.source_url || 'https://www.calqix.com/checkout';
  await eventState.recordReceived(eventId, 'InitiateCheckout', eventSource, checkoutToken, eventTime);
  await eventStats.incrementEventStat('InitiateCheckout', 'browser');
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl, eventTime);
  var result = await sendEvent('InitiateCheckout', eventId, sourceUrl, userData, customData, { eventTime: eventTime });
  await eventState.recordSent(eventId, result);
  await markProcessed('InitiateCheckout', checkoutToken);
  await capiDiag.recordCoverage('InitiateCheckout', eventId, eventSource, userData, {
    content_ids: customData.content_ids.length,
    source: eventSource
  });
  await qualityLedger.recordServerEvent({
    event_name: 'InitiateCheckout',
    event_id: eventId,
    event_time: eventTime,
    source: eventSource,
    user_data: userData,
    custom_data: customData,
    source_url: sourceUrl,
    meta_result: result
  });

  // Also store any user data as enrichment for Purchase
  var enrichment = buildEnrichmentData(body);
  if (Object.keys(enrichment).length > 0) {
    await store.setEnrichment(checkoutToken, enrichment);
  }

  return res.status(200).json({
    received: true,
    processed: Boolean(result && result.ok),
    event: 'InitiateCheckout',
    eventId: eventId,
    match_keys: {
      fbc: Boolean(userData.fbc),
      fbp: Boolean(userData.fbp),
      em: Boolean(userData.em),
      ph: Boolean(userData.ph),
      db: Boolean(userData.db),
      st: Boolean(userData.st),
      ip: Boolean(userData.client_ip_address),
      ua: Boolean(userData.client_user_agent)
    }
  });
}

/**
 * Send Purchase to Meta CAPI.
 * event_id = purchase_{checkout_token} — shared with orders-paid webhook.
 * Merges stored enrichment from contact_info_submitted.
 */
async function handleCheckoutCompleted(res, body, checkoutToken, clientIp, clientUserAgent, eventTime) {
  var eventId = 'purchase_' + checkoutToken;
  var eventSource = body.source === 'shopify_web_pixel' ? 'shopify_web_pixel' : 'custom_pixel';

  if (await isDuplicate('Purchase', checkoutToken)) {
    console.log('[CheckoutEvent] Purchase already sent', { checkoutToken: checkoutToken.substring(0, 8) + '...' });
    return res.status(200).json({ received: true, processed: false, reason: 'duplicate', eventId: eventId });
  }

  // Merge enrichment from contact_info_submitted
  var enrichment = await store.getEnrichment(checkoutToken) || {};
  var customerData = buildCustomerData(body, enrichment);
  var userData = formatUserData(customerData, clientIp, clientUserAgent);

  var lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  var customData = buildCustomDataFromLineItems(lineItems, body, {
    order_id: body.order_id ? String(body.order_id) : undefined
  });

  console.log('[CheckoutEvent] Purchase', {
    eventId: eventId,
    hasFbc: Boolean(userData.fbc),
    hasFbp: Boolean(userData.fbp),
    hasEmail: Boolean(userData.em),
    hasPhone: Boolean(userData.ph),
    hasIp: Boolean(userData.client_ip_address),
    hasUa: Boolean(userData.client_user_agent),
    hasExternalId: Boolean(userData.external_id),
    contentIds: customData.content_ids.length,
    enrichedFromStore: Object.keys(enrichment).length > 0,
    source: 'custom_pixel'
  });

  var sourceUrl = body.source_url || 'https://www.calqix.com/checkout';
  await eventState.recordReceived(eventId, 'Purchase', eventSource, checkoutToken, eventTime);
  await eventStats.incrementEventStat('Purchase', 'browser');
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl, eventTime);
  var result = await sendEvent('Purchase', eventId, sourceUrl, userData, customData, { eventTime: eventTime });
  await eventState.recordSent(eventId, result);
  await markProcessed('Purchase', checkoutToken);
  await capiDiag.recordCoverage('Purchase', eventId, eventSource, userData, {
    content_ids: customData.content_ids.length,
    source: eventSource,
    order_id_present: Boolean(customData.order_id)
  });
  await qualityLedger.recordServerEvent({
    event_name: 'Purchase',
    event_id: eventId,
    event_time: eventTime,
    source: eventSource,
    user_data: userData,
    custom_data: customData,
    source_url: sourceUrl,
    meta_result: result
  });

  return res.status(200).json({
    received: true,
    processed: Boolean(result && result.ok),
    event: 'Purchase',
    eventId: eventId,
    match_keys: {
      fbc: Boolean(userData.fbc),
      fbp: Boolean(userData.fbp),
      em: Boolean(userData.em),
      ph: Boolean(userData.ph),
      db: Boolean(userData.db),
      st: Boolean(userData.st),
      ip: Boolean(userData.client_ip_address),
      ua: Boolean(userData.client_user_agent)
    }
  });
}

/**
 * Send AddPaymentInfo to Meta CAPI when customer reaches the payment step.
 * event_id = add_payment_info_{checkout_token} — unique per checkout attempt.
 * Merges stored enrichment (email/phone from contact_info_submitted).
 */
async function handlePaymentInfo(res, body, checkoutToken, clientIp, clientUserAgent, eventTime) {
  var eventId = 'add_payment_info_' + checkoutToken;
  var eventSource = body.source === 'shopify_web_pixel' ? 'shopify_web_pixel' : 'custom_pixel';

  if (await isDuplicate('AddPaymentInfo', checkoutToken)) {
    console.log('[CheckoutEvent] AddPaymentInfo already sent', {
      checkoutToken: checkoutToken.substring(0, 8) + '...'
    });
    return res.status(200).json({
      received: true,
      processed: false,
      reason: 'duplicate',
      eventId: eventId
    });
  }

  var enrichment = (await store.getEnrichment(checkoutToken)) || {};
  var customerData = buildCustomerData(body, enrichment);
  var userData = formatUserData(customerData, clientIp, clientUserAgent);

  var lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  var customData = buildCustomDataFromLineItems(lineItems, body);

  console.log('[CheckoutEvent] AddPaymentInfo', {
    eventId: eventId,
    hasFbc: Boolean(userData.fbc),
    hasFbp: Boolean(userData.fbp),
    hasEmail: Boolean(userData.em),
    hasPhone: Boolean(userData.ph),
    hasExternalId: Boolean(userData.external_id),
    contentIds: customData.content_ids.length,
    source: 'custom_pixel'
  });

  var sourceUrl = body.source_url || 'https://www.calqix.com/checkout';
  await eventState.recordReceived(eventId, 'AddPaymentInfo', eventSource, checkoutToken, eventTime);
  await eventStats.incrementEventStat('AddPaymentInfo', 'browser');
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl, eventTime);
  var result = await sendEvent('AddPaymentInfo', eventId, sourceUrl, userData, customData, { eventTime: eventTime });
  await eventState.recordSent(eventId, result);
  await markProcessed('AddPaymentInfo', checkoutToken);
  await capiDiag.recordCoverage('AddPaymentInfo', eventId, eventSource, userData, {
    content_ids: customData.content_ids.length,
    source: eventSource
  });
  await qualityLedger.recordServerEvent({
    event_name: 'AddPaymentInfo',
    event_id: eventId,
    event_time: eventTime,
    source: eventSource,
    user_data: userData,
    custom_data: customData,
    source_url: sourceUrl,
    meta_result: result
  });

  return res.status(200).json({
    received: true,
    processed: Boolean(result && result.ok),
    event: 'AddPaymentInfo',
    eventId: eventId,
    match_keys: {
      fbc: Boolean(userData.fbc),
      fbp: Boolean(userData.fbp),
      em: Boolean(userData.em),
      ph: Boolean(userData.ph),
      db: Boolean(userData.db),
      st: Boolean(userData.st),
      ip: Boolean(userData.client_ip_address),
      ua: Boolean(userData.client_user_agent)
    }
  });
}

/**
 * Build customer data object from request body + optional enrichment.
 * Enrichment fields are used only if not already present in the body.
 */
function buildCustomerData(body, enrichment) {
  var e = enrichment || {};
  var data = {};
  data.fbc = body.fbc || e.fbc || undefined;
  data.fbp = body.fbp || e.fbp || undefined;
  data.email = body.email || e.email || undefined;
  data.phone = body.phone || e.phone || undefined;
  data.external_id = body.external_id || e.external_id || undefined;
  data.first_name = body.first_name || e.first_name || undefined;
  data.last_name = body.last_name || e.last_name || undefined;
  data.city = body.city || e.city || undefined;
  data.state = body.state || body.province_code || e.state || e.province_code || undefined;
  data.zip = body.zip || body.postal_code || e.zip || e.postal_code || undefined;
  data.country_code = body.country_code || body.country || e.country_code || e.country || undefined;
  data.date_of_birth =
    body.date_of_birth ||
    body.birthday ||
    body.birthdate ||
    body.db ||
    e.date_of_birth ||
    e.birthday ||
    e.birthdate ||
    e.db ||
    undefined;
  return data;
}

function buildEnrichmentData(body) {
  var data = {};
  if (!body) return data;
  if (body.email) data.email = body.email;
  if (body.phone) data.phone = body.phone;
  if (body.fbc) data.fbc = body.fbc;
  if (body.fbp) data.fbp = body.fbp;
  if (body.external_id) data.external_id = body.external_id;
  if (body.ga_client_id || body.client_id) data.ga_client_id = body.ga_client_id || body.client_id;
  if (body.first_name) data.first_name = body.first_name;
  if (body.last_name) data.last_name = body.last_name;
  if (body.city) data.city = body.city;
  if (body.state || body.province_code) data.state = body.state || body.province_code;
  if (body.zip || body.postal_code) data.zip = body.zip || body.postal_code;
  if (body.country_code || body.country) data.country_code = body.country_code || body.country;
  if (body.date_of_birth || body.birthday || body.birthdate || body.db) {
    data.date_of_birth = body.date_of_birth || body.birthday || body.birthdate || body.db;
  }
  return data;
}

/**
 * Extract numeric product ID from various Shopify formats.
 * Handles: "8012345", "gid://shopify/Product/8012345", {product_id: 8012345}
 */
function extractProductId(item) {
  if (!item) return null;
  var id = item.product_id || (item.variant && item.variant.product && item.variant.product.id) || item.id;
  if (!id) return null;
  var str = String(id);
  // Strip gid:// prefix
  var gidMatch = str.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  // Already numeric
  if (/^\d+$/.test(str)) return str;
  return str;
}

/**
 * Extract all useful catalog identifiers from a Shopify line_item. Variant id
 * stays first for contents rows; SKU is also preserved for content_ids when it
 * may exist as a valid retailer_id.
 */
function extractCatalogIds(item) {
  if (!item) return [];
  var ids = [];
  var seen = Object.create(null);
  function push(id) {
    if (id === undefined || id === null || id === '') return;
    var str = String(id);
    if (!seen[str]) {
      seen[str] = true;
      ids.push(str);
    }
  }
  if (item.variant_id !== undefined && item.variant_id !== null && item.variant_id !== '') {
    push(item.variant_id);
  }
  if (item.sku !== undefined && item.sku !== null && item.sku !== '') {
    push(item.sku);
  }
  if (ids.length === 0) {
    var pid = extractProductId(item);
    if (pid) push(pid);
  }
  return ids;
}

/**
 * Build the full Meta custom_data object (content_ids/contents/content_type/
 * num_items/value/currency) from Shopify line items. Shared across IC, Purchase
 * and AddPaymentInfo so the catalog-match behaviour is consistent.
 */
function buildCustomDataFromLineItems(lineItems, body, extra) {
  var items = Array.isArray(lineItems) ? lineItems : [];

  var contentIds = [];
  var seen = Object.create(null);
  items.forEach(function (item) {
    extractCatalogIds(item).forEach(function (id) {
      if (!seen[id]) { seen[id] = true; contentIds.push(id); }
    });
  });

  var contents = items.map(function (item) {
    var ids = extractCatalogIds(item);
    if (ids.length === 0) return null;
    return {
      id: ids[0],
      quantity: parseInt(item.quantity, 10) || 1,
      item_price: item.price !== undefined ? Number(parseFloat(item.price).toFixed(2)) : undefined
    };
  }).filter(Boolean);

  // Prefer 'product' content_type whenever ANY item has variant-level data,
  // matching the CALQIX variant-level catalog.
  var hasVariantSignal = items.some(function (item) {
    return (item.variant_id !== undefined && item.variant_id !== null && item.variant_id !== '') ||
      (item.sku !== undefined && item.sku !== null && item.sku !== '');
  });

  var data = {
    value: body.value !== undefined ? Number(parseFloat(body.value).toFixed(2)) : undefined,
    currency: body.currency || 'EUR',
    content_ids: contentIds,
    content_type: hasVariantSignal ? 'product' : 'product_group',
    contents: contents,
    num_items: items.reduce(function (sum, item) { return sum + (parseInt(item.quantity, 10) || 1); }, 0)
  };

  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) data[k] = extra[k]; });
  }

  return data;
}

module.exports = handler;
