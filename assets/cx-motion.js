/* ============================================================
 * CALQIX Navy Rebuild — interaction layer
 * Vanilla JS, IntersectionObserver + event delegation.
 * Loaded as defer in <body> via layout/theme.liquid.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. Scroll reveal ---------- */
  var revealTargets = document.querySelectorAll('[data-cx-reveal], [data-cx-stagger]');
  if (revealTargets.length && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('cx-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('cx-in'); });
  }

  /* ---------- 2. Mega-menu dropdown ---------- */
  (function () {
    var toggles = document.querySelectorAll('[data-cx-dropdown-toggle]');
    if (!toggles.length) return;
    toggles.forEach(function (toggle) {
      var key = toggle.getAttribute('data-cx-dropdown-toggle');
      var panel = document.querySelector('[data-cx-dropdown-panel="' + key + '"]');
      var header = toggle.closest('[data-cx-header]') || document.querySelector('[data-cx-header]');
      if (!panel) return;

      function open() {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.classList.add('cx-is-open');
      }
      function close() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.classList.remove('cx-is-open');
      }

      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        panel.hidden ? open() : close();
      });

      document.addEventListener('mousedown', function (e) {
        if (!panel.hidden && header && !header.contains(e.target)) close();
      });
      window.addEventListener('scroll', function () {
        if (!panel.hidden) close();
      }, { passive: true });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !panel.hidden) close();
      });
    });
  })();

  /* ---------- 3. Flavor picker (hero) ---------- */
  (function () {
    var heroes = document.querySelectorAll('[data-cx-hero-flavor]');
    if (!heroes.length) return;
    heroes.forEach(function (section) {
      var pills = section.querySelectorAll('[data-cx-variant-id]');
      var form = section.querySelector('form[action*="/cart/add"]');
      var idInput = form && form.querySelector('input[name="id"]');
      var nameEl = section.querySelector('[data-cx-flavor-name]');
      var tagEl = section.querySelector('[data-cx-flavor-tag]');
      var priceEl = section.querySelector('[data-cx-flavor-price]');
      var compareEl = section.querySelector('[data-cx-flavor-compare]');
      var ctaPrice = section.querySelector('[data-cx-cta-price]');
      var jarLabel = section.querySelector('[data-cx-jar-label]');

      function selectPill(pill) {
        pills.forEach(function (p) { p.classList.remove('cx-is-active'); p.setAttribute('aria-pressed', 'false'); });
        pill.classList.add('cx-is-active');
        pill.setAttribute('aria-pressed', 'true');
        var variantId = pill.getAttribute('data-cx-variant-id');
        var color = pill.getAttribute('data-cx-swatch-color');
        var name = pill.getAttribute('data-cx-name');
        var tag = pill.getAttribute('data-cx-tag');
        var price = pill.getAttribute('data-cx-price');
        var compare = pill.getAttribute('data-cx-compare');
        if (idInput && variantId) idInput.value = variantId;
        if (nameEl && name) nameEl.textContent = name;
        if (tagEl && tag) tagEl.textContent = tag;
        if (priceEl && price) priceEl.textContent = price;
        if (compareEl) compareEl.textContent = compare || '';
        if (ctaPrice && price) {
          ctaPrice.setAttribute('data-cx-normal', price);
          if (!section.classList.contains('cx-subscribed')) ctaPrice.textContent = price;
        }
        if (jarLabel && name) jarLabel.textContent = ('JAR · ' + name).toUpperCase();
        if (color) section.style.setProperty('--cx-hero-bg', color);
      }

      pills.forEach(function (pill) { pill.addEventListener('click', function () { selectPill(pill); }); });
    });
  })();

  /* ---------- 4. Subscribe toggle (hero secondary CTA) ---------- */
  (function () {
    var toggles = document.querySelectorAll('[data-cx-subscribe-toggle]');
    toggles.forEach(function (btn) {
      var section = btn.closest('section') || document;
      var priceEl = section.querySelector('[data-cx-cta-price]');
      var box = btn.querySelector('[data-cx-subscribe-box]');
      btn.addEventListener('click', function () {
        var on = btn.classList.toggle('cx-is-active');
        btn.classList.toggle('cx-btn-gold', on);
        btn.classList.toggle('cx-btn-ghost', !on);
        if (section.classList) section.classList.toggle('cx-subscribed', on);
        if (priceEl) {
          var normal = priceEl.getAttribute('data-cx-normal') || priceEl.textContent;
          var ratio = parseFloat(priceEl.getAttribute('data-cx-sub-ratio') || '0.8');
          if (on) {
            var numMatch = normal.match(/([\d.,]+)/);
            if (numMatch) {
              var raw = numMatch[1].replace('.', '').replace(',', '.');
              var discounted = (parseFloat(raw) * ratio).toFixed(2).replace('.', ',');
              priceEl.textContent = normal.replace(numMatch[1], discounted);
            }
          } else {
            priceEl.textContent = normal;
          }
        }
        if (box) box.innerHTML = on ? '<span class="cx-check">✓</span>' : '';
      });
    });
  })();

  /* ---------- 5. Tooth atlas tab switcher ---------- */
  (function () {
    var atlases = document.querySelectorAll('[data-cx-tooth-atlas]');
    atlases.forEach(function (atlas) {
      var pills = atlas.querySelectorAll('[data-cx-tooth-pill]');
      var panels = atlas.querySelectorAll('[data-cx-tooth-panel]');
      pills.forEach(function (pill) {
        pill.addEventListener('click', function () {
          var id = pill.getAttribute('data-cx-tooth-pill');
          pills.forEach(function (p) { p.classList.toggle('cx-is-active', p.getAttribute('data-cx-tooth-pill') === id); });
          panels.forEach(function (p) { p.classList.toggle('cx-is-active', p.getAttribute('data-cx-tooth-panel') === id); });
        });
      });
    });
  })();

  /* ---------- 6. Review filter pills (UI-only) ---------- */
  (function () {
    var groups = document.querySelectorAll('[data-cx-review-filter]');
    groups.forEach(function (group) {
      var pills = group.querySelectorAll('[data-cx-review-pill]');
      pills.forEach(function (pill) {
        pill.addEventListener('click', function () {
          pills.forEach(function (p) { p.classList.remove('cx-is-active'); });
          pill.classList.add('cx-is-active');
        });
      });
    });
  })();

  /* ---------- 7. Feature accordion ---------- */
  (function () {
    var accordions = document.querySelectorAll('[data-cx-accordion]');
    accordions.forEach(function (acc) {
      var items = acc.querySelectorAll('[data-cx-accordion-item]');
      items.forEach(function (item) {
        var btn = item.querySelector('[data-cx-accordion-toggle]');
        var body = item.querySelector('[data-cx-accordion-body]');
        if (!btn || !body) return;
        btn.addEventListener('click', function () {
          var open = item.classList.toggle('cx-is-open');
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          body.hidden = !open;
        });
      });
    });
  })();

  /* ---------- 8. Mobile header drawer + accordion ---------- */
  (function () {
    var drawer = document.querySelector('[data-cx-drawer]');
    var overlay = document.querySelector('[data-cx-drawer-overlay]');
    var openers = document.querySelectorAll('[data-cx-drawer-open]');
    var closers = document.querySelectorAll('[data-cx-drawer-close]');
    if (!drawer) return;

    function open() {
      drawer.hidden = false;
      if (overlay) overlay.hidden = false;
      // Two-phase so the slide-in transition runs on next frame
      requestAnimationFrame(function () {
        drawer.classList.add('cx-is-open');
      });
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      openers.forEach(function (o) { o.setAttribute('aria-expanded', 'true'); });
      var firstFocusable = drawer.querySelector('a, button');
      if (firstFocusable) firstFocusable.focus();
    }
    function close() {
      drawer.classList.remove('cx-is-open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      openers.forEach(function (o) { o.setAttribute('aria-expanded', 'false'); });
      // Wait for transition end before hiding (220ms)
      setTimeout(function () {
        if (!drawer.classList.contains('cx-is-open')) {
          drawer.hidden = true;
          if (overlay) overlay.hidden = true;
        }
      }, 240);
    }

    openers.forEach(function (btn) { btn.addEventListener('click', open); });
    closers.forEach(function (btn) { btn.addEventListener('click', close); });
    if (overlay) overlay.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('cx-is-open')) close();
    });

    // Close drawer when navigating a link inside it (SPA-ish feel)
    drawer.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', function () {
        // Let the browser follow the link, then close so back/forward feels tidy
        setTimeout(close, 120);
      });
    });

    // Accordion toggles inside the drawer
    drawer.querySelectorAll('[data-cx-accordion]').forEach(function (item) {
      var btn = item.querySelector('[data-cx-accordion-toggle]');
      var body = item.querySelector('[data-cx-accordion-body]');
      if (!btn || !body) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var open = item.classList.toggle('cx-is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        body.hidden = !open;
      });
    });
  })();

  /* ---------- 9. Counter count-up ---------- */
  (function () {
    var counters = document.querySelectorAll('[data-cx-count]');
    if (!counters.length || !('IntersectionObserver' in window)) return;
    function animateNumber(el) {
      var target = parseFloat(el.getAttribute('data-cx-count'));
      var decimals = parseInt(el.getAttribute('data-cx-count-decimals') || '0', 10);
      var duration = parseInt(el.getAttribute('data-cx-count-duration') || '1400', 10);
      var start = performance.now();
      function step(now) {
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        var value = target * eased;
        el.textContent = decimals > 0 ? value.toFixed(decimals).replace('.', ',') : Math.round(value).toLocaleString('nl-NL');
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    var counterObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          animateNumber(e.target);
          counterObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (c) { counterObs.observe(c); });
  })();
})();
