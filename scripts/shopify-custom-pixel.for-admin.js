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
var BROWSER_LEDGER_URL = "https://calqix-capi.vercel.app/api/meta-browser-event";
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

function parseGaClientId(value) {
  if (!value) return null;
  var s = String(value);
  var match = s.match(/^GA\d+\.\d+\.(.+)$/);
  return match ? match[1] : s;
}

async function getGaClientId() {
  return parseGaClientId(await getCookie("_ga"));
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
    // Variant id is primary, SKU is preserved as an additional retailer_id
    // candidate when present.
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

async function browserExternalId(checkout) {
  return customerId(checkout) || await getCookie("_cq_anon_id");
}

function shippingAddress(checkout) {
  return (checkout && (checkout.shippingAddress || checkout.shipping_address || checkout.billingAddress || checkout.billing_address)) || null;
}

function checkoutPhone(checkout, addr) {
  if (!checkout) return null;
  return checkout.phone ||
    (addr && addr.phone) ||
    (checkout.shippingAddress && checkout.shippingAddress.phone) ||
    (checkout.shipping_address && checkout.shipping_address.phone) ||
    (checkout.billingAddress && checkout.billingAddress.phone) ||
    (checkout.billing_address && checkout.billing_address.phone) ||
    (checkout.customer && checkout.customer.phone) ||
    (checkout.order && checkout.order.customer && checkout.order.customer.phone) ||
    null;
}

function normalizeDateOfBirth(value) {
  if (!value) return null;
  var s = String(value).trim().toLowerCase();
  var compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return compact[1] + compact[2] + compact[3];
  var iso = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (iso) return iso[1] + iso[2] + iso[3];
  return null;
}

function dialCodeForCountry(countryCode) {
  if (!countryCode) return null;
  var code = String(countryCode).trim().toUpperCase().slice(0, 2);
  var map = {
    NL: "31",
    BE: "32",
    DE: "49",
    FR: "33",
    ES: "34",
    GB: "44",
    UK: "44",
    US: "1",
    CA: "1",
    AT: "43",
    CH: "41",
    LI: "423",
    SE: "46",
    NO: "47",
    DK: "45",
    FI: "358",
    IS: "354",
    LU: "352"
  };
  return map[code] || null;
}

function normalizePhoneForMeta(value, countryCode) {
  if (!value) return null;
  var raw = String(value).trim();
  var digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.indexOf("+") === 0) return digits;
  if (digits.indexOf("00") === 0) return digits.substring(2) || null;

  var dial = dialCodeForCountry(countryCode);
  if (digits.indexOf("0") === 0) {
    return dial ? dial + digits.replace(/^0+/, "") : null;
  }
  if (dial && digits.length <= 10 && digits.indexOf(dial) !== 0) {
    return dial + digits;
  }
  return digits;
}

function customerBirthday(checkout) {
  try {
    var customer = checkout && (
      checkout.customer ||
      (checkout.buyerIdentity && checkout.buyerIdentity.customer) ||
      (checkout.order && checkout.order.customer)
    );
    var value = customer && (
      customer.birthday ||
      customer.birthdate ||
      customer.dateOfBirth ||
      customer.date_of_birth
    );
    if (value && value.value) value = value.value;
    return normalizeDateOfBirth(value);
  } catch (e) { /* silent */ }
  return null;
}

function eventUnixTime(event) {
  var ts = event && event.timestamp;
  var parsed = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function postJson(url, payload, includeBrowserUserAgent) {
  try {
    var base = { event_time: Math.floor(Date.now() / 1000) };
    if (includeBrowserUserAgent) {
      base.browser_user_agent = navigator.userAgent || null;
    }
    payload = Object.assign(base, payload || {});
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch (e) { /* fire and forget */ }
}

function send(payload) {
  postJson(CAPI_URL, payload, true);
}

function auditBrowserEvent(eventName, eventId, eventTime, customData, userData, fbp, fbc, sourceUrl) {
  postJson(BROWSER_LEDGER_URL, {
    event_name: eventName,
    event_id: eventId,
    event_time: eventTime,
    pixel_id: META_PIXEL_ID,
    source: "shopify_custom_pixel_direct_tr",
    source_url: sourceUrl,
    identity_flags: {
      em: Boolean(userData && userData.email),
      ph: Boolean(userData && userData.phone),
      fn: Boolean(userData && userData.first_name),
      ln: Boolean(userData && userData.last_name),
      ct: Boolean(userData && userData.city),
      st: Boolean(userData && userData.state),
      zp: Boolean(userData && userData.zip),
      country: Boolean(userData && userData.country_code),
      db: Boolean(userData && userData.date_of_birth),
      external_id: Boolean(userData && userData.external_id),
      fbp: Boolean(fbp),
      fbc: Boolean(fbc),
      client_user_agent: Boolean(typeof navigator !== "undefined" && navigator.userAgent)
    },
    custom_data_flags: {
      value: Boolean(customData && customData.value !== undefined && customData.value !== null),
      currency: Boolean(customData && customData.currency),
      content_ids: Boolean(customData && Array.isArray(customData.content_ids) && customData.content_ids.length),
      contents: Boolean(customData && Array.isArray(customData.contents) && customData.contents.length),
      order_id: Boolean(customData && customData.order_id)
    }
  }, false);
}

function normalizeForHash(field, value, userData) {
  if (!value) return null;
  var v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v.normalize) v = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (field === "ph") v = normalizePhoneForMeta(v, userData && userData.country_code);
  if (field === "zp") v = v.replace(/\s+/g, "");
  if (field === "country") {
    var countryMap = {
      nederland: "nl",
      netherlands: "nl",
      holland: "nl",
      belgie: "be",
      belgium: "be",
      germany: "de",
      deutschland: "de",
      france: "fr",
      spain: "es",
      espana: "es",
      unitedkingdom: "gb",
      uk: "gb",
      unitedstates: "us",
      unitedstatesofamerica: "us",
      usa: "us"
    };
    var compactCountry = v.replace(/[^a-z0-9]/g, "");
    v = countryMap[compactCountry] || compactCountry.substring(0, 2);
  }
  if (field === "db") v = normalizeDateOfBirth(v);
  if (field === "st") v = v.replace(/[^a-z0-9]/g, "");
  return v || null;
}

function reportSubtleCrypto(works, error) {
  try {
    var key = works ? "__calqixSubtleConfirmed" : "__calqixSubtleFailed";
    if (typeof globalThis !== "undefined" && !globalThis[key]) {
      globalThis[key] = true;
      fetch("https://calqix-capi.vercel.app/api/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test: "subtle_crypto",
          works: works,
          error: error ? String(error).slice(0, 180) : undefined,
          source: "live_custom_pixel",
          timestamp: Date.now()
        }),
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) {}
}

async function sha256Hash(value) {
  if (!value) return null;
  var normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest && typeof TextEncoder !== "undefined") {
    try {
      var enc = new TextEncoder();
      var data = enc.encode(normalized);
      var hashBuffer = await crypto.subtle.digest("SHA-256", data);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      reportSubtleCrypto(true);
      return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) {
      reportSubtleCrypto(false, e && e.message || e);
    }
  }
  reportSubtleCrypto(false, "subtle_crypto_unavailable");
  return null;
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
async function fireBrowserPixelEvent(eventName, eventId, customData, userData, fbp, fbc, sourceUrl) {
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

    if (userData) {
      var fields = [
        { key: "em", value: userData.email },
        { key: "ph", value: userData.phone },
        { key: "fn", value: userData.first_name },
        { key: "ln", value: userData.last_name },
        { key: "ct", value: userData.city },
        { key: "st", value: userData.state },
        { key: "zp", value: userData.zip },
        { key: "country", value: userData.country_code },
        { key: "db", value: userData.date_of_birth },
        { key: "external_id", value: userData.external_id }
      ];
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var normalized = normalizeForHash(field.key, field.value, userData);
        if (normalized) {
          var hashed = await sha256Hash(normalized);
          if (hashed) qs.push("ud[" + field.key + "]=" + encodeURIComponent(hashed));
        }
      }
    }

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
    if (items[i] && items[i].variant_id) {
      hasVariantSignal = true;
      push(items[i].variant_id);
    }
    if (items[i] && items[i].sku) {
      hasVariantSignal = true;
      push(items[i].sku);
    }
  }
  // Only fall back to product_id when NO line item has variant-level data.
  if (!hasVariantSignal) {
    for (var j = 0; j < items.length; j++) {
      if (items[j]) push(items[j].product_id);
    }
  }
  return out;
}

function contentsFromItems(items) {
  if (!Array.isArray(items)) return [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var id = item.variant_id || item.sku || item.product_id;
    if (!id) continue;
    var row = {
      id: String(id),
      quantity: item.quantity || 1
    };
    if (item.price !== null && item.price !== undefined && item.price !== '') {
      var price = parseFloat(item.price);
      if (isFinite(price)) row.item_price = price;
    }
    out.push(row);
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
  var gaClientId = await getGaClientId();
  var externalId = await browserExternalId(checkout);
  var eventTime = eventUnixTime(event);

  enrichment[token] = { fbc: fbc, fbp: fbp, ga_client_id: gaClientId };

  var addr = shippingAddress(checkout);
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);
  var userData = {
    email: checkout.email || null,
    phone: checkoutPhone(checkout, addr),
    external_id: externalId,
    ga_client_id: gaClientId,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    state: addr && (addr.provinceCode || addr.province || addr.region) || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    date_of_birth: customerBirthday(checkout)
  };
  enrichment[token] = Object.assign({}, enrichment[token], userData);

  // Browser-side InitiateCheckout — matches server event_id for dedup.
  var icCustomData = {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    contents: contentsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems)
  };
  await fireBrowserPixelEvent("InitiateCheckout", "ic_" + token, icCustomData, userData, fbp, fbc, sourceUrl);
  auditBrowserEvent("InitiateCheckout", "ic_" + token, eventTime, icCustomData, userData, fbp, fbc, sourceUrl);

  send({
    event_type: "checkout_started",
    event_time: eventTime,
    checkout_token: token,
    fbc: fbc,
    fbp: fbp,
    email: checkout.email || null,
    phone: checkoutPhone(checkout, addr),
    external_id: externalId,
    ga_client_id: gaClientId,
    first_name: addr && (addr.firstName || addr.first_name) || null,
    last_name: addr && (addr.lastName || addr.last_name) || null,
    city: addr && addr.city || null,
    state: addr && (addr.provinceCode || addr.province || addr.region) || null,
    zip: addr && addr.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || null,
    date_of_birth: userData.date_of_birth || null,
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
  var gaClientId = await getGaClientId();
  var externalId = await browserExternalId(checkout);
  var addr = shippingAddress(checkout);

  var cached = enrichment[token] || {};
  var userData = {
    email: checkout.email || cached.email || null,
    phone: checkoutPhone(checkout, addr) || cached.phone || null,
    external_id: externalId || cached.external_id || null,
    ga_client_id: gaClientId || cached.ga_client_id || null,
    first_name: addr && (addr.firstName || addr.first_name) || cached.first_name || null,
    last_name: addr && (addr.lastName || addr.last_name) || cached.last_name || null,
    city: addr && addr.city || cached.city || null,
    state: addr && (addr.provinceCode || addr.province || addr.region) || cached.state || null,
    zip: addr && addr.zip || cached.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || cached.country_code || null,
    date_of_birth: customerBirthday(checkout) || cached.date_of_birth || null
  };
  enrichment[token] = {
    fbc: fbc || cached.fbc || null,
    fbp: fbp || cached.fbp || null,
    ga_client_id: gaClientId || cached.ga_client_id || null,
    email: userData.email,
    phone: userData.phone,
    external_id: userData.external_id,
    first_name: userData.first_name,
    last_name: userData.last_name,
    city: userData.city,
    state: userData.state,
    zip: userData.zip,
    country_code: userData.country_code,
    date_of_birth: userData.date_of_birth
  };

  send({
    event_type: "contact_info_submitted",
    event_time: eventUnixTime(event),
    checkout_token: token,
    email: userData.email,
    phone: userData.phone,
    external_id: userData.external_id,
    ga_client_id: userData.ga_client_id,
    first_name: userData.first_name,
    last_name: userData.last_name,
    city: userData.city,
    state: userData.state,
    zip: userData.zip,
    country_code: userData.country_code,
    date_of_birth: userData.date_of_birth,
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
  var gaClientId = await getGaClientId();
  var externalId = await browserExternalId(checkout);
  var eventTime = eventUnixTime(event);
  var cached = enrichment[token] || {};
  var effectiveFbp = fbp || cached.fbp || null;
  var effectiveFbc = fbc || cached.fbc || null;
  var effectiveGaClientId = gaClientId || cached.ga_client_id || null;

  var addr = shippingAddress(checkout);
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);
  var userData = {
    email: checkout.email || cached.email || null,
    phone: checkoutPhone(checkout, addr) || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || cached.first_name || null,
    last_name: addr && (addr.lastName || addr.last_name) || cached.last_name || null,
    city: addr && addr.city || cached.city || null,
    state: addr && (addr.provinceCode || addr.province || addr.region) || cached.state || null,
    zip: addr && addr.zip || cached.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || cached.country_code || null,
    date_of_birth: customerBirthday(checkout) || cached.date_of_birth || null,
    external_id: externalId || cached.external_id || null
  };

  // Browser-side AddPaymentInfo — matches server event_id for dedup.
  var apiCustomData = {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    contents: contentsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems)
  };
  await fireBrowserPixelEvent("AddPaymentInfo", "add_payment_info_" + token, apiCustomData, userData, effectiveFbp, effectiveFbc, sourceUrl);
  auditBrowserEvent("AddPaymentInfo", "add_payment_info_" + token, eventTime, apiCustomData, userData, effectiveFbp, effectiveFbc, sourceUrl);

  send({
    event_type: "payment_info_submitted",
    event_time: eventTime,
    checkout_token: token,
    external_id: userData.external_id,
    ga_client_id: effectiveGaClientId,
    fbc: effectiveFbc,
    fbp: effectiveFbp,
    email: userData.email,
    phone: userData.phone,
    first_name: userData.first_name,
    last_name: userData.last_name,
    city: userData.city,
    state: userData.state,
    zip: userData.zip,
    country_code: userData.country_code,
    date_of_birth: userData.date_of_birth,
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
  var gaClientId = await getGaClientId();
  var externalId = await browserExternalId(checkout);
  var eventTime = eventUnixTime(event);
  var cached = enrichment[token] || {};
  var effectiveFbp = fbp || cached.fbp || null;
  var effectiveFbc = fbc || cached.fbc || null;
  var effectiveGaClientId = gaClientId || cached.ga_client_id || null;

  var addr = shippingAddress(checkout);
  var lineItems = buildLineItems(checkout);
  var value = totalValue(checkout);
  var curr = currency(checkout);
  var sourceUrl = getSourceUrl(event);
  var oid = orderId(checkout);
  var userData = {
    email: checkout.email || cached.email || null,
    phone: checkoutPhone(checkout, addr) || cached.phone || null,
    first_name: addr && (addr.firstName || addr.first_name) || cached.first_name || null,
    last_name: addr && (addr.lastName || addr.last_name) || cached.last_name || null,
    city: addr && addr.city || cached.city || null,
    state: addr && (addr.provinceCode || addr.province || addr.region) || cached.state || null,
    zip: addr && addr.zip || cached.zip || null,
    country_code: addr && (addr.countryCode || addr.country_code) || cached.country_code || null,
    date_of_birth: customerBirthday(checkout) || cached.date_of_birth || null,
    external_id: externalId || cached.external_id || null
  };

  // Browser-side Purchase — matches server event_id for dedup. This is THE
  // high-EMQ event; server-side alone gives lower match quality tier.
  var purchaseCustomData = {
    value: value,
    currency: curr,
    content_ids: contentIdsFromItems(lineItems),
    contents: contentsFromItems(lineItems),
    content_type: contentTypeFromItems(lineItems),
    num_items: sumQuantities(lineItems),
    order_id: oid
  };
  await fireBrowserPixelEvent("Purchase", "purchase_" + token, purchaseCustomData, userData, effectiveFbp, effectiveFbc, sourceUrl);
  auditBrowserEvent("Purchase", "purchase_" + token, eventTime, purchaseCustomData, userData, effectiveFbp, effectiveFbc, sourceUrl);

  send({
    event_type: "checkout_completed",
    event_time: eventTime,
    checkout_token: token,
    order_id: oid,
    external_id: userData.external_id,
    ga_client_id: effectiveGaClientId,
    fbc: effectiveFbc,
    fbp: effectiveFbp,
    email: userData.email,
    phone: userData.phone,
    first_name: userData.first_name,
    last_name: userData.last_name,
    city: userData.city,
    state: userData.state,
    zip: userData.zip,
    country_code: userData.country_code,
    date_of_birth: userData.date_of_birth,
    line_items: lineItems,
    value: value,
    currency: curr,
    source_url: sourceUrl
  });

  delete enrichment[token];
});
