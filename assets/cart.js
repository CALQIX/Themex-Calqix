class CartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener("click", (event) => {
      event.preventDefault();
      const cartItems =
        this.closest("cart-items") || this.closest("cart-drawer-items");

      cartItems.updateQuantity(this.dataset.index, 0);
    });
  }
}

customElements.define("cart-remove-button", CartRemoveButton);

class CartItems extends HTMLElement {
  cartUpdateUnsubscriber = undefined;
  constructor() {
    super();
    this.lineItemStatusElement =
      document.getElementById("shopping-cart-line-item-status") ||
      document.getElementById("CartDrawer-LineItemStatus");

    const debouncedOnChange = debounce((event) => {
      this.onChange(event);
    }, ON_CHANGE_DEBOUNCE_TIMER);

    this.addEventListener("change", debouncedOnChange.bind(this));
  }

  connectedCallback() {
    this.cartUpdateUnsubscriber = subscribe(
      PUB_SUB_EVENTS.cartUpdate,
      (event) => {
        if (event.source === "cart-items") {
          return;
        }
        this.onCartUpdate();
      },
    );
  }

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  onChange(event) {
    this.updateQuantity(
      event.target.dataset.index,
      event.target.value,
      document.activeElement.getAttribute("name"),
    );
  }

  onCartUpdate() {
    fetch(`${routes.cart_url}?section_id=main-cart-items`)
      .then((response) => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, "text/html");
        const sourceQty = html.querySelector("cart-items");
        this.innerHTML = sourceQty.innerHTML;
      })
      .catch((e) => {
        console.error(e);
      });
  }

  getSectionsToRender() {
    return [
      {
        id: "main-cart-items",
        section: document.getElementById("main-cart-items").dataset.id,
        selector: ".js-contents",
      },
      {
        id: "cart-icon-bubble",
        section: "cart-icon-bubble",
        selector: ".shopify-section",
      },
      {
        id: "cart-live-region-text",
        section: "cart-live-region-text",
        selector: ".shopify-section",
      },
      {
        id: "main-cart-footer",
        section: document.getElementById("main-cart-footer").dataset.id,
        selector: ".js-contents",
      },
    ];
  }

  updateQuantity(line, quantity, name) {
    const previousQuantityInput =
      document.getElementById(`Quantity-${line}`) ||
      document.getElementById(`Drawer-quantity-${line}`);
    const previousQuantity = parseInt(
      previousQuantityInput?.getAttribute("value") || previousQuantityInput?.value || "0",
      10,
    );
    const requestedQuantity = parseInt(quantity, 10);
    const previousItemCount = document.querySelectorAll(".cart-item").length;

    this.enableLoading(line);

    const body = JSON.stringify({
      line,
      quantity,
      sections: this.getSectionsToRender().map((section) => section.section),
      sections_url: window.location.pathname,
    });

    fetch(`${routes.cart_change_url}`, { ...fetchConfig(), ...{ body } })
      .then((response) => {
        return response.text();
      })
      .then((state) => {
        const parsedState = JSON.parse(state);
        const quantityElement =
          document.getElementById(`Quantity-${line}`) ||
          document.getElementById(`Drawer-quantity-${line}`);
        const items = document.querySelectorAll(".cart-item");

        if (parsedState.errors) {
          quantityElement.value = quantityElement.getAttribute("value");
          this.updateLiveRegions(line, parsedState.errors);
          return;
        }

        this.classList.toggle("is-empty", parsedState.item_count === 0);
        const cartDrawerWrapper = document.querySelector("cart-drawer");
        const cartFooter = document.getElementById("main-cart-footer");

        if (cartFooter)
          cartFooter.classList.toggle("is-empty", parsedState.item_count === 0);
        if (cartDrawerWrapper)
          cartDrawerWrapper.classList.toggle(
            "is-empty",
            parsedState.item_count === 0,
          );

        this.getSectionsToRender().forEach((section) => {
          const elementToReplace =
            document
              .getElementById(section.id)
              .querySelector(section.selector) ||
            document.getElementById(section.id);
          elementToReplace.innerHTML =
            this.getSectionInnerHTML(
              parsedState.sections[section.section],
              section.selector,
            ) || "";
        });
        const updatedValue = parsedState.items[line - 1]
          ? parsedState.items[line - 1].quantity
          : undefined;
        let message = "";
        if (
          items.length === parsedState.items.length &&
          updatedValue !== parseInt(quantityElement.value)
        ) {
          if (typeof updatedValue === "undefined") {
            message = window.cartStrings.error;
          } else {
            message = window.cartStrings.quantityError.replace(
              "[quantity]",
              updatedValue,
            );
          }
        }
        this.updateLiveRegions(line, message);
        this.runCartMotion({
          line,
          previousQuantity,
          requestedQuantity,
          previousItemCount,
          parsedState,
        });

        const lineItem =
          document.getElementById(`CartItem-${line}`) ||
          document.getElementById(`CartDrawer-Item-${line}`);
        if (lineItem && lineItem.querySelector(`[name="${name}"]`)) {
          cartDrawerWrapper
            ? trapFocus(
                cartDrawerWrapper,
                lineItem.querySelector(`[name="${name}"]`),
              )
            : lineItem.querySelector(`[name="${name}"]`).focus();
        } else if (document.querySelector(".cart-item") && cartDrawerWrapper) {
          trapFocus(
            cartDrawerWrapper,
            document.querySelector(".cart-item__name"),
          );
        }
        publish(PUB_SUB_EVENTS.cartUpdate, { source: "cart-items" });
      })
      // .catch(() => {
      //   this.querySelectorAll('.loading-overlay').forEach((overlay) => overlay.classList.add('hidden'));
      //   const errors = document.getElementById('cart-errors') || document.getElementById('CartDrawer-CartErrors');
      //   errors.textContent = window.cartStrings.error;
      // })
      .finally(() => {
        this.disableLoading(line);
      });
  }

  updateLiveRegions(line, message) {
    const lineItemError =
      document.getElementById(`Line-item-error-${line}`) ||
      document.getElementById(`CartDrawer-LineItemError-${line}`);
    if (lineItemError) {
      if (message.length > 0) lineItemError.style.display = "flex";
      lineItemError.querySelector(".cart-item__error-text").innerHTML = message;
    }

    this.lineItemStatusElement.setAttribute("aria-hidden", true);

    const cartStatus =
      document.getElementById("cart-live-region-text") ||
      document.getElementById("CartDrawer-LiveRegionText");
    cartStatus.setAttribute("aria-hidden", false);

    setTimeout(() => {
      cartStatus.setAttribute("aria-hidden", true);
    }, 1000);
  }

  getSectionInnerHTML(html, selector) {
    return new DOMParser()
      .parseFromString(html, "text/html")
      ?.querySelector(selector)?.innerHTML;
  }

  enableLoading(line) {
    const mainCartItems =
      document.getElementById("main-cart-items") ||
      document.getElementById("CartDrawer-CartItems");
    mainCartItems.classList.add("cart__items--disabled");

    const cartItemElements = this.querySelectorAll(
      `#CartItem-${line} .loading-overlay`,
    );
    const cartDrawerItemElements = this.querySelectorAll(
      `#CartDrawer-Item-${line} .loading-overlay`,
    );

    [...cartItemElements, ...cartDrawerItemElements].forEach((overlay) =>
      overlay.classList.remove("hidden"),
    );

    document.activeElement.blur();
    this.lineItemStatusElement.setAttribute("aria-hidden", false);
  }

  disableLoading(line) {
    const mainCartItems =
      document.getElementById("main-cart-items") ||
      document.getElementById("CartDrawer-CartItems");
    mainCartItems.classList.remove("cart__items--disabled");

    const cartItemElements = this.querySelectorAll(
      `#CartItem-${line} .loading-overlay`,
    );
    const cartDrawerItemElements = this.querySelectorAll(
      `#CartDrawer-Item-${line} .loading-overlay`,
    );

    cartItemElements.forEach((overlay) => overlay.classList.add("hidden"));
    cartDrawerItemElements.forEach((overlay) =>
      overlay.classList.add("hidden"),
    );
  }

  runCartMotion({ line, previousQuantity, requestedQuantity, previousItemCount, parsedState }) {
    const updatedItem = parsedState.items[line - 1];
    const updatedQuantity = updatedItem ? updatedItem.quantity : 0;
    const quantityDelta = updatedQuantity - previousQuantity;

    const currentLineItem =
      document.getElementById(`CartItem-${line}`) ||
      document.getElementById(`CartDrawer-Item-${line}`);
    if (currentLineItem) {
      currentLineItem.classList.remove(
        "wt-cart-line--quantity-up",
        "wt-cart-line--quantity-down",
        "wt-cart-line--flash",
      );
      currentLineItem.classList.add("wt-cart-line--flash");
      if (quantityDelta > 0) currentLineItem.classList.add("wt-cart-line--quantity-up");
      if (quantityDelta < 0) currentLineItem.classList.add("wt-cart-line--quantity-down");
      window.setTimeout(() => {
        currentLineItem.classList.remove(
          "wt-cart-line--quantity-up",
          "wt-cart-line--quantity-down",
          "wt-cart-line--flash",
        );
      }, 900);

      if (quantityDelta !== 0) {
        const counterHost =
          currentLineItem.querySelector(".counter-wrapper") ||
          currentLineItem.querySelector(".wt-cart__item__amount");
        if (counterHost) {
          counterHost.querySelectorAll(".wt-cart__qty-delta").forEach((node) => node.remove());
          const deltaNode = document.createElement("span");
          deltaNode.className = "wt-cart__qty-delta";
          deltaNode.classList.add(
            quantityDelta > 0 ? "wt-cart__qty-delta--up" : "wt-cart__qty-delta--down",
          );
          deltaNode.textContent = `${quantityDelta > 0 ? "+" : ""}${quantityDelta}`;
          counterHost.appendChild(deltaNode);
          window.setTimeout(() => deltaNode.remove(), 950);
        }
      }
    }

    const newItemCount = parsedState.items.length;
    const drawer = document.querySelector(".wt-cart__drawer");
    if (drawer) {
      drawer.classList.remove("wt-cart__drawer--item-added", "wt-cart__drawer--item-removed");
      if (newItemCount > previousItemCount || requestedQuantity > previousQuantity) {
        drawer.classList.add("wt-cart__drawer--item-added");
      } else if (newItemCount < previousItemCount || requestedQuantity < previousQuantity) {
        drawer.classList.add("wt-cart__drawer--item-removed");
      }
      window.setTimeout(() => {
        drawer.classList.remove("wt-cart__drawer--item-added", "wt-cart__drawer--item-removed");
      }, 750);
    }

    this.pulseCartTotals();
    this.pulseProgressBar();
  }

  pulseCartTotals() {
    const targets = document.querySelectorAll(
      ".wt-cart__subtotal, .wt-cart__subtotal__value, .wt-cart__saved-row, .wt-cart__saved-value",
    );
    targets.forEach((target) => {
      target.classList.remove("wt-cart-motion--pulse");
      requestAnimationFrame(() => target.classList.add("wt-cart-motion--pulse"));
      window.setTimeout(() => target.classList.remove("wt-cart-motion--pulse"), 620);
    });
  }

  pulseProgressBar() {
    const progressFill = document.querySelector(".wt-cart__drawer .wt-progress-bar__fill");
    if (!progressFill) return;
    progressFill.classList.remove("wt-cart-motion--progress");
    requestAnimationFrame(() => progressFill.classList.add("wt-cart-motion--progress"));
    window.setTimeout(() => progressFill.classList.remove("wt-cart-motion--progress"), 900);
  }
}

customElements.define("cart-items", CartItems);

if (!customElements.get("cart-note")) {
  customElements.define(
    "cart-note",
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          "change",
          debounce((event) => {
            const body = JSON.stringify({
              note: document.querySelector('[data-id="wt-cart-note"]').value,
            });
            fetch(`${routes.cart_update_url}`, {
              ...fetchConfig(),
              ...{ body },
            });
          }, ON_CHANGE_DEBOUNCE_TIMER),
        );
      }
    },
  );
}
