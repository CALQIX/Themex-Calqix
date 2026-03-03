if (!customElements.get("page-header-image-video")) {
  customElements.define(
    "page-header-image-video",
    class PageHeaderImageVideo extends HTMLElement {
      constructor() {
        super();
        this.section = this.closest("section");
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
          this.resetTopMargin();
        }
      }

      resetTopMargin() {
        this.section.style.marginTop = "0";
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
        this.removeObserver();

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

        this.observer.observe(this);
      }

      getHeaderHeight() {
        const header = document.querySelector("header.page-header");
        return header.offsetHeight;
      }

      calculateOffset() {
        const headerHeight = this.getHeaderHeight();
        return this.isTransparentHeaderEnabled() ? headerHeight : 0;
      }

      setTopMargin() {
        const offset = this.calculateOffset();
        this.section.style.marginTop = `-${offset}px`;

        this.section.style.setProperty(
          "--top-header-space",
          `${this.getHeaderHeight()}px`,
        );
      }
    },
  );
}
