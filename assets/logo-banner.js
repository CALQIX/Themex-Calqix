if (!customElements.get("logo-banner")) {
  customElements.define(
    "logo-banner",
    class LogoBanner extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
        this.logoBanner = this;
        this.video = this.querySelector(".wt-video__movie video");
        this.lowBatteryClass = "low-battery-mode";
        this.isLowBattery = false;
        this.isMobile = window.matchMedia("(max-width: 899px)").matches;
        this.elementToScale = this.querySelector(".wt-logo-banner__logo");
      }

      connectedCallback() {
        this.init();
      }

      isFirstSection() {
        const sectionWrapper = document.querySelector("#root");
        const firstSection = sectionWrapper.querySelector("section");
        const currentSection = this.section;

        return firstSection === currentSection;
      }

      observeHeader() {
        const header = document.querySelector(".wt-header");
        const activeTransparentClass = "wt-header--transparent";
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

        observer.observe(this.logoBanner);
      }

      getNominalWidth() {
        const header = document.querySelector("header");
        const comuptedStyle = window.getComputedStyle(header);
        const nominalWidthMobile = comuptedStyle
          .getPropertyValue("--logo-width")
          .trim();
        const nominalWidth = comuptedStyle
          .getPropertyValue("--logo-width-desk")
          .trim();
        return parseInt(this.isMobile ? nominalWidthMobile : nominalWidth);
      }

      calculateMaxScale() {
        const nominalWidth = this.getNominalWidth();
        const screenWidth = window.innerWidth;
        const maxLogoWidth = screenWidth * 0.7;
        const maxScale = maxLogoWidth / nominalWidth;
        return Math.min(maxScale, 6);
      }

      setInitialScale() {
        this.elementToScale.style.transform = `scale(${this.calculateMaxScale()})`;
      }

      handleLogoSize() {
        const logoBanner = this.logoBanner;
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

        let scale = Math.max(
          1,
          Math.min(
            calculateMaxScale(),
            (calculateMaxScale() * containerBottom) / window.innerHeight,
          ),
        );

        if (visibilityRatio < 0.7) {
          logoBanner.classList.add(vanishingClass);
        } else {
          logoBanner.classList.remove(vanishingClass);
        }

        window.requestAnimationFrame(() => {
          logoWrapper.style.height = `${logoWrapperHeight}px`;
          elementToScale.style.transform = `scale(${scale})`;
        });

        if (logoWrapperHeight < 1) {
          logoWrapper.classList.add(inactiveClass);
        } else {
          logoWrapper.classList.remove(inactiveClass);
        }
      }

      observeAndScaleElement() {
        this.setInitialScale();
        document.addEventListener("scroll", this.handleLogoSize.bind(this));
      }

      calculateOffset() {
        const header = document.querySelector("header");
        const headerHeight = header.offsetHeight;

        const announcment = document.querySelector(".wt-announcement");
        const announcmentHeight = announcment ? announcment.offsetHeight : 0;
        const offset = this.isTransparentHeaderEnabled()
          ? headerHeight + announcmentHeight
          : 0;

        return offset;
      }

      setTopMargin() {
        const offset = this.calculateOffset();
        this.section.style.marginTop = `-${offset}px`;
      }

      isTransparentHeaderEnabled() {
        const header = document.querySelector(".wt-header");
        return (
          header.dataset.transparent &&
          this.isFirstSection() &&
          header.classList.contains("wt-header--v3")
        );
      }

      init() {
        if (this.isTransparentHeaderEnabled()) {
          const header = document.querySelector(".wt-header");
          const stickyHeaderThreshold = document.querySelector(
            ".sticky-header__threshold",
          );
          const isHeaderTransparent = header.classList.contains(
            "wt-header--transparent",
          );
          const isHeaderSticky =
            document.body.classList.contains("page-header-sticky");
          if (isHeaderSticky) {
            stickyHeaderThreshold.style.height = "110vh";
            this.setTopMargin();
          } else if (isHeaderTransparent) {
            this.setTopMargin();
          }
          this.observeHeader();
        }

        // Detect low battery mode
        this.video
          ?.play()
          .catch((err) => {
            this.isLowBattery = true;
          })
          .finally(() => {
            if (this.isLowBattery) {
              this.classList.add(this.lowBatteryClass);
              this.setInitialScale();
            } else {
              this.observeAndScaleElement();
            }
          });

        const isDesignMode = this.dataset.designMode;

        if (!this.video || isDesignMode) this.observeAndScaleElement();

        this.handleLogoSize();
      }
    },
  );
}
