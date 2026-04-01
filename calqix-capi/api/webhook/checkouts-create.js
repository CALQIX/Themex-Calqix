// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { isDuplicate, markProcessed } = require('../../lib/dedup-guard');
const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const store = require('../../lib/store');
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
    toMoney(item && item.line_price) ??
    toMoney(item && item.compare_at_price)
  );
}

function buildCheckoutUserData(checkout, fallbackIp, fallbackUserAgent, enrichment) {
  var enrich = enrichment || {};
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
    },
    extractMetaBrowserIds(checkout),
    {
      external_id: extractExternalId(checkout)
    },
    // Enrichment from Custom Pixel (fbc/fbp/email stored at contact_info_submitted)
    {
      fbc: enrich.fbc || undefined,
      fbp: enrich.fbp || undefined,
      email: enrich.email || undefined,
      phone: enrich.phone || undefined,
      external_id: enrich.external_id || undefined
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

    if (isDuplicate('InitiateCheckout', String(checkoutKey))) {
      console.log('[Webhook checkouts-create] skipping duplicate', { identifier: checkoutKey });
      return respondOk(res, { received: true, processed: false, reason: 'duplicate' });
    }

    const lineItems = Array.isArray(checkout.line_items) ? checkout.line_items : [];
    // Shared event_id format: ic_{checkout_token} — matches Custom Pixel
    const eventId = `ic_${checkoutKey}`;

    // Merge enrichment from Custom Pixel's contact_info_submitted if available
    const enrichment = await store.getEnrichment(String(checkoutKey)) || {};
    const userData = buildCheckoutUserData(checkout, verification.clientIp, verification.userAgent, enrichment);
    const customData = {
      value: toMoney(checkout.total_price),
      currency: checkout.currency || 'EUR',
      content_ids: extractContentIds(lineItems),
      content_type: resolveContentType(lineItems),
      contents: buildContents(lineItems, getLineItemPrice),
      num_items: countItems(lineItems)
    };

    console.log('[Webhook checkouts-create] InitiateCheckout', {
      eventId,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasExternalId: Boolean(userData.external_id),
      enrichedFromStore: Object.keys(enrichment).length > 0,
      source: 'webhook'
    });

    await sendEvent('InitiateCheckout', eventId, SOURCE_URL, userData, customData);
    await markProcessed('InitiateCheckout', String(checkoutKey));

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
