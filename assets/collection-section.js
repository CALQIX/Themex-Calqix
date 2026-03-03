class CollectionSection extends HTMLElement {
  constructor() {
    super();

    this.pageOverlayClass = "page-overlay";
    this.activeOverlayBodyClass = `${this.pageOverlayClass}-on`;
    this.drawer = () => document.querySelector(".wt-filter");
    this.classDrawerActive = "wt-filter--drawer-open";
    this.getCloseButton = () => document.querySelector(".wt-filter__close");
    this.getTrigger = () =>
      document.querySelector(".collection__filter-trigger");
    this.isOpen = () =>
      document.body.classList.contains(this.activeOverlayBodyClass);
    this.sectionsTriggers = () =>
      this.drawer()?.querySelectorAll(".wt-collapse__trigger");
    this.isDrawer = this.dataset.filterPosition === "drawer";

    this.triggerClasses = [
      "wt-filter__close",
      this.pageOverlayClass,
      "collection__filter-trigger",
    ];
    this.toggleDrawerElements = () =>
      this.drawer().querySelectorAll(this.drawer().dataset.toggleTabindex);

    this.overlay = document.createElement("div");

    this.breakpoint = 1200;
    this.currentDrawerMode = this.isDrawerMode();

    this.init();
  }

  init() {
    this.createOverlay();

    document.body.addEventListener("click", (e) => {
      if (this.triggerClasses.some((cls) => e.target.classList.contains(cls))) {
        this.toggleDrawer(e);
      }
    });

    this.addEventListener("keydown", (e) => {
      const isTabPressed =
        e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const { first, last } = this.getFocusableElements();

      if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
        if (this.isOpen()) {
          this.toggleDrawer(e);
        }
      }

      if (isTabPressed && this.isOpen() && this.currentDrawerMode) {
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });

    window.addEventListener("resize", this.handleResize.bind(this));
    this.handleResize();
  }

  isDrawerMode() {
    const width = window.innerWidth;
    return this.isDrawer || width <= this.breakpoint;
  }

  handleResize() {
    const isDrawerMode = this.isDrawerMode();

    if (isDrawerMode !== this.currentDrawerMode) {
      this.currentDrawerMode = isDrawerMode;

      if (isDrawerMode) {
        if (!this.isOpen()) {
          this.drawer()?.classList.remove(this.classDrawerActive);
          document.body.classList.remove(this.activeOverlayBodyClass);
        }
        this.updateTabindexes(this.isOpen());
      } else {
        this.drawer()?.classList.add(this.classDrawerActive);
        document.body.classList.remove(this.activeOverlayBodyClass);
        this.updateTabindexes(true);
      }
    }
  }

  temporaryHideFocusVisible() {
    document.body.classList.add("no-focus-visible");
  }

  getFocusableElements() {
    const focusableElementsSelector =
      "button, [href], input:not([type='hidden']), select, [tabindex]";
    const elements = Array.from(
      this.drawer().querySelectorAll(focusableElementsSelector),
    ).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.tabIndex >= 0 &&
        el.offsetParent !== null,
    );

    return {
      focusableElements: elements,
      first: elements[0],
      last: elements[elements.length - 1],
    };
  }

  updateTabindexes(isOpen) {
    if (this.currentDrawerMode) {
      if (isOpen) {
        this.getCloseButton()?.focus();
        this.temporaryHideFocusVisible();
        setTabindex(this.sectionsTriggers(), "0");
        setTabindex(this.toggleDrawerElements(), "0");
      } else {
        this.getTrigger()?.focus();
        this.temporaryHideFocusVisible();
        setTabindex(this.sectionsTriggers(), "-1");
        setTabindex(this.toggleDrawerElements(), "-1");

        this.closeAllCollapsibleSections();
      }
    } else {
      // Always visible mode
      setTabindex(this.sectionsTriggers(), "0");
      setTabindex(this.toggleDrawerElements(), "0");
    }
  }

  toggleDrawer(e) {
    if (e) e.preventDefault();

    if (!this.currentDrawerMode) {
      return;
    }

    if (this.isOpen()) {
      // close drawer
      const offsetTop = -parseInt(document.body.style.top, 10);
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      window.scrollTo(0, offsetTop);

      this.closeAllCollapsibleSections();
    } else {
      // open drawer
      document.body.style.top = `${-document.documentElement.scrollTop}px`;
      document.body.style.left = "0px";
    }

    this.drawer()?.classList.toggle(this.classDrawerActive);
    document.body.classList.toggle(this.activeOverlayBodyClass);

    this.updateTabindexes(this.isOpen());
  }

  closeAllCollapsibleSections() {
    const openSections = this.drawer().querySelectorAll('[data-open="true"]');
    openSections.forEach((section) => {
      const trigger = section.querySelector(".wt-collapse__trigger");
      if (trigger) {
        trigger.classList.remove("wt-collapse__trigger--active");
        section.dataset.open = "false";
        const focusableElementsWithTabindex =
          section.querySelectorAll('[tabindex="0"]');
        setTabindex(focusableElementsWithTabindex, "-1");
      }
    });
  }

  createOverlay() {
    if (!document.querySelector(`.${this.pageOverlayClass}`)) {
      this.overlay?.classList.add(this.pageOverlayClass);
      document.body.appendChild(this.overlay);
    }
  }
}

customElements.define("collection-section", CollectionSection);
