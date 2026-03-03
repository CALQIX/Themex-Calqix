class StickyBuyButton extends HTMLElement {
  constructor() {
    super();

    this.activeClass = "wt-product__sticky-buy--show";
  }

  connectedCallback() {
    this.initialize();
  }

  initialize() {
    const addToCartModule = document.querySelector(".wt-product__add-to-cart");
    const btn = this.querySelector("button");
    const addToCart = this.dataset.addToCart === "";

    const forObserver = document.querySelectorAll(
      ".wt-product__add-to-cart, .wt-footer, .wt-product__name",
    );

    let intersected = [];

    btn.addEventListener("click", (e) => {
      if (!addToCart) {
        e.preventDefault();
      }
      addToCartModule.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        isIntersecting
          ? intersected.push(target)
          : (intersected = intersected.filter((item) => item !== target));
      });

      if (intersected.length) {
        this.classList.remove(this.activeClass);
      } else {
        this.classList.add(this.activeClass);
      }
    });

    forObserver.forEach((item) => {
      observer.observe(item);
    });
  }
}

customElements.define("sticky-buy-button", StickyBuyButton);

if (!customElements.get("gallery-fashion")) {
  customElements.define(
    "gallery-fashion",
    class GalleryFashion extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
        this.logoBanner = this;
      }

      connectedCallback() {
        this.init();
      }

      disconnectedCallback() {
        this.removeEventsWhenDesignMode();
      }

      addEventsWhenDesignMode() {
        if (Shopify.designMode) {
          document.addEventListener(
            "shopify:section:load",
            this.reinitAfterDelay,
          );
          document.addEventListener(
            "shopify:section:unload",
            this.reinitAfterDelay,
          );
        }
      }

      removeEventsWhenDesignMode() {
        if (Shopify.designMode) {
          document.removeEventListener(
            "shopify:section:load",
            this.reinitAfterDelay,
          );
          document.removeEventListener(
            "shopify:section:unload",
            this.reinitAfterDelay,
          );
        }
      }

      reinitAfterDelay() {
        setTimeout(() => this.reinit(), 0);
      }

      isFirstSection() {
        const sectionWrapper = document.querySelector("#root");
        const firstSection = sectionWrapper.querySelector("section");
        this.section = this.closest("section");
        const currentSection = this.section;

        return firstSection === currentSection;
      }

      handleResize() {
        this.setTopMargin();
        this.positioningProductInfo();
      }

      observeHeader() {
        const header = document.querySelector(".wt-header");
        const activeTransparentClass = "wt-header--fashion-transparent";

        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                header.classList.remove(activeTransparentClass);
              } else {
                header.classList.add(activeTransparentClass);
              }
            });
          },
          { root: null, threshold: 0.05 },
        );

        observer.observe(this.querySelector(".wt-product__gallery"));
      }

      calculateOffset() {
        const header = document.querySelector("header");
        const headerHeight = header.offsetHeight;
        const offset =
          this.isTransparentHeaderEnabled() && this.isFirstSection()
            ? headerHeight
            : 0;

        return offset;
      }

      setTopMargin() {
        const offset = this.calculateOffset();
        if (offset) {
          this.section.style.marginTop = `-${offset}px`;
        } else {
          this.section.style.marginTop = 0;
        }
      }

      isTransparentHeaderEnabled() {
        const header = document.querySelector(".wt-header");
        return (
          header.dataset.transparent &&
          header.classList.contains("wt-header--v3")
        );
      }

      renderProgressBar() {
        const thumbsGallery = this.querySelector("[data-thumbs]");
        const progressBarElement = document.createElement("div");
        progressBarElement.classList.add("gallery-fashion__progress-bar");
        const progressBarIndicatorElement = document.createElement("div");
        progressBarIndicatorElement.classList.add(
          "gallery-fashion__progress-bar-indicator",
        );
        progressBarElement.appendChild(progressBarIndicatorElement);
        thumbsGallery.appendChild(progressBarElement);

        function updateProgressBar() {
          const images = this.querySelector("gallery-section");
          const progressBar = progressBarIndicatorElement;

          const scrolled = window.scrollY;
          const maxHeight = images.clientHeight - window.innerHeight;
          const scrollPercentage = (scrolled / maxHeight) * 100;

          const progressBarHeight = progressBarElement.clientHeight;
          const progressHeight = progressBar.clientHeight;
          const maxProgressTop = progressBarHeight - progressHeight;
          const progressTop = Math.min(
            (scrollPercentage / 100) * maxProgressTop,
            maxProgressTop,
          );

          progressBar.style.top = `${progressTop}px`;

          if (progressTop === maxProgressTop) {
            thumbsGallery.classList.add("finished");
          } else {
            thumbsGallery.classList.remove("finished");
          }
        }

        window.addEventListener("scroll", updateProgressBar.bind(this));

        function handleThumbsClick(event) {
          if (event.target.closest(".thumbs-list-item")) {
            const thumbnails = Array.from(
              event.currentTarget.querySelectorAll(".wt-product__img"),
            );
            const targetImage = event.target
              .closest(".thumbs-list-item")
              .querySelector(".wt-product__img");
            const index = thumbnails.indexOf(targetImage);
            const fullImage = this.querySelectorAll(
              ".wt-masonry__wrapper .wt-product__img, .wt-masonry__wrapper .wt-product__thumbnail-video",
            )[index];

            fullImage.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }

        thumbsGallery.addEventListener("click", handleThumbsClick.bind(this));
      }

      positioningProductInfo() {
        const productInfo = this.querySelector(".wt-product__main");
        const mediaDesktop = window.matchMedia("(min-width: 1200px)");

        if (mediaDesktop.matches) {
          productInfo.style.top = `${Math.max((window.innerHeight - productInfo.offsetHeight) / 2, 0)}px`;
        }

        const resizeObserver = new ResizeObserver((entries) => {
          for (let entry of entries) {
            if (mediaDesktop.matches) {
              productInfo.style.top = `${Math.max((window.innerHeight - productInfo.offsetHeight) / 2, 0)}px`;
            }
          }
        });

        const observedElement = productInfo;
        resizeObserver.observe(observedElement);
      }

      attachEvents() {
        window.addEventListener("resize", this.handleResize.bind(this));
      }

      /**
       * Wait until all images inside masonry wrapper are loaded
       * then run callback
       */
      waitForMasonryImages(callback) {
        const masonry = this.querySelector(".swiper-wrapper--masonry");
        if (!masonry) return;

        const images = masonry.querySelectorAll("img");
        if (images.length === 0) {
          callback();
          return;
        }

        let loaded = 0;
        const checkDone = () => {
          loaded++;
          if (loaded === images.length) {
            callback();
          }
        };

        images.forEach((img) => {
          if (img.complete) {
            checkDone();
          } else {
            img.addEventListener("load", checkDone, { once: true });
            img.addEventListener("error", checkDone, { once: true });
          }
        });
      }

      init() {
        this.reinitAfterDelay = this.reinitAfterDelay.bind(this);
        if (this.isTransparentHeaderEnabled()) {
          const stickyHeaderThreshold = document.querySelector(
            ".sticky-header__threshold",
          );
          const isHeaderSticky =
            document.body.classList.contains("page-header-sticky");
          if (isHeaderSticky) {
            this.waitForMasonryImages(() => {
              const masonry = this.querySelector(".swiper-wrapper--masonry");
              if (masonry) {
                stickyHeaderThreshold.style.height = `${masonry.offsetHeight}px`;
              }
            });
          }
          this.setTopMargin();
          this.observeHeader();
          this.attachEvents();
        }

        this.renderProgressBar();
        this.positioningProductInfo();
        this.addEventsWhenDesignMode();
      }

      reinit() {
        if (this.isTransparentHeaderEnabled()) {
          const stickyHeaderThreshold = document.querySelector(
            ".sticky-header__threshold",
          );
          const isHeaderSticky =
            document.body.classList.contains("page-header-sticky");
          if (isHeaderSticky) {
            stickyHeaderThreshold.style.height = `${this.querySelector(".swiper-wrapper--masonry").offsetHeight}px`;
          }
          this.setTopMargin();
          this.observeHeader();
        }
        this.positioningProductInfo();
      }
    },
  );
}
