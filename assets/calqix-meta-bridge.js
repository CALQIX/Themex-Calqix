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

  function syncCartAttributes() {
    var fbc = getCookie('_fbc');
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

  function generateEventId(prefix) {
    var ts = Date.now();
    var rand = Math.random().toString(36).substring(2, 10);
    return (prefix || 'evt') + '_' + ts + '_' + rand;
  }

  /**
   * Wraps fbq('track', ...) with a shared event_id so the server-side
   * event can be deduplicated against this browser event.
   *
   * Usage:
   *   window.calqixMeta.track('Purchase', { value: 39.95, currency: 'EUR' });
   */
  function track(eventName, customData) {
    if (typeof fbq !== 'function') return null;

    var eventId = generateEventId(eventName.toLowerCase());

    fbq('track', eventName, customData || {}, { eventID: eventId });

    return eventId;
  }

  /* ------------------------------------------------------------------ */
  /*  Expose public API                                                  */
  /* ------------------------------------------------------------------ */

  window.calqixMeta = {
    getCookie: getCookie,
    generateEventId: generateEventId,
    track: track,
    syncCartAttributes: syncCartAttributes
  };

  /* ------------------------------------------------------------------ */
  /*  Auto-sync on page load                                             */
  /* ------------------------------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncCartAttributes);
  } else {
    syncCartAttributes();
  }

  /* Re-sync when cart is updated (e.g. after add-to-cart) */
  document.addEventListener('cart:updated', syncCartAttributes);
  document.addEventListener('ajaxProduct:added', syncCartAttributes);
})();
