/**
 * CALQIX Meta CAPI Bridge
 *
 * 1. Reads _fbc and _fbp cookies set by the Meta pixel
 * 2. Stores them as Shopify cart attributes so server-side webhooks can forward them
 * 3. Provides event_id generation for browser pixel → server deduplication
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Cookie helpers                                                     */
  /* ------------------------------------------------------------------ */

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  /* ------------------------------------------------------------------ */
  /*  Cart attribute sync                                                */
  /* ------------------------------------------------------------------ */

  var ATTR_FBC = '_meta_fbc';
  var ATTR_FBP = '_meta_fbp';

  function getFbcFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fbclid = params.get('fbclid');
      if (fbclid) return 'fb.1.' + Date.now() + '.' + fbclid;
    } catch (e) { /* silent */ }
    return null;
  }

  function syncCartAttributes() {
    var fbc = getCookie('_fbc') || getFbcFromUrl();
    var fbp = getCookie('_fbp');

    if (!fbc && !fbp) return;

    var attributes = {};
    if (fbc) attributes[ATTR_FBC] = fbc;
    if (fbp) attributes[ATTR_FBP] = fbp;

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: attributes }),
      credentials: 'same-origin'
    }).catch(function () {
      /* silent – non-critical */
    });
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

  /**
   * Wraps fbq('track', ...) with a shared event_id so the server-side
   * event can be deduplicated against this browser event.
   *
   * Usage:
   *   window.calqixMeta.track('ViewContent', { content_ids: ['123'] }, '123');
   *   window.calqixMeta.track('AddToCart', { content_ids: ['456'] }, '456');
   */
  function track(eventName, customData, identifier) {
    if (typeof fbq !== 'function') return null;

    var eventId = generateEventId(eventName.toLowerCase(), identifier);

    fbq('track', eventName, customData || {}, { eventID: eventId });

    return eventId;
  }

  /* ------------------------------------------------------------------ */
  /*  ViewContent – auto-fire on product pages                           */
  /* ------------------------------------------------------------------ */

  var VIEW_CONTENT_ENDPOINT = 'https://calqix-capi.vercel.app/api/view-content';

  function fireViewContent() {
    var meta = document.querySelector('meta[property="og:type"][content="product"]');
    if (!meta) return;

    var productData = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    if (!productData) return;

    var eventId = generateEventId('viewcontent', String(productData.id || ''));
    var price = productData.variants && productData.variants[0] && productData.variants[0].price
      ? (parseFloat(productData.variants[0].price) / 100)
      : undefined;

    var payload = {
      product_id: String(productData.id || ''),
      product_handle: productData.handle || '',
      product_title: productData.type || productData.handle || '',
      variant_id: productData.variants && productData.variants[0] ? String(productData.variants[0].id) : undefined,
      price: price,
      currency: window.Shopify && window.Shopify.currency && window.Shopify.currency.active || 'EUR',
      event_id: eventId,
      fbc: getCookie('_fbc') || getFbcFromUrl() || undefined,
      fbp: getCookie('_fbp') || undefined
    };

    fetch(VIEW_CONTENT_ENDPOINT, {
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
  /*  Expose public API                                                  */
  /* ------------------------------------------------------------------ */

  window.calqixMeta = {
    getCookie: getCookie,
    generateEventId: generateEventId,
    track: track,
    syncCartAttributes: syncCartAttributes,
    fireViewContent: fireViewContent
  };

  /* ------------------------------------------------------------------ */
  /*  Auto-sync on page load                                             */
  /* ------------------------------------------------------------------ */

  function onReady() {
    syncCartAttributes();
    fireViewContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  /* Re-sync when cart is updated (e.g. after add-to-cart) */
  document.addEventListener('cart:updated', syncCartAttributes);
  document.addEventListener('ajaxProduct:added', syncCartAttributes);
})();
