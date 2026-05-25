/**
 * CALQIX Meta CAPI Bridge v2
 *
 * 1. Persists fbclid from URL into _fbc cookie (Meta format)
 * 2. Reads _fbc and _fbp cookies set by the Meta pixel
 * 3. Stores them as Shopify cart attributes so checkout/order webhooks can forward them
 * 4. Fires server-side ViewContent and keeps cart identity attributes warm
 * 5. Provides event_id generation for browser pixel → server deduplication
 */
(function () {
  'use strict';

  // Bumped whenever this file changes in a way the server should care about.
  // Format: YYYY-MM-DD-<letter>. The server uses this to detect stuck theme
  // cache (see api/cron/bridge-version-check.js) — if an older version keeps
  // reporting in after a new one has gone live, Shopify's CDN or browser
  // caches are serving stale JS.
  var BRIDGE_VERSION = '2026-05-25-addtocart-parity-a';
  var ENABLE_THEME_ADD_TO_CART_META_FALLBACK = false;

  var CAPI_BASE = 'https://calqix-capi.vercel.app/api';
  var BROWSER_LEDGER_URL = CAPI_BASE + '/meta-browser-event';

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
    var secure = window.location && window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax' + secure;
  }

  function writeStorage(key, value) {
    if (!key || !value) return;
    try { localStorage.setItem(key, value); } catch (e) { /* silent */ }
    try { sessionStorage.setItem(key, value); } catch (e) { /* silent */ }
  }

  function readStorage(key) {
    if (!key) return null;
    try {
      var localValue = localStorage.getItem(key);
      if (localValue) return localValue;
    } catch (e) { /* silent */ }
    try {
      var sessionValue = sessionStorage.getItem(key);
      if (sessionValue) return sessionValue;
    } catch (e) { /* silent */ }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  fbclid → _fbc cookie persistence                                   */
  /* ------------------------------------------------------------------ */

  function persistFbclid() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fbclid = params.get('fbclid');
      if (fbclid) {
        writeStorage('_cq_fbclid', fbclid);
        var currentFbc = getCookie('_fbc') || readStorage('_cq_fbc');
        var fbc = currentFbc && currentFbc.indexOf('.' + fbclid) !== -1
          ? currentFbc
          : 'fb.1.' + Date.now() + '.' + fbclid;
        setCookie('_fbc', fbc, 90);
        writeStorage('_cq_fbc', fbc);
        return fbc;
      }
    } catch (e) { /* silent */ }
    return readStorage('_cq_fbc');
  }

  function getFbc() {
    return getCookie('_fbc') || persistFbclid();
  }

  function getFbp() {
    var existing = getCookie('_fbp') || readStorage('_cq_fbp');
    if (existing) {
      writeStorage('_cq_fbp', existing);
      return existing;
    }

    var randomPart = Math.floor(Math.random() * 10000000000);
    var generated = 'fb.1.' + Date.now() + '.' + randomPart;
    setCookie('_fbp', generated, 90);
    writeStorage('_cq_fbp', generated);
    return generated;
  }

  /* ------------------------------------------------------------------ */
  /*  Customer data extraction and first-party identity cache             */
  /* ------------------------------------------------------------------ */

  /**
   * Pull the customer's email from any first-party signal we have.
   *
   * Priority:
   *  1. Shopify globals (logged-in customer or checkout-resumed session)
   *  2. localStorage `_cq_known_email` (newsletter or lead form submitted earlier)
   *  3. Cookie `_cq_known_email` (cross-subdomain fallback)
   *
   * The localStorage/cookie path is what powers Fix #4 — EMQ boost for
   * non-logged-in repeat visitors. As soon as a visitor submits the newsletter
   * form (see `fireLead`), we cache the email here so every subsequent
   * ViewContent / AddToCart event includes it as `em` to Meta CAPI.
   */
  function getCustomerEmail() {
    try {
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

    var remembered = readKnownIdentity('email');
    if (remembered && remembered.indexOf('@') !== -1) return remembered;

    return null;
  }

  /**
   * Persist a normalized email to localStorage + cookie so getCustomerEmail()
   * can return it on every future page load. Idempotent.
   */
  function rememberEmail(email) {
    rememberIdentityField('email', email);
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
    return readKnownIdentity('phone');
  }

  function getCountryCode() {
    try {
      if (window.CALQIX_COUNTRY_CODE) {
        return window.CALQIX_COUNTRY_CODE;
      }
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
  function getGaClientId() {
    var ga = getCookie('_ga');
    if (!ga) return null;
    var match = String(ga).match(/^GA\d+\.\d+\.(.+)$/);
    return match ? match[1] : String(ga);
  }

  /* ------------------------------------------------------------------ */
  /*  Stable anonymous external_id (first-party, cross-session)          */
  /* ------------------------------------------------------------------ */

  var ANON_ID_KEY = '_cq_anon_id';
  var ANON_ID_COOKIE_DAYS = 365;

  // Fix #4 — cached email from newsletter / lead form, used to enrich
  // anonymous events. Same TTL as anon_id so they expire together.
  var KNOWN_EMAIL_KEY = '_cq_known_email';
  var KNOWN_IDENTITY_COOKIE_DAYS = 365;
  var KNOWN_EMAIL_COOKIE_DAYS = KNOWN_IDENTITY_COOKIE_DAYS;
  var KNOWN_IDENTITY_KEYS = {
    email: KNOWN_EMAIL_KEY,
    phone: '_cq_known_phone',
    first_name: '_cq_known_fn',
    last_name: '_cq_known_ln',
    city: '_cq_known_ct',
    state: '_cq_known_st',
    zip: '_cq_known_zp',
    country_code: '_cq_known_country',
    date_of_birth: '_cq_known_db'
  };

  function normalizeIdentityField(field, value) {
    var v = value === undefined || value === null ? '' : String(value).trim();
    if (!v) return '';
    if (field === 'email') {
      v = v.toLowerCase();
      return v.indexOf('@') !== -1 ? v : '';
    }
    if (field === 'phone') {
      v = v.replace(/[^\d]/g, '');
      return v.length >= 7 ? v : '';
    }
    if (field === 'date_of_birth') {
      v = v.replace(/[^\d]/g, '');
      return v.length === 8 ? v : '';
    }
    v = v.toLowerCase();
    if (field === 'city' || field === 'zip') v = v.replace(/\s+/g, '');
    return v;
  }

  function readKnownIdentity(field) {
    var key = KNOWN_IDENTITY_KEYS[field];
    if (!key) return null;
    return readStorage(key) || getCookie(key) || null;
  }

  function rememberIdentityField(field, value) {
    var key = KNOWN_IDENTITY_KEYS[field];
    if (!key) return;
    var normalized = normalizeIdentityField(field, value);
    if (!normalized) return;
    writeStorage(key, normalized);
    setCookie(key, normalized, KNOWN_IDENTITY_COOKIE_DAYS);
  }

  function rememberIdentityPayload(payload) {
    if (!payload) return;
    rememberIdentityField('email', payload.email || payload.em);
    rememberIdentityField('phone', payload.phone || payload.ph);
    rememberIdentityField('first_name', payload.first_name || payload.fn);
    rememberIdentityField('last_name', payload.last_name || payload.ln);
    rememberIdentityField('city', payload.city || payload.ct);
    rememberIdentityField('state', payload.state || payload.province || payload.province_code || payload.st);
    rememberIdentityField('zip', payload.zip || payload.postal_code || payload.zp);
    rememberIdentityField('country_code', payload.country_code || payload.country || payload.countryCode);
    rememberIdentityField('date_of_birth', payload.date_of_birth || payload.db);
  }

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
  var ATTR_EXTERNAL_ID = '_meta_external_id';
  var ATTR_DB = '_meta_db';
  var ATTR_ST = '_meta_st';
  var _lastCartAttributePayload = '';
  var _lastCartAttributeSyncAt = 0;

  function syncCartAttributes(options) {
    options = options || {};
    var fbc = getFbc();
    var fbp = getFbp();
    var externalId = getExternalId();
    var userPayload = buildUserPayload();

    if (!fbc && !fbp && !externalId && !userPayload.date_of_birth && !userPayload.state) return Promise.resolve(false);

    var attributes = {};
    if (fbc) attributes[ATTR_FBC] = fbc;
    if (fbp) attributes[ATTR_FBP] = fbp;
    if (externalId) attributes[ATTR_EXTERNAL_ID] = externalId;
    if (userPayload.date_of_birth) attributes[ATTR_DB] = userPayload.date_of_birth;
    if (userPayload.state) attributes[ATTR_ST] = userPayload.state;

    var body = JSON.stringify({ attributes: attributes });
    var now = Date.now();
    if (!options.force && body === _lastCartAttributePayload && now - _lastCartAttributeSyncAt < 10000) {
      return Promise.resolve(true);
    }
    _lastCartAttributePayload = body;
    _lastCartAttributeSyncAt = now;

    return fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      credentials: 'same-origin',
      keepalive: true
    }).then(function () {
      return true;
    }).catch(function () {
      return false;
    });
  }

  function primeTrackingForCartMutation() {
    persistFbclid();
    captureClickIds();
    getOrCreateAnonId();
    return syncCartAttributes({ force: true });
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
    var gaClientId = getGaClientId();
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
    if (gaClientId) data.ga_client_id = gaClientId;
    if (ttclid) data.ttclid = ttclid;
    if (ttp) data.ttp = ttp;
    var dl = window.dataLayer || [];
    for (var i = dl.length - 1; i >= 0; i--) {
      var entry = dl[i];
      if (entry && entry.event === 'calqix_user_data') {
        var cu = entry.user_data || entry;
        if (!data.email && cu.em) data.email = cu.em;
        if (!data.phone && cu.ph) data.phone = cu.ph;
        if (!data.external_id && cu.external_id) data.external_id = cu.external_id;
        if (cu.fn) data.first_name = cu.fn;
        if (cu.ln) data.last_name = cu.ln;
        if (cu.ct) data.city = cu.ct;
        if (cu.st || cu.province || cu.province_code) data.state = cu.st || cu.province || cu.province_code;
        if (cu.db || cu.date_of_birth) data.date_of_birth = cu.db || cu.date_of_birth;
        if (cu.zp || cu.zip || cu.postal_code) data.zip = cu.zp || cu.zip || cu.postal_code;
        if (!data.country_code && (cu.country || cu.country_code)) data.country_code = cu.country || cu.country_code;
        break;
      }
    }
    if (!data.first_name) data.first_name = readKnownIdentity('first_name');
    if (!data.last_name) data.last_name = readKnownIdentity('last_name');
    if (!data.city) data.city = readKnownIdentity('city');
    if (!data.state) data.state = readKnownIdentity('state');
    if (!data.date_of_birth) data.date_of_birth = readKnownIdentity('date_of_birth');
    if (!data.zip) data.zip = readKnownIdentity('zip');
    if (!data.country_code) data.country_code = readKnownIdentity('country_code');
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

  function auditBrowserEvent(eventName, eventId, customData, userPayload) {
    postKeepAlive(BROWSER_LEDGER_URL, {
      event_name: eventName,
      event_id: eventId,
      event_time: Math.floor(Date.now() / 1000),
      pixel_id: '934134615770602',
      source: 'theme_bridge_fbq',
      source_url: window.location.href,
      identity_flags: {
        em: Boolean(userPayload && userPayload.email),
        ph: Boolean(userPayload && userPayload.phone),
        fn: Boolean(userPayload && userPayload.first_name),
        ln: Boolean(userPayload && userPayload.last_name),
        ct: Boolean(userPayload && userPayload.city),
        st: Boolean(userPayload && userPayload.state),
        zp: Boolean(userPayload && userPayload.zip),
        country: Boolean(userPayload && userPayload.country_code),
        db: Boolean(userPayload && userPayload.date_of_birth),
        external_id: Boolean(userPayload && userPayload.external_id),
        fbp: Boolean(userPayload && userPayload.fbp),
        fbc: Boolean(userPayload && userPayload.fbc),
        client_user_agent: Boolean(navigator && navigator.userAgent)
      },
      custom_data_flags: {
        value: Boolean(customData && customData.value !== undefined && customData.value !== null),
        currency: Boolean(customData && customData.currency),
        content_ids: Boolean(customData && Array.isArray(customData.content_ids) && customData.content_ids.length),
        contents: Boolean(customData && Array.isArray(customData.contents) && customData.contents.length),
        order_id: Boolean(customData && customData.order_id)
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  ViewContent – auto-fire on product pages                           */
  /* ------------------------------------------------------------------ */

  function fireViewContent() {
    var meta = document.querySelector('meta[property="og:type"][content="product"]');
    if (!meta) return;

    var productData = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    if (!productData) return;

    var eventId = generateEventId('vc', String(productData.id || ''));
    var firstVariant = (productData.variants && productData.variants[0]) || null;
    var price = firstVariant && firstVariant.price ? (parseFloat(firstVariant.price) / 100) : undefined;
    var variantId = firstVariant && firstVariant.id ? String(firstVariant.id) : undefined;
    var sku = firstVariant && firstVariant.sku ? String(firstVariant.sku) : undefined;
    var parentId = productData.id ? String(productData.id) : '';

    // Meta Commerce catalog is matched on Shopify variant_id first. Keep SKU as
    // an additional retailer_id candidate when present.
    var catalogIds = [];
    if (variantId) catalogIds.push(variantId);
    if (sku && catalogIds.indexOf(sku) === -1) catalogIds.push(sku);
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
      first_name: userPayload.first_name || undefined,
      last_name: userPayload.last_name || undefined,
      city: userPayload.city || undefined,
      state: userPayload.state || undefined,
      date_of_birth: userPayload.date_of_birth || undefined,
      zip: userPayload.zip || undefined,
      external_id: userPayload.external_id || undefined,
      country_code: userPayload.country_code || undefined,
      ga_client_id: userPayload.ga_client_id || undefined,
      source_url: window.location.href,
      browser_user_agent: navigator.userAgent || undefined,
      event_time: Math.floor(Date.now() / 1000)
    };

    postKeepAlive(CAPI_BASE + '/view-content', payload);

    if (typeof fbq === 'function') {
      var viewContentContents = catalogIds.length > 0 ? [{
        id: catalogIds[0],
        quantity: 1
      }] : undefined;
      if (viewContentContents && price !== undefined) {
        viewContentContents[0].item_price = price;
      }
      var viewContentData = {
        content_ids: catalogIds,
        content_type: contentType,
        contents: viewContentContents,
        content_name: payload.product_title,
        value: price,
        currency: payload.currency
      };
      fbq('track', 'ViewContent', viewContentData, { eventID: eventId });
      auditBrowserEvent('ViewContent', eventId, viewContentData, userPayload);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  AddToCart – server-side event with fbc/fbp/email                   */
  /* ------------------------------------------------------------------ */

  var _atcRecent = {};

  function fireAddToCart(detail) {
    if (!detail) return;

    var items = detail.items || (detail.item ? [detail.item] : []);
    if (items.length === 0 && detail.id) items = [detail];

    // Shopify AJAX cart line_item shape:
    //   id         = variant_id  (what Shopify calls "id" on add-to-cart payload)
    //   product_id = parent product id
    //   sku        = variant SKU (when set)
    // For Meta Commerce catalog matching we send Shopify variant_id first.
    // SKU is also kept when present; product_id is only a final fallback.
    var contentIds = [];
    var seen = Object.create(null);
    var contents = [];
    var totalValue = 0;
    var hasVariantSignal = false;

    items.forEach(function (item) {
      var variantId = item.id != null && item.id !== '' ? String(item.id) : null;
      var sku = item.sku ? String(item.sku) : null;
      var productIdStr = item.product_id != null && item.product_id !== '' ? String(item.product_id) : null;

      var primary = variantId || sku || productIdStr;
      if (!primary) return;
      if (variantId || sku) hasVariantSignal = true;
      if (variantId && !seen[variantId]) { seen[variantId] = true; contentIds.push(variantId); }
      if (sku && !seen[sku]) { seen[sku] = true; contentIds.push(sku); }
      if (!variantId && !sku && productIdStr && !seen[productIdStr]) { seen[productIdStr] = true; contentIds.push(productIdStr); }

      var qty = parseInt(item.quantity, 10) || 1;
      var price = parseFloat(item.price) || 0;
      if (price > 100) price = price / 100;
      contents.push({ id: primary, quantity: qty, item_price: price });
      totalValue += price * qty;
    });

    if (contentIds.length === 0) return;

    var dedupKey = contentIds.join('|') + ':' + contents.map(function (item) {
      return item.id + 'x' + item.quantity;
    }).join('|');
    var now = Date.now();
    if (_atcRecent[dedupKey] && now - _atcRecent[dedupKey] < 2500) return;
    _atcRecent[dedupKey] = now;

    var contentType = hasVariantSignal ? 'product' : 'product_group';
    var eventId = generateEventId('atc', contentIds[0]);
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
      first_name: userPayload.first_name || undefined,
      last_name: userPayload.last_name || undefined,
      city: userPayload.city || undefined,
      state: userPayload.state || undefined,
      date_of_birth: userPayload.date_of_birth || undefined,
      zip: userPayload.zip || undefined,
      external_id: userPayload.external_id || undefined,
      country_code: userPayload.country_code || undefined,
      ga_client_id: userPayload.ga_client_id || undefined,
      source_url: window.location.href,
      browser_user_agent: navigator.userAgent || undefined,
      event_time: Math.floor(Date.now() / 1000)
    };

    if (ENABLE_THEME_ADD_TO_CART_META_FALLBACK) {
      payload.source = 'theme_bridge_fallback';
      postKeepAlive(CAPI_BASE + '/add-to-cart', payload);

      if (typeof fbq === 'function') {
        var addToCartData = {
          content_ids: contentIds,
          content_type: contentType,
          contents: contents,
          value: payload.value,
          currency: currency
        };
        fbq('track', 'AddToCart', addToCartData, { eventID: eventId });
        auditBrowserEvent('AddToCart', eventId, addToCartData, userPayload);
      }
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
    // Checkout-stage InitiateCheckout is owned by the Shopify Custom Pixel
    // using ic_{checkout_token}. A cart-token IC here creates browser-only
    // noise that cannot deduplicate with the server checkout event.
    return null;
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
    // Fix #4: persist this email so anonymous ViewContent/AddToCart events
    // on subsequent pages include it as `em` (Meta EMQ boost).
    rememberEmail(email);

    var userPayload = buildUserPayload();
    var payload = {
      event_id: eventId,
      email: email,
      form_context: formContext || 'newsletter',
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      external_id: userPayload.external_id || undefined,
      date_of_birth: userPayload.date_of_birth || undefined,
      country_code: userPayload.country_code || undefined,
      ga_client_id: userPayload.ga_client_id || undefined,
      source_url: window.location.href
    };

    postKeepAlive(CAPI_BASE + '/lead', payload);

    if (typeof fbq === 'function') {
      var leadData = {
        content_name: formContext === 'newsletter' ? 'Newsletter Signup' : 'Lead Capture',
        content_category: formContext || 'newsletter'
      };
      fbq('track', 'Lead', leadData, { eventID: eventId });
      auditBrowserEvent('Lead', eventId, leadData, userPayload);
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
    // Tag every bridge-originated payload so the server-side version check
    // (api/cron/bridge-version-check.js) can detect stuck theme caches.
    if (payload && typeof payload === 'object' && !payload.bridge_version) {
      payload.bridge_version = BRIDGE_VERSION;
    }
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
      var urlString = '';
      try {
        urlString = typeof url === 'string' ? url : (url && url.url ? String(url.url) : String(url || ''));
      } catch (e) { urlString = ''; }

      if (urlString.indexOf('/cart/add') !== -1 && opts && opts.body) {
        var fetchThis = this;
        var fetchArgs = arguments;
        var sendAddRequest = function () {
          var promise = origFetch.apply(fetchThis, fetchArgs);
          promise.then(function (response) {
            if (response.ok) {
              response.clone().json().then(function (data) {
                fireAddToCart(data);
              }).catch(function () { /* silent */ });
            }
          }).catch(function () { /* silent */ });
          return promise;
        };

        return primeTrackingForCartMutation().then(sendAddRequest, sendAddRequest);
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
        primeTrackingForCartMutation();
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

  function interceptNativeAddToCartForms() {
    document.addEventListener('submit', function (evt) {
      var form = evt.target;
      if (!form || !form.getAttribute) return;
      var action = form.getAttribute('action') || '';
      if (action.indexOf('/cart/add') === -1 && action.indexOf('/cart/add.js') === -1) return;
      primeTrackingForCartMutation();
    }, true);
  }

  function handleCartUpdatePayload(data) {
    try {
      if (!data) return;
      if (data.cartData) {
        fireAddToCart(data.cartData);
        return;
      }
      if (data.detail && data.detail.cartData) {
        fireAddToCart(data.detail.cartData);
        return;
      }
      if (data.detail && data.detail.response) {
        fireAddToCart(data.detail.response);
      }
    } catch (e) { /* silent */ }
  }

  function interceptCartUpdateEvents() {
    document.addEventListener('cart-update', function (event) {
      handleCartUpdatePayload(event);
    });

    function trySubscribe() {
      try {
        if (typeof subscribe === 'function') {
          subscribe('cart-update', handleCartUpdatePayload);
          return;
        }
      } catch (e) { /* retry */ }
      if ((trySubscribe.tries = (trySubscribe.tries || 0) + 1) < 80) {
        setTimeout(trySubscribe, 250);
      }
    }
    trySubscribe();
  }

  /* ------------------------------------------------------------------ */
  /*  Identity capture — sends enrichment data to server on checkout     */
  /* ------------------------------------------------------------------ */

  function captureIdentity(fields) {
    var payload = buildUserPayload();
    payload.anon_id = getOrCreateAnonId();
    payload.bridge_version = BRIDGE_VERSION;

    // Merge additional fields (from checkout form, etc.)
    if (fields) {
      var keys = Object.keys(fields);
      for (var i = 0; i < keys.length; i++) {
        if (fields[keys[i]]) payload[keys[i]] = fields[keys[i]];
      }
    }
    rememberIdentityPayload(payload);

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
        if (co.email) {
          fields.email = co.email;
          // Fix #4: also cache so non-checkout pages keep using this email.
          rememberEmail(co.email);
        }
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

  function firstFieldValue(scope, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var input = scope.querySelector(selectors[i]);
        if (input && input.value) return input.value;
      } catch (e) { /* silent */ }
    }
    return null;
  }

  function collectIdentityFields(scope) {
    var root = scope && scope.querySelector ? scope : document;
    var fields = {};
    fields.email = firstFieldValue(root, [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]'
    ]);
    fields.phone = firstFieldValue(root, [
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[autocomplete="tel"]'
    ]);
    fields.first_name = firstFieldValue(root, [
      'input[name*="first_name" i]',
      'input[name*="firstname" i]',
      'input[name*="first-name" i]',
      'input[autocomplete="given-name"]'
    ]);
    fields.last_name = firstFieldValue(root, [
      'input[name*="last_name" i]',
      'input[name*="lastname" i]',
      'input[name*="last-name" i]',
      'input[autocomplete="family-name"]'
    ]);
    fields.city = firstFieldValue(root, [
      'input[name*="city" i]',
      'input[id*="city" i]',
      'input[autocomplete="address-level2"]'
    ]);
    fields.state = firstFieldValue(root, [
      'input[name*="province" i]',
      'input[name*="state" i]',
      'input[autocomplete="address-level1"]'
    ]);
    fields.zip = firstFieldValue(root, [
      'input[name*="zip" i]',
      'input[name*="postal" i]',
      'input[autocomplete="postal-code"]'
    ]);
    fields.country_code = firstFieldValue(root, [
      'select[name*="country" i]',
      'input[name*="country" i]',
      'select[autocomplete="country"]',
      'input[autocomplete="country"]'
    ]);

    Object.keys(fields).forEach(function (key) {
      if (!fields[key]) delete fields[key];
    });
    return fields;
  }

  var _identityCaptureTimer = null;
  function scheduleIdentityCapture(scope) {
    clearTimeout(_identityCaptureTimer);
    _identityCaptureTimer = setTimeout(function () {
      var fields = collectIdentityFields(scope);
      rememberIdentityPayload(fields);
      if (fields.email || fields.phone) captureIdentity(fields);
      pushUserDataToDataLayer();
    }, 250);
  }

  function interceptIdentityInputs() {
    var handler = function (evt) {
      var target = evt.target;
      if (!target || !target.matches || !target.matches('input, select, textarea')) return;
      scheduleIdentityCapture(target.form || document);
    };
    document.addEventListener('change', handler, true);
    document.addEventListener('blur', handler, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Expose public API                                                  */
  /* ------------------------------------------------------------------ */

  window.CALQIX_META_BRIDGE_VERSION = BRIDGE_VERSION;
  window.calqixMeta = {
    BRIDGE_VERSION: BRIDGE_VERSION,
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
    rememberIdentityPayload: rememberIdentityPayload,
    primeTrackingForCartMutation: primeTrackingForCartMutation,
    getGclid: getGclid,
    getGaClientId: getGaClientId,
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
      if (payload.date_of_birth) userData.db = payload.date_of_birth;
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
    pushUserDataToDataLayer();
    syncCartAttributes();
    fireViewContent();
    interceptAddToCart();
    interceptNativeAddToCartForms();
    interceptCartUpdateEvents();
    interceptCheckoutClicks();
    interceptLeadForms();
    interceptIdentityInputs();
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
