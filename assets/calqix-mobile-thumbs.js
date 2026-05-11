/* CALQIX mobile pentagon thumbnail overlay — wires bubbles to the gallery swiper.
 *
 * Looks for `[data-cqmt]` containers, finds the closest `gallery-section`,
 * waits for its `gallerySwiper` (initialized by gallery.js), and:
 *   - on bubble click → swiper.slideTo(index)
 *   - on swiper slideChange → highlights the matching bubble and centers it
 *     within the horizontally scrollable strip when needed.
 *
 * Mobile-only behavior is enforced by CSS; this script is a no-op on desktop
 * because bubbles are not rendered visible there but we still wire them in
 * case of resize.
 */
(function () {
  function init() {
    var containers = document.querySelectorAll('[data-cqmt]');
    for (var i = 0; i < containers.length; i++) {
      setup(containers[i]);
    }
  }

  function setup(container) {
    if (container.dataset.cqmtBound === '1') return;

    var section = container.closest('gallery-section');
    if (!section) return;

    var bubbles = container.querySelectorAll('[data-cqmt-bubble]');
    if (!bubbles.length) return;

    container.dataset.cqmtBound = '1';

    waitForSwiper(section, function (swiper) {
      bindBubbles(section, container, bubbles, swiper);
    });
  }

  function waitForSwiper(section, cb) {
    var attempts = 0;
    var maxAttempts = 80; // ~8s at 100ms

    function check() {
      if (section.gallerySwiper && typeof section.gallerySwiper.slideTo === 'function') {
        cb(section.gallerySwiper);
        return;
      }
      if (++attempts >= maxAttempts) return;
      setTimeout(check, 100);
    }
    check();
  }

  function bindBubbles(section, container, bubbles, swiper) {
    function setActive(idx) {
      for (var i = 0; i < bubbles.length; i++) {
        if (i === idx) {
          bubbles[i].classList.add('is-active');
          bubbles[i].setAttribute('aria-current', 'true');
          centerBubble(container, bubbles[i]);
        } else {
          bubbles[i].classList.remove('is-active');
          bubbles[i].removeAttribute('aria-current');
        }
      }
    }

    for (var i = 0; i < bubbles.length; i++) {
      (function (idx) {
        function activate(e) {
          e.preventDefault();
          e.stopPropagation();
          slideToMedia(section, swiper, bubbles[idx].getAttribute('data-media-id'), idx);
        }
        bubbles[idx].addEventListener('click', activate, true);
        bubbles[idx].addEventListener('pointerup', activate, true);
      })(i);
    }

    swiper.on('slideChange', function () {
      var mediaId = getActiveMediaId(section, swiper);
      var idx = indexBubbleByMediaId(bubbles, mediaId);
      if (idx < 0) idx = typeof swiper.realIndex === 'number' ? swiper.realIndex : swiper.activeIndex;
      setActive(idx);
    });

    // Initial sync (variant or deep-link may have advanced the swiper before we bound).
    var initialMediaId = getActiveMediaId(section, swiper);
    var initialIdx = indexBubbleByMediaId(bubbles, initialMediaId);
    if (initialIdx < 0) initialIdx = typeof swiper.realIndex === 'number' ? swiper.realIndex : swiper.activeIndex;
    setActive(initialIdx || 0);
  }

  function slideToMedia(section, swiper, mediaId, fallbackIdx) {
    var idx = indexGallerySlideByMediaId(section, mediaId);
    if (idx < 0) idx = fallbackIdx;

    if (swiper.params && swiper.params.loop && typeof swiper.slideToLoop === 'function') {
      swiper.slideToLoop(idx);
    } else {
      swiper.slideTo(idx);
    }

    if (section.thumbsSwiper && typeof section.thumbsSwiper.slideTo === 'function') {
      section.thumbsSwiper.slideTo(idx);
    }
    setNativeThumbActive(section, mediaId);
  }

  function getActiveMediaId(section, swiper) {
    var activeSlide = section.querySelector('[data-gallery] .swiper-slide-active[data-media-id]');
    if (activeSlide) return activeSlide.getAttribute('data-media-id');
    var idx = typeof swiper.realIndex === 'number' ? swiper.realIndex : swiper.activeIndex;
    var slides = section.querySelectorAll('[data-gallery] [data-swiper-slide][data-media-id], [data-gallery] .swiper-slide[data-media-id]');
    return slides[idx] ? slides[idx].getAttribute('data-media-id') : '';
  }

  function indexBubbleByMediaId(bubbles, mediaId) {
    if (!mediaId) return -1;
    for (var i = 0; i < bubbles.length; i++) {
      if (bubbles[i].getAttribute('data-media-id') === mediaId) return i;
    }
    return -1;
  }

  function indexGallerySlideByMediaId(section, mediaId) {
    if (!mediaId) return -1;
    var slides = section.querySelectorAll('[data-gallery] [data-swiper-slide][data-media-id], [data-gallery] .swiper-slide[data-media-id]');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].getAttribute('data-media-id') === mediaId) return i;
    }
    return -1;
  }

  function setNativeThumbActive(section, mediaId) {
    if (!mediaId) return;
    var thumbs = section.querySelectorAll('[data-thumbs] [data-slide-media-id]');
    for (var i = 0; i < thumbs.length; i++) {
      var active = thumbs[i].getAttribute('data-slide-media-id') === mediaId;
      thumbs[i].classList.toggle('swiper-slide-thumb-active', active);
      thumbs[i].classList.toggle('swiper-slide-active', active);
      if (active) {
        thumbs[i].setAttribute('aria-current', 'true');
      } else {
        thumbs[i].removeAttribute('aria-current');
      }
    }
  }

  function centerBubble(container, bubble) {
    if (!container || !bubble) return;
    // Only auto-center when there is overflow to scroll.
    if (container.scrollWidth <= container.clientWidth + 2) return;

    var target =
      bubble.offsetLeft - container.clientWidth / 2 + bubble.offsetWidth / 2;
    var max = container.scrollWidth - container.clientWidth;
    if (target < 0) target = 0;
    if (target > max) target = max;

    try {
      container.scrollTo({ left: target, behavior: 'smooth' });
    } catch (err) {
      container.scrollLeft = target;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();

/* OralBiome gallery/USP guard. Kept in this asset because it is loaded by the
 * product gallery across cached HTML variants, so it reaches browser traffic
 * even when Shopify serves a stale Liquid fragment.
 */
(function () {
  function isOralBiomePage() {
    return document.body.classList.contains('template-product-oralbiome') ||
      window.location.pathname.toLowerCase().indexOf('oralbiome') !== -1 ||
      /OralBiome/i.test(document.title || '');
  }

  function bindGalleryZoom() {
    if (!isOralBiomePage()) return;
    var gallery = document.querySelector('gallery-section[data-product-page]');
    if (!gallery) return;

    gallery.querySelectorAll('[data-gallery] a[href*="/cdn/shop/files"], [data-gallery] a[href*="cdn/shop/files"]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
      });
      link.removeAttribute('target');
    });

    gallery.querySelectorAll('[data-gallery] .wt-product__img').forEach(function (image) {
      if (image.dataset.cqZoomBound === '1') return;
      image.dataset.cqZoomBound = '1';
      image.addEventListener('pointermove', function (event) {
        if (event.pointerType === 'touch') return;
        var rect = image.getBoundingClientRect();
        var x = ((event.clientX - rect.left) / rect.width) * 100;
        var y = ((event.clientY - rect.top) / rect.height) * 100;
        image.style.setProperty('--cq-zoom-x', Math.max(0, Math.min(100, x)).toFixed(2) + '%');
        image.style.setProperty('--cq-zoom-y', Math.max(0, Math.min(100, y)).toFixed(2) + '%');
      }, { passive: true });
      image.addEventListener('pointerleave', function () {
        image.style.removeProperty('--cq-zoom-x');
        image.style.removeProperty('--cq-zoom-y');
      }, { passive: true });
    });
  }

  function bindGalleryThumbs() {
    if (!isOralBiomePage()) return;
    var gallery = document.querySelector('gallery-section[data-product-page]');
    if (!gallery) return;

    if (gallery.dataset.cqThumbsDelegated === '1') return;
    gallery.dataset.cqThumbsDelegated = '1';

    function activate(event) {
      var thumb = event.target.closest && event.target.closest('[data-thumbs] [data-slide-media-id]');
      if (!thumb || !gallery.contains(thumb)) return;

      var mediaId = thumb.getAttribute('data-slide-media-id');
      if (!mediaId) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      waitForSwiper(gallery, function (swiper) {
        var liveThumbs = Array.prototype.slice.call(gallery.querySelectorAll('[data-thumbs] [data-slide-media-id]'));
        slideToMedia(gallery, swiper, mediaId, liveThumbs.indexOf(thumb));
      });
    }

    gallery.addEventListener('click', activate, true);
    gallery.addEventListener('pointerup', activate, true);
  }

  function ensureUsps() {
    if (!isOralBiomePage()) return;
    if (document.querySelector('.calqix-obp-usp-fallback')) return;
    var switcher = document.querySelector('.calqix-colour-switcher-block, [id^="ccs-block-"]');
    if (!switcher || !switcher.parentNode) return;

    var items = [
      ['4 studied oral strains', '<path d="M8 30h24M20 30V10M10 10h20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="20" r="5" stroke="currentColor" stroke-width="1.8"/><circle cx="28" cy="20" r="5" stroke="currentColor" stroke-width="1.8"/><path d="M16 20h8" stroke="#9f7d27" stroke-width="1.6" stroke-linecap="round"/>'],
      ['Fresh breath support', '<ellipse cx="20" cy="22" rx="11" ry="6" stroke="currentColor" stroke-width="1.8"/><circle cx="20" cy="20" r="8" stroke="#9f7d27" stroke-width="1.6"/><path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'],
      ['One lozenge daily', '<path d="M26 8a12 12 0 1 0 0 24 9 9 0 0 1 0-24Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><ellipse cx="14" cy="28" rx="5.5" ry="3.2" stroke="#9f7d27" stroke-width="1.8"/><circle cx="30" cy="14" r="1" fill="currentColor"/>'],
      ['30-day supply per jar', '<circle cx="20" cy="20" r="13" stroke="currentColor" stroke-width="1.8"/><circle cx="20" cy="20" r="13" stroke="#9f7d27" stroke-width="1.8" stroke-dasharray="2 4"/><text x="20" y="24" text-anchor="middle" font-family="DM Serif Display, Georgia, serif" font-size="11" fill="currentColor">30</text>']
    ];

    var wrapper = document.createElement('div');
    wrapper.className = 'calqix-obp-usp-fallback calqix-inline-usps';
    wrapper.setAttribute('data-block-id', 'oralbiome-usp-fallback');
    wrapper.innerHTML = '<ul class="calqix-obp-usp-fallback__list" role="list">' + items.map(function (item) {
      return '<li class="calqix-obp-usp-fallback__item"><span class="calqix-obp-usp-fallback__icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">' + item[1] + '</svg></span><span class="calqix-obp-usp-fallback__text">' + item[0] + '</span></li>';
    }).join('') + '</ul>';
    switcher.parentNode.insertBefore(wrapper, switcher);
  }

  function initOralBiomeGuard() {
    bindGalleryZoom();
    bindGalleryThumbs();
    ensureUsps();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOralBiomeGuard);
  } else {
    initOralBiomeGuard();
  }
  document.addEventListener('shopify:section:load', initOralBiomeGuard);
})();
