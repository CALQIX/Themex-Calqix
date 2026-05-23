(function () {
  var roots = document.querySelectorAll('[data-glow-pro-section]');
  if (!roots.length) return;

  roots.forEach(function (root) {
    var details = root.querySelectorAll('.gp-faq-item');
    details.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        details.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });

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
