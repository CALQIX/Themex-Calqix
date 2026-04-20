/*
  CALQIX Flying-Tooth Cart Animation (Phase A)
  -------------------------------------------------------------
  Subscribes to Wonder's PUB_SUB_EVENTS.cartUpdate and launches a
  brief flying-tooth animation from the last-clicked add-to-cart
  button toward #cart-icon-bubble in the header.

  Design constraints honored:
  - Additive only. No modification to product-form.js or cart-drawer.js.
  - Zero tracking impact. No /cart.js refetch, no extra network calls.
  - Graceful degradation. If PUB_SUB_EVENTS / subscribe / target element
    are missing, the module is a silent no-op.
  - Respects prefers-reduced-motion: reduce.
  - Single flight at a time; rapid ATCs collapse into one animation.

  Depends on Wonder globals defined in assets/constants.js + pubsub.js
  (both load-ordered before this file in layout/theme.liquid).
*/

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (prefersReducedMotion && prefersReducedMotion.matches) return;

  // Wait for Wonder globals. They load with defer before us but we guard anyway.
  function ready() {
    if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS !== 'object') {
      // If Wonder has not yet defined these, retry on next tick until DOMContentLoaded.
      return false;
    }
    if (!PUB_SUB_EVENTS.cartUpdate) return false;
    return true;
  }

  function init() {
    if (!ready()) {
      document.addEventListener('DOMContentLoaded', function onReady() {
        if (!ready()) return;
        document.removeEventListener('DOMContentLoaded', onReady);
        start();
      });
      return;
    }
    start();
  }

  // ---------------------------------------------------------------
  // Source-button capture
  // ---------------------------------------------------------------
  // Remember the last interacted add-to-cart trigger so we know where
  // the tooth should launch from when cartUpdate fires.
  var lastSourceRect = null;
  var lastSourceCapturedAt = 0;
  var SOURCE_TTL_MS = 1500; // if no cartUpdate within 1.5s, discard

  function isAtcTrigger(el) {
    if (!el || !el.closest) return false;
    // Wonder's canonical add button and any variant we have seen on CALQIX
    return !!el.closest(
      'button[name="add"], ' +
      '.js-add-to-cart, ' +
      '.product-form__submit, ' +
      '.wt-product__add-to-cart_form button[type="submit"], ' +
      '[data-calqix-atc]'
    );
  }

  function captureSource(e) {
    var target = e.target;
    if (!isAtcTrigger(target)) return;
    var btn = target.closest(
      'button[name="add"], .js-add-to-cart, .product-form__submit, [data-calqix-atc]'
    ) || target;
    var rect = btn.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    lastSourceRect = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    lastSourceCapturedAt = Date.now();
  }

  // ---------------------------------------------------------------
  // Tooth element (singleton)
  // ---------------------------------------------------------------
  var toothEl = null;
  var flyingToken = 0;

  function ensureToothEl() {
    if (toothEl) return toothEl;
    toothEl = document.createElement('div');
    toothEl.className = 'calqix-flying-tooth';
    toothEl.setAttribute('aria-hidden', 'true');
    toothEl.innerHTML =
      '<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<radialGradient id="calqixToothGrad" cx="50%" cy="30%" r="70%">' +
            '<stop offset="0%" stop-color="#FFFFFF"/>' +
            '<stop offset="100%" stop-color="#E8DFC5"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<path d="M30 8C18 8 10 18 10 30c0 12 4 22 12 25 4 1 12 1 16 0 8-3 12-13 12-25 0-12-8-22-20-22z" ' +
          'fill="url(#calqixToothGrad)" stroke="#C9A84C" stroke-width="2"/>' +
        '<ellipse cx="22" cy="22" rx="3" ry="7" fill="#FFFFFF" opacity="0.8"/>' +
      '</svg>';
    document.body.appendChild(toothEl);
    return toothEl;
  }

  // ---------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------
  function fly(source) {
    var cartTarget = document.getElementById('cart-icon-bubble');
    if (!cartTarget || !source) return;

    var dstRect = cartTarget.getBoundingClientRect();
    if (!dstRect || (dstRect.width === 0 && dstRect.height === 0)) return;

    var tooth = ensureToothEl();
    var size = 56;
    var startX = source.x - size / 2;
    var startY = source.y - size / 2;
    var endX = dstRect.left + dstRect.width / 2 - size / 2;
    var endY = dstRect.top + dstRect.height / 2 - size / 2;

    // Arc peak: rise to max(startY - 120, 40px from viewport top)
    var peakY = Math.max(Math.min(startY, endY) - 120, 40);

    var token = ++flyingToken;

    // Reset & stage
    tooth.style.transition = 'none';
    tooth.style.transform = 'translate3d(' + startX + 'px, ' + startY + 'px, 0) scale(1) rotate(0deg)';
    tooth.classList.add('calqix-flying-tooth--flying');
    // Force reflow to commit starting transform before transition kicks in
    /* eslint-disable no-unused-expressions */
    tooth.offsetWidth;
    /* eslint-enable no-unused-expressions */

    // Phase 1: rise to peak (0 -> 500ms), slight rotate
    tooth.style.transition =
      'transform 500ms cubic-bezier(0.33, 0.02, 0.5, 0.5), opacity 150ms ease';
    tooth.style.transform =
      'translate3d(' + ((startX + endX) / 2) + 'px, ' + peakY + 'px, 0) scale(1.08) rotate(180deg)';

    // Phase 2: drop to cart + shrink (500ms -> 950ms)
    window.setTimeout(function () {
      if (token !== flyingToken) return;
      tooth.style.transition =
        'transform 450ms cubic-bezier(0.55, 0.2, 0.8, 0.9), opacity 180ms ease 270ms';
      tooth.style.transform =
        'translate3d(' + endX + 'px, ' + endY + 'px, 0) scale(0.2) rotate(360deg)';
      tooth.style.opacity = '0';
    }, 500);

    // Cleanup
    window.setTimeout(function () {
      if (token !== flyingToken) return;
      tooth.classList.remove('calqix-flying-tooth--flying');
      tooth.style.transition = 'none';
      tooth.style.transform = 'translate3d(0,0,0) scale(1) rotate(0deg)';
      tooth.style.opacity = '';
    }, 1050);
  }

  // ---------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------
  function start() {
    // Capture add-to-cart source at the button level (capture phase so we
    // always see it even if the product-form listener preventDefaults).
    document.addEventListener('pointerdown', captureSource, true);
    document.addEventListener('click', captureSource, true);

    subscribe(PUB_SUB_EVENTS.cartUpdate, function onCartUpdate() {
      // Only run if a recent source was captured; otherwise the update came
      // from quantity changes, cart-drawer add-ons, recovery, etc.
      var hasFreshSource =
        lastSourceRect &&
        Date.now() - lastSourceCapturedAt <= SOURCE_TTL_MS;
      if (!hasFreshSource) return;

      var source = lastSourceRect;
      lastSourceRect = null;
      fly(source);
    });
  }

  init();
})();
