import Swiper from "./swiper-bundle.esm.browser.min.js";

class CustomScroll extends HTMLElement {
  constructor() {
    super();

    this.init();
  }

  init() {
    const swiper = new Swiper(this, {
      direction: "vertical",
      slidesPerView: "auto",
      freeMode: true,
      grabCursor: true,
      scrollbar: {
        el: this.querySelector(".swiper-scrollbar"),
        draggable: true,
      },
      mousewheel: true,
    });
  }
}

customElements.define("custom-scroll", CustomScroll);
