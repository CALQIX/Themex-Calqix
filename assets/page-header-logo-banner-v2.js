if (!customElements.get("page-header-logo-banner-new")) {
  customElements.define(
    "page-header-logo-banner-new",
    class PageHeaderLogoBannerSection extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
        this.logoBanner = this;
        this.video = this.querySelector(".wt-video__movie video");
        this.mediaContainer = this.querySelector(".wt-video");
        this.lowBatteryClass = "low-battery-mode";
        this.isLowBattery = false;
        this.elementToScale = this.querySelector(".wt-logo-banner__logo");
        this.header = document.querySelector(".wt-header");
        this.pageBody = document.querySelector("body");

        this.isSticky = false;
        this.observer = null;
        this.scrollListener = null;
        this.readyClass = "wt-logo-banner--ready";

        this.animationThreshold = 0;
        this.bodyAnimationClass = "wt-logo-banner-animated";
        this.bodyAnimationEndClass = "wt-logo-banner-animated-done";
        this.isAnimatedClassAdded = false;

        this.pageHeader = document.querySelector("page-header#header");
        this.pageHeaderTransparentClass = "wt-header--transparent";
      }

      connectedCallback() {
        this.init();

        this.onScroll = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScroll);

        this.onTransitionEnd = this.onTransitionEnd.bind(this);
        this.elementToScale.addEventListener(
          "transitionend",
          this.onTransitionEnd,
        );

        this.setupLogoContainer();

        this.checkAspectRatio();
      }

      setupLogoContainer() {
        const pageHeaderHeight = this.header.getBoundingClientRect().height;
        const pageHeaderBody =
          this.pageHeader.querySelector(".wt-header__body");
        const logoWrapper = this.querySelector(".wt-logo-banner__picture");

        if (!pageHeaderBody || !logoWrapper) return;

        const computedStyles = window.getComputedStyle(pageHeaderBody);

        const paddingTop = computedStyles.getPropertyValue("padding-top");
        const paddingBottom = computedStyles.getPropertyValue("padding-bottom");

        logoWrapper.style.paddingTop = paddingTop;
        logoWrapper.style.paddingBottom = paddingBottom;
        logoWrapper.style.height = pageHeaderHeight + "px";

        const componentWidth = this.getBoundingClientRect().width;
        logoWrapper.style.width = componentWidth + "px";

        this.style.setProperty(
          "--logo-top-offset",
          this.getAnnouncementBarHeight() + "px",
        );
      }

      onTransitionEnd(event) {
        const relevantProperties = ["width"];

        if (!relevantProperties.includes(event.propertyName)) return;

        if (this.isAnimatedClassAdded) {
          this.onIntroAnimationComplete();
        } else {
          this.onOutroAnimationComplete();
        }
      }

      checkAspectRatio() {
        const sectionWidth = this.offsetWidth;
        const viewportHeight = window.innerHeight;
        const sectionAspectRatio = sectionWidth / viewportHeight;

        // All potential media wrappers
        const mediaItems = Array.from(
          this.querySelectorAll(".wt-video__item[data-media-ratio]"),
        );

        // Only visible wrappers
        const visibleMediaItem = mediaItems.find((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== "none" && el.dataset.mediaRatio;
        });

        if (!visibleMediaItem) {
          console.warn("No visible media wrapper with data-media-ratio found");
          return;
        }

        const mediaRatioAttr = visibleMediaItem.dataset.mediaRatio;
        const mediaAspectRatio = parseFloat(mediaRatioAttr);

        if (isNaN(mediaAspectRatio)) {
          console.warn("Invalid data-media-ratio value");
          return;
        }

        if (sectionAspectRatio > mediaAspectRatio) {
          this.handleWiderSection(mediaAspectRatio);
        } else {
          this.handleWiderMedia();
        }
      }

      handleWiderMedia() {}

      handleWiderSection(ratio) {
        this.mediaContainer.style.aspectRatio = ratio;
      }

      onIntroAnimationComplete() {
        this.pageBody.classList.add(this.bodyAnimationEndClass);
      }

      onOutroAnimationComplete() {}

      animateIntro() {
        this.pageBody.classList.add(this.bodyAnimationClass);
        this.isAnimatedClassAdded = true;
      }

      animateOutro() {
        this.pageBody.classList.remove(this.bodyAnimationClass);
        this.pageBody.classList.remove(this.bodyAnimationEndClass);
        this.isAnimatedClassAdded = false;

        this.elementToScale.style.opacity = 1;
      }

      getAnnouncementBarHeight() {
        return (
          document.querySelector(".wt-announcement-bar")?.offsetHeight || 0
        );
      }

      getAnimationThreshold() {
        return this.getAnnouncementBarHeight() + this.animationThreshold;
      }

      onScroll() {
        const scrollY = window.scrollY;
        const triggerPoint = this.getAnimationThreshold();

        if (scrollY > triggerPoint && !this.isAnimatedClassAdded) {
          this.animateIntro();
        } else if (scrollY <= triggerPoint && this.isAnimatedClassAdded) {
          this.animateOutro();
        }
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

        window.removeEventListener("scroll", this.onScroll);
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
        const activeTransparentClass = this.pageHeaderTransparentClass;
        const updateHeaderState = () => {
          const headerBottom = this.header.getBoundingClientRect().bottom;
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

      observeAndScaleElement() {
        this.resizeListener = this.setupHeaderAndObservers.bind(this);
        window.addEventListener("resize", this.resizeListener);
      }

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

        this.setupHeaderAndObservers();
        this.initializeVideoAndScaling();

        if (!this.video) {
          this.setReadyClass();
        }

        document.body.classList.add("wt-logo-banner-v2--ready");
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
            this.pageHeaderTransparentClass,
          );

          if (isHeaderSticky) {
            stickyHeaderThreshold.style.height = "100vh";
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
        this.setupLogoContainer();

        this.checkAspectRatio();

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

            this.setReadyClass();
          });

        const isDesignMode = this.dataset.designMode;
        if (!this.video || isDesignMode) {
          this.observeAndScaleElement();
        }
      }

      reinit() {
        this.setupHeaderAndObservers();
      }
    },
  );
}
