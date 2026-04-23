/**
 * CALQIX Meta CAPI Bridge v2
 *
 * 1. Persists fbclid from URL into _fbc cookie (Meta format)
 * 2. Reads _fbc and _fbp cookies set by the Meta pixel
 * 3. Stores them as Shopify cart attributes so checkout/order webhooks can forward them
 * 4. Fires server-side ViewContent and AddToCart events with fbc/fbp/email for high match quality
 * 5. Provides event_id generation for browser pixel → server deduplication
 */
(function () {
  'use strict';

  var CAPI_BASE = 'https://calqix-capi.vercel.app/api';

  /* ------------------------------------------------------------------ */
  /*  Cookie helpers                                                     */
  /* ------------------------------------------------------------------ */

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var d = new Date();
      d.setTime(d.getTime() + days * 86400000);
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  }

  /* ------------------------------------------------------------------ */
  /*  fbclid → _fbc cookie persistence                                   */
  /* ------------------------------------------------------------------ */

  function persistFbclid() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fbclid = params.get('fbclid');
      if (fbclid) {
        var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
        setCookie('_fbc', fbc, 90);
        return fbc;
      }
    } catch (e) { /* silent */ }
    return null;
  }

  function getFbc() {
    return getCookie('_fbc') || persistFbclid();
  }

  function getFbp() {
    var existing = getCookie('_fbp');
    if (existing) return existing;

    // Generate fallback _fbp if Meta Pixel hasn't set it yet
    var fallback = 'fb.1.' + Date.now() + '.' + Math.floor(1000000000 + Math.random() * 9000000000);
    setCookie('_fbp', fallback, 90);
    return fallback;
  }

  /* ------------------------------------------------------------------ */
  /*  Customer data extraction (email from Shopify globals)              */
  /* ------------------------------------------------------------------ */

  function getCustomerEmail() {
    try {
      if (window.__st && window.__st.cid) {
        var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
        if (meta && meta.page && meta.page.customerId) return null;
      }
      if (window.meta && window.meta.customer && window.meta.customer.email) {
        return window.meta.customer.email;
      }
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerEmail) {
        return window.ShopifyAnalytics.meta.page.customerEmail;
      }
      if (window.__st && window.__st.em) {
        return window.__st.em;
      }
    } catch (e) { /* silent */ }
    return null;
  }

  function getCustomerId() {
    try {
      if (window.__st && window.__st.cid) return String(window.__st.cid);
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
        return String(window.ShopifyAnalytics.meta.page.customerId);
      }
    } catch (e) { /* silent */ }
    return null;
  }

  function getCustomerPhone() {
    try {
      if (window.meta && window.meta.customer && window.meta.customer.phone) {
        return window.meta.customer.phone;
      }
      if (window.__st && window.__st.ph) {
        return window.__st.ph;
      }
    } catch (e) { /* silent */ }
    return null;
  }

  function getCountryCode() {
    try {
      if (window.Shopify && window.Shopify.country) {
        return window.Shopify.country;
      }
      if (window.meta && window.meta.page && window.meta.page.countryCode) {
        return window.meta.page.countryCode;
      }
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.countryCode) {
        return window.ShopifyAnalytics.meta.page.countryCode;
      }
    } catch (e) { /* silent */ }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Multi-platform click ID capture                                    */
  /* ------------------------------------------------------------------ */

  function captureClickIds() {
    try {
      var params = new URLSearchParams(window.location.search);
      var gclid = params.get('gclid');
      var gbraid = params.get('gbraid');
      var wbraid = params.get('wbraid');
      var ttclid = params.get('ttclid');

      if (gclid) setCookie('_cq_gclid', gclid, 90);
      if (gbraid) setCookie('_cq_gbraid', gbraid, 90);
      if (wbraid) setCookie('_cq_wbraid', wbraid, 90);
      if (ttclid) setCookie('_cq_ttclid', ttclid, 90);
    } catch (e) { /* silent */ }
  }

  function getGclid() { return getCookie('_cq_gclid') || null; }
  function getGbraid() { return getCookie('_cq_gbraid') || null; }
  function getWbraid() { return getCookie('_cq_wbraid') || null; }
  function getTtclid() { return getCookie('_cq_ttclid') || null; }
  function getTtp() { return getCookie('_ttp') || null; }

  /* ------------------------------------------------------------------ */
  /*  Stable anonymous external_id (first-party, cross-session)          */
  /* ------------------------------------------------------------------ */

  var ANON_ID_KEY = '_cq_anon_id';
  var ANON_ID_COOKIE_DAYS = 365;

  function getOrCreateAnonId() {
    var existing = null;
    try { existing = localStorage.getItem(ANON_ID_KEY); } catch (e) { /* silent */ }
    if (!existing) existing = getCookie(ANON_ID_KEY);
    if (existing) return existing;

    var id = 'cq_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    try { localStorage.setItem(ANON_ID_KEY, id); } catch (e) { /* silent */ }
    setCookie(ANON_ID_KEY, id, ANON_ID_COOKIE_DAYS);
    return id;
  }

  function getExternalId() {
    var customerId = getCustomerId();
    if (customerId) return customerId;
    return getOrCreateAnonId();
  }

  /* ------------------------------------------------------------------ */
  /*  Cart attribute sync                                                */
  /* ------------------------------------------------------------------ */

  var ATTR_FBC = '_meta_fbc';
  var ATTR_FBP = '_meta_fbp';

  function syncCartAttributes() {
    var fbc = getFbc();
    var fbp = getFbp();

    if (!fbc && !fbp) return;

    var attributes = {};
    if (fbc) attributes[ATTR_FBC] = fbc;
    if (fbp) attributes[ATTR_FBP] = fbp;

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: attributes }),
      credentials: 'same-origin'
    }).catch(function () { /* silent */ });
  }

  /* ------------------------------------------------------------------ */
  /*  Event ID generation for deduplication                              */
  /* ------------------------------------------------------------------ */

  function generateEventId(prefix, identifier) {
    var ts = Math.floor(Date.now() / 1000);
    if (identifier) {
      return (prefix || 'evt') + '_' + identifier + '_' + ts;
    }
    var rand = Math.random().toString(36).substring(2, 10);
    return (prefix || 'evt') + '_' + ts + '_' + rand;
  }

  /* ------------------------------------------------------------------ */
  /*  Build common user_data payload for server events                   */
  /* ------------------------------------------------------------------ */

  function buildUserPayload() {
    var data = {};
    var fbc = getFbc();
    var fbp = getFbp();
    var email = getCustomerEmail();
    var phone = getCustomerPhone();
    var externalId = getExternalId();
    var countryCode = getCountryCode();
    var gclid = getGclid();
    var gbraid = getGbraid();
    var wbraid = getWbraid();
    var ttclid = getTtclid();
    var ttp = getTtp();

    if (fbc) data.fbc = fbc;
    if (fbp) data.fbp = fbp;
    if (email) data.email = email;
    if (phone) data.phone = phone;
    if (externalId) data.external_id = externalId;
    if (countryCode) data.country_code = countryCode;
    if (gclid) data.gclid = gclid;
    if (gbraid) data.gbraid = gbraid;
    if (wbraid) data.wbraid = wbraid;
    if (ttclid) data.ttclid = ttclid;
    if (ttp) data.ttp = ttp;
    return data;
  }

  /* ------------------------------------------------------------------ */
  /*  Browser pixel track wrapper with shared event_id                   */
  /* ------------------------------------------------------------------ */

  function track(eventName, customData, identifier) {
    if (typeof fbq !== 'function') return null;

    var eventId = generateEventId(eventName.toLowerCase(), identifier);

    fbq('track', eventName, customData || {}, { eventID: eventId });

    return eventId;
  }

  /* ------------------------------------------------------------------ */
  /*  ViewContent – auto-fire on product pages                           */
  /* ------------------------------------------------------------------ */

  function fireViewContent() {
    var meta = document.querySelector('meta[property="og:type"][content="product"]');
    if (!meta) return;

    var productData = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    if (!productData) return;

    var eventId = generateEventId('viewcontent', String(productData.id || ''));
    var firstVariant = (productData.variants && productData.variants[0]) || null;
    var price = firstVariant && firstVariant.price ? (parseFloat(firstVariant.price) / 100) : undefined;
    var variantId = firstVariant && firstVariant.id ? String(firstVariant.id) : undefined;
    var sku = firstVariant && firstVariant.sku ? String(firstVariant.sku) : undefined;
    var parentId = productData.id ? String(productData.id) : '';

    // Meta Commerce catalog matches against retailer_id (variant_id or SKU for
    // the CALQIX catalog). Emit catalog-aligned ids in priority order.
    var catalogIds = [];
    if (variantId) catalogIds.push(variantId);
    if (sku) catalogIds.push(sku);
    if (catalogIds.length === 0 && parentId) catalogIds.push(parentId);
    var contentType = (variantId || sku) ? 'product' : 'product_group';

    var userPayload = buildUserPayload();
    var payload = {
      product_id: parentId,
      product_handle: productData.handle || '',
      product_title: productData.type || productData.handle || '',
      variant_id: variantId,
      sku: sku,
      price: price,
      currency: window.Shopify && window.Shopify.currency && window.Shopify.currency.active || 'EUR',
      event_id: eventId,
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      email: userPayload.email || undefined,
      phone: userPayload.phone || undefined,
      external_id: userPayload.external_id || undefined,
      country_code: userPayload.country_code || undefined
    };

    postKeepAlive(CAPI_BASE + '/view-content', payload);

    if (typeof fbq === 'function') {
      fbq('track', 'ViewContent', {
        content_ids: catalogIds,
        content_type: contentType,
        content_name: payload.product_title,
        value: price,
        currency: payload.currency
      }, { eventID: eventId });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  AddToCart – server-side event with fbc/fbp/email                   */
  /* ------------------------------------------------------------------ */

  function fireAddToCart(detail) {
    if (!detail) return;

    var items = detail.items || (detail.item ? [detail.item] : []);
    if (items.length === 0 && detail.id) items = [detail];

    // Shopify AJAX cart line_item shape:
    //   id         = variant_id  (what Shopify calls "id" on add-to-cart payload)
    //   product_id = parent product id
    //   sku        = variant SKU (when set)
    // For Meta Commerce catalog matching we want variant_id + sku first;
    // product_id is only used when no variant-level id exists.
    var contentIds = [];
    var seen = Object.create(null);
    var contents = [];
    var totalValue = 0;
    var hasVariantSignal = false;

    items.forEach(function (item) {
      var variantId = item.id != null && item.id !== '' ? String(item.id) : null;
      var sku = item.sku ? String(item.sku) : null;
      var productIdStr = item.product_id != null && item.product_id !== '' ? String(item.product_id) : null;

      if (variantId || sku) hasVariantSignal = true;

      if (variantId && !seen[variantId]) { seen[variantId] = true; contentIds.push(variantId); }
      if (sku && !seen[sku]) { seen[sku] = true; contentIds.push(sku); }
      // product_id is only added if THIS item has no variant-level signal.
      if (!variantId && !sku && productIdStr && !seen[productIdStr]) {
        seen[productIdStr] = true;
        contentIds.push(productIdStr);
      }

      var primary = variantId || sku || productIdStr;
      if (!primary) return;

      var qty = parseInt(item.quantity, 10) || 1;
      var price = parseFloat(item.price) || 0;
      if (price > 100) price = price / 100;
      contents.push({ id: primary, quantity: qty, item_price: price });
      totalValue += price * qty;
    });

    if (contentIds.length === 0) return;

    var contentType = hasVariantSignal ? 'product' : 'product_group';
    var eventId = generateEventId('addtocart', contentIds[0]);
    var currency = window.Shopify && window.Shopify.currency && window.Shopify.currency.active || 'EUR';
    var userPayload = buildUserPayload();

    var payload = {
      event_id: eventId,
      content_ids: contentIds,
      content_type: contentType,
      contents: contents,
      value: Math.round(totalValue * 100) / 100,
      currency: currency,
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      email: userPayload.email || undefined,
      phone: userPayload.phone || undefined,
      external_id: userPayload.external_id || undefined,
      country_code: userPayload.country_code || undefined,
      source_url: window.location.href
    };

    postKeepAlive(CAPI_BASE + '/add-to-cart', payload);

    if (typeof fbq === 'function') {
      fbq('track', 'AddToCart', {
        content_ids: contentIds,
        content_type: contentType,
        contents: contents,
        value: payload.value,
        currency: currency
      }, { eventID: eventId });
    }

    syncCartAttributes();
  }

  /* ------------------------------------------------------------------ */
  /*  InitiateCheckout – browser event on "Check out" click              */
  /*                                                                    */
  /*  The server-side IC is already fired by Shopify Custom Pixel when  */
  /*  the /checkouts/* page loads (event_id = ic_{checkout_token}).     */
  /*  This browser-side fbq fires earlier (click time) so Meta sees a   */
  /*  browser signal for the IC funnel step. We use the cart token in   */
  /*  the eventID so multiple clicks on same cart dedupe client-side.   */
  /*  Cart token != checkout token, so these two will NOT dedup via     */
  /*  event_id; Meta falls back to FBP dedup (same browser, seconds     */
  /*  apart) which works reliably for the IC → IC pair.                 */
  /* ------------------------------------------------------------------ */

  var _icFiredForCart = null; // guard: one browser-IC per cart token per session

  function getCartToken() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)cart=([^;]+)/);
      if (m) return decodeURIComponent(m[1]).split('?')[0];
    } catch (e) { /* silent */ }
    return null;
  }

  function fireInitiateCheckout() {
    var cartToken = getCartToken();
    if (cartToken && _icFiredForCart === cartToken) return; // already fired this session
    _icFiredForCart = cartToken || 'anon_' + Date.now();

    var eventId = 'ic_cart_' + (cartToken ? cartToken.slice(0, 24) : Date.now().toString(36));
    var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'EUR';

    if (typeof fbq === 'function') {
      fbq('track', 'InitiateCheckout', {
        currency: currency
      }, { eventID: eventId });
    }
  }

  function interceptCheckoutClicks() {
    document.addEventListener('click', function (evt) {
      var target = evt.target;
      if (!target || !target.closest) return;
      // Match: any element with name="checkout", any <a href> to /checkout or /checkouts,
      // or any element carrying a data-checkout-trigger attribute.
      var trigger = target.closest(
        '[name="checkout"], a[href="/checkout"], a[href^="/checkouts"], [data-checkout-trigger]'
      );
      if (!trigger) return;
      fireInitiateCheckout();
    }, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Lead – newsletter / lightweight signup browser + server event     */
  /*                                                                    */
  /*  Browser eventID uses a client-side hash of the email so the       */
  /*  matching /api/lead call can reproduce it (server uses a           */
  /*  cryptographic sha256 of the same normalized email). Here we use a */
  /*  simpler but deterministic hash (email normalized lower-case)      */
  /*  truncated; the server does its own sha256 for the final eventID   */
  /*  written to Meta. The browser and server sha256 of the same        */
  /*  normalized email yield identical hex digests, so eventIDs match.  */
  /* ------------------------------------------------------------------ */

  var _leadFiredForEmail = {};

  function sha256Hex(str) {
    // Web Crypto async; callers must handle the returned Promise.
    return crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        var hex = '';
        var view = new Uint8Array(buf);
        for (var i = 0; i < view.length; i++) {
          hex += view[i].toString(16).padStart(2, '0');
        }
        return hex;
      });
  }

  function fireLead(email, formContext) {
    var norm = (email || '').trim().toLowerCase();
    if (!norm || norm.indexOf('@') === -1) return;
    if (_leadFiredForEmail[norm]) return; // session-local dedup
    _leadFiredForEmail[norm] = true;

    if (!window.crypto || !window.crypto.subtle) {
      // Older browsers: skip hashing, use timestamp-based eventID (no server match).
      var fallbackEid = 'lead_ns_t_' + Date.now().toString(36);
      sendLead(fallbackEid, norm, formContext);
      return;
    }

    sha256Hex(norm).then(function (hash) {
      var emailHash = hash.slice(0, 16);
      var eventId = 'lead_ns_' + emailHash;
      sendLead(eventId, norm, formContext, emailHash);
    }).catch(function () {
      var fallbackEid = 'lead_ns_t_' + Date.now().toString(36);
      sendLead(fallbackEid, norm, formContext);
    });
  }

  function sendLead(eventId, email, formContext, emailHash) {
    var userPayload = buildUserPayload();
    var payload = {
      event_id: eventId,
      email: email,
      form_context: formContext || 'newsletter',
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      external_id: userPayload.external_id || undefined,
      country_code: userPayload.country_code || undefined,
      source_url: window.location.href
    };

    postKeepAlive(CAPI_BASE + '/lead', payload);

    if (typeof fbq === 'function') {
      fbq('track', 'Lead', {
        content_name: formContext === 'newsletter' ? 'Newsletter Signup' : 'Lead Capture',
        content_category: formContext || 'newsletter'
      }, { eventID: eventId });
    }
  }

  function interceptLeadForms() {
    document.addEventListener('submit', function (evt) {
      var form = evt.target;
      if (!form || !(form instanceof HTMLFormElement)) return;

      // Newsletter forms: marked with class `newsletter-form` OR hidden input
      // contact[email]=newsletter (Shopify customer-form convention we use).
      var isNewsletter =
        form.classList.contains('newsletter-form') ||
        (form.querySelector('input[name="contact[email]"][value="newsletter"]') !== null);
      if (!isNewsletter) return;

      var emailInput = form.querySelector('input[type="email"], input[name="contact[email]"]:not([type="hidden"])');
      if (!emailInput || !emailInput.value) return;
      fireLead(emailInput.value, 'newsletter');
    }, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Unload-safe transport used by all CAPI bridge POSTs                */
  /* ------------------------------------------------------------------ */

  function postKeepAlive(url, payload) {
    var bodyStr = JSON.stringify(payload);

    // sendBeacon survives page navigation (native form submits, quick-add links).
    // Fallback: fetch with keepalive so the request completes during unload.
    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        var blob = new Blob([bodyStr], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) { /* fall through to fetch */ }

    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: true
      }).catch(function () { /* silent */ });
    } catch (e) { /* silent */ }
  }

  /* ------------------------------------------------------------------ */
  /*  Intercept add-to-cart form submissions                             */
  /* ------------------------------------------------------------------ */

  function interceptAddToCart() {
    var origFetch = window.fetch;
    window.fetch = function () {
      var url = arguments[0];
      var opts = arguments[1];

      if (typeof url === 'string' && url.indexOf('/cart/add') !== -1 && opts && opts.body) {
        var promise = origFetch.apply(this, arguments);
        promise.then(function (response) {
          if (response.ok) {
            response.clone().json().then(function (data) {
              fireAddToCart(data);
            }).catch(function () { /* silent */ });
          }
        }).catch(function () { /* silent */ });
        return promise;
      }

      return origFetch.apply(this, arguments);
    };

    var origXHROpen = XMLHttpRequest.prototype.open;
    var origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._calqixUrl = url;
      return origXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      if (xhr._calqixUrl && xhr._calqixUrl.indexOf('/cart/add') !== -1) {
        xhr.addEventListener('load', function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var data = JSON.parse(xhr.responseText);
              fireAddToCart(data);
            } catch (e) { /* silent */ }
          }
        });
      }
      return origXHRSend.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Native <form action="/cart/add"> submits (page-unloading)          */
  /* ------------------------------------------------------------------ */

  function buildDetailFromForm(form) {
    try {
      var fd = new FormData(form);
      var rawId = fd.get('id');
      if (!rawId) return null;
      var qty = parseInt(fd.get('quantity') || '1', 10) || 1;
      var priceAttr =
        form.getAttribute('data-product-price') ||
        (form.dataset && form.dataset.productPrice) ||
        null;
      var pidAttr =
        form.getAttribute('data-product-id') ||
        (form.dataset && form.dataset.productId) ||
        null;
      return {
        id: String(rawId),
        product_id: pidAttr ? String(pidAttr) : String(rawId),
        quantity: qty,
        price: priceAttr ? parseFloat(priceAttr) : 0
      };
    } catch (e) {
      return null;
    }
  }

  function interceptCartAddForms() {
    document.addEventListener('submit', function (evt) {
      var form = evt.target;
      if (!form || !(form instanceof HTMLFormElement)) return;
      var action = (form.getAttribute('action') || '').toString();
      if (action.indexOf('/cart/add') === -1) return;

      // AJAX forms (enctype typically absent, bridge's fetch/XHR hook catches
      // them). We only need to care about native posts that unload the page —
      // detect by the absence of "no-redirect" markers. Safe to always fire:
      // the server endpoint is idempotent via event_id dedup and the browser
      // fbq call also dedups on the same eventID.
      var detail = buildDetailFromForm(form);
      if (detail) fireAddToCart(detail);
    }, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Identity capture — sends enrichment data to server on checkout     */
  /* ------------------------------------------------------------------ */

  function captureIdentity(fields) {
    var payload = buildUserPayload();
    payload.anon_id = getOrCreateAnonId();

    // Merge additional fields (from checkout form, etc.)
    if (fields) {
      var keys = Object.keys(fields);
      for (var i = 0; i < keys.length; i++) {
        if (fields[keys[i]]) payload[keys[i]] = fields[keys[i]];
      }
    }

    // Get cart token from Shopify
    try {
      if (window.Shopify && window.Shopify.checkout && window.Shopify.checkout.token) {
        payload.cart_token = window.Shopify.checkout.token;
      }
    } catch (e) { /* silent */ }

    fetch(CAPI_BASE + '/identity/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () { /* silent */ });
  }

  // Auto-capture identity when Shopify checkout fields are available
  function autoIdentityCapture() {
    try {
      if (window.Shopify && window.Shopify.checkout) {
        var co = window.Shopify.checkout;
        var fields = {};
        if (co.email) fields.email = co.email;
        if (co.shipping_address) {
          var sa = co.shipping_address;
          if (sa.first_name) fields.first_name = sa.first_name;
          if (sa.last_name) fields.last_name = sa.last_name;
          if (sa.phone) fields.phone = sa.phone;
          if (sa.city) fields.city = sa.city;
          if (sa.zip) fields.zip = sa.zip;
          if (sa.province_code) fields.province_code = sa.province_code;
          if (sa.country_code) fields.country_code = sa.country_code;
        }
        if (Object.keys(fields).length > 0) {
          captureIdentity(fields);
        }
      }
    } catch (e) { /* silent */ }
  }

  /* ------------------------------------------------------------------ */
  /*  Expose public API                                                  */
  /* ------------------------------------------------------------------ */

  window.calqixMeta = {
    getCookie: getCookie,
    getFbc: getFbc,
    getFbp: getFbp,
    getExternalId: getExternalId,
    getCountryCode: getCountryCode,
    generateEventId: generateEventId,
    track: track,
    fireAddToCart: fireAddToCart,
    syncCartAttributes: syncCartAttributes,
    fireViewContent: fireViewContent,
    fireInitiateCheckout: fireInitiateCheckout,
    fireLead: fireLead,
    buildUserPayload: buildUserPayload,
    captureIdentity: captureIdentity,
    getGclid: getGclid,
    getTtclid: getTtclid
  };

  /* ------------------------------------------------------------------ */
  /*  dataLayer push for Meta Pixel Advanced Matching (anonymous users)  */
  /* ------------------------------------------------------------------ */

  function pushUserDataToDataLayer() {
    try {
      window.dataLayer = window.dataLayer || [];
      // If the Liquid layer already pushed logged-in user_data, skip to avoid
      // overwriting richer customer identity with anon_id-only data.
      var alreadyPushed = window.dataLayer.some(function (entry) {
        return entry && entry.event === 'calqix_user_data';
      });
      if (alreadyPushed) return;

      var payload = buildUserPayload();
      var externalId = payload.external_id;
      if (!externalId) return;

      var userData = { external_id: externalId };
      if (payload.email) userData.em = payload.email;
      if (payload.phone) userData.ph = payload.phone;
      if (payload.country_code) userData.country = payload.country_code;

      window.dataLayer.push({
        event: 'calqix_user_data',
        user_data: userData
      });
    } catch (e) { /* silent */ }
  }

  function onReady() {
    persistFbclid();
    captureClickIds();
    getOrCreateAnonId();
    getFbp(); // Ensures _fbp fallback is generated if missing
    pushUserDataToDataLayer();
    syncCartAttributes();
    fireViewContent();
    interceptAddToCart();
    interceptCartAddForms();
    interceptCheckoutClicks();
    interceptLeadForms();
    autoIdentityCapture();

    // Retry fbp sync after Meta Pixel loads (it may set _fbp after bridge init)
    setTimeout(function () {
      var fbp = getFbp();
      if (fbp) syncCartAttributes();
      autoIdentityCapture();
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  document.addEventListener('cart:updated', syncCartAttributes);
  document.addEventListener('ajaxProduct:added', function (e) {
    syncCartAttributes();
    if (e && e.detail) fireAddToCart(e.detail);
  });
})();
