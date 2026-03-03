if (!customElements.get("switch-column")) {
  customElements.define(
    "switch-column",
    class SwitchColumn extends HTMLElement {
      static MOBILE_WIDTH_BREAKPOINT = 600;

      constructor() {
        super();
      }

      connectedCallback() {
        this.initialize();
      }

      initialize() {
        this.container = this.querySelector(
          ".collection__mobile-layout-switch",
        );
        this.loader = this.querySelector(".loading-overlay");
        this.collectionGrid = document.querySelector(".collection__grid");
        this.checkInput = document.querySelector(
          ".collection__mobile-layout-checkbox",
        );
        this.gridButton = this.container.querySelector(".css-icon--grid");
        this.squareButton = this.container.querySelector(".css-icon--square");
        this.sortCustomSelect = document.querySelector(
          '[data-reference-id="SortBy"]',
        );

        this.boundChangeNumberOfColumns = this.changeNumberOfColumns.bind(this);
        this.boundHandleResize = this.handleResize.bind(this);
        this.boundHandleLoad = this.handleLoad.bind(this);

        this.addEventListeners();
      }

      addEventListeners() {
        window.addEventListener("load", this.boundHandleLoad);
        window.addEventListener("resize", this.boundHandleResize);
        this.sortCustomSelect.addEventListener(
          "wtSelectChange",
          this.boundHandleLoad,
        );
        this.container.addEventListener(
          "click",
          this.boundChangeNumberOfColumns,
        );
      }

      removeEventListeners() {
        window.removeEventListener("load", this.boundHandleLoad);
        window.removeEventListener("facets:change", this.boundHandleLoad);
        window.removeEventListener("resize", this.boundHandleResize);
        this.container.removeEventListener(
          "click",
          this.boundChangeNumberOfColumns,
        );
        this.sortCustomSelect.removeEventListener(
          "wtSelectChange",
          this.boundHandleLoad,
        );
      }

      handleLoad() {
        this.loader.classList.add("loading-overlay--hidden");
        this.container.classList.remove(
          "collection__mobile-layout-switch--hidden",
        );
        if (window.innerWidth < SwitchColumn.MOBILE_WIDTH_BREAKPOINT) {
          this.setNumberOfColumns();
        }
      }

      handleResize() {
        if (
          window.innerWidth >= SwitchColumn.MOBILE_WIDTH_BREAKPOINT &&
          this.collectionGrid.style.getPropertyValue("--cols")
        ) {
          this.collectionGrid.style.removeProperty("--cols");
        } else if (window.innerWidth < SwitchColumn.MOBILE_WIDTH_BREAKPOINT) {
          if (!this.loader.classList.contains("loading-overlay--hidden")) {
            this.loader.classList.add("loading-overlay--hidden");
          }
            if (
              this.container.classList.contains(
                "collection__mobile-layout-switch--hidden",
              )
            ) {
              this.container.classList.remove(
                "collection__mobile-layout-switch--hidden",
              );
            }
            this.setNumberOfColumns();
        }
      }

      takeFromLocalStorage() {
        return localStorage.getItem("numberOfColumns");
      }

      setInLocalStorage(value) {
        localStorage.setItem("numberOfColumns", value);
      }

      getNumberOfColumns() {
        if (this.dataset.designMode === "true") {
          return this.dataset.col;
        } else {
          const valueFromLocalStorage = this.takeFromLocalStorage();
          const value =
            valueFromLocalStorage !== null
              ? valueFromLocalStorage
              : this.dataset.col;
          return value;
        }
      }

      setNumberOfColumns() {
        const colsNumber = this.getNumberOfColumns();

        if (["1", "2"].includes(colsNumber)) {
          this.collectionGrid.style.setProperty("--cols", colsNumber);
          this.changeColorOfButtons();
        }
      }

      changeNumberOfColumns() {
        const style = getComputedStyle(this.collectionGrid);
        const valueOfCols = style.getPropertyValue("--cols").trim();
        const newValue = valueOfCols === "1" ? "2" : "1";

        this.collectionGrid.style.setProperty("--cols", newValue);
        this.setInLocalStorage(newValue);
        this.dataset.col = newValue;
        this.changeColorOfButtons();
      }

      changeColorOfButtons() {
        const colsNumber = this.getNumberOfColumns();
        const primaryColor = "var(--color-text)";
        const secondaryColor = "var(--color-border)";

        this.squareButton.style.setProperty(
          "--icon-color",
          colsNumber === "1" ? primaryColor : secondaryColor,
        );
        this.gridButton.style.setProperty(
          "--icon-color",
          colsNumber === "2" ? primaryColor : secondaryColor,
        );
      }

      disconnectedCallback() {
        this.removeEventListeners();
      }
    },
  );
}
