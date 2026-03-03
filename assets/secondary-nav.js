import Swiper from "./swiper-bundle.esm.browser.min.js";

if (!customElements.get("secondary-nav")) {
  customElements.define(
    "secondary-nav",
    class SecondaryNav extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.scrollableElement = this.querySelector(
          ".secondary-navigation__ul",
        );
        this.container = this.querySelector(".secondary-navigation");
        this.swiperEl = this.querySelector('.swiper');
        this.dataCenterSlides = this.dataset.centerSlides === '';

       this.initSwiper();
      }

      initSwiper(){
        // functions        
        const scrollToActiveSlide = (swiperEvent) => {
          const activeClass = 'secondary-navigation__swiper-slide--active'
          const slides = [...swiperEvent.slides];

          const activeSlideIndex = slides.findIndex((el) => el.classList.contains(activeClass));
          if (activeSlideIndex) {
            const speed = activeSlideIndex * 220
            swiperEvent.slideTo(activeSlideIndex, speed, true)
          }
        }

        const centerSlides = (swiperEvent) => {
          const shouldBeCentered = swiperEvent.snapGrid.length === 1 && swiperEvent.snapGrid[0] === -0;
          swiperEvent.wrapperEl.classList.toggle('secondary-navigation__swiper-wrapper--center', shouldBeCentered)
        }

        // swiper initialization
        this.swiper = new Swiper(this.swiperEl, {
          loop: false,
          slidesPerView: 'auto',
          spaceBetween: 0,
          init: false,
          navigation: {
            nextEl: this.querySelector('.swiper-button-next'),
            prevEl: this.querySelector('.swiper-button-prev'),
          },
        });

        this.swiper.on('afterInit', scrollToActiveSlide)
        if (this.dataCenterSlides){
          this.swiper.on('init', centerSlides)
          this.swiper.on('resize', centerSlides)
        }
        
        // init
        this.swiper.init();
      }

      disconnectedCallback() {
        this.swiper?.destroy(true, true);
      }

    },
  );
}
