class CartDrawerSection extends HTMLElement {
  cartUpdateUnsubscriber = undefined;
  constructor() {
    super();

    this.cartType = this.dataset.cartType;
    this.drawerClass = "wt-cart__drawer";
    this.drawer = this.querySelector(`.${this.drawerClass}`);
    this.classDrawerActive = `${this.drawerClass}--open`;
    this.pageOverlayClass = "page-overlay-cart";
    this.activeOverlayBodyClass = `${this.pageOverlayClass}-on`;
    this.body = document.body;
    this.triggerQuery = [
      `.wt-cart__trigger`,
      `.wt-cart__back-link`,
      `.${this.pageOverlayClass}`,
    ].join(", ");
    this.triggers = () => document.querySelectorAll(this.triggerQuery);
    this.isOpen = false;
    this.isCartPage = window.location.pathname === window.routes.cart_url;
    this.closeButton = () => this.querySelector(".wt-cart__drawer__close");
    this.mainTrigger = document.querySelector(".wt-cart__trigger");
    this.toggleEelements = () =>
      this.querySelectorAll(this.dataset.toggleTabindex);
  }

  connectedCallback() {
    if (this.cartType === "page" || this.isCartPage) {
      document.addEventListener("cart-drawer:refresh", (e) =>
        this.refreshCartDrawer(e),
      );
      return;
    }

    this.init();
    this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, () => {
      if (this.isOpen) {
        setTabindex(this.toggleEelements(), "0");
        this.closeButton().focus();
      }
    });
  }

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  getFocusableElements() {
    const focusableElementsSelector =
      "button, [href], input, select, [tabindex]";
    const focusableElements = () =>
      Array.from(this.querySelectorAll(focusableElementsSelector)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0,
      );

    return {
      focusableElements,
      first: focusableElements()[0],
      last: focusableElements()[focusableElements().length - 1],
    };
  }

  temporaryHideFocusVisible() {
    document.body.classList.add("no-focus-visible");
  }

  onToggle() {
    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      this.isOpen = false;
      // this.mainTrigger.focus();
      this.temporaryHideFocusVisible();
      setTabindex(this.toggleEelements(), "-1");
    } else {
      this.setAttribute("open", "");
      this.isOpen = true;
      this.closeButton().focus();
      this.temporaryHideFocusVisible();
      setTabindex(this.toggleEelements(), "0");
    }
  }

  toggleDrawerClasses() {
    this.onToggle();
    this.drawer.classList.toggle(this.classDrawerActive);
    this.body.classList.toggle(this.activeOverlayBodyClass);

    // dispatch a custom event on the document
    const eventName = this.isOpen
      ? PUB_SUB_EVENTS.cartDrawerOpen
      : PUB_SUB_EVENTS.cartDrawerClose;

    document.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
      }),
    );
  }

  init() {
    this.addEventListener("keydown", (e) => {
      const isTabPressed =
        e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const { first, last } = this.getFocusableElements();

      if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
        if (this.isOpen) {
          this.toggleDrawerClasses();
        }
      }

      if (isTabPressed) {
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });

    this.triggers().forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleDrawerClasses();
      });
    });

    this.addEventListener("click", (e) => {
      if (e.target.classList.contains("wt-cart__drawer__close")) {
        e.preventDefault();
        this.toggleDrawerClasses();
      }
    });

    document.addEventListener("cart-drawer:refresh", (e) =>
      this.refreshCartDrawer(e),
    );
  }

  renderContents(parsedState, isClosedCart = true) {
    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);
      sectionElement.innerHTML = this.getSectionInnerHTML(
        parsedState.sections[section.id],
        section.selector,
      );
    });

    if (isClosedCart) {
      setTimeout(() => {
        this.toggleDrawerClasses();
        if (this.isOpen) {
          this.closeButton().focus();
        }
      });
    }
  }

  getSectionInnerHTML(html, selector = ".shopify-section") {
    return new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector(selector).innerHTML;
  }

  getSectionsToRender() {
    return [
      {
        id: "cart-drawer",
        selector: "#CartDrawer",
      },
      {
        id: "cart-icon-bubble",
      },
    ];
  }

  refreshCartDrawer(e) {
    const sectionsToRender = this.getSectionsToRender();
    fetch(
      `${window.Shopify.routes.root}?sections=${sectionsToRender[0].id},${sectionsToRender[1].id}`,
    )
      .then((response) => response.json())
      .then((response) => {
        const parsedState = {
          sections: response,
        };
        this.renderContents(parsedState, false);
      })
      .catch((e) => {
        console.log(e);
      });
  }

  setActiveElement(element) {
    this.activeElement = element;
  }
}

customElements.define("cart-drawer", CartDrawerSection);

class CartDrawerItems extends CartItems {
  getSectionsToRender() {
    return [
      {
        id: "CartDrawer",
        section: "cart-drawer",
        selector: ".drawer__inner",
      },
      {
        id: "cart-icon-bubble",
        section: "cart-icon-bubble",
        selector: ".shopify-section",
      },
    ];
  }
}

customElements.define("cart-drawer-items", CartDrawerItems);
