(function () {
  var roots = document.querySelectorAll('[data-glow-pro-section]');
  if (!roots.length) return;

  roots.forEach(function (root) {
    var faqItems = root.querySelectorAll('[data-gp-faq-item]');
    faqItems.forEach(function (item) {
      var trigger = item.querySelector('.gp-faq-trigger');
      var answer = item.querySelector('.gp-faq-answer');
      var inner = item.querySelector('.gp-faq-answer__inner');
      if (!trigger || !answer || !inner) return;

      trigger.addEventListener('click', function () {
        var isOpen = item.classList.contains('is-open');

        faqItems.forEach(function (other) {
          if (other === item || !other.classList.contains('is-open')) return;
          other.classList.remove('is-open');
          other.querySelector('.gp-faq-trigger').setAttribute('aria-expanded', 'false');
          other.querySelector('.gp-faq-answer').style.maxHeight = '0px';
        });

        if (isOpen) {
          item.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
          answer.style.maxHeight = '0px';
        } else {
          item.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
          answer.style.maxHeight = inner.scrollHeight + 24 + 'px';
        }
      });
    });

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

      faqItems.forEach(function (item) {
        observer.observe(item);
      });
    } else {
      faqItems.forEach(function (item) {
        item.classList.add('is-visible');
      });
    }

    var sliders = root.querySelectorAll('[data-gp-scroll]');
    sliders.forEach(function (slider) {
      var startX = 0;
      var startScroll = 0;
      var dragging = false;

      slider.addEventListener('pointerdown', function (event) {
        if (window.matchMedia('(max-width: 900px)').matches === false) return;
        dragging = true;
        startX = event.clientX;
        startScroll = slider.scrollLeft;
        slider.setPointerCapture(event.pointerId);
      });

      slider.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        slider.scrollLeft = startScroll - (event.clientX - startX);
      });

      slider.addEventListener('pointerup', function () {
        dragging = false;
      });

      slider.addEventListener('pointercancel', function () {
        dragging = false;
      });
    });
  });
})();
