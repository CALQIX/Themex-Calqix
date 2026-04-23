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
const { isDuplicate, markProcessed } = require('../lib/dedup-guard');
const store = require('../lib/store');
const eventState = require('../lib/event-state');

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

    if (!eventType || !checkoutToken) {
      return res.status(400).json({ error: 'event_type and checkout_token required' });
    }

    const clientIp =
      (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
      (req.socket && req.socket.remoteAddress) ||
      undefined;
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      undefined;

    if (eventType === 'contact_info_submitted') {
      return handleContactInfo(res, body, checkoutToken);
    }

    if (eventType === 'checkout_started') {
      return handleCheckoutStarted(res, body, checkoutToken, clientIp, clientUserAgent);
    }

    if (eventType === 'payment_info_submitted') {
      return handlePaymentInfo(res, body, checkoutToken, clientIp, clientUserAgent);
    }

    if (eventType === 'checkout_completed') {
      return handleCheckoutCompleted(res, body, checkoutToken, clientIp, clientUserAgent);
    }

    return res.status(400).json({ error: 'Unknown event_type: ' + eventType });
  } catch (error) {
    console.error('[CheckoutEvent] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false, error: error.message });
  }
}

/**
 * Store enrichment data (email, phone) for later use by checkout_completed.
 */
async function handleContactInfo(res, body, checkoutToken) {
  var enrichment = {};
  if (body.email) enrichment.email = body.email;
  if (body.phone) enrichment.phone = body.phone;
  if (body.fbc) enrichment.fbc = body.fbc;
  if (body.fbp) enrichment.fbp = body.fbp;
  if (body.external_id) enrichment.external_id = body.external_id;

  if (Object.keys(enrichment).length === 0) {
    return res.status(200).json({ received: true, stored: false, reason: 'no_enrichment_data' });
  }

  await store.setEnrichment(checkoutToken, enrichment);

  console.log('[CheckoutEvent] contact_info stored', {
    checkoutToken: checkoutToken.substring(0, 8) + '...',
    hasEmail: Boolean(enrichment.email),
    hasPhone: Boolean(enrichment.phone),
    hasFbc: Boolean(enrichment.fbc)
  });

  return res.status(200).json({ received: true, stored: true, event: 'contact_info_submitted' });
}

/**
 * Send InitiateCheckout to Meta CAPI.
 * event_id = ic_{checkout_token} — shared with checkouts-create webhook.
 */
async function handleCheckoutStarted(res, body, checkoutToken, clientIp, clientUserAgent) {
  var eventId = 'ic_' + checkoutToken;

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

  var sourceUrl = body.source_url || 'https://calqix.com/checkout';
  await eventState.recordReceived(eventId, 'InitiateCheckout', 'custom_pixel', checkoutToken);
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl);
  var result = await sendEvent('InitiateCheckout', eventId, sourceUrl, userData, customData);
  await eventState.recordSent(eventId, result);
  await markProcessed('InitiateCheckout', checkoutToken);

  // Also store any user data as enrichment for Purchase
  var enrichment = {};
  if (body.fbc) enrichment.fbc = body.fbc;
  if (body.fbp) enrichment.fbp = body.fbp;
  if (body.email) enrichment.email = body.email;
  if (body.phone) enrichment.phone = body.phone;
  if (body.external_id) enrichment.external_id = body.external_id;
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
async function handleCheckoutCompleted(res, body, checkoutToken, clientIp, clientUserAgent) {
  var eventId = 'purchase_' + checkoutToken;

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

  var sourceUrl = body.source_url || 'https://calqix.com/checkout';
  await eventState.recordReceived(eventId, 'Purchase', 'custom_pixel', checkoutToken);
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl);
  var result = await sendEvent('Purchase', eventId, sourceUrl, userData, customData);
  await eventState.recordSent(eventId, result);
  await markProcessed('Purchase', checkoutToken);

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
async function handlePaymentInfo(res, body, checkoutToken, clientIp, clientUserAgent) {
  var eventId = 'add_payment_info_' + checkoutToken;

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

  var sourceUrl = body.source_url || 'https://calqix.com/checkout';
  await eventState.recordReceived(eventId, 'AddPaymentInfo', 'custom_pixel', checkoutToken);
  await eventState.storeEventPayload(eventId, userData, customData, sourceUrl);
  var result = await sendEvent('AddPaymentInfo', eventId, sourceUrl, userData, customData);
  await eventState.recordSent(eventId, result);
  await markProcessed('AddPaymentInfo', checkoutToken);

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
  data.first_name = body.first_name || undefined;
  data.last_name = body.last_name || undefined;
  data.city = body.city || undefined;
  data.zip = body.zip || undefined;
  data.country_code = body.country_code || undefined;
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
 * Extract every catalog identifier from a Shopify line_item in priority order.
 * The CALQIX Meta Commerce catalog uses variant_id or SKU as retailer_id, so
 * we emit those first; product_id is kept as a last-resort fallback for items
 * that don't expose variant data. See lib/webhook-utils.js getCatalogItemReferences
 * for the full rationale.
 *
 * Returns an array like ["54065091346761", "CALQIX-OBP-30-CM"]. Never empty
 * unless the input has no id information at all.
 */
function extractCatalogIds(item) {
  if (!item) return [];
  var ids = [];
  if (item.variant_id !== undefined && item.variant_id !== null && item.variant_id !== '') {
    ids.push(String(item.variant_id));
  }
  if (item.sku !== undefined && item.sku !== null && item.sku !== '') {
    ids.push(String(item.sku));
  }
  if (ids.length === 0) {
    var pid = extractProductId(item);
    if (pid) ids.push(pid);
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
