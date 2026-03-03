document.addEventListener("shopify:block:select", function (event) {
  const blockSelectedIsSlide = event.target.classList.contains("swiper-slide");
  if (!blockSelectedIsSlide) return;

  const parentSlideshowComponent = event.target.closest("slideshow-section");
  parentSlideshowComponent.slideTo(event.target);
});
