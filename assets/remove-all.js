if (!customElements.get("remove-all")) {
  customElements.define(
    "remove-all",
    class RemoveAll extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.clearButton = this.querySelector(
          ".wt-header__search__clear-button",
        );
        this.searchInput = document.querySelector("#Search-In-Template");
        this.isVisibleClearButton = false;

        this.changeVisibilityOfButton();
        this.addEventListeners();
      }

      changeVisibilityOfButton() {
        if (this.searchInput.value.length > 0 && !this.isVisibleClearButton) {
          this.clearButton.style.display = "flex";
          this.isVisibleClearButton = true;
        } else if (
          this.searchInput.value.length === 0 &&
          this.isVisibleClearButton
        ) {
          this.clearButton.style.display = "none";
          this.isVisibleClearButton = false;
        }
      }

      clearInputValue() {
        this.searchInput.value = "";
        this.clearButton.style.display = "none";
        this.isVisibleClearButton = false;
      }

      addEventListeners() {
        this.searchInput.addEventListener("input", () => {
          this.changeVisibilityOfButton();
        });

        this.clearButton.addEventListener("click", () => {
          this.clearInputValue();
        });
      }

      removeEventListeners() {
        this.searchInput.removeEventListener("input", () => {
          this.changeVisibilityOfButton();
        });

        this.clearButton.removeEventListener("click", () => {
          this.clearInputValue();
        });
      }

      disconnectedCallback() {
        this.removeEventListeners();
      }
    },
  );
}
