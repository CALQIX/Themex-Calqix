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
    return getCookie('_fbp') || null;
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
    var customerId = getCustomerId();

    if (fbc) data.fbc = fbc;
    if (fbp) data.fbp = fbp;
    if (email) data.email = email;
    if (customerId) data.external_id = customerId;
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
    var price = productData.variants && productData.variants[0] && productData.variants[0].price
      ? (parseFloat(productData.variants[0].price) / 100)
      : undefined;

    var userPayload = buildUserPayload();
    var payload = {
      product_id: String(productData.id || ''),
      product_handle: productData.handle || '',
      product_title: productData.type || productData.handle || '',
      variant_id: productData.variants && productData.variants[0] ? String(productData.variants[0].id) : undefined,
      price: price,
      currency: window.Shopify && window.Shopify.currency && window.Shopify.currency.active || 'EUR',
      event_id: eventId,
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      email: userPayload.email || undefined,
      external_id: userPayload.external_id || undefined
    };

    fetch(CAPI_BASE + '/view-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () { /* silent */ });

    if (typeof fbq === 'function') {
      fbq('track', 'ViewContent', {
        content_ids: [payload.product_id],
        content_type: 'product_group',
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

    var contentIds = [];
    var contents = [];
    var totalValue = 0;

    items.forEach(function (item) {
      var id = String(item.product_id || item.id || '');
      if (id) contentIds.push(id);
      var qty = parseInt(item.quantity, 10) || 1;
      var price = parseFloat(item.price) || 0;
      if (price > 100) price = price / 100;
      contents.push({ id: id, quantity: qty, item_price: price });
      totalValue += price * qty;
    });

    if (contentIds.length === 0) return;

    var eventId = generateEventId('addtocart', contentIds[0]);
    var currency = window.Shopify && window.Shopify.currency && window.Shopify.currency.active || 'EUR';
    var userPayload = buildUserPayload();

    var payload = {
      event_id: eventId,
      content_ids: contentIds,
      content_type: 'product_group',
      contents: contents,
      value: Math.round(totalValue * 100) / 100,
      currency: currency,
      fbc: userPayload.fbc || undefined,
      fbp: userPayload.fbp || undefined,
      email: userPayload.email || undefined,
      external_id: userPayload.external_id || undefined,
      source_url: window.location.href
    };

    fetch(CAPI_BASE + '/add-to-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () { /* silent */ });

    if (typeof fbq === 'function') {
      fbq('track', 'AddToCart', {
        content_ids: contentIds,
        content_type: 'product_group',
        contents: contents,
        value: payload.value,
        currency: currency
      }, { eventID: eventId });
    }

    syncCartAttributes();
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
  /*  Expose public API                                                  */
  /* ------------------------------------------------------------------ */

  window.calqixMeta = {
    getCookie: getCookie,
    getFbc: getFbc,
    getFbp: getFbp,
    generateEventId: generateEventId,
    track: track,
    fireAddToCart: fireAddToCart,
    syncCartAttributes: syncCartAttributes,
    fireViewContent: fireViewContent,
    buildUserPayload: buildUserPayload
  };

  /* ------------------------------------------------------------------ */
  /*  Auto-init on page load                                             */
  /* ------------------------------------------------------------------ */

  function onReady() {
    persistFbclid();
    syncCartAttributes();
    fireViewContent();
    interceptAddToCart();
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
