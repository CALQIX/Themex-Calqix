import "./modal-swiper.js";

(function () {
  "use strict";

  if (!customElements.get("product-video-reels")) {
    class ProductVideoReels extends HTMLElement {
      constructor() {
        super();
        this.swiperContainer = this.querySelector(".wt-slider__container");
        this.modalOverlay = null;
        this.slides = []; // { src, cardHTML, item }
        this.currentIndex = 0;
        this.pageBody = document.querySelector("body");
        this.bodyActiveModalClass = "video-reels-modal-opened";
      }

      connectedCallback() {
        this.checkInterval = setInterval(() => this.checkSwiperInit(), 500);

        const ds = this.dataset;

        this.options = {
          autoAdvanceOnEnd: ds.autoAdvanced === "true",
          showUnmute: ds.showUnmute === "true",
          showPlayPause: ds.showPlayPause === "true",
          showQuickAdd: ds.showQuickAdd === "true",
          threshold: 5,
        };
      }

      disconnectedCallback() {
        clearInterval(this.checkInterval);
      }

      checkSwiperInit() {
        if (
          this.swiperContainer &&
          this.swiperContainer.classList.contains("swiper-initialized")
        ) {
          clearInterval(this.checkInterval);
          this.initSlides();
          this.initItemClicks();
        }
      }

      initSlides() {
        this.slides = Array.from(
          this.querySelectorAll(".wt-product-video-reels__item"),
        ).map((item) => {
          const videoEl = item.querySelector("video");
          const src =
            videoEl.querySelector("source")?.src || videoEl.currentSrc || "";
          const cardEl = item.querySelector(".shoppable-product-card");

          if (!this.options.showQuickAdd)
            cardEl?.classList.add("shoppable-product-card--disable-quick-add");

          return { src, cardHTML: cardEl?.outerHTML || "", item };
        });
      }

      initItemClicks() {
        this.slides.forEach((slide, idx) => {
          slide.item.style.cursor = "pointer";
          slide.item.addEventListener("click", () => this.openModalAt(idx));
        });
      }

      openModalAt(index) {
        this.currentIndex = index;
        // build your slides array once at initSlides()
        // e.g. [{ src, cardHTML }, …]
        this.modal = document.createElement("modal-swiper");
        this.modal.slides = this.slides; // pass the data
        this.modal.config = {
          initialSlide: index,
          slidesPerView: 1,
          centeredSlides: true,
          direction: "vertical",
          loop: true,
          navigation: {
            nextEl: ".video-reels-modal__nav--next",
            prevEl: ".video-reels-modal__nav--prev",
          },
          pagination: false,
          ...this.options,
        };
        this.modal.open();
      }

      navigate(delta) {
        this.currentIndex =
          (this.currentIndex + delta + this.slides.length) % this.slides.length;
        const { src, cardHTML } = this.slides[this.currentIndex];
        const vid = this.modalOverlay.querySelector(
          ".video-reels-modal__video",
        );
        vid.pause();
        vid.src = src;
        vid.load();
        vid.play();
        this.modalOverlay.querySelector(".video-reels-modal__card").innerHTML =
          cardHTML;
      }

      closeModal() {
        if (!this.modalOverlay) return;
        const vid = this.modalOverlay.querySelector("video");
        if (vid) {
          vid.pause();
          vid.currentTime = 0;
        }
        this.modalOverlay.remove();
        this.modalOverlay = null;
        this.pageBody.classList.remove(this.bodyActiveModalClass);
      }
    }

    customElements.define("product-video-reels", ProductVideoReels);
  }
})();
