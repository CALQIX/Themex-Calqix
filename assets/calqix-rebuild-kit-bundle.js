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

    var primary = fetch('/collections/' + encodeURIComponent(collectionHandle) + '/products.json?limit=50', {
      credentials: 'same-origin'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) { return ((j && j.products) || []).map(function (p) { return p.handle; }); })
      .catch(function () { return []; });

    return primary
      .then(function (handles) {
        if (handles.length) return handles;
        // Fallback: search-suggest for 'flowcore', filter accessories
        return fetch('/search/suggest.json?q=flowcore&resources[type]=product&resources[limit]=20', {
          credentials: 'same-origin'
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var hits = (j && j.resources && j.resources.results && j.resources.results.products) || [];
            return hits
              .map(function (h) { return (h.handle || '').toLowerCase(); })
              .filter(function (h) { return h && h.indexOf('pouch') === -1 && h.indexOf('travel') === -1; });
          })
          .catch(function () { return []; });
      })
      .then(function (handles) {
        flavorHandlesCache = handles;
        return handles;
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

  // Portal the picker element out of the cart drawer so its
  // position:fixed escapes any ancestor with `contain: layout` /
  // `transform` (the CALQIX cart drawer sets both). Without this,
  // the modal would be clipped/positioned relative to the drawer.
  function portalPicker() {
    var all = document.querySelectorAll('[data-cq-rk-picker]');
    if (!all.length) return;

    // Prefer an already-portaled instance (it has JS-rendered cards).
    var keep = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-cq-rk-portaled') === '1') {
        keep = all[i];
        break;
      }
    }
    // Otherwise keep the first one and portal it.
    if (!keep) {
      keep = all[0];
    }

    // Remove any duplicates (e.g. a fresh instance re-rendered inside the
    // cart drawer after an AJAX refresh) so querySelector always returns
    // the canonical portaled picker with its populated card grid.
    for (var j = 0; j < all.length; j++) {
      if (all[j] !== keep && all[j].parentElement) {
        all[j].parentElement.removeChild(all[j]);
      }
    }

    if (keep.parentElement !== document.body) {
      document.body.appendChild(keep);
    }
    keep.setAttribute('data-cq-rk-portaled', '1');
  }

  // When the merchant has not set a FlowCore collection via theme
  // settings, the Liquid-rendered grid is empty. Fall back to a
  // runtime fetch of /collections/flowcore/products.json so the
  // feature still works out-of-the-box on new installs.
  function ensurePickerHasCards() {
    var picker = document.querySelector('[data-cq-rk-picker]');
    if (!picker) return Promise.resolve();
    var existingGrid = picker.querySelector('.cq-rk-picker__grid');
    if (existingGrid && existingGrid.children && existingGrid.children.length > 0) {
      return Promise.resolve();
    }

    var config = readConfig();
    if (!config || !config.flavorCollection) return Promise.resolve();

    // Primary source: the merchant's configured collection
    var primary = fetch('/collections/' + encodeURIComponent(config.flavorCollection) + '/products.json?limit=8', {
      credentials: 'same-origin'
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { return (data && data.products) || []; })
      .catch(function () { return []; });

    // Fallback source: search-suggest by query (default 'flowcore')
    // This makes the picker work without any collection setup.
    var fallbackQuery = config.fallbackQuery || 'flowcore';
    var fallback = primary.then(function (products) {
      if (products.length) return products;
      return fetch(
        '/search/suggest.json?q=' + encodeURIComponent(fallbackQuery) +
        '&resources[type]=product&resources[limit]=10',
        { credentials: 'same-origin' }
      )
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var hits = (data && data.resources && data.resources.results && data.resources.results.products) || [];
          // Reshape hits so the rest of the render code works uniformly.
          return hits
            .filter(function (h) {
              var handle = (h.handle || '').toLowerCase();
              // Exclude accessories that are clearly not flavor SKUs.
              return handle.indexOf('pouch') === -1 && handle.indexOf('travel') === -1;
            })
            .slice(0, 4)
            .map(function (h) {
              return {
                handle: h.handle,
                title: h.title,
                images: h.image ? [{ src: h.image }] : [],
                variants: [{
                  id: h.variants && h.variants[0] && h.variants[0].id,
                  price: h.price,
                  available: h.available !== false
                }],
                _priceHtml: h.price_min || h.price
              };
            });
        })
        .catch(function () { return []; });
    });

    // If fallback produced variant.id === undefined, enrich with /products/{handle}.js
    var enriched = fallback.then(function (products) {
      if (!products.length) return products;
      var need = products.filter(function (p) {
        return !p.variants || !p.variants[0] || !p.variants[0].id;
      });
      if (!need.length) return products;
      return Promise.all(need.map(function (p) {
        return fetch('/products/' + encodeURIComponent(p.handle) + '.js', { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (full) {
            if (!full) return;
            p.variants = [{
              id: full.variants[0].id,
              price: full.variants[0].price,
              available: full.variants[0].available
            }];
            if (full.featured_image) p.images = [{ src: full.featured_image }];
            if (full.title) p.title = full.title;
          })
          .catch(function () {});
      })).then(function () { return products; });
    });

    return enriched
      .then(function (products) {
        if (!products.length) return;

        var emptyNote = picker.querySelector('.cq-rk-picker__empty');
        if (emptyNote) emptyNote.remove();

        var grid = document.createElement('ul');
        grid.className = 'cq-rk-picker__grid';
        grid.setAttribute('role', 'list');

        products.forEach(function (p, i) {
          var variant = (p.variants && p.variants[0]) || {};
          var available = variant.available !== false;
          var price = typeof variant.price === 'string' ? variant.price : (variant.price / 100).toFixed(2);
          var img = (p.images && p.images[0] && p.images[0].src) || '';

          var li = document.createElement('li');
          li.className = 'cq-rk-picker__card';
          li.style.setProperty('--cq-rk-card-delay', (i * 70) + 'ms');

          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cq-rk-picker__card-btn';
          btn.setAttribute('data-cq-rk-add', '');
          btn.setAttribute('data-variant-id', variant.id || '');
          btn.setAttribute('data-product-title', p.title || '');
          btn.setAttribute('data-product-image', img);
          if (!available) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
          }

          var media = document.createElement('span');
          media.className = 'cq-rk-picker__card-media';
          media.setAttribute('aria-hidden', 'true');
          if (img) {
            var imgEl = document.createElement('img');
            imgEl.src = img;
            imgEl.loading = 'lazy';
            imgEl.width = 160; imgEl.height = 160;
            imgEl.alt = p.title || '';
            media.appendChild(imgEl);
          } else {
            var ph = document.createElement('span');
            ph.className = 'cq-rk-picker__card-placeholder';
            media.appendChild(ph);
          }
          var shine = document.createElement('span');
          shine.className = 'cq-rk-picker__card-shine';
          media.appendChild(shine);

          var info = document.createElement('span');
          info.className = 'cq-rk-picker__card-info';
          info.innerHTML =
            '<span class="cq-rk-picker__card-title"></span>' +
            '<span class="cq-rk-picker__card-price"></span>';
          info.querySelector('.cq-rk-picker__card-title').textContent = p.title || '';
          var priceText = '€' + (typeof price === 'string' ? price : String(price));
          try { priceText = new Intl.NumberFormat(document.documentElement.lang || 'en-EU', { style: 'currency', currency: 'EUR' }).format(parseFloat(price)); } catch (e) {}
          info.querySelector('.cq-rk-picker__card-price').textContent = priceText;

          var cta = document.createElement('span');
          cta.className = 'cq-rk-picker__card-cta';
          cta.innerHTML =
            '<span class="cq-rk-picker__card-cta-text">Add to Kit</span>' +
            '<span class="cq-rk-picker__card-cta-arrow" aria-hidden="true">' +
            '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg></span>';

          btn.appendChild(media);
          btn.appendChild(info);
          btn.appendChild(cta);
          li.appendChild(btn);
          grid.appendChild(li);
        });

        // Insert grid before footer
        var footer = picker.querySelector('.cq-rk-picker__footer');
        if (footer) {
          footer.parentNode.insertBefore(grid, footer);
        } else {
          picker.querySelector('.cq-rk-picker__dialog').appendChild(grid);
        }
      })
      .catch(function () {});
  }

  function init() {
    var config = readConfig();
    if (!config || !config.enable) return;

    portalPicker();
    ensurePickerHasCards();

    // Re-portal + ensure cards if the cart drawer re-renders and
    // wipes/replaces our picker element.
    var reportalTimer;
    document.addEventListener('cart:refresh', function () {
      clearTimeout(reportalTimer);
      reportalTimer = setTimeout(function () {
        portalPicker();
        ensurePickerHasCards();
      }, 120);
    }, false);

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
