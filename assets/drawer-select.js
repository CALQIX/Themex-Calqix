if (!customElements.get("drawer-select")) {
  customElements.define(
    "drawer-select",
    class DrawerSelect extends HTMLElement {
      constructor() {
        super();

        this.optionId = this.dataset.optionId;
        this.currentVariant = this.dataset.currentVariant;
        this.optionTitleLabel = this.querySelector(
          ".wt-product__option__title .value",
        );
        this.trigger = this.querySelector(".wt-select__trigger");
        this.triggerLabel = this.trigger?.querySelector(
          ".wt-select__trigger__label",
        );
        this.options = this.querySelectorAll(
          ".wt-select__item:not(.wt-select__item--disabled)",
        );
        this.optionName = this.querySelector(
          ".wt-product__option__title .label",
        ).innerText;
        this.form = document.querySelector(
          `form[data-type=add-to-cart-form]:has(input[name='id'][value='${this.currentVariant}'])`,
        );

        this.inputType = this.dataset.inputType;

        this.body = document.body;
        this.container = this.querySelector(".wt-select__drawer");
        this.closeButton = this.querySelector(".wt-select__drawer__close");
        this.isDrawerOpen = false;

        // Overlay-related variables
        this.pageOverlayClass = "page-overlay";
        this.pageBodyActiveClass = "wt-select-opened";
        this.activeOverlayBodyClass = `${this.pageOverlayClass}-on`;

        // Bind methods
        this.openDrawer = this.openDrawer.bind(this);
        this.closeDrawer = this.closeDrawer.bind(this);
        this.handleInteractionOutside =
          this.handleInteractionOutside.bind(this);
        this._keyDownHandler = this._keyDownHandler.bind(this);
        this.setOption = this.setOption.bind(this);
        this.setCheckboxOption = this.setCheckboxOption.bind(this);
        this.setTextOption = this.setTextOption.bind(this);
        this._handleTabindex = this._handleTabindex.bind(this);
      }

      connectedCallback() {
        if (this.inputType === "dropdown") {
          this._init();
          this.preselectFirstOption();
        } else if (this.inputType === "text") {
          this.setupTextListeners();
        } else {
          this.setupCheckboxListeners();
        }
      }

      disconnectedCallback() {
        this.cleanupListeners();
      }

      createOverlay() {
        if (!this.querySelector(`.${this.pageOverlayClass}`)) {
          this.overlay = document.createElement("div");
          this.overlay.classList.add(this.pageOverlayClass);
          this.appendChild(this.overlay);
        } else {
          this.overlay = this.querySelector(`.${this.pageOverlayClass}`);
        }
      }

      addEventListeners() {
        this.trigger.addEventListener("click", this.openDrawer);
        this.closeButton.addEventListener("click", this.closeDrawer);
        this.container.addEventListener("keydown", this._keyDownHandler);
        this.options.forEach((option) => {
          option.addEventListener("click", this.setOption);
        });
        // Add event listener to the overlay to close the drawer when clicked
        this.overlay.addEventListener("click", this.closeDrawer);
      }

      setupCheckboxListeners() {
        this.inputCheckbox = this.querySelector(".form-checkbox__input");
        this.inputCheckbox.addEventListener("click", this.setCheckboxOption);
      }

      setupTextListeners() {
        this.inputText = this.querySelector(".wt-product__option__text");
        this.inputText.addEventListener("change", this.setTextOption);
      }

      cleanupListeners() {
        if (this.inputType === "dropdown") {
          this.trigger.removeEventListener("click", this.openDrawer);
          this.closeButton.removeEventListener("click", this.closeDrawer);
          this.container.removeEventListener("keydown", this._keyDownHandler);
          this.options.forEach((option) => {
            option.removeEventListener("click", this.setOption);
          });
          this.overlay.removeEventListener("click", this.closeDrawer);
        } else {
          this.inputCheckbox.removeEventListener(
            "click",
            this.setCheckboxOption,
          );
        }
      }

      openDrawer() {
        this.container.classList.add("wt-select__drawer--open");
        this.overlay.classList.remove("hidden");
        this.body.classList.add(this.activeOverlayBodyClass);
        this.body.classList.add(this.pageBodyActiveClass);
        this.isDrawerOpen = true;
        this._handleTabindex();
        document.addEventListener("click", this.handleInteractionOutside);
      }

      closeDrawer() {
        this.container.classList.remove("wt-select__drawer--open");
        this.overlay.classList.add("hidden");
        this.body.classList.remove(this.activeOverlayBodyClass);
        this.body.classList.remove(this.pageBodyActiveClass);
        this.isDrawerOpen = false;
        this._handleTabindex();
        document.removeEventListener("click", this.handleInteractionOutside);
      }

      handleInteractionOutside(event) {
        if (this.isDrawerOpen) {
          const clickInsideDrawer = this.container.contains(event.target);
          const clickOnTrigger = this.trigger.contains(event.target);
          const clickOption = Array.from(this.options).some((option) =>
            option.contains(event.target),
          );
          if ((!clickInsideDrawer && !clickOnTrigger) || clickOption) {
            this.closeDrawer();
          }
        }
      }

      getFocusableElements() {
        const focusableElementsSelector =
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]';
        const focusableElements = Array.from(
          this.container.querySelectorAll(focusableElementsSelector),
        );
        return {
          first: focusableElements[0],
          last: focusableElements[focusableElements.length - 1],
        };
      }

      setOption(event) {
        const target = event.currentTarget || event;
        const value = target.dataset.value.trim();

        this.triggerLabel.innerHTML = `<span class="value">${value}</span>`;
        this.optionTitleLabel.innerHTML = value;

        this.options.forEach((option) => {
          option.classList.remove("wt-select__item--current");
          option.setAttribute("aria-selected", "false");
        });

        target.classList.add("wt-select__item--current");
        target.setAttribute("aria-selected", "true");

        this.updateHiddenInput(value);
        this.closeDrawer();
        // this.trigger.focus();
      }

      setCheckboxOption(event) {
        const target = event.currentTarget || event;
        console.log(target);
        const value = target.checked ? target.value : "";
        this.updateHiddenInput(value);
      }

      setTextOption(event) {
        const target = event.currentTarget || event;
        const value = target.value;
        this.updateHiddenInput(value);
      }

      preselectFirstOption() {
        const currentOption = this.container.querySelector(
          ".wt-select__item--current",
        );
        if (currentOption) {
          this.setOption(currentOption);
        } else if (this.options[0]) {
          this.setOption(this.options[0]);
        }
      }

      updateHiddenInput(value) {
        let hiddenInput = this.form?.querySelector(
          `input[type="hidden"][name="properties[${this.optionName}]"]`,
        );
        if (!hiddenInput) {
          hiddenInput = document.createElement("input");
          hiddenInput.type = "hidden";
          hiddenInput.name = `properties[${this.optionName}]`;
          this.form?.appendChild(hiddenInput);
        }
        hiddenInput.value = value;
      }

      _init() {
        this.createOverlay();
        this._handleTabindex();
        this.addEventListeners();
      }

      _keyDownHandler(e) {
        const isTabPressed = e.key === "Tab" || e.keyCode === 9;

        if (e.key === "Escape" || e.keyCode === 27) {
          if (this.isDrawerOpen) {
            this.closeDrawer();
            this.trigger.focus();
          }
        }

        if (this.isDrawerOpen && isTabPressed) {
          const { first, last } = this.getFocusableElements();
          if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }

      _handleTabindex() {
        const interactiveElements = this.container.querySelectorAll(
          ".wt-select__item, .wt-select__drawer__close",
        );
        interactiveElements.forEach((el) => {
          el.setAttribute("tabindex", this.isDrawerOpen ? "0" : "-1");
        });
      }
    },
  );
}
