/*
 * CALQIX Meta CAPI — Shopify Custom Pixel
 *
 * INSTALL: Shopify Admin > Settings > Customer events > Add custom pixel
 * Name: "CALQIX Meta CAPI"  —  Paste this code  —  Save  —  Connect
 *
 * Tracks: checkout_started, checkout_contact_info_submitted, checkout_completed
 * Sends to: https://calqix-capi.vercel.app/api/checkout-event
 *
 * Dedup: event_id = ic_{token} for IC, purchase_{token} for Purchase
 * Webhook fallbacks use the same format so Meta deduplicates correctly.
 */

var CAPI_URL = "https://calqix-capi.vercel.app/api/checkout-event";
var FALLBACK_URL = "https://calqix.com/checkout";

// Enrichment accumulator — survives across events in the same checkout session
var enrichment = {};

// Cache the last known page URL from page_viewed events
var lastPageUrl = FALLBACK_URL;
analytics.subscribe("page_viewed", function (event) {
  try {
    var loc = event.context.document.location;
    if (loc && loc.href) {
      lastPageUrl = loc.href;
    }
  } catch (e) { /* ignore */ }
});

// --- Helpers ---

function getCookie(name) {
  try { return browser.cookie.get(name); }
  catch (e) { return Promise.resolve(null); }
}

function getSourceUrl(event) {
  try {
    var loc = event.context.document.location;
    if (loc && loc.href) return loc.href;
  } catch (e) { /* ignore */ }
  return lastPageUrl || FALLBACK_URL;
}

function numericId(raw) {
  if (!raw) return null;
  var s = String(raw);
  var idx = s.lastIndexOf("/");
  if (idx !== -1) {
    var after = s.substring(idx + 1);
    if (after.length > 0 && !isNaN(Number(after))) return after;
  }
  if (!isNaN(Number(s))) return s;
  return s;
}

function buildLineItems(checkout) {
  if (!checkout || !checkout.lineItems) return [];
  var items = [];
  for (var i = 0; i < checkout.lineItems.length; i++) {
    var li = checkout.lineItems[i];
    var pid = null;
    if (li.variant && li.variant.product && li.variant.product.id) {
      pid = numericId(li.variant.product.id);
    }
    if (!pid && li.id) pid = numericId(li.id);
    var price = null;
    if (li.variant && li.variant.price && li.variant.price.amount) {
      price = parseFloat(li.variant.price.amount);
    }
    items.push({ product_id: pid, quantity: li.quantity || 1, price: price });
  }
  return items;
}

function totalValue(checkout) {
  if (checkout && checkout.totalPrice && checkout.totalPrice.amount) {
    return parseFloat(checkout.totalPrice.amount);
  }
  return undefined;
}

function currency(checkout) {
  if (checkout && checkout.totalPrice && checkout.totalPrice.currencyCode) {
    return checkout.totalPrice.currencyCode;
  }
  return checkout && checkout.currencyCode ? checkout.currencyCode : "EUR";
}

function orderId(checkout) {
  if (checkout && checkout.order && checkout.order.id) {
    return numericId(checkout.order.id);
  }
  return null;
}

function customerId(checkout) {
  try {
    if (checkout && checkout.order && checkout.order.customer && checkout.order.customer.id) {
      return numericId(checkout.order.customer.id);
    }
    if (checkout && checkout.customer && checkout.customer.id) {
      return numericId(checkout.customer.id);
    }
    if (checkout && checkout.buyerIdentity && checkout.buyerIdentity.customer && checkout.buyerIdentity.customer.id) {
      return numericId(checkout.buyerIdentity.customer.id);
    }
  } catch (e) { /* silent */ }
  return null;
}

function shippingAddress(checkout) {
  return (checkout && (checkout.shippingAddress || checkout.shipping_address)) || null;
}

function send(payload) {
  try {
    fetch(CAPI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (e) { /* fire and forget */ }
}

// --- checkout_started → InitiateCheckout ---

analytics.subscribe("checkout_started", async function (event) {
  var checkout = event.data.checkout;
  if (!checkout || !checkout.token) return;

  var token = checkout.token;
  var fbc = await getCookie("_fbc");
  var fbp = await getCookie("_fbp");

  enrichment[token] = { fbc: fbc, fbp: fbp };

  var addr = shippingAddress(checkout);
  send({
    event_type: "checkout_started",
    checkout_token: token,
    fbc: fbc,
    fbp: fbp,
    email: checkout.email || null,
    phone: checkout.phone || null,
    external_id: customerId(checkout),
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    line_items: buildLineItems(checkout),
    value: totalValue(checkout),
    currency: currency(checkout),
    source_url: getSourceUrl(event)
  });
});

// --- checkout_contact_info_submitted → Enrichment storage ---

analytics.subscribe("checkout_contact_info_submitted", async function (event) {
  var checkout = event.data.checkout;
  if (!checkout || !checkout.token) return;

  var token = checkout.token;
  var fbc = await getCookie("_fbc");
  var fbp = await getCookie("_fbp");

  var cached = enrichment[token] || {};
  enrichment[token] = {
    fbc: fbc || cached.fbc || null,
    fbp: fbp || cached.fbp || null,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null
  };

  send({
    event_type: "contact_info_submitted",
    checkout_token: token,
    email: checkout.email || null,
    phone: checkout.phone || null,
    external_id: customerId(checkout),
    fbc: fbc,
    fbp: fbp
  });
});

// --- payment_info_submitted → AddPaymentInfo ---

analytics.subscribe("payment_info_submitted", async function (event) {
  var checkout = event.data.checkout;
  if (!checkout || !checkout.token) return;

  var token = checkout.token;
  var fbc = await getCookie("_fbc");
  var fbp = await getCookie("_fbp");
  var cached = enrichment[token] || {};

  var addr = shippingAddress(checkout);
  send({
    event_type: "payment_info_submitted",
    checkout_token: token,
    external_id: customerId(checkout),
    fbc: fbc || cached.fbc || null,
    fbp: fbp || cached.fbp || null,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    line_items: buildLineItems(checkout),
    value: totalValue(checkout),
    currency: currency(checkout),
    source_url: getSourceUrl(event)
  });
});

// --- checkout_completed → Purchase ---

analytics.subscribe("checkout_completed", async function (event) {
  var checkout = event.data.checkout;
  if (!checkout || !checkout.token) return;

  var token = checkout.token;
  var fbc = await getCookie("_fbc");
  var fbp = await getCookie("_fbp");
  var cached = enrichment[token] || {};

  var addr = shippingAddress(checkout);
  send({
    event_type: "checkout_completed",
    checkout_token: token,
    order_id: orderId(checkout),
    external_id: customerId(checkout),
    fbc: fbc || cached.fbc || null,
    fbp: fbp || cached.fbp || null,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    line_items: buildLineItems(checkout),
    value: totalValue(checkout),
    currency: currency(checkout),
    source_url: getSourceUrl(event)
  });

  delete enrichment[token];
});
