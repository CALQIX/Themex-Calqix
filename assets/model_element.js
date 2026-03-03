if (!customElements.get("model-element")) {
  customElements.define(
    "model-element",
    class ModelElement extends HTMLElement {
      constructor() {
        super();
        this.initialize();
        this.showModelBound = this.showModel.bind(this);
        this.closeButtonBound = this.closeButton.bind(this);
      }

      connectedCallback() {
        this.modelBtn = this.querySelector(".model-btn");

        // Add the show model event listener to modelBtn
        this.modelBtn?.addEventListener("click", this.showModelBound);
      }

      disconnectedCallback() {
        // Remove the show model event listener to avoid memory leaks
        this.modelBtn?.removeEventListener("click", this.showModelBound);
      }

      getFocusableElements() {
        const focusableElementsSelector =
          "button, [href], input, select, [tabindex], iframe";
        const focusableElements = () =>
          Array.from(
            this.modelContainer.querySelectorAll(focusableElementsSelector)
          ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);

        return {
          focusableElements,
          first: focusableElements()[0],
          last: focusableElements()[focusableElements().length - 1],
        };
      }

      initialize() {
        const els = this.querySelectorAll('[data-model="true"]');
        this.elsArr = Array.from(els);
        this.ul = this.querySelectorAll("ul");

        this.modelContainer = document.querySelector(".model-container");
        this.modelWrapper = this.modelContainer?.querySelector(".model");
        this.closeBtn = this.modelContainer?.querySelector(".close-btn");
        this.iframe = this.querySelector("iframe");

        // Modal keyboard navigation handling
        this.modelContainer.addEventListener("keydown", (e) => {
          const isTabPressed =
            e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
          const { first, last } = this.getFocusableElements();

          if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
            this.closeBtn.click();
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
      }

      showModel(e) {
        this.trigger = e.currentTarget;
        document.body.style.overflow = "hidden";

        // Dynamically add event listeners for backBtn and closeBtn
        this.backBtn = this.modelWrapper.querySelector(".hero__button--link");
        this.backBtn?.addEventListener("click", this.closeButtonBound);
        this.closeBtn?.addEventListener("click", this.closeButtonBound);

        // Clone and show the model
        this.modelViewer = this.querySelector("model-viewer") || this.iframe;
        this.modelWrapper?.insertBefore(
          this.modelViewer.cloneNode(true),
          this.backBtn
        );

        // Show the modal
        this.modelContainer?.classList.remove("hidden");
        this.closeBtn.setAttribute("tabindex", "0");
        this.closeBtn.focus();

      }

      closeButton(e) {
        e?.stopPropagation();
        document.body.style.overflow = "auto";
        this.modelContainer?.classList.add("hidden");

        // Remove dynamically added event listeners for backBtn and closeBtn
        this.backBtn?.removeEventListener("click", this.closeButtonBound);
        this.closeBtn?.removeEventListener("click", this.closeButtonBound);

        const elementToRemove =
          this.modelWrapper.querySelector("model-viewer") ||
          this.modelWrapper.querySelector("iframe");
        if (elementToRemove) this.modelWrapper.removeChild(elementToRemove);
        this.closeBtn.setAttribute("tabindex", "-1");
        this.trigger?.focus();
      }
    }
  );
}

window.ProductModel = {
  loadShopifyXR() {
    Shopify.loadFeatures([
      {
        name: "shopify-xr",
        version: "1.0",
        onLoad: this.setupShopifyXR.bind(this),
      },
    ]);
  },

  setupShopifyXR(errors) {
    if (errors) return;

    if (!window.ShopifyXR) {
      document.addEventListener("shopify_xr_initialized", () =>
        this.setupShopifyXR()
      );
      return;
    }

    document.querySelectorAll('[id^="ProductJSON-"]').forEach((modelJSON) => {
      window.ShopifyXR.addModels(JSON.parse(modelJSON.textContent));
      modelJSON.remove();
    });
    window.ShopifyXR.setupXRElements();
  },
};

window.addEventListener("DOMContentLoaded", () => {
  if (window.ProductModel) window.ProductModel.loadShopifyXR();
});