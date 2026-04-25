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
      bindBubbles(container, bubbles, swiper);
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

  function bindBubbles(container, bubbles, swiper) {
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
        bubbles[idx].addEventListener('click', function (e) {
          e.preventDefault();
          // Use slideTo when not in loop mode; slideToLoop when loop is on.
          if (swiper.params && swiper.params.loop && typeof swiper.slideToLoop === 'function') {
            swiper.slideToLoop(idx);
          } else {
            swiper.slideTo(idx);
          }
        });
      })(i);
    }

    swiper.on('slideChange', function () {
      var idx = typeof swiper.realIndex === 'number' ? swiper.realIndex : swiper.activeIndex;
      setActive(idx);
    });

    // Initial sync (variant or deep-link may have advanced the swiper before we bound).
    var initialIdx = typeof swiper.realIndex === 'number' ? swiper.realIndex : swiper.activeIndex;
    setActive(initialIdx || 0);
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
