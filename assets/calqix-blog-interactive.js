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
    initHeaderOffset();
    initLazyImages();
    initScientificNames();
    initDynamicTOC();
    initReadingProgress();
    initStatCounters();
    initCompareSliders();
    initCitations();
    initIngredientTooltips();
    initGlossaryTooltips();
    initTOCTracking();
    initMobileTOC();
    initScrollAnimations();
    initContentAnimations();
  }

  /* ───────────────────────────────────────
     HEADER OFFSET — set CSS var for sticky mobile TOC
     ─────────────────────────────────────── */
  function initHeaderOffset() {
    var header = document.querySelector('.wt-header') || document.querySelector('header');
    if (!header) return;
    function update() {
      document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
    }
    update();
    window.addEventListener('resize', update, { passive: true });
  }

  /* ───────────────────────────────────────
     LAZY LOADING — inject loading="lazy" on content images
     ─────────────────────────────────────── */
  function initLazyImages() {
    var article = document.querySelector('.blog-content');
    if (!article) return;
    var imgs = article.querySelectorAll('img');
    imgs.forEach(function (img, i) {
      if (i === 0) {
        img.setAttribute('loading', 'eager');
      } else {
        img.setAttribute('loading', 'lazy');
      }
      img.setAttribute('decoding', 'async');
    });
  }

  /* ───────────────────────────────────────
     0. SCIENTIFIC NAME ITALICISATION (text-nodes only)
     ─────────────────────────────────────── */
  function initScientificNames() {
    var article = document.querySelector('.blog-content');
    if (!article) return;

    var rules = [
      { find: 'Streptococcus salivarius K12', html: '<em>Streptococcus salivarius</em>\u00a0K12' },
      { find: 'Streptococcus salivarius M18', html: '<em>Streptococcus salivarius</em>\u00a0M18' },
      { find: 'Streptococcus salivarius', html: '<em>Streptococcus salivarius</em>' },
      { find: 'Streptococcus mutans', html: '<em>Streptococcus mutans</em>' },
      { find: 'Porphyromonas gingivalis', html: '<em>Porphyromonas gingivalis</em>' },
      { find: 'Lactobacillus reuteri', html: '<em>Lactobacillus reuteri</em>' },
      { find: 'S. salivarius K12', html: '<em><span class="sci-nowrap">S.\u00a0salivarius</span></em>\u00a0K12' },
      { find: 'S. salivarius M18', html: '<em><span class="sci-nowrap">S.\u00a0salivarius</span></em>\u00a0M18' },
      { find: 'S. salivarius', html: '<em><span class="sci-nowrap">S.\u00a0salivarius</span></em>' },
      { find: 'S. mutans', html: '<em><span class="sci-nowrap">S.\u00a0mutans</span></em>' },
      { find: 'P. gingivalis', html: '<em><span class="sci-nowrap">P.\u00a0gingivalis</span></em>' },
      { find: 'L. reuteri', html: '<em><span class="sci-nowrap">L.\u00a0reuteri</span></em>' },
      { find: 'Rothia', html: '<em>Rothia</em>' },
      { find: 'nano-hydroxyapatite', html: '<span class="sci-nowrap">nano-hydroxyapatite</span>' },
      { find: 'nano-HA', html: '<span class="sci-nowrap">nano-HA</span>' }
    ];

    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(function (node) {
      if (!node.parentNode) return;
      var parent = node.parentNode;
      if (parent.closest && (parent.closest('a') || parent.closest('script') || parent.closest('style') || parent.closest('.blog-glossary'))) return;
      if (parent.tagName === 'EM' || parent.tagName === 'A') return;

      var text = node.nodeValue;
      var parts = [];
      var cursor = 0;

      while (cursor < text.length) {
        var earliest = null;
        for (var r = 0; r < rules.length; r++) {
          var idx = text.indexOf(rules[r].find, cursor);
          if (idx !== -1 && (earliest === null || idx < earliest.idx || (idx === earliest.idx && rules[r].find.length > earliest.len))) {
            earliest = { idx: idx, len: rules[r].find.length, html: rules[r].html };
          }
        }
        if (!earliest) break;
        if (earliest.idx > cursor) parts.push({ type: 'text', value: text.slice(cursor, earliest.idx) });
        parts.push({ type: 'html', value: earliest.html });
        cursor = earliest.idx + earliest.len;
      }

      if (!parts.length) return;
      if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });

      var frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (p.type === 'text') {
          frag.appendChild(document.createTextNode(p.value));
        } else {
          var tmp = document.createElement('span');
          tmp.innerHTML = p.value;
          while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        }
      });
      parent.replaceChild(frag, node);
    });
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
     5b. GLOSSARY TOOLTIPS
     ─────────────────────────────────────── */
  function initGlossaryTooltips() {
    var article = document.querySelector('.blog-content');
    if (!article) return;

    var glossary = [
      { term: 'oral microbiome', def: 'The community of bacteria, fungi and other micro-organisms that naturally live in your mouth.' },
      { term: 'microbiome', def: 'A community of trillions of micro-organisms living together in a specific environment, such as your mouth or gut.' },
      { term: 'biofilm', def: 'A thin, sticky layer of bacteria that forms on surfaces like your teeth and gums.' },
      { term: 'dysbiosis', def: 'An imbalance in your microbial community where harmful species outnumber beneficial ones.' },
      { term: 'pathogenic', def: 'Capable of causing disease or infection.' },
      { term: 'pathogens', def: 'Micro-organisms that can cause disease or infection.' },
      { term: 'periodontal', def: 'Relating to the gums and bone structures that support your teeth.' },
      { term: 'gingivitis', def: 'Early-stage gum disease causing redness, swelling and bleeding of the gums.' },
      { term: 'periodontitis', def: 'Advanced gum disease where the bone supporting the teeth starts to break down.' },
      { term: 'Lactobacillus reuteri', def: 'A beneficial probiotic bacterium clinically studied for reducing gum inflammation and supporting oral health.' },
      { term: 'L. reuteri', def: 'Short for Lactobacillus reuteri — a probiotic strain that helps reduce harmful oral bacteria.' },
      { term: 'S. salivarius K12', def: 'A probiotic strain naturally found in healthy mouths, studied for reducing bad-breath bacteria.' },
      { term: 'S. salivarius M18', def: 'A probiotic strain researched for reducing plaque and supporting enamel health.' },
      { term: 'Streptococcus salivarius', def: 'A species of beneficial bacteria naturally present in a healthy mouth.' },
      { term: 'CFU', def: 'Colony Forming Units — a measure of how many live, active bacteria are in each dose.' },
      { term: 'nano-hydroxyapatite', def: 'A nano-sized form of the mineral that makes up 97% of tooth enamel, used to remineralise and repair teeth.' },
      { term: 'hydroxyapatite', def: 'The natural mineral that forms the hard structure of tooth enamel and bone.' },
      { term: 'remineralisation', def: 'The natural process of restoring lost minerals to tooth enamel, making it stronger.' },
      { term: 'remineralization', def: 'The natural process of restoring lost minerals to tooth enamel, making it stronger.' },
      { term: 'demineralisation', def: 'The loss of minerals from tooth enamel caused by acid-producing bacteria.' },
      { term: 'demineralization', def: 'The loss of minerals from tooth enamel caused by acid-producing bacteria.' },
      { term: 'enamel', def: 'The hard, outer layer of your teeth that protects against decay and sensitivity.' },
      { term: 'plaque', def: 'A soft, sticky film of bacteria that constantly forms on your teeth and can lead to cavities.' },
      { term: 'halitosis', def: 'The medical term for chronic bad breath, often caused by specific bacteria in the mouth.' },
      { term: 'bacteriocins', def: 'Natural antimicrobial substances produced by good bacteria to fight harmful ones.' },
      { term: 'antimicrobial', def: 'A substance that kills or stops the growth of micro-organisms like bacteria.' },
      { term: 'probiotic', def: 'Live beneficial micro-organisms that, when consumed in the right amounts, support your health.' },
      { term: 'probiotics', def: 'Live beneficial micro-organisms that support health when taken in adequate amounts.' },
      { term: 'clinical study', def: 'A scientific research trial conducted on human participants to test safety and effectiveness.' },
      { term: 'peer-reviewed', def: 'Research that has been evaluated and approved by independent experts before publication.' },
      { term: 'in vitro', def: 'Experiments performed in a lab (e.g. in a test tube), not inside a living body.' },
      { term: 'in vivo', def: 'Experiments or studies conducted inside a living organism.' },
      { term: 'double-blind', def: 'A study design where neither participants nor researchers know who receives the treatment or placebo.' },
      { term: 'placebo', def: 'An inactive treatment (e.g. sugar pill) used as a comparison in clinical studies.' },
      { term: 'systemic', def: 'Affecting the whole body, not just one area — oral bacteria can enter the bloodstream.' },
      { term: 'subgingival', def: 'Below the gum line — the area between your gums and teeth where bacteria can hide.' },
      { term: 'supragingival', def: 'Above the gum line — the visible surface of teeth where plaque first forms.' },
      { term: 'colonisation', def: 'The process of bacteria establishing themselves and multiplying in a specific area.' },
      { term: 'colonization', def: 'The process of bacteria establishing themselves and multiplying in a specific area.' },
      { term: 'gingival', def: 'Relating to the gums.' },
      { term: 'inflammatory', def: 'Causing or related to inflammation — the body\'s response to irritation or infection.' },
      { term: 'cariogenic', def: 'Capable of causing tooth decay (cavities).' },
      { term: 'encapsulation', def: 'A technology that coats probiotics in a protective layer so they stay alive until they reach the target area.' }
    ];

    /* sort longest-first so multi-word terms match before sub-terms */
    glossary.sort(function (a, b) { return b.term.length - a.term.length; });

    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    var matched = {}; /* track first-occurrence-only per term */

    textNodes.forEach(function (node) {
      if (!node.parentNode) return;
      var parent = node.parentNode;
      /* skip if already inside a tooltip, heading, link, or script */
      if (parent.closest && (parent.closest('.blog-glossary') || parent.closest('a') || parent.closest('h1') || parent.closest('h2') || parent.closest('h3') || parent.closest('script') || parent.closest('style'))) return;
      if (parent.tagName === 'A' || parent.tagName === 'H2' || parent.tagName === 'H3') return;

      var text = node.nodeValue;
      var replacements = [];

      glossary.forEach(function (g) {
        if (matched[g.term.toLowerCase()]) return;
        var regex = new RegExp('\\b(' + g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'i');
        var m = regex.exec(text);
        if (m) {
          replacements.push({ index: m.index, length: m[0].length, original: m[0], def: g.def, termKey: g.term.toLowerCase() });
        }
      });

      if (!replacements.length) return;

      /* only keep first match per node to avoid overlapping */
      replacements.sort(function (a, b) { return a.index - b.index; });
      var filtered = [];
      var lastEnd = 0;
      replacements.forEach(function (r) {
        if (r.index >= lastEnd) {
          filtered.push(r);
          lastEnd = r.index + r.length;
        }
      });

      var frag = document.createDocumentFragment();
      var pos = 0;
      filtered.forEach(function (r) {
        if (matched[r.termKey]) {
          /* already matched elsewhere, skip */
          return;
        }
        matched[r.termKey] = true;
        if (r.index > pos) frag.appendChild(document.createTextNode(text.slice(pos, r.index)));
        var span = document.createElement('span');
        span.className = 'blog-glossary';
        span.setAttribute('tabindex', '0');
        span.setAttribute('role', 'button');
        span.setAttribute('aria-label', r.original + ': ' + r.def);
        span.innerHTML = r.original + '<span class="blog-glossary__tip">' + r.def + '</span>';
        frag.appendChild(span);
        pos = r.index + r.length;
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      if (pos > 0) parent.replaceChild(frag, node);
    });

    /* toggle on tap for mobile */
    document.addEventListener('click', function (e) {
      var gl = e.target.closest('.blog-glossary');
      document.querySelectorAll('.blog-glossary.is-open').forEach(function (el) {
        if (el !== gl) el.classList.remove('is-open');
      });
      if (gl) {
        e.preventDefault();
        gl.classList.toggle('is-open');
      }
    });
  }

  /* ───────────────────────────────────────
     5c. DYNAMIC TOC GENERATION
     ─────────────────────────────────────── */
  function initDynamicTOC() {
    var article = document.querySelector('.blog-content');
    if (!article) return;
    var headings = article.querySelectorAll('h2');
    if (!headings.length) return;

    /* ensure every h2 has an id */
    headings.forEach(function (h, i) {
      if (!h.id) {
        var slug = h.textContent.trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
        h.id = slug || ('section-' + (i + 1));
      }
    });

    /* populate desktop TOC */
    var desktopNav = document.querySelector('.blog-toc');
    if (desktopNav && !desktopNav.querySelectorAll('.blog-toc__item').length) {
      headings.forEach(function (h) {
        var a = document.createElement('a');
        a.className = 'blog-toc__item';
        a.href = '#' + h.id;
        a.textContent = h.textContent.trim();
        desktopNav.appendChild(a);
      });
    }

    /* populate mobile TOC accordion */
    var mobileInner = document.querySelector('.blog-toc-mobile__body-inner');
    if (mobileInner && !mobileInner.querySelectorAll('.blog-toc__item').length) {
      headings.forEach(function (h) {
        var a = document.createElement('a');
        a.className = 'blog-toc__item';
        a.href = '#' + h.id;
        a.textContent = h.textContent.trim();
        mobileInner.appendChild(a);
      });
    }
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
    }, { rootMargin: '-100px 0px -70% 0px', threshold: 0 });

    headings.forEach(function (h) { observer.observe(h); });

    tocItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(item.getAttribute('href').substring(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        /* close mobile accordion if open */
        var mobileWrap = document.querySelector('.blog-toc-mobile');
        if (mobileWrap) {
          mobileWrap.classList.remove('is-open');
          var trigger = mobileWrap.querySelector('.blog-toc-mobile__trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  /* ───────────────────────────────────────
     7. MOBILE TOC MODAL
     ─────────────────────────────────────── */
  function initMobileTOC() {
    var wrapper = document.querySelector('.blog-toc-mobile');
    var btn = document.querySelector('.blog-toc-mobile__trigger');
    if (!wrapper || !btn) return;

    btn.addEventListener('click', function () {
      var isOpen = wrapper.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
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

  /* ───────────────────────────────────────
     9. CONTENT ANIMATIONS (h2, img, hr)
     ─────────────────────────────────────── */
  function initContentAnimations() {
    var headings = document.querySelectorAll('.blog-content h2');
    var images   = document.querySelectorAll('.blog-content img');
    var dividers = document.querySelectorAll('.blog-content hr, .blog-divider');

    var allElements = [];
    headings.forEach(function (el) { allElements.push(el); });
    images.forEach(function (el) { allElements.push(el); });
    dividers.forEach(function (el) { allElements.push(el); });

    if (!allElements.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    allElements.forEach(function (el) { observer.observe(el); });
  }

})();
