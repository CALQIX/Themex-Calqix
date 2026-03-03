class LocalizationDrawer extends HTMLElement {
  constructor() {
    super();

    this.drawerClass = "wt-localization-drawer";
    this.drawer = this;
    this.classDrawerActive = `${this.drawerClass}--open`;
    this.pageOverlayClass = "wt-localization-drawer-overlay";
    this.activeOverlayBodyClass = `${this.pageOverlayClass}-on`;
    this.body = document.body;

    this.triggerQuery = [
      ".wt-localization-trigger",
      ".wt-localization-drawer__close",
      `.${this.pageOverlayClass}`,
    ].join(", ");

    this.isOpen = false;
    this.mainTrigger =
      document.querySelector(".wt-header__localization-trigger") || null;
  }

  connectedCallback() {
    this.init();
  }

  getFocusableElements() {
    const focusableSelector = "button, [href], input, select, [tabindex]";
    const focusableElements = Array.from(
      this.querySelectorAll(focusableSelector),
    ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);

    return {
      first: focusableElements[0],
      last: focusableElements[focusableElements.length - 1],
    };
  }

  temporaryHideFocusVisible() {
    document.body.classList.add("no-focus-visible");
    setTimeout(() => {
      document.body.classList.remove("no-focus-visible");
    }, 200);
  }

  onToggle() {
    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      this.isOpen = false;
      if (this.mainTrigger) this.mainTrigger.focus();
    } else {
      this.setAttribute("open", "");
      this.isOpen = true;
      const closeBtn = this.querySelector(".wt-localization-drawer__close");
      if (closeBtn) closeBtn.focus();
    }
    this.temporaryHideFocusVisible();
  }

  toggleDrawerClasses() {
    this.onToggle();
    this.drawer.classList.toggle(this.classDrawerActive);
    this.body.classList.toggle(this.activeOverlayBodyClass);
  }

  setActiveTab(tabKey) {
    const tabTriggers = this.querySelectorAll(
      ".wt-localization-drawer__tab__trigger",
    );
    const tabContents = this.querySelectorAll(
      ".wt-localization-drawer__tab__content",
    );

    tabTriggers.forEach((t) =>
      t.classList.remove("wt-localization-drawer__tab__trigger--active"),
    );
    tabContents.forEach((c) => c.classList.remove("is-active"));

    const matchingTrigger = this.querySelector(`[data-tab-target="${tabKey}"]`);
    if (matchingTrigger) {
      matchingTrigger.classList.add(
        "wt-localization-drawer__tab__trigger--active",
      );
    }

    const matchingContent = this.querySelector(
      `[data-tab-content="${tabKey}"]`,
    );
    if (matchingContent) {
      matchingContent.classList.add("is-active");
    }
  }

  init() {
    // Trap focus & close on Escape
    this.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      const { first, last } = this.getFocusableElements();
      const isTab = e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const isEsc =
        e.key === "Escape" || e.keyCode === 27 || e.code === "Escape";

      if (isEsc) {
        e.preventDefault();
        this.toggleDrawerClasses();
      } else if (isTab) {
        // Focus trap
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    document.querySelectorAll(this.triggerQuery).forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();

        const openTab = trigger.dataset.openDrawer;

        this.toggleDrawerClasses();

        if (openTab) {
          this.setActiveTab(openTab);
        }
      });
    });

    const searchInput = this.querySelector(
      ".wt-localization-drawer__search-country__input",
    );
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const searchValue = searchInput.value.toLowerCase().trim();

        this.querySelectorAll(".country-selector__item").forEach((item) => {
          const countryName = (item.dataset.filterName || "").toLowerCase();
          item.style.display = countryName.includes(searchValue) ? "" : "none";
        });
      });
    }

    const tabTriggers = this.querySelectorAll(
      ".wt-localization-drawer__tab__trigger",
    );
    const tabContents = this.querySelectorAll(
      ".wt-localization-drawer__tab__content",
    );

    tabTriggers.forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        tabTriggers.forEach((t) =>
          t.classList.remove("wt-localization-drawer__tab__trigger--active"),
        );
        tabContents.forEach((c) => c.classList.remove("is-active"));

        trigger.classList.add("wt-localization-drawer__tab__trigger--active");
        const targetKey = trigger.dataset.tabTarget;
        const matchedContent = this.querySelector(
          `[data-tab-content="${targetKey}"]`,
        );
        if (matchedContent) {
          matchedContent.classList.add("is-active");
        }
      });
    });

    const countryForm = document.querySelector("#DrawerCountryForm");
    if (countryForm) {
      const countryInput = countryForm.querySelector('[name="country_code"]');
      const countryLinks = this.querySelectorAll(".country-selector__trigger");

      countryLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();

          countryInput.value = link.dataset.value;
          countryForm.submit();
        });
      });
    }

    const languageForm = this.querySelector("form#DrawerLanguageForm");
    if (languageForm) {
      const radioButtons = languageForm.querySelectorAll(
        'input[name="language_code"]',
      );
      radioButtons.forEach((radio) => {
        radio.addEventListener("change", () => {
          languageForm.submit();
        });
      });
    }
  }
}

customElements.define("localization-drawer", LocalizationDrawer);
