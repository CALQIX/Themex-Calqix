import Swiper from "./swiper-bundle.esm.browser.min.js";

// Animation toggling classes
const ANIMATION_CLASSES = ["scroll-trigger", "animate--slide-in"];
const ANIMATION_MOBILE_DISABLED_CLASS = "disabled-on-mobile";

// Helper: find the first direct DIV inside a slide
function getSlideAnimTarget(slide) {
  const directDiv = slide.querySelector(":scope > div");
  if (directDiv) return directDiv;
  const first = slide.firstElementChild;
  if (first && first.tagName === "DIV") return first;
  return null;
}

/**
 * Add animation classes only to the initially visible slides
 * and set cascade attributes/order.
 * @param {Swiper} swiper
 * @param {Object} opts
 * @param {boolean} opts.disableOnMobile - add mobile disabling class
 * @param {boolean} [opts.cascade=true] - add data-cascade + --animation-order
 * @param {string[]} [opts.animClasses=ANIMATION_CLASSES]
 * @param {string} [opts.mobileDisabledClass=ANIMATION_MOBILE_DISABLED_CLASS]
 * @param {string} [opts.cascadeAttrName="data-cascade"]
 * @param {string} [opts.orderVarName="--animation-order"]
 * @param {number} [opts.orderStart=1]
 */
function markInitialVisibleSlides(
  swiper,
  {
    disableOnMobile = false,
    cascade = true,
    animClasses = ANIMATION_CLASSES,
    mobileDisabledClass = ANIMATION_MOBILE_DISABLED_CLASS,
    cascadeAttrName = "data-cascade",
    orderVarName = "--animation-order",
    orderStart = 1,
    force = false,
  } = {},
) {
  if (!swiper || !swiper.slides || swiper.slides.length === 0) {
    console.warn("markInitialVisibleSlides(): swiper or slides doesn't exist", {
      swiper: !!swiper,
      slides: !!swiper?.slides,
      slidesLength: swiper?.slides?.length,
    });
    return;
  }

  // Guard: run once per lifecycle
  if (swiper.__initAnimated && !force) return;

  // 1) Cleanup on all slide targets
  swiper.slides.forEach((slide) => {
    const target = getSlideAnimTarget(slide);
    if (!target) return;
    target.classList.remove(
      ...animClasses,
      ...(disableOnMobile ? [mobileDisabledClass] : []),
    );
    if (cascade) {
      target.removeAttribute(cascadeAttrName);
      target.style.removeProperty(orderVarName);
    }
  });

  // 2) Find initially visible slides
  let visible = Array.from(swiper.slides).filter((slide) =>
    slide.classList.contains("swiper-slide-visible"),
  );

  if (visible.length === 0) {
    let inViewCount = 1;
    const spv = swiper.params?.slidesPerView;
    if (typeof spv === "number") {
      inViewCount = Math.max(1, spv);
    } else {
      try {
        inViewCount = Math.max(
          1,
          Math.round(
            typeof swiper.slidesPerViewDynamic === "function"
              ? swiper.slidesPerViewDynamic("current", true) // include partials
              : 1,
          ),
        );
      } catch {
        inViewCount = 1;
      }
    }
    const start = swiper.activeIndex ?? 0;
    visible = Array.from({ length: inViewCount })
      .map((_, i) => swiper.slides[start + i])
      .filter(Boolean);
  }

  // 3) Add classes + cascade attributes only to initially visible targets
  visible.forEach((slide, i) => {
    const target = getSlideAnimTarget(slide);
    if (!target) return;

    target.classList.add(
      ...animClasses,
      ...(disableOnMobile ? [mobileDisabledClass] : []),
    );

    if (cascade) {
      target.setAttribute(cascadeAttrName, "");
      target.style.setProperty(orderVarName, String(orderStart + i));
    }
  });

  swiper.__initAnimated = true;
}

if (!customElements.get("slideshow-section")) {
  customElements.define(
    "slideshow-section",
    class Slider extends HTMLElement {
      constructor() {
        super();
        this.swiper = null;
        this.configuration = null;
        this.handleKeyboard = this.handleKeyboard.bind(this);
      }

      handleTabindex(swiper) {
        const isSlidesGroup = this.hasAttribute("data-slides-group");
        const focusableSelectors =
          "a, button, input, textarea, select, [tabindex]";
        const totalSlides = swiper.slides.length;
        const slidesPerView = swiper.params.slidesPerView;

        if (swiper && totalSlides > slidesPerView) {
          swiper.slides.forEach((slide) => {
            if (isSlidesGroup) {
              const slideRect = slide.getBoundingClientRect();
              const swiperRect = this.getBoundingClientRect();

              const isFullyVisible =
                slideRect.left >= swiperRect.left &&
                slideRect.right <= swiperRect.right &&
                slideRect.top >= swiperRect.top &&
                slideRect.bottom <= swiperRect.bottom;

              slide.querySelectorAll(focusableSelectors).forEach((el) => {
                if (isFullyVisible) {
                  el.setAttribute("tabindex", "0");
                } else {
                  el.setAttribute("tabindex", "-1");
                }
                if (el.hasAttribute("data-omit-tabindex")) {
                  el.setAttribute("tabindex", "-1");
                }
              });
            } else {
              swiper.slides.forEach((slide) => {
                slide.querySelectorAll(focusableSelectors).forEach((el) => {
                  el.setAttribute("tabindex", "-1");
                });
              });

              const activeSlide = swiper.slides[swiper.activeIndex];
              activeSlide
                ?.querySelectorAll(focusableSelectors)
                .forEach((el) => {
                  el.setAttribute(
                    "tabindex",
                    el.hasAttribute("data-omit-tabindex") ? "-1" : "0",
                  );
                });
            }
          });
        } else {
          swiper.slides.forEach((slide) => {
            slide.querySelectorAll(focusableSelectors).forEach((el) => {
              el.setAttribute(
                "tabindex",
                el.hasAttribute("data-omit-tabindex") ? "-1" : "0",
              );
            });
          });
        }
      }

      handleKeyboard(event) {
        const keyCode = event.keyCode || event.which;
        const focusedElement = document.activeElement;

        if (this.swiper && this.swiper.el.contains(focusedElement)) {
          switch (keyCode) {
            case 37: // Left arrow
              this.swiper.slidePrev();
              break;
            case 39: // Right arrow
              this.swiper.slideNext();
              break;
          }
        }
      }

      connectedCallback() {
        this.readConfiguration();
        this.initializeOrDestroySwiperForBrands =
          this.initializeOrDestroySwiperForBrands.bind(this);
        this.centerNavigation = this.centerNavigation.bind(this);
        this.shouldSkipCenterNavMethod =
          this.dataset.skipCenterNavMethod === "true";
        // Initialize the swiper based on conditions
        if (window.innerWidth < 900 && !this.swiper) {
          this.swiperInitilize();
        }

        // Register resize event listeners
        window.addEventListener("resize", this.centerNavigation);

        if (this.dataset.brands === "true") {
          window.addEventListener(
            "resize",
            this.initializeOrDestroySwiperForBrands,
          );
        } else if (this.configuration.enableOnMedia) {
          window.addEventListener("resize", this.matchResolution.bind(this)); // Using bind directly here
          this.breakpoint = window.matchMedia(this.configuration.enableOnMedia);
          this.matchResolution();
        } else if (!this.swiper) {
          this.swiperInitilize();
        }

        // Add keyboard event listener
        window.addEventListener("keydown", this.handleKeyboard);
      }

      disconnectedCallback() {
        window.removeEventListener(
          "resize",
          this.initializeOrDestroySwiperForBrands,
        );
        window.removeEventListener("resize", this.centerNavigation);
        window.removeEventListener("keydown", this.handleKeyboard);
      }

      initializeOrDestroySwiperForBrands() {
        if (window.innerWidth < 900) {
          if (!this.swiper) this.swiperInitilize();
        } else if (this.swiper) this.swiperDestroy();
      }

      centerNavigation() {
        if (window.innerWidth < 900 || this.shouldSkipCenterNavMethod) return;

        const picture = this.querySelector("picture")?.classList.contains(
          "hero__pic--mobile",
        )
          ? this.querySelectorAll("picture")[1]
          : this.querySelector("picture");

        if (picture) {
          const boundingClientRectPic = picture.getBoundingClientRect();

          const btns = this.querySelectorAll(".wt-slider__nav-btn");
          btns.forEach(
            (btn) =>
              (btn.style.top = `${22 + boundingClientRectPic.height / 2}px`),
          );
        }
      }

      // Clean all animation traces on slide > div
      _cleanupSlideAnimations(swiper) {
        swiper.slides.forEach((slide) => {
          const target = getSlideAnimTarget(slide);
          if (!target) return;
          target.classList.remove(
            ...ANIMATION_CLASSES,
            ANIMATION_MOBILE_DISABLED_CLASS,
          );
          target.removeAttribute("data-cascade");
          target.style.removeProperty("--animation-order");
        });
        swiper.__initAnimated = false;
      }

      /** Sync initial animations (used by afterInit and resize) */
      _syncInitialAnimations(swiper, { force = false } = {}) {
        const animationEnabled = !!this.configuration.enableAnimation;
        const disableOnMobile = !!this.configuration.disableAnimationOnMobile;

        if (!animationEnabled) {
          this._cleanupSlideAnimations(swiper);
          return;
        }

        setTimeout(() => {
          markInitialVisibleSlides(swiper, { disableOnMobile, force });
        }, 0);
      }

      readConfiguration() {
        const default_configuration = {
          autoHeight: false,
          slidesPerView: 1,
          autoplay: false,
          threshold: 5,
          watchSlidesProgress: true,
          enableAnimation: false,
          disableAnimationOnMobile: false,
          pagination: {
            el: ".swiper-pagination",
            renderBullet(index, className) {
              return `<span class="${className} swiper-pagination-bullet--svg-animation"><svg width="20" height="20" viewBox="0 0 28 28"><circle class="svg__circle" cx="14" cy="14" r="12" fill="none" stroke-width="2"></circle><circle class="svg__circle-inner" cx="14" cy="14" r="5" stroke-width="2"></circle></svg></span>`;
            },
          },
          navigation: {
            nextEl: ".wt-slider__nav-next",
            prevEl: ".wt-slider__nav-prev",
          },
          scrollbar: false,
          on: {
            afterInit: (swiper) => {
              this._syncInitialAnimations(swiper, { force: false });

              const dataSwiper = this.querySelector("[data-swiper]");
              const dataSwiperContainer = this.querySelector(
                "[data-swiper-container]",
              );
              dataSwiper?.classList.remove("loading");
              dataSwiperContainer?.classList.remove("loading");

              this.centerNavigation();
              this.handleTabindex(swiper);
            },
            resize: (swiper) => {
              this._syncInitialAnimations(swiper, { force: true });
            },
            slideChangeTransitionEnd: (swiper) => {
              this.handleTabindex(swiper);
            },
          },
        };

        const get_custom_configuration = this.querySelector(
          "[data-swiper-configuration]",
        )?.innerHTML;
        const custom_configuration = get_custom_configuration
          ? JSON.parse(get_custom_configuration)
          : {};

        this.configuration = {
          ...default_configuration,
          ...custom_configuration,
        };

        if (this.configuration.autoplay) {
          if (window.innerWidth < 900) {
            var override_configuration = {
              autoplay: false,
            };
          }
          this.configuration = {
            ...this.configuration,
            ...override_configuration,
          };
        }
      }

      matchResolution() {
        if (this.breakpoint.matches === true) {
          if (!this.swiper) {
            this.swiperInitilize();
          }
        } else if (this.swiper) {
          this.swiperDestroy();
        }
      }

      swiperInitilize() {
        // Guard: prevent double init
        if (this.swiper) return;

        // Scoped DOM refs
        const containerEl = this.querySelector("[data-swiper]");
        const wrapperEl = this.querySelector("[data-swiper-container]");
        const slideEls = this.querySelectorAll("[data-swiper-slide]");

        if (!containerEl || !wrapperEl) {
          console.warn(
            "[slideshow-section] Missing required elements for Swiper init.",
            {
              container: !!containerEl,
              wrapper: !!wrapperEl,
            },
          );
          return;
        }

        // Clean animation classes before a fresh init (handles destroy/reinit on resize)
        slideEls.forEach((el) => {
          el.classList.remove(
            ...ANIMATION_CLASSES,
            ANIMATION_MOBILE_DISABLED_CLASS,
          );
        });

        // Add Swiper structural classes (scoped to this instance)
        containerEl.classList.add("swiper", "wt-slider__container");
        wrapperEl.classList.add("swiper-wrapper", "wt-slider__wrapper");
        slideEls.forEach((el) =>
          el.classList.add("swiper-slide", "wt-slider__slide"),
        );

        // ----- SCOPE NAVIGATION & PAGINATION TO THIS INSTANCE -----
        // Prefer elements from current section; fall back to selectors from config only if they resolve inside this component.
        const paginationEl =
          this.querySelector(".wt-slider__pagination") ||
          this.querySelector(".swiper-pagination");

        const nextEl =
          this.querySelector(".wt-slider__nav-next--featured") ||
          this.querySelector(".wt-slider__nav-next");

        const prevEl =
          this.querySelector(".wt-slider__nav-prev--featured") ||
          this.querySelector(".wt-slider__nav-prev");

        // Clone configuration so we can safely override nav/pagination with element refs
        const cfg = { ...this.configuration };

        // Resolve pagination to an element (never leave string selectors that can leak to other sections)
        if (paginationEl || cfg.pagination) {
          const resolvedPagEl =
            paginationEl ||
            (typeof cfg.pagination?.el === "string"
              ? this.querySelector(cfg.pagination.el)
              : cfg.pagination?.el);

          if (resolvedPagEl) {
            cfg.pagination = {
              clickable: true,
              ...(cfg.pagination || {}),
              el: resolvedPagEl,
            };
          } else {
            delete cfg.pagination;
          }
        }

        // Resolve navigation to elements
        if (nextEl || prevEl || cfg.navigation) {
          const resolvedNext =
            nextEl ||
            (typeof cfg.navigation?.nextEl === "string"
              ? this.querySelector(cfg.navigation.nextEl)
              : cfg.navigation?.nextEl);

          const resolvedPrev =
            prevEl ||
            (typeof cfg.navigation?.prevEl === "string"
              ? this.querySelector(cfg.navigation.prevEl)
              : cfg.navigation?.prevEl);

          if (resolvedNext && resolvedPrev) {
            cfg.navigation = {
              ...(cfg.navigation || {}),
              nextEl: resolvedNext,
              prevEl: resolvedPrev,
            };
          } else {
            delete cfg.navigation;
          }
        }

        // Optional: scope scrollbar if you ever enable it in config
        if (cfg.scrollbar) {
          const resolvedScrollbarEl =
            typeof cfg.scrollbar.el === "string"
              ? this.querySelector(cfg.scrollbar.el)
              : cfg.scrollbar.el;
          if (resolvedScrollbarEl) {
            cfg.scrollbar = {
              ...(cfg.scrollbar || {}),
              el: resolvedScrollbarEl,
            };
          } else {
            delete cfg.scrollbar;
          }
        }

        // Finally, init Swiper with per-instance elements only
        this.swiper = new Swiper(containerEl, cfg);
      }

      swiperDestroy() {
        if (!this.swiper) return;

        this.swiper.__initAnimated = false;

        this.querySelector("[data-swiper]").classList.remove(
          "swiper",
          "wt-slider__container",
        );
        this.querySelector("[data-swiper-container]").classList.remove(
          "swiper-wrapper",
          "wt-slider__wrapper",
        );
        this.querySelectorAll("[data-swiper-slide]").forEach(function (e) {
          e.classList.remove("swiper-slide", "wt-slider__slide");
        });
        this.swiper.destroy();
        if (this.querySelector(".swiper-pagination"))
          this.querySelector(".swiper-pagination").innerHTML = "";
        this.swiper = null;
      }

      slideTo(slide) {
        this.swiper.autoplay.stop();
        const index = Array.from(slide.parentNode.children).indexOf(slide);
        this.swiper.slideTo(index);
      }
    },
  );
}
