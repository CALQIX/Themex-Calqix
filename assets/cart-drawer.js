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
    this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.lastMouseMoveTick = 0;
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
    const wasOpen = this.isOpen;
    this.onToggle();
    this.drawer.classList.toggle(this.classDrawerActive);
    this.body.classList.toggle(this.activeOverlayBodyClass);
    if (!wasOpen && this.isOpen) {
      this.applyItemStagger();
    }

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

    this.addEventListener("submit", (event) => this.handleAddonSubmit(event), true);
    this.addEventListener("mousemove", (event) => this.handleDrawerMouseMove(event));
    this.addEventListener("mouseleave", () => this.resetDrawerMousePosition());
    this.addEventListener("touchstart", (event) => this.handleTouchThumb(event), {
      passive: true,
    });
    this.addEventListener("touchend", (event) => this.handleTouchThumb(event));

    document.addEventListener("cart-drawer:refresh", (e) =>
      this.refreshCartDrawer(e),
    );
  }

  renderContents(parsedState, isClosedCart = true) {
    const previousCount = this.querySelectorAll(".cart-item").length;
    const previousHeaderCount = this.getHeaderCounterValue();
    const previousSubtotal = this.getSubtotalCents();
    const previousProgress = this.getFreeShippingProgress();
    const previousRemaining = this.getFreeShippingRemainingCents();

    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);
      sectionElement.innerHTML = this.getSectionInnerHTML(
        parsedState.sections[section.id],
        section.selector,
      );
    });

    const nextCount = this.querySelectorAll(".cart-item").length;
    this.applyDrawerMotion(previousCount, nextCount);
    this.animateHeaderCounter(previousHeaderCount);
    this.animateSubtotal(previousSubtotal);
    this.animateFreeShipping(previousProgress, previousRemaining);
    this.triggerShippingConfetti(previousProgress, previousRemaining);
    this.syncCalqixCartState();

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

  getHeaderCounterValue() {
    const node = document.querySelector("#cart-icon-bubble .wt-header__panel__counter");
    if (!node) return 0;
    const value = parseInt(node.textContent || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  getSubtotalCents() {
    const node = this.querySelector(".wt-cart__subtotal");
    if (!node) return 0;
    const value = parseInt(node.dataset.subtotalCents || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  getFreeShippingProgress() {
    const bar = this.querySelector(".wt-free-shipping-bar .wt-progress-bar__fill");
    if (!bar) return 0;
    const value = parseFloat(bar.dataset.progress || "0");
    return Number.isFinite(value) ? value : 0;
  }

  getFreeShippingRemainingCents() {
    const holder = this.querySelector(".wt-free-shipping-bar");
    if (!holder) return 0;
    const value = parseInt(holder.dataset.freeShippingRemainingCents || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  isMotionAllowed() {
    return !this.prefersReducedMotion.matches;
  }

  applyItemStagger() {
    if (!this.isMotionAllowed()) return;
    const items = this.querySelectorAll(".wt-cart__drawer .wt-cart__item");
    items.forEach((item, index) => {
      item.style.setProperty("--wt-cart-item-index", index);
      item.classList.remove("wt-cart-item--stagger-in");
      requestAnimationFrame(() => item.classList.add("wt-cart-item--stagger-in"));
    });
  }

  handleDrawerMouseMove(event) {
    if (!this.drawer || !this.isMotionAllowed() || window.innerWidth <= 768) return;
    const now = Date.now();
    if (now - this.lastMouseMoveTick < 24) return;
    this.lastMouseMoveTick = now;
    const rect = this.drawer.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    this.drawer.style.setProperty("--mouse-x", `${Math.min(100, Math.max(0, x)).toFixed(2)}%`);
    this.drawer.style.setProperty("--mouse-y", `${Math.min(100, Math.max(0, y)).toFixed(2)}%`);
  }

  resetDrawerMousePosition() {
    if (!this.drawer) return;
    this.drawer.style.setProperty("--mouse-x", "50%");
    this.drawer.style.setProperty("--mouse-y", "40%");
  }

  handleTouchThumb(event) {
    const thumb = event.target.closest(".wt-cart__item__thumb");
    if (!thumb) return;
    const isTouchStart = event.type === "touchstart";
    thumb.classList.toggle("wt-cart-thumb--touch", isTouchStart);
  }

  async handleAddonSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.closest(".wt-cart__addon-product-form")) return;
    if (!this.drawer || !this.isOpen) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const button = form.querySelector(".wt-cart__addon-card__button");
    if (button?.disabled) return;
    const variantInput = form.querySelector('input[name="id"]');
    const variantId = variantInput?.value;
    if (!variantId) return;

    this.animateAddButtonState(button, "loading");

    try {
      await fetch(`${routes.cart_add_url}.js`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to add add-on");
        return res.json();
      });

      this.animateAddButtonState(button, "success");
      await this.refreshSectionsInPlace();
      publish(PUB_SUB_EVENTS.cartUpdate, { source: "cart-drawer-addon" });
    } catch (error) {
      console.error(error);
      this.animateAddButtonState(button, "idle");
    }
  }

  animateAddButtonState(button, state) {
    if (!button) return;
    const idleLabel = button.dataset.addLabel || "Add";
    const addedLabel = button.dataset.addedLabel || "Added";
    if (state !== "loading") {
      button.disabled = false;
    }
    button.classList.remove(
      "wt-addon-button--loading",
      "wt-addon-button--success",
      "wt-addon-button--pressed",
    );
    if (state === "loading") {
      button.classList.add("wt-addon-button--pressed", "wt-addon-button--loading");
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.innerHTML = '<span class="wt-addon-button__spinner" aria-hidden="true"></span>';
      return;
    }
    if (state === "success") {
      button.classList.add("wt-addon-button--success");
      button.textContent = addedLabel;
      button.disabled = true;
      setTimeout(() => {
        button.classList.remove("wt-addon-button--success");
      }, 1200);
      return;
    }
    button.textContent = button.dataset.originalText || idleLabel;
  }

  animateAddonCardOut(card) {
    if (!card) return;
    const list = card.closest(".wt-cart__addons__list");
    const section = card.closest(".wt-cart__addons");
    card.classList.add("wt-cart__addon-card--removing");
    card.style.maxHeight = `${card.scrollHeight}px`;
    requestAnimationFrame(() => {
      card.style.maxHeight = "0px";
      card.style.opacity = "0";
    });
    setTimeout(() => {
      card.remove();
      if (list && list.children.length === 0 && section) {
        section.classList.add("wt-cart__addons--collapsing");
        section.style.maxHeight = `${section.scrollHeight}px`;
        requestAnimationFrame(() => {
          section.style.maxHeight = "0px";
          section.style.opacity = "0";
        });
      }
    }, 280);
  }

  async refreshSectionsInPlace() {
    const sectionsToRender = this.getSectionsToRender();
    const response = await fetch(
      `${window.Shopify.routes.root}?sections=${sectionsToRender[0].id},${sectionsToRender[1].id}`,
    ).then((res) => res.json());
    this.renderContents({ sections: response }, false);
  }

  animateHeaderCounter(previousCount) {
    const counter = document.querySelector("#cart-icon-bubble .wt-header__panel__counter");
    if (!counter) return;
    const nextCount = parseInt(counter.textContent || "0", 10) || 0;
    if (nextCount === previousCount) return;

    counter.classList.remove("wt-cart-counter--bounce", "wt-cart-counter--flip-up");
    counter.dataset.previous = `${previousCount}`;
    requestAnimationFrame(() => {
      counter.classList.add("wt-cart-counter--bounce", "wt-cart-counter--flip-up");
    });
    setTimeout(() => counter.classList.remove("wt-cart-counter--flip-up"), 420);
  }

  animateSubtotal(previousSubtotal) {
    const subtotal = this.querySelector(".wt-cart__subtotal");
    const valueNode = this.querySelector(".wt-cart__subtotal__value[data-subtotal-value]");
    if (!subtotal || !valueNode) return;
    const nextSubtotal = parseInt(subtotal.dataset.subtotalCents || "0", 10) || 0;
    if (nextSubtotal === previousSubtotal) return;

    subtotal.classList.add("wt-cart-subtotal--updating");
    this.countMoneyValue(valueNode, previousSubtotal, nextSubtotal, 400, subtotal.dataset.currencyCode);
    setTimeout(() => subtotal.classList.remove("wt-cart-subtotal--updating"), 620);
  }

  animateFreeShipping(previousProgress, previousRemaining) {
    const wrapper = this.querySelector(".wt-free-shipping-bar");
    const fill = this.querySelector(".wt-free-shipping-bar .wt-progress-bar__fill");
    if (!wrapper || !fill) return;
    const nextProgress = this.getFreeShippingProgress();
    fill.style.setProperty("--wt-prev-free-progress", `${previousProgress}%`);
    fill.style.setProperty("--wt-free-progress", `${nextProgress}%`);
    fill.classList.remove("wt-progress-bar__fill--animate");
    requestAnimationFrame(() => fill.classList.add("wt-progress-bar__fill--animate"));

    if (nextProgress >= 100 && previousProgress < 100) {
      fill.classList.add("wt-progress-bar__fill--complete");
      setTimeout(() => fill.classList.remove("wt-progress-bar__fill--complete"), 500);
      const text = wrapper.querySelector(".wt-free-shipping-bar__text");
      if (text) {
        text.innerHTML = '<span class="wt-free-shipping-bar__success">\u{1F389} Free shipping unlocked!</span>';
        text.classList.add("wt-free-shipping-bar__text--success");
      }
      return;
    }

    const amountNode = wrapper.querySelector(".wt-free-shipping-bar__amount");
    if (amountNode && previousRemaining !== this.getFreeShippingRemainingCents()) {
      this.countMoneyValue(
        amountNode,
        previousRemaining,
        this.getFreeShippingRemainingCents(),
        400,
        subtotalCurrencyFromDrawer(this.drawer),
      );
    }
  }

  triggerShippingConfetti(previousProgress, previousRemaining) {
    if (!this.isMotionAllowed()) return;
    const bar = this.querySelector(".wt-free-shipping-bar");
    if (!bar) return;
    const remaining = this.getFreeShippingRemainingCents();
    if (remaining > 0) return;
    if (typeof previousProgress === "number" && Number.isFinite(previousProgress)) {
      if (previousProgress >= 100) return;
    } else if (previousRemaining <= 0) {
      return;
    }
    if (sessionStorage.getItem("shippingConfettiShown") === "1") return;
    if (typeof window.confetti !== "function") return;

    window.confetti({
      particleCount: 80,
      spread: 60,
      origin: { x: 0.5, y: 0 },
      colors: ["#E8C96A", "#1A3B5C", "#FFFFFF"],
      scalar: 0.9,
      shapes: ["circle", "square"],
    });
    sessionStorage.setItem("shippingConfettiShown", "1");
  }

  syncCalqixCartState() {
    if (typeof routes === "undefined" || !routes.cart_url) return;
    if (typeof refreshCalqixCartState !== "function") return;

    fetch(`${routes.cart_url}.js`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((cart) => {
        if (cart) refreshCalqixCartState(cart);
      })
      .catch(() => {});
  }

  countMoneyValue(node, fromCents, toCents, duration, currencyCode) {
    if (!node) return;
    if (!this.isMotionAllowed()) {
      node.textContent = formatCents(toCents, currencyCode);
      return;
    }
    const start = performance.now();
    const delta = toCents - fromCents;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(fromCents + delta * eased);
      node.textContent = formatCents(value, currencyCode);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  applyDrawerMotion(previousCount, nextCount) {
    if (!this.drawer) return;

    this.drawer.classList.remove("wt-cart__drawer--item-added", "wt-cart__drawer--item-removed");
    if (nextCount > previousCount) {
      this.drawer.classList.add("wt-cart__drawer--item-added");
      const latestItem = this.querySelector(".wt-cart__list .cart-item:last-child");
      if (latestItem) {
        latestItem.classList.add("wt-cart-line--enter", "wt-cart-line--new-gold");
        setTimeout(() => latestItem.classList.remove("wt-cart-line--enter"), 850);
        setTimeout(() => latestItem.classList.remove("wt-cart-line--new-gold"), 1500);
      }
    } else if (nextCount < previousCount) {
      this.drawer.classList.add("wt-cart__drawer--item-removed");
    }

    const totals = this.querySelectorAll(
      ".wt-cart__subtotal, .wt-cart__subtotal__value, .wt-cart__saved-row, .wt-cart__saved-value",
    );
    totals.forEach((node) => {
      node.classList.remove("wt-cart-motion--pulse");
      requestAnimationFrame(() => node.classList.add("wt-cart-motion--pulse"));
      setTimeout(() => node.classList.remove("wt-cart-motion--pulse"), 620);
    });

    setTimeout(() => {
      this.drawer.classList.remove("wt-cart__drawer--item-added", "wt-cart__drawer--item-removed");
    }, 750);
  }
}

function formatCents(cents, currencyCode) {
  const code = currencyCode || window.Shopify?.currency?.active || "EUR";
  try {
    return new Intl.NumberFormat(document.documentElement.lang || navigator.language || "en", {
      style: "currency",
      currency: code,
    }).format((cents || 0) / 100);
  } catch (error) {
    return `${(cents || 0) / 100}`;
  }
}

function subtotalCurrencyFromDrawer(drawer) {
  const subtotal = drawer?.querySelector(".wt-cart__subtotal");
  return subtotal?.dataset.currencyCode || window.Shopify?.currency?.active || "EUR";
}

customElements.define("cart-drawer", CartDrawerSection);

class CartDrawerItems extends CartItems {
  onCartUpdate(event) {
    if (event?.source === "cart-items") return;
    if (event?.source === "product-form") return;
    if (event?.source === "cart-drawer-addon") return;

    const drawer = this.closest("cart-drawer");
    if (drawer && typeof drawer.refreshCartDrawer === "function") {
      drawer.refreshCartDrawer(event);
    }
  }

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
