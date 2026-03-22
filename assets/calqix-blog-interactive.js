/**
 * CALQIX Blog Interactive Features
 * Loaded on: blog article pages only
 * Features: reading progress, stat counters, comparison slider,
 *           citation popups, ingredient tooltips, TOC tracking,
 *           scroll entrance animations, mobile TOC modal
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    initReadingProgress();
    initStatCounters();
    initCompareSliders();
    initCitations();
    initIngredientTooltips();
    initTOCTracking();
    initMobileTOC();
    initScrollAnimations();
  }

  /* ───────────────────────────────────────
     1. READING PROGRESS BAR
     ─────────────────────────────────────── */
  function initReadingProgress() {
    var bar = document.querySelector('.blog-progress');
    var article = document.querySelector('.blog-content');
    if (!bar || !article) return;

    function update() {
      var rect = article.getBoundingClientRect();
      var articleTop = rect.top + window.scrollY;
      var articleHeight = rect.height;
      var scrolled = window.scrollY - articleTop;
      var progress = Math.min(Math.max(scrolled / (articleHeight - window.innerHeight), 0), 1);
      bar.style.width = (progress * 100) + '%';
    }

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ───────────────────────────────────────
     2. STAT COUNTERS (count up on scroll)
     ─────────────────────────────────────── */
  function initStatCounters() {
    var stats = document.querySelectorAll('.blog-stat');
    if (!stats.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    stats.forEach(function (s) { observer.observe(s); });
  }

  function animateCounter(statEl) {
    var numberEl = statEl.querySelector('.blog-stat__number');
    var target = parseInt(statEl.dataset.target, 10);
    if (isNaN(target)) return;
    var duration = 2000;
    var startTime = performance.now();

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function step(currentTime) {
      var elapsed = currentTime - startTime;
      var progress = Math.min(elapsed / duration, 1);
      numberEl.textContent = Math.round(easeOutCubic(progress) * target);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /* ───────────────────────────────────────
     3. BEFORE / AFTER COMPARISON SLIDER
     ─────────────────────────────────────── */
  function initCompareSliders() {
    var sliders = document.querySelectorAll('[data-interactive="compare"]');
    sliders.forEach(setupCompareSlider);
  }

  function setupCompareSlider(slider) {
    var afterEl = slider.querySelector('.blog-compare__after');
    var handle  = slider.querySelector('.blog-compare__handle');
    if (!afterEl || !handle) return;
    var isDragging = false;

    function pos(x) {
      var rect = slider.getBoundingClientRect();
      var pct = ((x - rect.left) / rect.width) * 100;
      pct = Math.max(2, Math.min(98, pct));
      afterEl.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      handle.style.left = pct + '%';
    }

    slider.addEventListener('mousedown', function (e) { isDragging = true; pos(e.clientX); });
    document.addEventListener('mousemove', function (e) { if (isDragging) { e.preventDefault(); pos(e.clientX); } });
    document.addEventListener('mouseup', function () { isDragging = false; });

    slider.addEventListener('touchstart', function (e) { isDragging = true; pos(e.touches[0].clientX); }, { passive: true });
    slider.addEventListener('touchmove', function (e) { if (isDragging) pos(e.touches[0].clientX); }, { passive: true });
    slider.addEventListener('touchend', function () { isDragging = false; });

    /* initial wiggle hint */
    setTimeout(function () {
      afterEl.style.transition = 'clip-path 0.6s ease';
      handle.style.transition  = 'left 0.6s ease';
      afterEl.style.clipPath   = 'inset(0 40% 0 0)';
      handle.style.left        = '60%';
      setTimeout(function () {
        afterEl.style.clipPath = 'inset(0 50% 0 0)';
        handle.style.left      = '50%';
        setTimeout(function () {
          afterEl.style.transition = '';
          handle.style.transition  = '';
        }, 600);
      }, 600);
    }, 1000);
  }

  /* ───────────────────────────────────────
     4. CITATION POPUPS
     ─────────────────────────────────────── */
  function initCitations() {
    var cites = document.querySelectorAll('[data-interactive="cite"]');
    if (!cites.length) return;

    cites.forEach(function (cite) {
      var trigger = cite.querySelector('.blog-cite__trigger');
      if (!trigger) return;
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        cites.forEach(function (c) { if (c !== cite) c.classList.remove('is-open'); });
        cite.classList.toggle('is-open');
      });
    });

    document.addEventListener('click', function () {
      cites.forEach(function (c) { c.classList.remove('is-open'); });
    });
  }

  /* ───────────────────────────────────────
     5. INGREDIENT TOOLTIPS
     ─────────────────────────────────────── */
  function initIngredientTooltips() {
    var items = document.querySelectorAll('[data-interactive="ingredient"]');
    items.forEach(function (el) {
      if (el.querySelector('.blog-ingredient__tooltip')) return;

      var name    = el.dataset.name || '';
      var cfu     = el.dataset.cfu  || '';
      var benefit = el.dataset.benefit || '';

      var tip = document.createElement('span');
      tip.className = 'blog-ingredient__tooltip';
      tip.innerHTML =
        '<span class="blog-ingredient__tooltip-name">' + name + '</span>' +
        (cfu ? '<span class="blog-ingredient__tooltip-cfu">' + cfu + '</span>' : '') +
        '<span class="blog-ingredient__tooltip-benefit">' + benefit + '</span>';
      el.appendChild(tip);
    });
  }

  /* ───────────────────────────────────────
     6. TABLE OF CONTENTS — active tracking
     ─────────────────────────────────────── */
  function initTOCTracking() {
    var tocItems = document.querySelectorAll('.blog-toc__item');
    var headings = document.querySelectorAll('.blog-content h2[id], .blog-content h3[id]');
    if (!tocItems.length || !headings.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          tocItems.forEach(function (item) {
            item.classList.toggle('is-active', item.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    headings.forEach(function (h) { observer.observe(h); });

    tocItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(item.getAttribute('href').substring(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        /* close mobile modal if open */
        var modal = document.querySelector('.blog-toc-mobile__sheet');
        if (modal) modal.classList.remove('is-open');
        var overlay = document.querySelector('.blog-toc-mobile__overlay');
        if (overlay) overlay.classList.remove('is-open');
      });
    });
  }

  /* ───────────────────────────────────────
     7. MOBILE TOC MODAL
     ─────────────────────────────────────── */
  function initMobileTOC() {
    var btn = document.querySelector('.blog-toc-mobile__trigger');
    var sheet = document.querySelector('.blog-toc-mobile__sheet');
    var overlay = document.querySelector('.blog-toc-mobile__overlay');
    if (!btn || !sheet) return;

    btn.addEventListener('click', function () {
      sheet.classList.toggle('is-open');
      if (overlay) overlay.classList.toggle('is-open');
    });

    if (overlay) {
      overlay.addEventListener('click', function () {
        sheet.classList.remove('is-open');
        overlay.classList.remove('is-open');
      });
    }
  }

  /* ───────────────────────────────────────
     8. SCROLL ENTRANCE ANIMATIONS
     ─────────────────────────────────────── */
  function initScrollAnimations() {
    var animated = document.querySelectorAll('.blog-content [data-animate]');
    if (!animated.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    animated.forEach(function (el) { observer.observe(el); });
  }

})();
