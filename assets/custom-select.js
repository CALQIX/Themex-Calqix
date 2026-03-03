class CustomSelect extends HTMLElement {
  static get observedAttributes() {
    return ["selected"];
  }

  constructor() {
    super();

    this.referenceElement = document.getElementById(this.dataset.referenceId);
    this.currentLabel = this.querySelector("[ custom-select-current]");
    this.mainTrigger = this.querySelector("[custom-select-trigger]");
  }

  connectedCallback() {
    this.init();
  }

  disconectedCallback() {
    // this.removeEventListener('wtSelectChange');
  }

  attributeChangedCallback(name, oldValue, newValue) {
    const onChangeEvent = new CustomEvent("wtSelectChange", {
      detail: {
        prevValue: oldValue,
        value: newValue,
      },
    });
    this.dispatchEvent(onChangeEvent);
  }

  getFocusableElements() {
    const focusableElementsSelector = "[role='option']";
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

  setSelectedLabel() {
    const selectedLabel = this.querySelector(
      "[custom-select-list] [selected]",
    )?.textContent;

    this.setAttribute("selected-label", selectedLabel);
    this.currentLabel.textContent = selectedLabel;
  }

  getAttrVal(attr, elem) {
    return elem.hasAttribute(attr) ? elem.getAttribute(attr) : null;
  }

  unselectAll() {
    const listItems = this.querySelectorAll("[custom-select-list] li");
    listItems.forEach((item) => item.removeAttribute("selected"));
  }

  onSelect(val, elem) {
    this.unselectAll();
    this.setAttribute("selected", val);
    elem.setAttribute("selected", "");
    this.setSelectedLabel();
    this.updateReferenceValue();
    this.toggleState();
  }

  createOverlay() {
    if (!document.querySelector("[custom-select-overlay]")) {
      const overlay = document.createElement("div");
      overlay.setAttribute("custom-select-overlay", "");
      document.body.appendChild(overlay);
      overlay.addEventListener("click", () => this.toggleState());
    }
  }

  handleClick(e) {
    const clickedElem = e.target;

    if (
      clickedElem.hasAttribute("custom-select-drawer") ||
      clickedElem === this ||
      clickedElem.classList.contains("wt-options__close")
    ) {
      this.toggleState();
    }

    if (this.getAttrVal("value", clickedElem)) {
      this.onSelect(this.getAttrVal("value", e.target), clickedElem);
    }
  }

  init() {
    this.createOverlay();
    this.mainTrigger.addEventListener("click", () => this.toggleState());

    this.addEventListener("keydown", (e) => {
      const isTabPressed =
        e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const { first, last } = this.getFocusableElements();

      if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
        if (this.hasAttribute("open")) {
          this.toggleState();
        }
      }

      if (isTabPressed && this.hasAttribute("open")) {
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });

    this.addEventListener("click", this.handleClick); // TODO: add touch event
    this.setSelectedLabel();
  }

  updateReferenceValue() {
    this.referenceElement.value = this.getAttribute("selected");
    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    this.referenceElement.dispatchEvent(inputEvent);
  }

  toggleState() {
    const body = document.body;
    const openBodyAttr = "custom-select-opened";
    const header = document.querySelector("header.page-header");
    const liItems = this.querySelectorAll("li");
    const trigger = this.querySelector("[custom-select-trigger]");
    const isOpen = trigger.getAttribute("aria-expanded") === "true";

    trigger.setAttribute("aria-expanded", !isOpen);

    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      body.removeAttribute(openBodyAttr);
      body.classList.contains("page-header-sticky")
        ? header.classList.remove("hide")
        : "";
      for (const item of liItems) {
        item.setAttribute("tabindex", "-1");
      }
      this.mainTrigger.focus();
    } else {
      this.setAttribute("open", "");
      body.setAttribute(openBodyAttr, "");
      body.classList.contains("page-header-sticky")
        ? header.classList.add("hide")
        : "";
      for (const item of liItems) {
        item.setAttribute("tabindex", "0");
      }
      if (window.matchMedia("(max-width: 1199px)").matches) {
        this.querySelector("[custom-select-list] [selected]").focus();
      }
    }
  }
}

customElements.define("custom-select", CustomSelect);
