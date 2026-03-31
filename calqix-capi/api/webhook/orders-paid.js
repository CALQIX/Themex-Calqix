// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { isDuplicate, markProcessed } = require('../../lib/dedup-guard');
const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
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

function buildOrderUserData(order, fallbackIp, fallbackUserAgent) {
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

    if (isDuplicate('Purchase', String(order.id))) {
      console.log('[Webhook orders-paid] skipping duplicate', { identifier: order.id });
      return respondOk(res, { received: true, processed: false, reason: 'duplicate' });
    }

    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    const eventId = `purchase_${order.id}`;
    const userData = buildOrderUserData(order, verification.clientIp, verification.userAgent);
    const customData = {
      value: toMoney(order.total_price),
      currency: order.currency || 'EUR',
      content_ids: extractContentIds(lineItems),
      content_type: resolveContentType(lineItems),
      contents: buildContents(lineItems, getLineItemPrice),
      num_items: countItems(lineItems),
      order_id: String(order.id)
    };

    await sendEvent('Purchase', eventId, SOURCE_URL, userData, customData);
    markProcessed('Purchase', String(order.id));

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
