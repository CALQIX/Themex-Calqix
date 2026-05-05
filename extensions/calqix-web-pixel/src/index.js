import {register} from '@shopify/web-pixels-extension';

var PIXEL_VERSION = '2026-05-05-catalog-ids-a';
var DEFAULT_ENDPOINT = 'https://calqix-capi.vercel.app/api/checkout-event';
var DEFAULT_HEALTH_ENDPOINT = 'https://calqix-capi.vercel.app/api/shopify-web-pixel';
var DEFAULT_PIXEL_ID = '934134615770602';

function asString(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function numericId(value) {
  var str = asString(value);
  if (!str) return null;
  var match = str.match(/\/(\d+)$/);
  if (match) return match[1];
  return str;
}

function amount(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value.amount !== undefined) return amount(value.amount);
  return undefined;
}

function checkoutToken(checkout) {
  if (!checkout) return null;
  return asString(checkout.token || checkout.checkoutToken || checkout.id);
}

function checkoutEmail(checkout) {
  if (!checkout) return undefined;
  return checkout.email || checkout.customer && checkout.customer.email || undefined;
}

function checkoutPhone(checkout) {
  if (!checkout) return undefined;
  return checkout.phone ||
    checkout.shippingAddress && checkout.shippingAddress.phone ||
    checkout.billingAddress && checkout.billingAddress.phone ||
    undefined;
}

function orderId(checkout) {
  if (!checkout) return undefined;
  return checkout.order && (checkout.order.id || checkout.order.name) || checkout.orderId || undefined;
}

function checkoutValue(checkout) {
  if (!checkout) return undefined;
  return amount(checkout.totalPrice || checkout.subtotalPrice);
}

function checkoutCurrency(checkout) {
  if (!checkout) return 'EUR';
  return checkout.currencyCode ||
    checkout.totalPrice && checkout.totalPrice.currencyCode ||
    checkout.subtotalPrice && checkout.subtotalPrice.currencyCode ||
    'EUR';
}

function lineItems(checkout) {
  var lines = checkout && checkout.lineItems;
  if (!Array.isArray(lines)) return [];
  return lines.map(function (line) {
    var variant = line.variant || line.merchandise || {};
    var price = amount(line.finalLinePrice || line.cost && line.cost.totalAmount || variant.price);
    return {
      id: numericId(variant.id || line.variantId || line.id),
      sku: asString(variant.sku),
      quantity: line.quantity || 1,
      item_price: price
    };
  }).filter(function (line) {
    return line.id || line.sku;
  });
}

function sourceUrl(event) {
  return event && event.context && event.context.document && event.context.document.location &&
    event.context.document.location.href || 'https://www.calqix.com/checkout';
}

function eventId(event) {
  return asString(event && (event.id || event.clientId)) || ('shopify_web_pixel_' + Date.now());
}

async function readCookie(browser, name) {
  try {
    if (!browser || !browser.cookie || typeof browser.cookie.get !== 'function') return undefined;
    return await browser.cookie.get(name);
  } catch (e) {
    return undefined;
  }
}

function postJson(url, payload) {
  try {
    fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  } catch (e) {}
}

register(function ({analytics, browser, settings}) {
  var endpoint = settings && settings.endpoint || DEFAULT_ENDPOINT;
  var healthEndpoint = settings && settings.healthEndpoint || DEFAULT_HEALTH_ENDPOINT;
  var pixelId = settings && settings.pixelId || DEFAULT_PIXEL_ID;

  async function commonPayload(event, eventType) {
    return {
      event_type: eventType,
      shopify_event_id: eventId(event),
      source: 'shopify_web_pixel',
      pixel_id: pixelId,
      web_pixel_version: PIXEL_VERSION,
      source_url: sourceUrl(event),
      fbc: await readCookie(browser, '_fbc'),
      fbp: await readCookie(browser, '_fbp'),
      external_id: await readCookie(browser, '_cq_anon_id')
    };
  }

  function health(eventName) {
    analytics.subscribe(eventName, async function (event) {
      var payload = await commonPayload(event, eventName);
      postJson(healthEndpoint, payload);
    });
  }

  async function sendCheckout(event, eventType) {
    var checkout = event && event.data && event.data.checkout;
    var token = checkoutToken(checkout);
    if (!token) {
      var missing = await commonPayload(event, eventType + '_missing_token');
      postJson(healthEndpoint, missing);
      return;
    }

    var payload = await commonPayload(event, eventType);
    var lines = lineItems(checkout);
    payload.checkout_token = token;
    payload.order_id = orderId(checkout);
    payload.email = checkoutEmail(checkout);
    payload.phone = checkoutPhone(checkout);
    payload.value = checkoutValue(checkout);
    payload.currency = checkoutCurrency(checkout);
    payload.contents = lines.map(function (line) {
      return {
        id: line.id || line.sku,
        quantity: line.quantity,
        item_price: line.item_price
      };
    });
    payload.content_ids = lines.map(function (line) {
      return line.id || line.sku;
    }).filter(Boolean);

    postJson(endpoint, payload);
    postJson(healthEndpoint, payload);
  }

  health('page_viewed');
  health('product_viewed');
  health('product_added_to_cart');

  analytics.subscribe('checkout_started', function (event) {
    sendCheckout(event, 'checkout_started');
  });
  analytics.subscribe('checkout_contact_info_submitted', function (event) {
    sendCheckout(event, 'contact_info_submitted');
  });
  analytics.subscribe('payment_info_submitted', function (event) {
    sendCheckout(event, 'payment_info_submitted');
  });
  analytics.subscribe('checkout_completed', function (event) {
    sendCheckout(event, 'checkout_completed');
  });
});
