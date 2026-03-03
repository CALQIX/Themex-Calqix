document.addEventListener("shopify:block:select", function (event) {
  const blockSelectedIsSlide = event.target.classList.contains("swiper-slide");
  if (!blockSelectedIsSlide) return;

  const parentProductsSlider = event.target.closest("products-slider");
  if (!parentProductsSlider) {
    console.error("Parent <products-slider /> not found");
    return;
  }

  const slideshows = parentProductsSlider.querySelectorAll("slideshow-section");

  if (slideshows.length === 0) {
    console.error("No <slideshow-section /> found inside <products-slider />");
    return;
  }

  slideshows.forEach((slideshowSection) => {
    if (typeof slideshowSection.slideTo === "function") {
      slideshowSection.slideTo(event.target);
      console.log(`Slide updated in <slideshow-section />`, slideshowSection);
    } else {
      console.error(
        `<slideshow-section /> does not have a slideTo method`,
        slideshowSection,
      );
    }
  });
});
