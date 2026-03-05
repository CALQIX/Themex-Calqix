const calqixCartState = { items: [], total_price: 0, item_count: 0 };

(function seedCalqixCartState() {
  if (typeof routes === "undefined" || !routes.cart_url) return;
  fetch(`${routes.cart_url}.js`, { headers: { Accept: "application/json" } })
    .then((r) => r.ok ? r.json() : null)
    .then((cart) => { if (cart) refreshCalqixCartState(cart); })
    .catch(() => {});
})();

function refreshCalqixCartState(cartJson) {
  if (!cartJson) return;
  calqixCartState.items = Array.isArray(cartJson.items) ? cartJson.items : [];
  calqixCartState.total_price = cartJson.total_price || 0;
  calqixCartState.item_count = cartJson.item_count || 0;
}

function getQuantityByKey(lineKey) {
  const item = calqixCartState.items.find((i) => i.key === lineKey);
  if (!item) {
    console.warn("CALQIX Cart: line key not found in state", lineKey);
    return null;
  }
  return item.quantity;
}

function getQuantityByLineIndex(lineIndex) {
  const idx = parseInt(lineIndex, 10) - 1;
  if (idx < 0 || idx >= calqixCartState.items.length) return null;
  return calqixCartState.items[idx].quantity;
}

window.calqixGetCartQuantity = function (lineIndex) {
  return getQuantityByLineIndex(lineIndex);
};

class CartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const cartItems =
        this.closest("cart-items") || this.closest("cart-drawer-items");
      const cartLine =
        document.getElementById(`CartDrawer-Item-${this.dataset.index}`) ||
        document.getElementById(`CartItem-${this.dataset.index}`);
      const shouldAnimate =
        cartLine &&
        this.closest("cart-drawer-items") &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!shouldAnimate) {
        cartItems.updateQuantity(this.dataset.index, 0);
        return;
      }

      cartLine.classList.add("wt-cart-line--remove-pending", "wt-cart-line--remove-flash");
      cartLine.style.maxHeight = `${cartLine.scrollHeight}px`;
      requestAnimationFrame(() => {
        cartLine.style.maxHeight = "0px";
        cartLine.style.opacity = "0";
      });
      setTimeout(() => {
        cartItems.updateQuantity(this.dataset.index, 0);
      }, 320);
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
        this.onCartUpdate(event);
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

  onCartUpdate(_event) {
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
    const previousHeaderCount = parseCounterValue(
      document.querySelector("#cart-icon-bubble .wt-header__panel__counter"),
    );
    const previousSubtotal = parseInt(
      document.querySelector(".wt-cart__subtotal")?.dataset.subtotalCents || "0",
      10,
    );
    const previousProgress = parseFloat(
      document.querySelector(".wt-free-shipping-bar .wt-progress-bar__fill")?.dataset.progress || "0",
    );
    const previousRemaining = parseInt(
      document.querySelector(".wt-free-shipping-bar")?.dataset.freeShippingRemainingCents || "0",
      10,
    );
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
      .then(async (state) => {
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

        const isDrawerContext = this.closest("cart-drawer-items") !== null;
        if (isDrawerContext) {
          const freshCart = await this.fetchCartState();
          this.applyDrawerDiffUpdate(parsedState, freshCart);
        } else {
          refreshCalqixCartState(parsedState);
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
        }
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
          previousHeaderCount,
          previousSubtotal,
          previousProgress,
          previousRemaining,
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

  async fetchCartState() {
    try {
      const response = await fetch(`${routes.cart_url}.js`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const cartJson = await response.json();
      refreshCalqixCartState(cartJson);
      return cartJson;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  applyDrawerDiffUpdate(parsedState, freshCart) {
    const drawerRoot = document.getElementById("CartDrawer");
    const cartItemsContainer = drawerRoot?.querySelector("#CartDrawer-CartItems");
    const currentList = cartItemsContainer?.querySelector(".wt-cart__list");
    const incomingDrawerHtml = parsedState?.sections?.["cart-drawer"];

    if (!drawerRoot || !cartItemsContainer || !incomingDrawerHtml) return;

    const parsedIncoming = new DOMParser().parseFromString(incomingDrawerHtml, "text/html");
    const incomingInner = parsedIncoming.querySelector(".drawer__inner");
    const incomingItemsContainer = incomingInner?.querySelector("#CartDrawer-CartItems");
    const incomingList = incomingItemsContainer?.querySelector(".wt-cart__list");
    const itemsFromCart = Array.isArray(freshCart?.items) ? freshCart.items : [];

    if (!currentList || !incomingList || itemsFromCart.length === 0) {
      cartItemsContainer.innerHTML = incomingItemsContainer?.innerHTML || "";
      this.syncDrawerShellFromTemplate(drawerRoot, incomingInner);
      this.updateCartBubbleSection(parsedState);
      return;
    }

    const existingByKey = new Map();
    currentList.querySelectorAll(".cart-item[data-line-key]").forEach((node) => {
      existingByKey.set(node.dataset.lineKey, node);
    });

    const incomingByKey = new Map();
    itemsFromCart.forEach((item) => incomingByKey.set(item.key, item));

    const incomingKeys = new Set(itemsFromCart.map((i) => i.key));

    existingByKey.forEach((node, key) => {
      if (incomingKeys.has(key)) return;
      node.classList.add("wt-cart-line--remove-pending", "wt-cart-line--remove-flash");
      node.style.maxHeight = `${node.scrollHeight}px`;
      requestAnimationFrame(() => {
        node.style.maxHeight = "0px";
        node.style.opacity = "0";
      });
      setTimeout(() => node.remove(), 320);
    });

    itemsFromCart.forEach((item, index) => {
      const templateNode = incomingList.querySelector(
        `.cart-item[data-line-key="${cssEscapeValue(item.key)}"]`,
      );
      if (!templateNode) return;

      const existingNode = existingByKey.get(item.key);
      if (existingNode) {
        this.updateDrawerItemInPlace(existingNode, templateNode, item);
      } else {
        const newNode = templateNode.cloneNode(true);
        newNode.classList.add("wt-cart-line--enter", "wt-cart-line--new-gold");
        const referenceChild = currentList.children[index] || null;
        currentList.insertBefore(newNode, referenceChild);
        existingByKey.set(item.key, newNode);
        setTimeout(() => {
          newNode.classList.remove("wt-cart-line--enter", "wt-cart-line--new-gold");
        }, 1500);
      }
    });

    this.syncDrawerIndexes(currentList, itemsFromCart);
    this.syncDrawerShellFromTemplate(drawerRoot, incomingInner);
    this.updateCartBubbleSection(parsedState);
  }

  updateDrawerItemInPlace(currentNode, templateNode, itemData) {
    const previousQty = parseInt(currentNode.dataset.quantity || "0", 10);
    currentNode.dataset.quantity = `${itemData.quantity}`;
    currentNode.dataset.linePrice = `${itemData.final_line_price ?? itemData.line_price ?? 0}`;

    const input = currentNode.querySelector(".js-counter-quantity");
    if (input) {
      input.value = itemData.quantity;
      input.setAttribute("value", itemData.quantity);
      input.classList.remove("wt-cart-qty--flip-up", "wt-cart-qty--flip-down");
      input.classList.add(itemData.quantity >= previousQty ? "wt-cart-qty--flip-up" : "wt-cart-qty--flip-down");
      setTimeout(() => input.classList.remove("wt-cart-qty--flip-up", "wt-cart-qty--flip-down"), 220);
    }

    const displayNode = currentNode.querySelector(".cart-item__quantity-display");
    if (displayNode) {
      displayNode.dataset.current = `${itemData.quantity}`;
      displayNode.textContent = `${itemData.quantity}`;
    }

    const currentPriceNode = currentNode.querySelector(".cart-item__line-price");
    const nextPriceNode = templateNode.querySelector(".cart-item__line-price");
    const currencyCode =
      document.querySelector(".wt-cart__subtotal")?.dataset.currencyCode ||
      window.Shopify?.currency?.active ||
      "EUR";
    if (currentPriceNode && nextPriceNode) {
      const fromCents = parseInt(currentPriceNode.dataset.cents || "0", 10);
      const toCents = parseInt(nextPriceNode.dataset.cents || "0", 10);
      currentPriceNode.dataset.cents = `${toCents}`;
      countMoneyValue(currentPriceNode, fromCents, toCents, 320, currencyCode);
    } else {
      const currentWrapper = currentNode.querySelector(".wt-cart__item__price-wrapper");
      const templateWrapper = templateNode.querySelector(".wt-cart__item__price-wrapper");
      if (currentWrapper && templateWrapper) {
        currentWrapper.innerHTML = templateWrapper.innerHTML;
      }
    }
  }

  syncDrawerIndexes(listNode, orderedItems) {
    orderedItems.forEach((item, index) => {
      const line = index + 1;
      const node = listNode.querySelector(`.cart-item[data-line-key="${cssEscapeValue(item.key)}"]`);
      if (!node) return;
      node.id = `CartDrawer-Item-${line}`;
      node.dataset.lineIndex = `${line}`;

      node.querySelectorAll("cart-remove-button").forEach((removeButton) => {
        removeButton.dataset.index = `${line}`;
        removeButton.id = `CartDrawer-Remove-${line}`;
      });

      const qtyInput = node.querySelector(".js-counter-quantity");
      if (qtyInput) {
        qtyInput.id = `Drawer-quantity-${line}`;
        qtyInput.dataset.index = `${line}`;
      }
    });
  }

  syncDrawerShellFromTemplate(drawerRoot, incomingInner) {
    if (!incomingInner) return;
    this.copyNodeInner(incomingInner, drawerRoot, ".wt-cart__drawer__header");
    this.copyNodeInner(
      incomingInner,
      drawerRoot,
      ".wt-cart__drawer__module-slot--pre-items",
    );
    this.copyNodeInner(
      incomingInner,
      drawerRoot,
      ".wt-cart__drawer__module-slot--post-items",
    );
    this.copyNodeInner(incomingInner, drawerRoot, ".wt-cart__drawer__footer");
  }

  copyNodeInner(sourceRoot, targetRoot, selector) {
    const source = sourceRoot.querySelector(selector);
    const target = targetRoot.querySelector(selector);
    if (!target) return;
    if (!source) {
      target.innerHTML = "";
      target.setAttribute("hidden", "");
      return;
    }
    target.innerHTML = source.innerHTML;
    target.removeAttribute("hidden");
  }

  updateCartBubbleSection(parsedState) {
    const cartIconBubble = document.getElementById("cart-icon-bubble");
    if (!cartIconBubble || !parsedState?.sections?.["cart-icon-bubble"]) return;
    const html = this.getSectionInnerHTML(
      parsedState.sections["cart-icon-bubble"],
      ".shopify-section",
    );
    if (html) cartIconBubble.innerHTML = html;
  }

  runCartMotion({
    line,
    previousQuantity,
    requestedQuantity,
    previousItemCount,
    parsedState,
    previousHeaderCount,
    previousSubtotal,
    previousProgress,
    previousRemaining,
  }) {
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
        const quantityInput = currentLineItem.querySelector(".js-counter-quantity");
        if (quantityInput) {
          quantityInput.classList.remove("wt-cart-qty--flip-up", "wt-cart-qty--flip-down");
          quantityInput.classList.add(
            quantityDelta > 0 ? "wt-cart-qty--flip-up" : "wt-cart-qty--flip-down",
          );
          setTimeout(
            () => quantityInput.classList.remove("wt-cart-qty--flip-up", "wt-cart-qty--flip-down"),
            220,
          );
        }
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
    this.animateHeaderCounter(previousHeaderCount);
    this.animateSubtotalCounter(previousSubtotal);
    this.animateFreeShipping(previousProgress, previousRemaining);
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

  animateHeaderCounter(previousCount) {
    const counter = document.querySelector("#cart-icon-bubble .wt-header__panel__counter");
    if (!counter) return;
    const nextCount = parseCounterValue(counter);
    if (nextCount === previousCount) return;
    counter.classList.remove("wt-cart-counter--bounce", "wt-cart-counter--flip-up");
    requestAnimationFrame(() => counter.classList.add("wt-cart-counter--bounce", "wt-cart-counter--flip-up"));
    setTimeout(() => counter.classList.remove("wt-cart-counter--flip-up"), 420);
  }

  animateSubtotalCounter(previousSubtotal) {
    const subtotal = document.querySelector(".wt-cart__subtotal");
    const valueNode = document.querySelector(".wt-cart__subtotal__value[data-subtotal-value]");
    if (!subtotal || !valueNode) return;
    const nextSubtotal = parseInt(subtotal.dataset.subtotalCents || "0", 10);
    if (nextSubtotal === previousSubtotal) return;
    const currencyCode = subtotal.dataset.currencyCode || window.Shopify?.currency?.active || "EUR";
    countMoneyValue(valueNode, previousSubtotal || 0, nextSubtotal || 0, 400, currencyCode);
    subtotal.classList.add("wt-cart-subtotal--updating");
    setTimeout(() => subtotal.classList.remove("wt-cart-subtotal--updating"), 620);
  }

  animateFreeShipping(previousProgress, previousRemaining) {
    const barWrapper = document.querySelector(".wt-free-shipping-bar");
    const fill = document.querySelector(".wt-free-shipping-bar .wt-progress-bar__fill");
    if (!barWrapper || !fill) return;
    const nextProgress = parseFloat(fill.dataset.progress || "0");
    fill.style.setProperty("--wt-prev-free-progress", `${previousProgress || 0}%`);
    fill.style.setProperty("--wt-free-progress", `${nextProgress}%`);
    fill.classList.remove("wt-progress-bar__fill--animate");
    requestAnimationFrame(() => fill.classList.add("wt-progress-bar__fill--animate"));
    if (nextProgress >= 100 && (previousProgress || 0) < 100) {
      fill.classList.add("wt-progress-bar__fill--complete");
      setTimeout(() => fill.classList.remove("wt-progress-bar__fill--complete"), 500);
      const text = barWrapper.querySelector(".wt-free-shipping-bar__text");
      if (text) text.innerHTML = '<span class="wt-free-shipping-bar__success">\u{1F389} Free shipping unlocked!</span>';
      const remaining = parseInt(barWrapper.dataset.freeShippingRemainingCents || "0", 10);
      triggerShippingConfetti(previousRemaining || 0, remaining || 0, previousProgress || 0);
    }
    const amountNode = barWrapper.querySelector(".wt-free-shipping-bar__amount");
    const remaining = parseInt(barWrapper.dataset.freeShippingRemainingCents || "0", 10);
    if (amountNode && remaining !== previousRemaining) {
      const currencyCode =
        document.querySelector(".wt-cart__subtotal")?.dataset.currencyCode ||
        window.Shopify?.currency?.active ||
        "EUR";
      countMoneyValue(amountNode, previousRemaining || 0, remaining || 0, 400, currencyCode);
    }
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

function parseCounterValue(counterNode) {
  if (!counterNode) return 0;
  const value = parseInt(counterNode.textContent || "0", 10);
  return Number.isFinite(value) ? value : 0;
}

function countMoneyValue(node, fromCents, toCents, duration, currencyCode) {
  if (!node) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = formatMoneyValue(toCents, currencyCode);
    return;
  }
  const start = performance.now();
  const delta = (toCents || 0) - (fromCents || 0);
  const animate = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round((fromCents || 0) + delta * eased);
    node.textContent = formatMoneyValue(value, currencyCode);
    if (progress < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function formatMoneyValue(cents, currencyCode) {
  try {
    return new Intl.NumberFormat(document.documentElement.lang || navigator.language || "en", {
      style: "currency",
      currency: currencyCode || window.Shopify?.currency?.active || "EUR",
    }).format((cents || 0) / 100);
  } catch (error) {
    return `${(cents || 0) / 100}`;
  }
}

function triggerShippingConfetti(previousRemaining, nextRemaining) {
  const prevProgress = arguments.length >= 3 ? arguments[2] : null;
  if (nextRemaining > 0) return;
  if (typeof prevProgress === "number" && Number.isFinite(prevProgress)) {
    if (prevProgress >= 100) return;
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

function cssEscapeValue(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}
