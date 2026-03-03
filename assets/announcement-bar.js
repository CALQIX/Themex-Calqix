class AnnouncementBar extends HTMLElement {
  constructor() {
    super();

    this.currentIndex = 0;
    this.touchStartX = 0;
    this.touchEndX = 0;
    this.announcementBar = this.querySelector("#wt-announcement__container");
    this.announcementInterval = null;

    this.changeAnnouncement = this.changeAnnouncement.bind(this);
    this.previousAnnouncement = this.previousAnnouncement.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.hideForOneDay = this.hideForOneDay.bind(this);
    this.restartInterval = this.restartInterval.bind(this);
    this.isMobileView = this.isMobileView.bind(this);
  }

  connectedCallback() {
    if (
      !this.announcementBar?.classList.contains(
        "wt-announcement__container--marquee",
      )
    ) {
      this.announcementInterval = setInterval(this.changeAnnouncement, 5000);

      if (this.announcementBar) {
        this.announcementBar.addEventListener(
          "touchstart",
          this.handleTouchStart,
          { passive: true },
        );
        this.announcementBar.addEventListener(
          "touchmove",
          this.handleTouchMove,
          {
            passive: true,
          },
        );
        this.announcementBar.addEventListener("touchend", this.handleTouchEnd, {
          passive: true,
        });
        this.announcementBar.addEventListener(
          "touchstart",
          () => clearInterval(this.announcementInterval),
          { passive: true },
        );
        this.announcementBar.addEventListener(
          "touchend",
          this.restartInterval,
          {
            passive: true,
          },
        );
      }
    }

    if (this.announcementBar)
      this.announcementBar.style.transition = "transform 0.5s ease-in-out";

    this.closeButton = this.querySelector(".wt-announcement__close");
    if (this.closeButton)
      this.closeButton.addEventListener("click", this.hideForOneDay);

    window.addEventListener("resize", this.handleResize.bind(this));
  }

  handleResize() {
    if (window.innerWidth >= 900) {
      // Reset the translateX to its initial state
      if (this.announcementBar) {
        this.announcementBar.style.transform = "translateX(0)";
        this.currentIndex = 0;
      }
    }
  }

  isMobileView() {
    return window.innerWidth < 900;
  }

  restartInterval() {
    clearInterval(this.announcementInterval);
    this.announcementInterval = setInterval(this.changeAnnouncement, 5000);
  }

  hideForOneDay() {
    const oneDayLater = new Date().getTime() + 24 * 60 * 60 * 1000;
    localStorage.setItem("wt-announcement-hidden", oneDayLater);
    this.style.display = "none";
  }

  changeAnnouncement() {
    if (!this.isMobileView()) {
      return;
    }

    const totalSlides = this.announcementBar?.children.length;

    // Move to the next slide
    this.currentIndex = (this.currentIndex + 1) % totalSlides;
    const newPosition = -(this.currentIndex * 100);

    if (this.announcementBar)
      this.announcementBar.style.transform = `translateX(${newPosition}vw)`;

    if (this.currentIndex === 0 && this.announcementBar) {
      // When we're back at the start, reset position with transition.
      setTimeout(() => {
        this.announcementBar.style.transition = "none";
        this.announcementBar.style.transform = "translateX(0)";
        this.currentIndex = 0;
        // Restore transition after resetting position
        setTimeout(() => {
          this.announcementBar.style.transition = "transform 0.5s ease-in-out";
        }, 0);
      }, 490); // Just slightly before 0.5s to ensure it happens before next slide movement.
    }
  }

  previousAnnouncement() {
    const totalSlides = this.announcementBar?.children.length;

    this.currentIndex = (this.currentIndex - 1 + totalSlides) % totalSlides;
    const newPosition = -(this.currentIndex * 100);
    if (this.announcementBar)
      this.announcementBar.style.transform = `translateX(${newPosition}vw)`;
  }

  handleTouchStart(e) {
    if (this.isMobileView()) {
      this.touchStartX = e.touches[0].clientX;
    }
  }

  handleTouchMove(e) {
    if (this.isMobileView()) {
      this.touchEndX = e.touches[0].clientX;
    }
  }

  handleTouchEnd() {
    const swipeThreshold = 30;

    if (Math.abs(this.touchEndX - this.touchStartX) > swipeThreshold) {
      if (this.touchEndX < this.touchStartX) {
        this.changeAnnouncement();
      } else {
        this.previousAnnouncement();
      }
    }
  }

  disconnectedCallback() {
    clearInterval(this.announcementInterval);
    this.announcementBar.removeEventListener(
      "touchstart",
      this.handleTouchStart,
    );
    this.announcementBar.removeEventListener("touchmove", this.handleTouchMove);
    this.announcementBar.removeEventListener("touchend", this.handleTouchEnd);
    window.removeEventListener("resize", this.handleResize.bind(this));
  }
}

customElements.define("announcement-bar", AnnouncementBar);
