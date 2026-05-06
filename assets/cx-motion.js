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
      var section = atlas.closest('.cx-tooth-atlas-v2');
      var visual = section ? section.querySelector('[data-cx-atlas-visual]') : null;
      var meters = section ? section.querySelectorAll('[data-cx-atlas-meter]') : [];
      var callouts = section ? section.querySelectorAll('[data-cx-atlas-callout]') : [];
      var pills = atlas.querySelectorAll('[data-cx-tooth-pill]');
      var panels = atlas.querySelectorAll('[data-cx-tooth-panel]');
      function activateLayer(id) {
        if (visual) visual.setAttribute('data-cx-atlas-state', id);
        meters.forEach(function (m) { m.classList.toggle('cx-is-active', m.getAttribute('data-cx-atlas-meter') === id); });
        callouts.forEach(function (c) {
          var active = c.getAttribute('data-cx-atlas-callout') === id;
          c.classList.toggle('cx-is-active', active);
          c.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        pills.forEach(function (p) {
          var active = p.getAttribute('data-cx-tooth-pill') === id;
          p.classList.toggle('cx-is-active', active);
          p.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach(function (p) { p.classList.toggle('cx-is-active', p.getAttribute('data-cx-tooth-panel') === id); });
      }
      pills.forEach(function (pill) {
        var id = pill.getAttribute('data-cx-tooth-pill');
        pill.addEventListener('click', function () { activateLayer(id); });
        pill.addEventListener('mouseenter', function () { activateLayer(id); });
      });
      callouts.forEach(function (callout) {
        var id = callout.getAttribute('data-cx-atlas-callout');
        callout.addEventListener('click', function () { activateLayer(id); });
        callout.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateLayer(id);
          }
        });
      });
    });
  })();

  /* ---------- 5b. Tooth role switcher ---------- */
  (function () {
    var labs = document.querySelectorAll('[data-cx-tooth-role-lab]');
    labs.forEach(function (lab) {
      var section = lab.closest('.cx-tooth-atlas-v2');
      var pills = section ? section.querySelectorAll('[data-cx-tooth-role]') : [];
      var panels = section ? section.querySelectorAll('[data-cx-tooth-role-panel]') : [];
      var arch = section ? section.querySelector('[data-cx-tooth-arch]') : null;
      function activateRole(id) {
        if (arch) arch.setAttribute('data-cx-tooth-arch', id);
        pills.forEach(function (pill) {
          var active = pill.getAttribute('data-cx-tooth-role') === id;
          pill.classList.toggle('cx-is-active', active);
          pill.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach(function (panel) {
          panel.classList.toggle('cx-is-active', panel.getAttribute('data-cx-tooth-role-panel') === id);
        });
      }
      pills.forEach(function (pill) {
        var id = pill.getAttribute('data-cx-tooth-role');
        pill.addEventListener('click', function () { activateRole(id); });
        pill.addEventListener('mouseenter', function () { activateRole(id); });
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

    /* Time-aware greeting swap. The Liquid template renders the
       afternoon variant by default (Shopify's CDN cache strips visitor
       timezone), and we replace the textContent here based on the
       browser's local hour so each user sees the right greeting in
       their own locale. Stays a single read of `Date()` per pageview. */
    (function applyGreeting() {
      var greet = drawer.querySelector('[data-cx-greeting]');
      if (!greet) return;
      var slot = greet.querySelector('[data-cx-greet-text]');
      if (!slot) return;
      var h = new Date().getHours();
      var key;
      if (h >= 5 && h < 12)       key = 'morning';
      else if (h >= 12 && h < 18) key = 'afternoon';
      else                        key = 'evening';
      var text = greet.getAttribute('data-cx-greet-' + key);
      if (text) slot.textContent = text;
    })();

    function open() {
      drawer.hidden = false;
      if (overlay) overlay.hidden = false;
      // Two-phase so the slide-in transition runs on next frame.
      // Mirroring the open class onto the overlay triggers its fade +
      // backdrop-blur ramp in lockstep with the drawer slide.
      requestAnimationFrame(function () {
        drawer.classList.add('cx-is-open');
        if (overlay) overlay.classList.add('cx-is-open');
      });
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      openers.forEach(function (o) { o.setAttribute('aria-expanded', 'true'); });
      var firstFocusable = drawer.querySelector('a, button');
      if (firstFocusable) firstFocusable.focus();
    }
    function close() {
      drawer.classList.remove('cx-is-open');
      if (overlay) overlay.classList.remove('cx-is-open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      openers.forEach(function (o) { o.setAttribute('aria-expanded', 'false'); });
      // Wait for transition end before hiding (matches 640ms slide).
      setTimeout(function () {
        if (!drawer.classList.contains('cx-is-open')) {
          drawer.hidden = true;
          if (overlay) overlay.hidden = true;
        }
      }, 640);
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

    // ---- Drawer accordion (mega menu toggle) -------------------------------
    // Single-open behaviour with a smooth, JS-driven height + opacity
    // animation. Tapping the same toggle, another mega toggle, or any
    // non-mega link will collapse the currently open submenu before the
    // drawer itself navigates/closes — gives the menu a luxe, coordinated
    // feel instead of an instant collapse.
    var EASE_OPEN = 'cubic-bezier(0.22, 1, 0.36, 1)';
    var EASE_CLOSE = 'cubic-bezier(0.65, 0, 0.35, 1)';

    function expandPanel(item, btn, body) {
      if (item.classList.contains('cx-is-open')) return;
      item.classList.add('cx-is-open');
      btn.setAttribute('aria-expanded', 'true');
      body.hidden = false;
      body.style.transition = 'none';
      body.style.height = '0px';
      body.style.opacity = '0';
      // force reflow so the next style change actually transitions
      void body.offsetHeight;
      var target = body.scrollHeight;
      body.style.transition =
        'height 480ms ' + EASE_OPEN + ', opacity 380ms ' + EASE_OPEN;
      body.style.height = target + 'px';
      body.style.opacity = '1';
      function done(ev) {
        if (ev.target !== body || ev.propertyName !== 'height') return;
        body.removeEventListener('transitionend', done);
        // Hand control back to CSS so the panel grows naturally with content.
        body.style.transition = '';
        body.style.height = '';
        body.style.opacity = '';
      }
      body.addEventListener('transitionend', done);
    }

    function collapsePanel(item, btn, body) {
      if (!item.classList.contains('cx-is-open') && body.hidden) return;
      var startH = body.scrollHeight;
      body.style.transition = 'none';
      body.style.height = startH + 'px';
      body.style.opacity = '1';
      // force reflow
      void body.offsetHeight;
      body.style.transition =
        'height 420ms ' + EASE_CLOSE + ', opacity 320ms ' + EASE_CLOSE;
      body.style.height = '0px';
      body.style.opacity = '0';
      item.classList.remove('cx-is-open');
      btn.setAttribute('aria-expanded', 'false');
      function done(ev) {
        if (ev.target !== body || ev.propertyName !== 'height') return;
        body.removeEventListener('transitionend', done);
        body.hidden = true;
        body.style.transition = '';
        body.style.height = '';
        body.style.opacity = '';
      }
      body.addEventListener('transitionend', done);
    }

    function closeAllAccordions(except) {
      drawer
        .querySelectorAll('[data-cx-accordion].cx-is-open')
        .forEach(function (other) {
          if (other === except) return;
          var ob = other.querySelector('[data-cx-accordion-toggle]');
          var oc = other.querySelector('[data-cx-accordion-body]');
          if (ob && oc) collapsePanel(other, ob, oc);
        });
    }

    drawer.querySelectorAll('[data-cx-accordion]').forEach(function (item) {
      var btn = item.querySelector('[data-cx-accordion-toggle]');
      var body = item.querySelector('[data-cx-accordion-body]');
      if (!btn || !body) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var isOpen = item.classList.contains('cx-is-open');
        // Always collapse siblings first so only one mega is open at a time.
        closeAllAccordions(item);
        if (isOpen) collapsePanel(item, btn, body);
        else expandPanel(item, btn, body);
      });
    });

    // Tapping any non-mega top-level linklist anchor inside the drawer
    // should also gracefully collapse an open mega before the drawer slides
    // shut. The existing `setTimeout(close, 120)` lets this animation breathe.
    drawer
      .querySelectorAll('a.cx-drawer__link')
      .forEach(function (a) {
        a.addEventListener('click', function () {
          closeAllAccordions(null);
        });
      });
  })();

  /* ---------- 8.5 Locale sheet (popup for country + language) ---------- */
  (function () {
    var sheet = document.querySelector('[data-cx-locale-sheet]');
    if (!sheet) return;
    var triggers = document.querySelectorAll('[data-cx-locale-open]');
    var closers = sheet.querySelectorAll('[data-cx-locale-close]');
    var panel = sheet.querySelector('.cx-locale-sheet__panel');

    function open(e) {
      if (e) e.preventDefault();
      sheet.hidden = false;
      // two-phase so the transition runs
      requestAnimationFrame(function () {
        sheet.setAttribute('data-open', '');
      });
      document.body.style.overflow = 'hidden';
      triggers.forEach(function (t) { t.setAttribute('aria-expanded', 'true'); });
      var firstOption = sheet.querySelector('.cx-locale-sheet__option');
      if (firstOption) firstOption.focus();
    }
    function close() {
      sheet.removeAttribute('data-open');
      document.body.style.overflow = '';
      triggers.forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
      setTimeout(function () {
        if (!sheet.hasAttribute('data-open')) sheet.hidden = true;
      }, 460);
    }

    triggers.forEach(function (t) { t.addEventListener('click', open); });
    closers.forEach(function (c) { c.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.hasAttribute('data-open')) close();
    });

    // Option click → submit its parent form with the chosen iso_code
    sheet.querySelectorAll('.cx-locale-sheet__option').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.preventDefault();
        var form = opt.closest('form');
        if (!form) return;
        var input = form.querySelector('input[name="country_code"], input[name="locale_code"]');
        if (input) input.value = opt.getAttribute('data-value');
        // Small delay to show active state feedback before navigation
        opt.classList.add('is-active');
        setTimeout(function () { form.submit(); }, 80);
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
