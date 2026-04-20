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
  // Total budget: 600ms (rise 280ms + drop 320ms). This lets the tooth
  // finish landing BEFORE the cart drawer opens on average (Wonder's
  // drawer opens after /cart/add.js returns, typically 300-600ms).
  var FLY_RISE_MS = 280;
  var FLY_DROP_MS = 320;
  var FLY_TOTAL_MS = FLY_RISE_MS + FLY_DROP_MS;

  // Debounce: if fly() has played within this window, ignore subsequent
  // triggers for the same ATC so click + cartUpdate don't double-play.
  var lastFlyAt = 0;
  var FLY_DEBOUNCE_MS = 1500;

  // Cart-icon glow duration (ms). Starts at fly landing.
  var GLOW_MS = 1400;
  // Drawer "shiny" sheen duration (ms). Starts at cartDrawerOpen.
  var SHINY_MS = 2000;
  // Grace period (ms) to hold drawer visually back while the tooth is in flight.
  // If the drawer's `open` attribute is set before the tooth lands, CSS
  // (body.calqix-atc-flying) delays the drawer transform transition.
  var FLYING_BODY_CLASS = 'calqix-atc-flying';
  var GLOW_CLASS = 'calqix-cart-glow';
  var SHINY_CLASS = 'calqix-drawer-shiny';

  function fly(source) {
    var cartTarget = document.getElementById('cart-icon-bubble');
    if (!cartTarget || !source) return;

    var now = Date.now();
    if (now - lastFlyAt < FLY_DEBOUNCE_MS) return;
    lastFlyAt = now;

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

    // Signal to CSS that a fly is in progress. This lets the cart-drawer
    // transition-delay kick in so the drawer slide-in waits until the
    // tooth has landed, preserving the "tooth -> glow -> drawer" sequence
    // even when /cart/add.js returns faster than the fly (300-400ms).
    document.body.classList.add(FLYING_BODY_CLASS);

    // Reset & stage
    tooth.style.transition = 'none';
    tooth.style.transform = 'translate3d(' + startX + 'px, ' + startY + 'px, 0) scale(1) rotate(0deg)';
    tooth.style.opacity = '1';
    tooth.classList.add('calqix-flying-tooth--flying');
    // Force reflow to commit starting transform before transition kicks in
    /* eslint-disable no-unused-expressions */
    tooth.offsetWidth;
    /* eslint-enable no-unused-expressions */

    // Phase 1: rise to peak with slight rotate
    tooth.style.transition =
      'transform ' + FLY_RISE_MS + 'ms cubic-bezier(0.33, 0.02, 0.5, 0.5), opacity 140ms ease';
    tooth.style.transform =
      'translate3d(' + ((startX + endX) / 2) + 'px, ' + peakY + 'px, 0) scale(1.12) rotate(180deg)';

    // Phase 2: drop to cart + shrink
    window.setTimeout(function () {
      if (token !== flyingToken) return;
      tooth.style.transition =
        'transform ' + FLY_DROP_MS + 'ms cubic-bezier(0.55, 0.2, 0.8, 0.9), opacity 180ms ease ' + (FLY_DROP_MS - 180) + 'ms';
      tooth.style.transform =
        'translate3d(' + endX + 'px, ' + endY + 'px, 0) scale(0.2) rotate(360deg)';
      tooth.style.opacity = '0';
    }, FLY_RISE_MS);

    // Landing: glow the cart icon + release the drawer transition gate.
    window.setTimeout(function () {
      if (token !== flyingToken) return;
      document.body.classList.remove(FLYING_BODY_CLASS);
      cartTarget.classList.add(GLOW_CLASS);
      window.setTimeout(function () {
        cartTarget.classList.remove(GLOW_CLASS);
      }, GLOW_MS);
    }, FLY_TOTAL_MS);

    // Cleanup tooth element
    window.setTimeout(function () {
      if (token !== flyingToken) return;
      tooth.classList.remove('calqix-flying-tooth--flying');
      tooth.style.transition = 'none';
      tooth.style.transform = 'translate3d(0,0,0) scale(1) rotate(0deg)';
      tooth.style.opacity = '';
    }, FLY_TOTAL_MS + 100);
  }

  // ---------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------
  function start() {
    // Capture add-to-cart source at the button level (capture phase so we
    // always see it even if the product-form listener preventDefaults).
    document.addEventListener('pointerdown', captureSource, true);
    document.addEventListener('click', captureSource, true);

    // CRITICAL: trigger animation immediately on ATC click so the tooth
    // begins flying while the /cart/add.js request is still in flight.
    // This runs in parallel with Wonder's form submission (rule 7 of the
    // homepage spec) and ensures the tooth lands before the drawer opens.
    document.addEventListener('click', function onAtcClick(e) {
      if (!isAtcTrigger(e.target)) return;
      // Small RAF so we animate AFTER the button's visual press state
      // has been applied by any form handlers.
      window.requestAnimationFrame(function () {
        if (!lastSourceRect) return;
        fly(lastSourceRect);
        // CRITICAL: clear the captured source immediately so the
        // cartUpdate fallback below does NOT re-fire the animation when
        // /cart/add.js returns 300-900ms later. Without this, the user
        // sees a second tooth fly AFTER the drawer is already open.
        lastSourceRect = null;
        lastSourceCapturedAt = 0;
      });
    }, true);

    // Fallback: cartUpdate from Wonder (e.g. server-initiated refresh
    // or programmatic cart add without a standard ATC button click).
    // For normal ATC clicks this is a no-op because the click handler
    // nulls lastSourceRect above.
    subscribe(PUB_SUB_EVENTS.cartUpdate, function onCartUpdate() {
      var hasFreshSource =
        lastSourceRect &&
        Date.now() - lastSourceCapturedAt <= SOURCE_TTL_MS;
      if (!hasFreshSource) return;

      var source = lastSourceRect;
      lastSourceRect = null;
      fly(source);
    });

    // Premium drawer entrance: the moment Wonder opens the cart drawer,
    // brush a subtle sheen across it and let it fade back to normal after
    // SHINY_MS. Works regardless of whether the drawer opens mid-fly or
    // after the fly has landed (the body.calqix-atc-flying CSS gate holds
    // the drawer transform until the tooth arrives).
    if (PUB_SUB_EVENTS.cartDrawerOpen) {
      subscribe(PUB_SUB_EVENTS.cartDrawerOpen, function onDrawerOpen() {
        var drawer = document.querySelector('cart-drawer');
        if (!drawer) return;
        drawer.classList.add(SHINY_CLASS);
        window.setTimeout(function () {
          drawer.classList.remove(SHINY_CLASS);
        }, SHINY_MS);
      });
    }
  }

  init();
})();
