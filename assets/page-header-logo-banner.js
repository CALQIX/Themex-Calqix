if (!customElements.get("page-header-logo-banner")) {
  customElements.define(
    "page-header-logo-banner",
    class PageHeaderLogoBannerSection extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
        this.logoBanner = this;
        this.video = this.querySelector(".wt-video__movie video");
        this.lowBatteryClass = "low-battery-mode";
        this.isLowBattery = false;
        this.elementToScale = this.querySelector(".wt-logo-banner__logo");
        this.header = document.querySelector(".wt-header");

        this.isSticky = false;
        this.observer = null;
        this.scrollListener = null;
        this.readyClass = "wt-logo-banner--ready";
      }

      connectedCallback() {
        this.init();
      }

      disconnectedCallback() {
        document.removeEventListener(
          "shopify:section:load",
          this.handleShopifyEditorEvent,
        );

        // Disconnect observer if it exists
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }

        // Remove scroll event listener if it exists
        if (this.scrollListener) {
          document.removeEventListener("scroll", this.scrollListener);
          this.scrollListener = null;
        }
        // Remove header scroll event listener if it exists
        if (this.headerScrollListener) {
          document.removeEventListener("scroll", this.headerScrollListener);
          this.headerScrollListener = null;
        }

        // Remove resize event listener if it exists
        if (this.resizeListener) {
          window.removeEventListener("resize", this.resizeListener);
          this.resizeListener = null;
        }
      }

      isMobile() {
        return window.matchMedia("(max-width: 899px)").matches;
      }

      handleShopifyEditorEvent() {
        this.reinit();
      }

      isValidSectionsOrder() {
        const pageHeader = document.body.querySelector("header.page-header");
        const currentSection = this.section;

        if (pageHeader && currentSection) {
          let sibling = pageHeader.nextElementSibling;
          while (sibling && sibling.tagName.toLowerCase() !== "section") {
            sibling = sibling.nextElementSibling;
          }
          return sibling === currentSection;
        }
        return false;
      }

      observeHeader() {
        const activeTransparentClass = "wt-header--transparent";
        const updateHeaderState = () => {
          const headerBottom = header.getBoundingClientRect().bottom;
          const logoBottom = this.logoBanner.getBoundingClientRect().bottom;

          if (logoBottom >= headerBottom) {
            this.header.classList.add(activeTransparentClass);
          } else {
            this.header.classList.remove(activeTransparentClass);
          }
        };

        this.headerScrollListener = updateHeaderState;
        document.addEventListener("scroll", this.headerScrollListener);
        updateHeaderState();
      }

      getNominalWidth() {
        const computedStyle = window.getComputedStyle(this.header);
        const nominalWidthMobile = computedStyle
          .getPropertyValue("--logo-width-mobile")
          .trim();
        const nominalWidth = computedStyle
          .getPropertyValue("--logo-width-desk")
          .trim();

        return parseInt(this.isMobile() ? nominalWidthMobile : nominalWidth);
      }

      calculateMaxScale() {
        const nominalWidth = this.getNominalWidth();
        const screenWidth = window.innerWidth;
        const maxLogoWidth = screenWidth * 0.6;
        const maxScale = maxLogoWidth / nominalWidth;
        return Math.min(maxScale, 6);
      }

      setInitialScale() {
        // this.elementToScale.style.transform = `scale(${this.calculateMaxScale()})`;
      }

      handleLogoSize() {
        const logoBanner = this.logoBanner;
        const header_height = this.header.offsetHeight;
        const elementToScale = this.elementToScale;
        const logoWrapper = this.logoBanner.querySelector(
          ".wt-logo-banner__picture",
        );
        const calculateMaxScale = this.calculateMaxScale.bind(this);

        const containerBottom = logoBanner.getBoundingClientRect().bottom;
        const visibilityRatio = containerBottom / window.innerHeight;
        const logoWrapperHeight = Math.max(0, containerBottom);

        const vanishingClass = "wt-logo-banner--vanishing";
        const inactiveClass = "inactive";

        const maxScale = calculateMaxScale();
        const distance = containerBottom - header_height;
        const maxDistance = window.innerHeight - header_height;

        const ratio = Math.max(0, Math.min(1, distance / maxDistance));
        const scale = Math.min(maxScale, 1 + (maxScale - 1) * ratio);

        const baseWidth = this.getNominalWidth();
        const newWidth = baseWidth * scale;

        console.log("baseWidth", baseWidth);

        const componentWidth = this.getBoundingClientRect().width;
        logoWrapper.style.width = componentWidth + "px";

        if (visibilityRatio < 0.7) {
          logoBanner.classList.add(vanishingClass);
        } else {
          logoBanner.classList.remove(vanishingClass);
        }

        logoWrapper.style.height = `${logoWrapperHeight}px`;
        elementToScale.style.transform = `scale(${scale})`;

        if (logoWrapperHeight < 1) {
          logoWrapper.classList.add(inactiveClass);
        } else {
          logoWrapper.classList.remove(inactiveClass);
        }
      }

      observeAndScaleElement() {
        this.setInitialScale();
        this.scrollListener = this.handleLogoSize.bind(this);
        document.addEventListener("scroll", this.scrollListener);
        this.resizeListener = this.handleLogoSize.bind(this);
        window.addEventListener("resize", this.resizeListener);
      }

      // calculateOffset() {
      //   const header = document.querySelector("header");
      //   const headerHeight = header.offsetHeight;
      //
      //   const announcement = document.querySelector(".wt-announcement");
      //   const announcementHeight = announcement ? announcement.offsetHeight : 0;
      //   const offset = this.isTransparentHeaderEnabled()
      //     ? headerHeight + announcementHeight
      //     : 0;
      //
      //   return offset;
      // }

      // setTopMargin() {
      //   const offset = this.calculateOffset();
      //   this.section.style.marginTop = `-${offset}px`;
      // }

      isTransparentHeaderEnabled() {
        const header = document.querySelector(".wt-header");
        return (
          header.dataset.transparent &&
          this.isValidSectionsOrder() &&
          header.classList.contains("wt-header--v3")
        );
      }

      setReadyClass() {
        this.classList.add(this.readyClass);
      }

      init() {
        document.addEventListener(
          "shopify:section:load",
          this.handleShopifyEditorEvent.bind(this),
        );

        this.setInitialScale();
        this.handleLogoSize();

        this.setupHeaderAndObservers();
        this.initializeVideoAndScaling();

        if (!this.video) {
          this.setReadyClass();
        }
      }

      setupHeaderMode() {
        const header = document.querySelector(".wt-header");
        const stickyHeaderThreshold = document.querySelector(
          ".sticky-header__threshold",
        );
        const isHeaderSticky =
          document.body.classList.contains("page-header-sticky");

        if (this.isTransparentHeaderEnabled()) {
          const isHeaderTransparent = header.classList.contains(
            "wt-header--transparent",
          );

          if (isHeaderSticky) {
            stickyHeaderThreshold.style.height = "120vh";
            // this.setTopMargin();
          } else if (isHeaderTransparent) {
            // this.setTopMargin();
          }
        } else if (isHeaderSticky) {
          stickyHeaderThreshold.style.height = "200px";
          this.section.style.marginTop = "0";
        }
      }

      setupHeaderAndObservers() {
        this.setupHeaderMode();

        if (this.isTransparentHeaderEnabled()) {
          this.observeHeader();
        }
      }

      initializeVideoAndScaling() {
        this.video
          ?.play()
          .catch((err) => {
            this.isLowBattery = true;
          })
          .finally(() => {
            if (this.isLowBattery) {
              this.classList.add(this.lowBatteryClass);
              // this.setInitialScale();
            } else {
              this.observeAndScaleElement();
            }

            this.handleLogoSize();
            this.setReadyClass();
          });

        const isDesignMode = this.dataset.designMode;
        if (!this.video || isDesignMode) {
          this.observeAndScaleElement();
        }

        // this.handleLogoSize();
      }

      reinit() {
        this.setupHeaderAndObservers();
        setTimeout(this.handleLogoSize.bind(this), 0);
      }
    },
  );
}
