// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { isDuplicate, markProcessed } = require('../../lib/dedup-guard');
const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const {
  buildContents,
  centsToMoney,
  countItems,
  extractContentIds,
  extractExternalId,
  extractMetaBrowserIds,
  mergeCustomerData,
  parseAndVerifyWebhook,
  resolveContentType,
  respondOk
} = require('../../lib/webhook-utils');

const SOURCE_URL = 'https://calqix.com/cart';

function getLineItemPrice(item) {
  return (
    centsToMoney(item && item.price) ??
    centsToMoney(item && item.final_price) ??
    centsToMoney(item && item.line_price)
  );
}

function buildCartUserData(cart, fallbackIp, fallbackUserAgent) {
  const mergedCustomer = mergeCustomerData(
    cart && cart.customer,
    cart && cart.buyer_identity,
    cart && cart.buyer_identity && cart.buyer_identity.customer,
    {
      email: cart && (cart.email || (cart.buyer_identity && cart.buyer_identity.email)),
      phone:
        cart &&
        (cart.phone ||
          (cart.buyer_identity && cart.buyer_identity.phone) ||
          (cart.customer && cart.customer.phone)),
      country_code:
        cart &&
        ((cart.buyer_identity && cart.buyer_identity.country_code) || cart.country_code)
    },
    extractMetaBrowserIds(cart),
    {
      external_id: extractExternalId(cart)
    }
  );

  const clientIp = (cart && (cart.client_ip || cart.browser_ip)) || fallbackIp;
  const clientUserAgent = (cart && cart.user_agent) || fallbackUserAgent;

  return formatUserData(mergedCustomer, clientIp, clientUserAgent);
}

async function handler(req, res) {
  try {
    const verification = await parseAndVerifyWebhook(req);

    if (!verification.ok) {
      console.warn('[Webhook carts-create] ignored', {
        reason: verification.reason
      });
      return respondOk(res, { received: true, processed: false });
    }

    const cart = verification.payload || {};
    const cartKey = cart.id || cart.token;

    if (!cartKey) {
      console.warn('[Webhook carts-create] ignored', {
        reason: 'missing_cart_id'
      });
      return respondOk(res, { received: true, processed: false });
    }

    if (await isDuplicate('AddToCart', String(cartKey))) {
      console.log('[Webhook carts-create] skipping duplicate', { identifier: cartKey });
      return respondOk(res, { received: true, processed: false, reason: 'duplicate' });
    }

    const lineItems = Array.isArray(cart.line_items) ? cart.line_items : [];
    const eventId = `cart_${cartKey}`;
    const userData = buildCartUserData(cart, verification.clientIp, verification.userAgent);
    const customData = {
      value: centsToMoney(cart.total_price),
      currency: cart.currency || 'EUR',
      content_ids: extractContentIds(lineItems),
      content_type: resolveContentType(lineItems),
      contents: buildContents(lineItems, getLineItemPrice),
      num_items: countItems(lineItems)
    };

    // DIAGNOSTIC ONLY — do NOT send to Meta.
    // The browser bridge (calqix-meta-bridge.js) is the canonical AddToCart source.
    // It fires fbq('track','AddToCart') + POST /api/add-to-cart with the SAME event_id.
    // This webhook uses a DIFFERENT event_id (cart_{id}) which would cause double-counting.
    // We log diagnostics to compare webhook vs browser match quality.
    console.log('[Webhook carts-create] DIAGNOSTIC (not sent to Meta)', {
      eventId,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasExternalId: Boolean(userData.external_id),
      contentIds: customData.content_ids.length
    });

    await markProcessed('AddToCart', String(cartKey));

    return respondOk(res, {
      received: true,
      processed: false,
      reason: 'diagnostic_only',
      event: 'AddToCart',
      eventId
    });
  } catch (error) {
    console.error('[Webhook carts-create] internal error', {
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
