(function () {
  'use strict';

  var panels = document.querySelectorAll('[data-cx-home-cro]');
  if (!panels.length) return;

  panels.forEach(function (panel) {
    var cards = panel.querySelectorAll('[data-cx-home-card]');
    if (!cards.length) return;

    var activeIndex = 0;
    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timer = null;

    function setActive(index) {
      activeIndex = index;
      cards.forEach(function (card, i) {
        card.classList.toggle('cx-is-active', i === activeIndex);
      });
    }

    function next() {
      setActive((activeIndex + 1) % cards.length);
    }

    function start() {
      if (prefersReduced || timer) return;
      timer = window.setInterval(next, 3200);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    cards.forEach(function (card, index) {
      card.addEventListener('mouseenter', function () {
        stop();
        setActive(index);
      });
      card.addEventListener('focusin', function () {
        stop();
        setActive(index);
      });
      card.addEventListener('mouseleave', start);
      card.addEventListener('focusout', start);
    });

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            start();
          } else {
            stop();
          }
        });
      }, { threshold: 0.35 });
      observer.observe(panel);
    } else {
      start();
    }
  });
})();
