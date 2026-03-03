if (!customElements.get("page-header-image-banner")) {
  customElements.define(
    "page-header-image-banner",
    class ImageBanner extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
        this.logoBanner = this;
        this.header = document.querySelector(".wt-header");
        this.isMobile = window.matchMedia("(max-width: 899px)").matches;
        this.logoWrapper = this.header.querySelector(".wt-header__logo");
        this.showLogoClass = "wt-header__logo--show";
      }

      connectedCallback() {
        this.init();

        document.addEventListener(
          "shopify:section:load",
          this.handleAdminEditing.bind(this),
        );
        document.addEventListener(
          "shopify:section:unload",
          this.handleAdminEditing.bind(this),
        );
        document.addEventListener(
          "shopify:section:reorder",
          this.handleAdminEditing.bind(this),
        );
      }

      handleAdminEditing() {
        this.init();
      }

      init() {
        const logoWrapper = document.querySelector(".wt-header__logo");

        if (this.isTransparentHeaderEnabled()) {
          this.setTopMargin();
          this.observeHeader();

          logoWrapper?.classList.add(this.showLogoClass);
        } else {
          this.resetTopMargin();
          logoWrapper?.classList.remove(this.showLogoClass);
        }
      }

      removeObserver() {
        // Disconnect observer if it exists
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }
      }

      resetTopMargin() {
        this.section.style.marginTop = "0";
      }

      disconnectedCallback() {
        this.logoWrapper?.classList.remove(this.showLogoClass);

        this.removeObserver();

        // Remove scroll event listener if it exists
        if (this.scrollListener) {
          document.removeEventListener("scroll", this.scrollListener);
          this.scrollListener = null;
        }

        document.removeEventListener(
          "shopify:section:load",
          this.handleAdminEditing.bind(this),
        );
        document.removeEventListener(
          "shopify:section:unload",
          this.handleAdminEditing.bind(this),
        );
        document.removeEventListener(
          "shopify:section:reorder",
          this.handleAdminEditing.bind(this),
        );
      }

      observeHeader() {
        const header = document.querySelector(".wt-header");
        const activeTransparentClass = "wt-header--transparent";
        this.observer = new IntersectionObserver(
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

        this.observer.observe(this.logoBanner);
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

      isTransparentHeaderEnabled() {
        const header = document.querySelector(".wt-header");

        return (
          this.isValidSectionsOrder() && Boolean(header?.dataset.transparent)
        );
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
    },
  );
}
