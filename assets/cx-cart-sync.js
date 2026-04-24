/* ============================================================
 * CALQIX — Cart counter sync + add-to-cart wow cascade
 * ------------------------------------------------------------
 * Responsibilities:
 *   1. Mirror the header cart counter (#cart-icon-bubble
 *      .wt-header__panel__counter, owned by assets/cart-drawer.js)
 *      into the mobile bottom bar (#cx-bottom-cart-counter) so both
 *      badges always show the same number.
 *   2. When the count transitions upward (item added), trigger a
 *      short cinematic cascade on the bottom bar: glow burst,
 *      ripple ring, sparkle particles, icon squash, badge pop, and
 *      a gold sheen sweep. Everything is CSS-keyframed; this file
 *      only flips the `.cx-bb--cart-updated` class.
 *   3. Keep the persistent `.cx-bb--has-items` halo state in sync
 *      with cart.item_count > 0.
 *
 * Design constraints:
 *   - No hard dependency on pubsub.js. We listen to the theme's
 *     existing `cart-update` / `cart-drawer-open` custom events on
 *     `document` (dispatched by cart-drawer.js), AND attach a
 *     MutationObserver on the header counter as a belt-and-braces
 *     fallback covering every code path that mutates the count
 *     (inline quickshop, bundle-picker, addon forms, server pushes).
 *   - No raw PII or cart-content logging (per AGENTS.md guardrails).
 *   - Respects prefers-reduced-motion at the CSS layer; this JS only
 *     toggles classes so motion-reducers still get sync, just no
 *     flair.
 * ============================================================ */
(function () {
  'use strict';

  // ---------- DOM refs ----------
  //
  // Multiple mirrors allowed: the bottom bar badge (#cx-bottom-cart-counter)
  // is the headline "wow" consumer of this sync, but the cx-header mobile
  // topbar badge also opts in via `data-cx-cart-counter-mirror` so both
  // stay perfectly in step with the header source counter.

  var bar = document.getElementById('cx-bottom-bar'); // may be null on themes without cx-bottom-bar
  var mirrors = Array.prototype.slice.call(
    document.querySelectorAll('[data-cx-cart-counter-mirror]')
  );
  if (!mirrors.length) return;

  // Scope the cascade classes to the bottom bar only — other mirrors get
  // just the numeric/hidden sync, no wow animations.
  //
  // We track BOTH the wrapping anchor (`#cart-icon-bubble`) and the inner
  // counter span. cart-drawer.js fetches the `cart-icon-bubble` section
  // after every add-to-cart and replaces the wrapper's innerHTML, which
  // discards the original counter node — any MutationObserver attached to
  // the span directly would silently die on the first add. The wrapper
  // itself is stable so we observe that instead, and re-query the counter
  // every read.
  var headerWrap = document.getElementById('cart-icon-bubble');
  function getHeaderCounter() {
    if (headerWrap) {
      var inside = headerWrap.querySelector('.wt-header__panel__counter');
      if (inside) return inside;
    }
    return document.querySelector('.wt-header__panel__counter');
  }

  var UPDATE_CLASS = 'cx-bb--cart-updated';
  var HAS_ITEMS_CLASS = 'cx-bb--has-items';
  var UPDATE_RESET_MS = 1200;

  // ---------- Count helpers ----------

  function parseCount(value) {
    if (value == null) return 0;
    var n = parseInt(String(value).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function readHeaderCount() {
    var counter = getHeaderCounter();
    if (!counter) return 0;
    if (counter.hasAttribute('hidden')) return 0;
    return parseCount(counter.textContent);
  }

  function readMirrorCount() {
    // Use the first mirror as the read reference; all mirrors stay in
    // lockstep so reading one is enough.
    var ref = mirrors[0];
    if (!ref || ref.hasAttribute('hidden')) return 0;
    return parseCount(ref.textContent);
  }

  function setMirrorCount(next) {
    var safe = next < 0 ? 0 : next;
    mirrors.forEach(function (el) {
      el.textContent = String(safe);
      if (safe <= 0) {
        el.setAttribute('hidden', '');
      } else {
        el.removeAttribute('hidden');
      }
    });
    if (bar) {
      bar.classList.toggle(HAS_ITEMS_CLASS, safe > 0);
      // Keep aria-label fresh for the bottom-bar cart button
      var cartBtn = bar.querySelector('[data-cx-bb-cart]');
      if (cartBtn) {
        var base = (cartBtn.getAttribute('aria-label') || 'Cart').replace(/\s*\(\d+\)\s*$/, '');
        cartBtn.setAttribute('aria-label', base + ' (' + safe + ')');
      }
    }
  }

  // ---------- Cascade trigger ----------

  var cascadeTimer = null;
  function playCascade() {
    if (!bar) return; // no bottom bar present — nothing to animate
    // Restart animations cleanly by stripping + re-adding the class.
    bar.classList.remove(UPDATE_CLASS);
    // Force reflow so animation restarts if count flips twice quickly.
    // eslint-disable-next-line no-unused-expressions
    void bar.offsetWidth;
    bar.classList.add(UPDATE_CLASS);
    if (cascadeTimer) clearTimeout(cascadeTimer);
    cascadeTimer = setTimeout(function () {
      bar.classList.remove(UPDATE_CLASS);
    }, UPDATE_RESET_MS);
  }

  // ---------- Sync core ----------

  function sync(source) {
    var next = readHeaderCount();
    var prev = readMirrorCount();
    setMirrorCount(next);
    // Only fire the wow cascade on increases, never on decrements
    // (remove-from-cart should feel neutral).
    if (next > prev) {
      playCascade();
    }
    // Debug breadcrumb (non-PII): count delta + source. Left as a
    // console.debug so it only surfaces when devtools are filtered.
    try {
      if (window.Shopify && window.Shopify.designMode) {
        // eslint-disable-next-line no-console
        console.debug('[cx-cart-sync]', { prev: prev, next: next, source: source || 'direct' });
      }
    } catch (e) { /* noop */ }
  }

  // ---------- Mutation observer (reliable fallback) ----------
  //
  // Observe the wrapping #cart-icon-bubble container so we keep firing
  // even when cart-drawer.js swaps the innerHTML wholesale. Without
  // subtree:true the observer would only see immediate-child mutations
  // and miss text changes inside the rebuilt counter span.
  if (headerWrap && 'MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      sync('mutation');
    });
    mo.observe(headerWrap, {
      characterData: true,
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  // ---------- Theme events ----------

  document.addEventListener('cart-update', function () { sync('cart-update'); });
  document.addEventListener('cart-drawer-open', function () { sync('drawer-open'); });
  document.addEventListener('cart-drawer-close', function () { sync('drawer-close'); });

  // Wonder theme also uses `publish` from pubsub.js. If available,
  // hook that too so we don't rely on DOM events alone.
  try {
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      // eslint-disable-next-line no-undef
      subscribe(PUB_SUB_EVENTS.cartUpdate, function () { sync('pubsub'); });
    }
  } catch (e) { /* pubsub module not loaded — events path is enough */ }

  // ---------- Initial paint ----------

  sync('init');

  // ---------- Light API for ad-hoc triggers ----------

  window.cxBottomBar = {
    sync: function () { sync('api'); },
    pulse: playCascade
  };
})();
