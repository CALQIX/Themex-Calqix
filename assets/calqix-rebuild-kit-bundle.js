/*
 * CALQIX Rebuild Kit Bundle — state machine
 * ------------------------------------------------------------
 * Owns the dynamic behaviour of:
 *   - the in-drawer Rebuild Kit banner (data-cq-rk-banner)
 *   - the FlowCore flavor picker modal (data-cq-rk-picker)
 *   - the combi-active savings badge (data-cq-rk-combi-badge)
 *
 * Visibility rules (all configurable per setting):
 *   1. cart must have at least one item
 *   2. last cartUpdate must have happened within POST_ATC_WINDOW_MS
 *   3. customer must not have already used the banner this session
 *      (unless the bundle was later broken again, which re-arms it)
 *   4. the bundle must not already be complete
 *
 * The actual 30% discount is applied server-side by a Shopify
 * 'Buy X Get Y' automatic discount configured in Shopify Admin.
 * This script never manipulates prices — it is pure UI glue.
 */
(function () {
  'use strict';

  var POST_ATC_WINDOW_MS = 12000;
  var SESSION_USED_KEY = 'cq_rk_used';
  var SESSION_COMBI_SEEN_KEY = 'cq_rk_combi_seen';
  var LAST_ATC_KEY = 'cq_rk_last_atc_at';

  // -- Config -----------------------------------------------------------

  function readConfig() {
    var el = document.querySelector('[data-cq-rk-banner]');
    if (!el) return null;
    try {
      return JSON.parse(el.getAttribute('data-cq-rk-config') || '{}');
    } catch (e) {
      return null;
    }
  }

  // -- Session helpers --------------------------------------------------

  function sget(k) {
    try { return window.sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function sset(k, v) {
    try { window.sessionStorage.setItem(k, v); } catch (e) {}
  }
  function sdel(k) {
    try { window.sessionStorage.removeItem(k); } catch (e) {}
  }

  // -- Cart helpers -----------------------------------------------------

  var cartCache = null;

  function fetchCart() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (c) { cartCache = c; return c; })
      .catch(function () { return null; });
  }

  function cartHasHandle(cart, handle) {
    if (!cart || !cart.items || !handle) return false;
    for (var i = 0; i < cart.items.length; i++) {
      if (cart.items[i].handle === handle) return true;
      if (cart.items[i].product_id && cart.items[i].url && cart.items[i].url.indexOf('/products/' + handle) !== -1) return true;
    }
    return false;
  }

  function cartHasCollection(cart, collectionHandle) {
    // Line items don't carry collection info. We approximate by
    // checking if any line item URL contains the handle prefix,
    // but primarily rely on a fetched collection product list cache.
    if (!cart || !cart.items) return false;
    var handles = flavorHandlesCache;
    if (!handles) return false;
    for (var i = 0; i < cart.items.length; i++) {
      if (handles.indexOf(cart.items[i].handle) !== -1) return true;
    }
    return false;
  }

  var flavorHandlesCache = null;
  function fetchFlavorHandles(collectionHandle) {
    if (flavorHandlesCache) return Promise.resolve(flavorHandlesCache);
    return fetch('/collections/' + encodeURIComponent(collectionHandle) + '/products.json?limit=50', {
      credentials: 'same-origin'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        flavorHandlesCache = (j.products || []).map(function (p) { return p.handle; });
        return flavorHandlesCache;
      })
      .catch(function () {
        flavorHandlesCache = [];
        return flavorHandlesCache;
      });
  }

  // -- State evaluation -------------------------------------------------

  function evaluate(config, cart) {
    var result = {
      hasOralbiome: cartHasHandle(cart, config.oralbiomeHandle),
      hasFlavor: cartHasCollection(cart, config.flavorCollection),
      itemCount: cart ? cart.item_count : 0
    };
    result.combiComplete = result.hasOralbiome && result.hasFlavor;

    // If the combi was once complete this session and is now broken,
    // re-arm the banner (reset the "used" flag) so customers who removed
    // something get another chance to re-bundle.
    var combiSeen = sget(SESSION_COMBI_SEEN_KEY) === '1';
    if (result.combiComplete && !combiSeen) {
      sset(SESSION_COMBI_SEEN_KEY, '1');
    }
    if (!result.combiComplete && combiSeen) {
      // Bundle was broken — allow banner to reappear
      sdel(SESSION_USED_KEY);
      sset(SESSION_COMBI_SEEN_KEY, '0');
    }

    var lastAtc = parseInt(sget(LAST_ATC_KEY) || '0', 10);
    var postAtcFresh = (Date.now() - lastAtc) < POST_ATC_WINDOW_MS;

    var used = sget(SESSION_USED_KEY) === '1';

    result.bannerShouldShow =
      (!config.requireCartNotEmpty || result.itemCount > 0) &&
      (!config.requirePostAtc || postAtcFresh) &&
      (!config.oncePerSession || !used) &&
      !result.combiComplete;

    return result;
  }

  // -- DOM painting -----------------------------------------------------

  function showBanner(el) {
    if (!el || !el.hasAttribute('hidden')) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    // Trigger entrance animation by adding the class on the next frame
    window.requestAnimationFrame(function () {
      el.classList.add('cq-rk-banner--in');
    });
  }

  function hideBanner(el) {
    if (!el || el.hasAttribute('hidden')) return;
    el.classList.remove('cq-rk-banner--in');
    el.setAttribute('aria-hidden', 'true');
    // Delay hidden attribute so the exit transition can complete
    window.setTimeout(function () {
      el.hidden = true;
    }, 220);
  }

  function showCombiBadge(el) {
    if (!el) return;
    if (el.hasAttribute('hidden')) {
      el.hidden = false;
      window.requestAnimationFrame(function () {
        el.classList.add('cq-rk-combi-badge--in');
      });
    }
  }

  function hideCombiBadge(el) {
    if (!el || el.hasAttribute('hidden')) return;
    el.classList.remove('cq-rk-combi-badge--in');
    window.setTimeout(function () { el.hidden = true; }, 220);
  }

  // -- Modal ------------------------------------------------------------

  var lastFocusedBeforeModal = null;

  function openPicker() {
    var picker = document.querySelector('[data-cq-rk-picker]');
    if (!picker) return;
    lastFocusedBeforeModal = document.activeElement;
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cq-rk-picker-open');
    window.requestAnimationFrame(function () {
      picker.classList.add('cq-rk-picker--in');
    });
    // Focus first focusable card button
    var firstBtn = picker.querySelector('[data-cq-rk-add]:not([disabled])');
    if (firstBtn) firstBtn.focus({ preventScroll: true });
  }

  function closePicker() {
    var picker = document.querySelector('[data-cq-rk-picker]');
    if (!picker || picker.hidden) return;
    picker.classList.remove('cq-rk-picker--in');
    picker.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cq-rk-picker-open');
    window.setTimeout(function () {
      picker.hidden = true;
      if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
        try { lastFocusedBeforeModal.focus({ preventScroll: true }); } catch (e) {}
      }
    }, 260);
  }

  // -- Add to cart from picker -----------------------------------------

  function addVariantToCart(variantId, sourceBtn) {
    if (!variantId) return Promise.resolve(null);

    // Optical celebration: shine sweep + scale pop on the card
    if (sourceBtn) {
      sourceBtn.classList.add('cq-rk-picker__card-btn--added');
    }

    // Reuse the existing flying-tooth animation if available
    try {
      if (window.calqixCartAnim && typeof window.calqixCartAnim.fly === 'function' && sourceBtn) {
        var rect = sourceBtn.getBoundingClientRect();
        window.calqixCartAnim.fly({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        });
      }
    } catch (e) {}

    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id: parseInt(variantId, 10), quantity: 1 })
    })
      .then(function (r) { return r.json(); })
      .then(function (addedItem) {
        // Mark used for this session and emit a custom event other
        // scripts (e.g. the cart drawer refresher) can listen to.
        sset(SESSION_USED_KEY, '1');
        sset(LAST_ATC_KEY, String(Date.now()));

        document.dispatchEvent(new CustomEvent('cq:rk:bundle-added', {
          detail: { variantId: variantId, item: addedItem }
        }));

        // Broadcast standard cart-update events so the theme drawer
        // refetches and re-renders its contents.
        document.dispatchEvent(new CustomEvent('cart:refresh'));
        document.dispatchEvent(new CustomEvent('cart:updated'));
        document.dispatchEvent(new CustomEvent('cartUpdate'));

        return addedItem;
      })
      .catch(function () { return null; })
      .finally(function () {
        closePicker();
        // Re-evaluate state once the drawer has had a moment to refresh
        window.setTimeout(function () { refresh(); }, 400);
      });
  }

  // -- Refresh loop -----------------------------------------------------

  var refreshQueued = false;

  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(function () {
      refreshQueued = false;
      var config = readConfig();
      if (!config || !config.enable) return;

      var banner = document.querySelector('[data-cq-rk-banner]');
      var badge = document.querySelector('[data-cq-rk-combi-badge]');

      fetchFlavorHandles(config.flavorCollection).then(function () {
        fetchCart().then(function (cart) {
          var state = evaluate(config, cart || {});

          if (state.combiComplete) {
            showCombiBadge(badge);
          } else {
            hideCombiBadge(badge);
          }

          if (state.bannerShouldShow) {
            showBanner(banner);
          } else {
            hideBanner(banner);
          }
        });
      });
    });
  }

  // -- Event wiring -----------------------------------------------------

  function init() {
    var config = readConfig();
    if (!config || !config.enable) return;

    // Open picker on banner click
    document.addEventListener('click', function (e) {
      var opener = e.target && e.target.closest('[data-cq-rk-open]');
      if (opener) {
        e.preventDefault();
        openPicker();
        return;
      }
      var closer = e.target && e.target.closest('[data-cq-rk-close]');
      if (closer) {
        e.preventDefault();
        closePicker();
        return;
      }
      var adder = e.target && e.target.closest('[data-cq-rk-add]');
      if (adder && !adder.disabled) {
        e.preventDefault();
        addVariantToCart(adder.getAttribute('data-variant-id'), adder);
        return;
      }
    }, false);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closePicker();
      }
    }, false);

    // Mark the last ATC timestamp whenever any add-to-cart happens
    // so the post-ATC window condition becomes true.
    document.addEventListener('cart:added', function () { sset(LAST_ATC_KEY, String(Date.now())); }, false);
    document.addEventListener('cartUpdate', function () { sset(LAST_ATC_KEY, String(Date.now())); refresh(); }, false);
    document.addEventListener('cart:updated', function () { refresh(); }, false);
    document.addEventListener('cart:refresh', function () { refresh(); }, false);
    document.addEventListener('cartDrawerOpen', function () { refresh(); }, false);

    // Also monkey-patch fetch to catch /cart/add.js calls the theme itself
    // does not emit a custom event for.
    try {
      var origFetch = window.fetch;
      window.fetch = function () {
        var args = arguments;
        var url = '';
        try { url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''; } catch (e) {}
        var p = origFetch.apply(this, args);
        if (url && url.indexOf('/cart/add') !== -1) {
          p.then(function () {
            sset(LAST_ATC_KEY, String(Date.now()));
            window.setTimeout(refresh, 250);
          }).catch(function () {});
        } else if (url && (url.indexOf('/cart/change') !== -1 || url.indexOf('/cart/update') !== -1 || url.indexOf('/cart/clear') !== -1)) {
          p.then(function () { window.setTimeout(refresh, 250); }).catch(function () {});
        }
        return p;
      };
    } catch (e) {}

    // Initial state (e.g. returning visitor reopening drawer)
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose a tiny debug API
  window.CalqixRebuildKit = {
    refresh: refresh,
    openPicker: openPicker,
    closePicker: closePicker,
    resetSession: function () {
      sdel(SESSION_USED_KEY);
      sdel(SESSION_COMBI_SEEN_KEY);
      sdel(LAST_ATC_KEY);
      refresh();
    }
  };
})();
