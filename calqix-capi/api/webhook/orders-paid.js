// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { isDuplicate, markProcessed } = require('../../lib/dedup-guard');
const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const store = require('../../lib/store');
const eventState = require('../../lib/event-state');
const {
  buildContents,
  countItems,
  extractContentIds,
  extractExternalId,
  extractMetaBrowserIds,
  mergeCustomerData,
  parseAndVerifyWebhook,
  respondOk,
  resolveContentType,
  toMoney
} = require('../../lib/webhook-utils');

const SOURCE_URL = 'https://calqix.com/checkout';

function getLineItemPrice(item) {
  return (
    toMoney(item && item.price) ??
    toMoney(item && item.price_set && item.price_set.shop_money && item.price_set.shop_money.amount) ??
    toMoney(item && item.original_price) ??
    toMoney(item && item.original_price_set && item.original_price_set.shop_money && item.original_price_set.shop_money.amount)
  );
}

function buildOrderUserData(order, fallbackIp, fallbackUserAgent, enrichment) {
  var enrich = enrichment || {};
  const mergedCustomer = mergeCustomerData(
    order && order.customer,
    order && order.customer && order.customer.default_address,
    order && order.billing_address,
    order && order.shipping_address,
    {
      email: order && (order.email || order.contact_email),
      phone:
        order &&
        (order.phone ||
          (order.billing_address && order.billing_address.phone) ||
          (order.shipping_address && order.shipping_address.phone) ||
          (order.customer && order.customer.phone)),
      first_name:
        order &&
        ((order.customer && order.customer.first_name) ||
          (order.billing_address && order.billing_address.first_name) ||
          (order.shipping_address && order.shipping_address.first_name)),
      last_name:
        order &&
        ((order.customer && order.customer.last_name) ||
          (order.billing_address && order.billing_address.last_name) ||
          (order.shipping_address && order.shipping_address.last_name)),
      city:
        order &&
        ((order.billing_address && order.billing_address.city) ||
          (order.shipping_address && order.shipping_address.city)),
      province_code:
        order &&
        ((order.billing_address && order.billing_address.province_code) ||
          (order.shipping_address && order.shipping_address.province_code)),
      zip:
        order &&
        ((order.billing_address && order.billing_address.zip) ||
          (order.shipping_address && order.shipping_address.zip)),
      country_code:
        order &&
        ((order.billing_address && order.billing_address.country_code) ||
          (order.shipping_address && order.shipping_address.country_code) ||
          (order.customer &&
            order.customer.default_address &&
            order.customer.default_address.country_code))
    },
    extractMetaBrowserIds(order),
    {
      external_id: extractExternalId(order)
    },
    // Enrichment from Custom Pixel (fbc/fbp/email stored during checkout)
    {
      fbc: enrich.fbc || undefined,
      fbp: enrich.fbp || undefined,
      email: enrich.email || undefined,
      phone: enrich.phone || undefined,
      external_id: enrich.external_id || undefined
    }
  );

  const clientIp =
    (order && order.client_details && order.client_details.browser_ip) ||
    (order && order.browser_ip) ||
    fallbackIp;
  const clientUserAgent =
    (order && order.client_details && order.client_details.user_agent) ||
    (order && order.user_agent) ||
    fallbackUserAgent;

  return formatUserData(mergedCustomer, clientIp, clientUserAgent);
}

async function handler(req, res) {
  try {
    const verification = await parseAndVerifyWebhook(req);

    if (!verification.ok) {
      console.warn('[Webhook orders-paid] ignored', {
        reason: verification.reason
      });
      return respondOk(res, { received: true, processed: false });
    }

    const order = verification.payload || {};

    if (!order.id) {
      console.warn('[Webhook orders-paid] ignored', {
        reason: 'missing_order_id'
      });
      return respondOk(res, { received: true, processed: false });
    }

    // Use checkout_token as the correlation key for dedup with Custom Pixel.
    // Custom Pixel sends purchase_{checkout_token}, so we must use the same.
    // Fall back to order.id if checkout_token is unavailable.
    const checkoutToken = order.checkout_token || order.token;
    const dedupKey = checkoutToken || String(order.id);

    if (await isDuplicate('Purchase', dedupKey)) {
      console.log('[Webhook orders-paid] skipping duplicate', {
        identifier: dedupKey,
        source: checkoutToken ? 'checkout_token' : 'order_id'
      });
      return respondOk(res, { received: true, processed: false, reason: 'duplicate' });
    }

    // Shared event_id format: purchase_{checkout_token} — matches Custom Pixel
    const eventId = checkoutToken ? `purchase_${checkoutToken}` : `purchase_${order.id}`;

    // Merge enrichment from Custom Pixel's contact_info_submitted if available
    const enrichment = checkoutToken ? (await store.getEnrichment(String(checkoutToken)) || {}) : {};

    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    const userData = buildOrderUserData(order, verification.clientIp, verification.userAgent, enrichment);
    const customData = {
      value: toMoney(order.total_price),
      currency: order.currency || 'EUR',
      content_ids: extractContentIds(lineItems),
      content_type: resolveContentType(lineItems),
      contents: buildContents(lineItems, getLineItemPrice),
      num_items: countItems(lineItems),
      order_id: String(order.id)
    };

    console.log('[Webhook orders-paid] Purchase', {
      eventId,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasExternalId: Boolean(userData.external_id),
      enrichedFromStore: Object.keys(enrichment).length > 0,
      correlationKey: checkoutToken ? 'checkout_token' : 'order_id',
      source: 'webhook'
    });

    await eventState.recordReceived(eventId, 'Purchase', 'webhook', dedupKey);
    var metaResult = await sendEvent('Purchase', eventId, SOURCE_URL, userData, customData);
    await eventState.recordSent(eventId, metaResult);
    await markProcessed('Purchase', dedupKey);

    return respondOk(res, {
      received: true,
      processed: true,
      event: 'Purchase',
      eventId
    });
  } catch (error) {
    console.error('[Webhook orders-paid] internal error', {
      message: error.message
    });
    return respondOk(res, { received: true, processed: false });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
