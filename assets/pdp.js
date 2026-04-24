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
    const ctaBtn = this.querySelector(".cq-sticky__cta");
    if (!addToCartModule || !ctaBtn) return;
    const addToCart = this.dataset.addToCart === "";

    const forObserver = document.querySelectorAll(
      ".wt-product__add-to-cart, .wt-footer, .wt-product__name",
    );

    let intersected = [];

    ctaBtn.addEventListener("click", (e) => {
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

    this.setupPriceSync(addToCartModule);
    this.setupQuantitySync(addToCartModule);
  }

  /**
   * Mirror the main PDP price block into the sticky bar so variant, subscription
   * and flavor/bundle selections are reflected in the sticky price automatically.
   * We target `#price-{sectionId}` which assets/variants.js#renderProductInfo
   * rewrites after every variant change, and also listen for ad-hoc price DOM
   * mutations (subscription toggles, rebuild-kit bundle picker, etc.) via a
   * MutationObserver so any code that updates the on-page price flows through.
   */
  setupPriceSync(addToCartModule) {
    const sectionId = this.dataset.sectionId;
    const slot = this.querySelector("[data-cq-sticky-price-slot]");
    if (!slot) return;

    const mainPriceEl =
      (sectionId && document.getElementById(`price-${sectionId}`)) ||
      addToCartModule.querySelector("[id^='price-']") ||
      addToCartModule.querySelector(".wt-product__price");
    if (!mainPriceEl) return;

    // The main price element typically contains a strike-through compare-at
    // span plus the current selling price span. For the sticky CTA we want a
    // compact single price, so prefer the most specific "current price" node
    // when it exists; fall back to the full innerHTML otherwise.
    const pickCompact = () => {
      const candidates = [
        ".price-item--sale:not(.price-item--regular)",
        ".price-item--last",
        ".wt-product__price__current",
        ".price-item--sale",
        ".price-item--regular",
      ];
      for (const sel of candidates) {
        const el = mainPriceEl.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim();
        }
      }
      const text = mainPriceEl.textContent.replace(/\s+/g, " ").trim();
      return text || mainPriceEl.innerHTML;
    };

    const mirror = () => {
      slot.textContent = pickCompact();
    };

    mirror();
    const observer = new MutationObserver(mirror);
    observer.observe(mainPriceEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /**
   * Two-way quantity sync between the sticky bar stepper and the main PDP
   * <quantity-counter> component. The main component is the source of truth —
   * its +/- buttons own validation, min/max clamping, etc. So the sticky bar
   * stepper proxies clicks to the main buttons and mirrors the resulting
   * value back into its own input.
   */
  setupQuantitySync(addToCartModule) {
    const stickyQtyWrap = this.querySelector("[data-cq-sticky-qty]");
    // Qty stepper is intentionally hidden in the sticky bar (user requested
    // price-only display). Skip all wiring so we don't pay for event listeners
    // on elements the user cannot interact with. Removing `hidden` in the
    // markup is enough to re-enable stepper behaviour later.
    if (stickyQtyWrap && stickyQtyWrap.hasAttribute("hidden")) return;

    const stickyDec = this.querySelector("[data-cq-sticky-qty-dec]");
    const stickyInc = this.querySelector("[data-cq-sticky-qty-inc]");
    const stickyInput = this.querySelector("[data-cq-sticky-qty-input]");
    if (!stickyDec || !stickyInc || !stickyInput) return;

    const mainInput = addToCartModule.querySelector(".js-counter-quantity");
    const mainDec = addToCartModule.querySelector(".js-counter-decrease");
    const mainInc = addToCartModule.querySelector(".js-counter-increase");

    // If the PDP doesn't render a quantity counter (qty selector disabled),
    // let the sticky stepper drive its own hidden flow: keep the input usable
    // but no main component to proxy to.
    if (!mainInput) {
      stickyDec.addEventListener("click", () => {
        const v = Math.max(1, parseInt(stickyInput.value, 10) - 1 || 1);
        stickyInput.value = v;
      });
      stickyInc.addEventListener("click", () => {
        const v = Math.min(999, (parseInt(stickyInput.value, 10) || 1) + 1);
        stickyInput.value = v;
      });
      return;
    }

    // Prime sticky with current main value
    stickyInput.value = mainInput.value || "1";

    // Sticky -> main (proxy to counter buttons so all events fire correctly)
    stickyDec.addEventListener("click", () => {
      if (mainDec) {
        mainDec.click();
      } else {
        mainInput.value = Math.max(1, (parseInt(mainInput.value, 10) || 1) - 1);
        mainInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    stickyInc.addEventListener("click", () => {
      if (mainInc) {
        mainInc.click();
      } else {
        mainInput.value = Math.min(999, (parseInt(mainInput.value, 10) || 1) + 1);
        mainInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Typed input on sticky -> main
    stickyInput.addEventListener("change", () => {
      const v = Math.max(1, Math.min(999, parseInt(stickyInput.value, 10) || 1));
      stickyInput.value = v;
      if (mainInput.value !== String(v)) {
        mainInput.value = v;
        mainInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Main -> sticky (catch clicks on main +/-, typed changes, and any
    // programmatic updates from cart-drawer re-render or flavor picker)
    const mirror = () => {
      if (stickyInput.value !== mainInput.value) {
        stickyInput.value = mainInput.value;
      }
    };
    mainInput.addEventListener("input", mirror);
    mainInput.addEventListener("change", mirror);
    new MutationObserver(mirror).observe(mainInput, {
      attributes: true,
      attributeFilter: ["value"],
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
