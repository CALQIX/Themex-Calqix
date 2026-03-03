class NotificationPopup extends HTMLElement {
  connectedCallback() {
    this.popup = document.querySelector(".not-pu-section");
    if (!this.popup) return;

    this.closeBtn = this.popup.querySelector(".newsletter__close-btn");
    this.hasSubscription = this.dataset.hasSubscription === "true";
    this.delay = Number(this.dataset.delay) || 0;
    this.cookie = document.cookie.includes("hideNotificationPopup=true");

    if (this.hasSubscription || this.cookie) return;

    setTimeout(() => {
      this.popup.classList.remove("hidden");
      this.popup.classList.add("wt-popup-fade-in");
    }, this.delay * 1000);

    this.closeBtn.addEventListener("click", () => {
      this.popup.classList.add("hidden");
      this.setCookie("hideNotificationPopup", "true", 7);
    });
  }

  setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value};${expires};path=/`;
  }
}

customElements.define("notification-popup", NotificationPopup);
