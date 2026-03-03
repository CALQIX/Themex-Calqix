if (!customElements.get("countdown-timer")) {
  customElements.define(
    "countdown-timer",
    class CountdownTimer extends HTMLElement {
      constructor() {
        super();
        // Bind the updateCountdown method to ensure the correct this context
        this.updateCountdown = this.updateCountdown.bind(this);
      }

      connectedCallback() {
        // Initialize properties
        this._initProperties();
        if (!this.timerDisplay) {
          console.error("Timer display element not found.");
          return;
        }
        if (isNaN(this.endDate)) {
          if (this.timerError) {
            this.timerError.innerHTML = `${this.translations.invalidDate}`;
          }
          return;
        }
        // Start the countdown timer
        this.updateCountdown();
        this.interval = setInterval(this.updateCountdown, 1000);
      }

      // Update the countdown timer display
      updateCountdown() {
        const now = new Date().getTime();
        const distance = this.endDate - now;

        if (distance < 0) {
          this.timerDisplay.innerHTML = `<span class="expired-message">${this.expiredMessage}</span>`;
          clearInterval(this.interval);
          return;
        }

        const days = String(
          Math.floor(distance / (1000 * 60 * 60 * 24)),
        ).padStart(2, "0");
        const hours = String(
          Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        ).padStart(2, "0");
        const minutes = String(
          Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        ).padStart(2, "0");
        const seconds = String(
          Math.floor((distance % (1000 * 60)) / 1000),
        ).padStart(2, "0");

        this.timerDisplay.innerHTML = `
          <div class="wt-counter__item">
            <div class="wt-counter__item__value">${days}</div>
            <div class="wt-counter__item__label">${this.translations.days}</div>
          </div>
          <div class="wt-counter__item">
            <div class="wt-counter__item__value">${hours}</div>
            <div class="wt-counter__item__label">${this.translations.hours}</div>
          </div>
          <div class="wt-counter__item">
            <div class="wt-counter__item__value">${minutes}</div>
            <div class="wt-counter__item__label">${this.translations.minutes}</div>
          </div>
          <div class="wt-counter__item">
            <div class="wt-counter__item__value">${seconds}</div>
            <div class="wt-counter__item__label">${this.translations.seconds}</div>
          </div>`;
      }

      disconnectedCallback() {
        // Clear the interval when the element is removed from the DOM
        clearInterval(this.interval);
      }

      // Initialize component properties
      _initProperties() {
        const endDateString = this.getAttribute("end-date");
        this.endDate = Date.parse(endDateString.replace(/-/g, "/"));
        this.expiredMessage = this.getAttribute("expired-message");
        this.timerDisplay = this.querySelector(".wt-countdown-timer__display");
        this.timerError = this.querySelector(".wt-countdown-timer__error");
        const useLongLabels = this.hasAttribute("data-long-labels");
        this.translations = {
          days: useLongLabels
            ? this.getAttribute("data-translation-days-long")
            : this.getAttribute("data-translation-days") || "d",
          hours: useLongLabels
            ? this.getAttribute("data-translation-hours-long")
            : this.getAttribute("data-translation-hours") || "h",
          minutes: useLongLabels
            ? this.getAttribute("data-translation-minutes-long")
            : this.getAttribute("data-translation-minutes") || "m",
          seconds: useLongLabels
            ? this.getAttribute("data-translation-seconds-long")
            : this.getAttribute("data-translation-seconds") || "s",
          invalidDate:
            this.getAttribute("data-translation-invalid-date") ||
            "Invalid date format. Please enter the date and time in the format YYYY-MM-DD HH:MM.",
        };
      }
    },
  );
}
