if (!customElements.get("products-slider")) {
  customElements.define(
    "products-slider",
    class ProductsSliders extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.interval = setInterval(() => {
          const mainSliderContainer = this.querySelector(
            ".wt-products-slider__slider--products [data-swiper]",
          );
          const promoSliderContainer = this.querySelector(
            ".wt-products-slider__slider--promo [data-swiper]",
          );

          const mainSlider = mainSliderContainer?.swiper;
          const promoSlider = promoSliderContainer?.swiper;

          if (mainSlider && promoSlider) {
            clearInterval(this.interval);
            this.initializeSync(mainSlider, promoSlider);
          }
        }, 100);
      }

      initializeSync(mainSlider, promoSlider) {
        const updateCssVariables = (slider) => {
          const activeSlide = slider.slides[slider.activeIndex];

          if (activeSlide) {
            const activeSlideStyles = getComputedStyle(activeSlide);

            const cssVariableValue = activeSlideStyles
              .getPropertyValue("--slide-text-color")
              .trim();

            this.style.setProperty("--slider-bullets-color", cssVariableValue);
          }
        };

        updateCssVariables(mainSlider);
        updateCssVariables(promoSlider);

        mainSlider.on("slideChange", () => {
          promoSlider.slideTo(mainSlider.activeIndex);
          updateCssVariables(mainSlider);
        });

        promoSlider.on("slideChange", () => {
          mainSlider.slideTo(promoSlider.activeIndex);
          updateCssVariables(promoSlider);
        });
      }

      disconnectedCallback() {
        if (this.interval) {
          clearInterval(this.interval);
        }
      }
    },
  );
}
