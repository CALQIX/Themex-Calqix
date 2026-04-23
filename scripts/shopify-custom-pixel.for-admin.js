/*
 * CALQIX Meta CAPI — Shopify Custom Pixel
 *
 * INSTALL: Shopify Admin > Settings > Customer events > Add custom pixel
 * Name: "CALQIX Meta CAPI"  —  Paste this code  —  Save  —  Connect
 *
 * Tracks:
 *   checkout_started                  → InitiateCheckout   (browser + server)
 *   checkout_contact_info_submitted   → enrichment storage
 *   payment_info_submitted            → AddPaymentInfo     (browser + server)
 *   checkout_completed                → Purchase           (browser + server)
 *
 * Two-layer delivery per event:
 *   1. Browser-side: direct GET to https://www.facebook.com/tr/ (pixel beacon)
 *      — same event_id as server, plus fbp/fbc for matching.
 *   2. Server-side:  POST to /api/checkout-event → Meta CAPI.
 *
 * Dedup: event_id identical on both sides so Meta counts each event once.
 *   InitiateCheckout  → ic_{checkout_token}
 *   AddPaymentInfo    → add_payment_info_{checkout_token}
 *   Purchase          → purchase_{checkout_token}
 * Webhook fallbacks (api/webhook/orders-paid etc.) reuse the same format.
 */

var CAPI_URL = "https://calqix-capi.vercel.app/api/checkout-event";
var FALLBACK_URL = "https://calqix.com/checkout";
var META_PIXEL_ID = "934134615770602";

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
    // CALQIX Meta Commerce catalog uses variant_id or SKU as retailer_id, so
    // the downstream server (api/checkout-event.js) needs both to match.
    var vid = null;
    if (li.variant && li.variant.id) vid = numericId(li.variant.id);
    var sku = null;
    if (li.variant && li.variant.sku) sku = String(li.variant.sku);
    var price = null;
    if (li.variant && li.variant.price && li.variant.price.amount) {
      price = parseFloat(li.variant.price.amount);
    }
    items.push({
      product_id: pid,
      variant_id: vid,
      sku: sku,
      quantity: li.quantity || 1,
      price: price
    });
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

/**
 * Fire a browser-side Meta Pixel event via direct GET to facebook.com/tr.
 *
 * Why this works in a Shopify Custom Pixel sandbox:
 *   - Loading fbevents.js (window.fbq) is restricted in the sandbox DOM.
 *   - facebook.com/tr/ is the same beacon endpoint that fbq itself hits.
 *   - With credentials:'include' the browser attaches facebook.com cookies
 *     (c_user, fr) for logged-in FB users; we also forward _fbp / _fbc so
 *     Meta can match this browser event to the matching server CAPI event
 *     via the shared event_id (Meta's primary dedup key).
 *
 * Meta classifies this as a browser-side Pixel event because the request
 *   originates from the user's browser, with their IP, UA and cookies.
 */
function fireBrowserPixelEvent(eventName, eventId, customData, fbp, fbc, sourceUrl) {
  try {
    var qs = [
      "id=" + META_PIXEL_ID,
      "ev=" + encodeURIComponent(eventName),
      "dl=" + encodeURIComponent(sourceUrl || FALLBACK_URL),
      "rl=" + encodeURIComponent(sourceUrl || FALLBACK_URL),
      "if=false",
      "ts=" + Date.now(),
      "v=2.9.182",
      "r=stable",
      "pl=calqix-custom-pixel",
      "es=automatic",
      "eid=" + encodeURIComponent(eventId)
    ];

    if (customData) {
      if (customData.value !== undefined && customData.value !== null) {
        qs.push("cd[value]=" + encodeURIComponent(customData.value));
      }
      if (customData.currency) {
        qs.push("cd[currency]=" + encodeURIComponent(customData.currency));
      }
      if (Array.isArray(customData.content_ids) && customData.content_ids.length) {
        qs.push("cd[content_ids]=" + encodeURIComponent(JSON.stringify(customData.content_ids)));
      }
      if (customData.content_type) {
        qs.push("cd[content_type]=" + encodeURIComponent(customData.content_type));
      }
      if (customData.num_items !== undefined && customData.num_items !== null) {
        qs.push("cd[num_items]=" + encodeURIComponent(customData.num_items));
      }
      if (customData.order_id) {
        qs.push("cd[order_id]=" + encodeURIComponent(customData.order_id));
      }
    }

    // _fbp / _fbc are essential for browser-to-server attribution matching.
    if (fbp) qs.push("fbp=" + encodeURIComponent(fbp));
    if (fbc) qs.push("fbc=" + encodeURIComponent(fbc));

    var url = "https://www.facebook.com/tr/?" + qs.join("&");

    // keepalive so the beacon survives the page navigation on checkout_completed.
    fetch(url, {
      method: "GET",
      mode: "no-cors",
      credentials: "include",
      keepalive: true
    });
  } catch (e) { /* fire and forget */ }
}

function contentIdsFromItems(items) {
  if (!Array.isArray(items)) return [];
  var out = [];
  var seen = {};
  function push(id) {
    if (id === null || id === undefined || id === '') return;
    var s = String(id);
    if (!seen[s]) { seen[s] = true; out.push(s); }
  }
  var hasVariantSignal = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].variant_id) { hasVariantSignal = true; push(items[i].variant_id); }
    if (items[i] && items[i].sku) { hasVariantSignal = true; push(items[i].sku); }
  }
  // Only fall back to product_id when NO line item has variant-level data.
  if (!hasVariantSignal) {
    for (var j = 0; j < items.length; j++) {
      if (items[j]) push(items[j].product_id);
    }
  }
  return out;
}

function contentTypeFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'product_group';
  var hasVariantSignal = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i] && (items[i].variant_id || items[i].sku)) { hasVariantSignal = true; break; }
  }
  return hasVariantSignal ? 'product' : 'product_group';
}

function sumQuantities(items) {
  if (!Array.isArray(items)) return 0;
  var n = 0;
  for (var i = 0; i < items.length; i++) {
    n += parseInt((items[i] && items[i].quantity) || 1, 10);
  }
  return n;
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
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);

  // Browser-side InitiateCheckout — matches server event_id for dedup.
  fireBrowserPixelEvent("InitiateCheckout", "ic_" + token, {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems)
  }, fbp, fbc, sourceUrl);

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
    line_items: lineItems,
    value: value,
    currency: curr,
    source_url: sourceUrl
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
  var effectiveFbp = fbp || cached.fbp || null;
  var effectiveFbc = fbc || cached.fbc || null;

  var addr = shippingAddress(checkout);
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);

  // Browser-side AddPaymentInfo — matches server event_id for dedup.
  fireBrowserPixelEvent("AddPaymentInfo", "add_payment_info_" + token, {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems)
  }, effectiveFbp, effectiveFbc, sourceUrl);

  send({
    event_type: "payment_info_submitted",
    checkout_token: token,
    external_id: customerId(checkout),
    fbc: effectiveFbc,
    fbp: effectiveFbp,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    line_items: lineItems,
    value: value,
    currency: curr,
    source_url: sourceUrl
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
  var effectiveFbp = fbp || cached.fbp || null;
  var effectiveFbc = fbc || cached.fbc || null;

  var addr = shippingAddress(checkout);
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);
  var oid = orderId(checkout);

  // Browser-side Purchase — matches server event_id for dedup. This is THE
  // high-EMQ event; server-side alone gives lower match quality tier.
  fireBrowserPixelEvent("Purchase", "purchase_" + token, {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems),
    order_id: oid
  }, effectiveFbp, effectiveFbc, sourceUrl);

  send({
    event_type: "checkout_completed",
    checkout_token: token,
    order_id: oid,
    external_id: customerId(checkout),
    fbc: effectiveFbc,
    fbp: effectiveFbp,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    line_items: lineItems,
    value: value,
    currency: curr,
    source_url: sourceUrl
  });

  delete enrichment[token];
});
