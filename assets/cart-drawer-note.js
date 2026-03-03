class DrawerCartNote extends HTMLElement {
  constructor() {
    super();

    this.triggers = [
      this.querySelector(".giftnote__drawercart__addnote"),
      this.querySelector(".giftnote__body__close"),
      this.querySelector(".giftnote__overlay"),
    ];
    this.saveBtn = this.querySelector(".giftnote__save");

    this.addEventListener(
      "change",
      debounce((event) => {
        const body = JSON.stringify({
          note: document.getElementById("CartDrawer-note").value,
        });
        fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } });
      }, ON_CHANGE_DEBOUNCE_TIMER),
    );

    this.onToggle.bind(this);
  }

  getFocusableElements() {
    const focusableElementsSelector =
      "button, [href], input, select, textarea, [tabindex]";
    const focusableElements = () =>
      Array.from(
        this.querySelector(".giftnote__body").querySelectorAll(
          focusableElementsSelector,
        ),
      );

    return {
      focusableElements,
      first: focusableElements()[0],
      last: focusableElements()[focusableElements().length - 1],
    };
  }

  connectedCallback() {
    this.init();
  }

  onSave() {
    const body = JSON.stringify({
      note: document.getElementById("CartDrawer-note").value,
    });
    fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } });
    this.onToggle();
  }

  onToggle() {
    const { focusableElements } = this.getFocusableElements();

    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      setTabindex(focusableElements(), "-1");
      this.triggers[0].focus();
    } else {
      this.setAttribute("open", true);
      setTabindex(focusableElements(), "0");
      this.triggers[1].focus();
    }
  }

  init() {
    this.triggers.forEach((trigger) => {
      trigger?.addEventListener("click", (e) => {
        e.preventDefault();
        this.onToggle();
      });
    });

    this.saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.onSave();
    });

    this.addEventListener("keydown", (e) => {
      const isTabPressed =
        e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const { first, last } = this.getFocusableElements();

      if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
        if (this.isOpen) {
          this.onToggle();
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
  }
}

customElements.define("drawer-cart-note", DrawerCartNote);
