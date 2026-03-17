const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const {
  buildContents,
  countItems,
  extractContentIds,
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
    toMoney(item && item.line_price) ??
    toMoney(item && item.compare_at_price)
  );
}

function buildCheckoutUserData(checkout, fallbackIp, fallbackUserAgent) {
  const mergedCustomer = mergeCustomerData(
    checkout && checkout.customer,
    checkout && checkout.billing_address,
    checkout && checkout.shipping_address,
    {
      email: checkout && checkout.email,
      phone:
        checkout &&
        (checkout.phone ||
          (checkout.billing_address && checkout.billing_address.phone) ||
          (checkout.shipping_address && checkout.shipping_address.phone)),
      first_name:
        checkout &&
        ((checkout.customer && checkout.customer.first_name) ||
          (checkout.billing_address && checkout.billing_address.first_name) ||
          (checkout.shipping_address && checkout.shipping_address.first_name)),
      last_name:
        checkout &&
        ((checkout.customer && checkout.customer.last_name) ||
          (checkout.billing_address && checkout.billing_address.last_name) ||
          (checkout.shipping_address && checkout.shipping_address.last_name)),
      city:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.city) ||
          (checkout.shipping_address && checkout.shipping_address.city)),
      province_code:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.province_code) ||
          (checkout.shipping_address && checkout.shipping_address.province_code)),
      zip:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.zip) ||
          (checkout.shipping_address && checkout.shipping_address.zip)),
      country_code:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.country_code) ||
          (checkout.shipping_address && checkout.shipping_address.country_code))
    }
  );

  const clientIp = (checkout && checkout.browser_ip) || fallbackIp;
  const clientUserAgent = (checkout && checkout.user_agent) || fallbackUserAgent;

  return formatUserData(mergedCustomer, clientIp, clientUserAgent);
}

async function handler(req, res) {
  try {
    const verification = await parseAndVerifyWebhook(req);

    if (!verification.ok) {
      console.warn('[Webhook checkouts-create] ignored', {
        reason: verification.reason
      });
      return respondOk(res, { received: true, processed: false });
    }

    const checkout = verification.payload || {};
    const checkoutKey = checkout.token || checkout.id;

    if (!checkoutKey) {
      console.warn('[Webhook checkouts-create] ignored', {
        reason: 'missing_checkout_token'
      });
      return respondOk(res, { received: true, processed: false });
    }

    const lineItems = Array.isArray(checkout.line_items) ? checkout.line_items : [];
    const eventId = `checkout_${checkoutKey}`;
    const userData = buildCheckoutUserData(checkout, verification.clientIp, verification.userAgent);
    const customData = {
      value: toMoney(checkout.total_price),
      currency: checkout.currency || 'EUR',
      content_ids: extractContentIds(lineItems),
      content_type: resolveContentType(lineItems),
      contents: buildContents(lineItems, getLineItemPrice),
      num_items: countItems(lineItems)
    };

    await sendEvent('InitiateCheckout', eventId, SOURCE_URL, userData, customData);

    return respondOk(res, {
      received: true,
      processed: true,
      event: 'InitiateCheckout',
      eventId
    });
  } catch (error) {
    console.error('[Webhook checkouts-create] internal error', {
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
