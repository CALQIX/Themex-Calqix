// assets/modal-swiper.js
import Swiper from "./swiper-bundle.esm.browser.min.js";

class ModalSwiper extends HTMLElement {
  // start every modal muted by default
  static globalMuted = true;

  constructor() {
    super();
    this._slides = [];
    this._config = {};
    this._swiper = null;
    this._overlay = null;
    this.bodyActiveModalClass = "video-reels-modal-opened";
  }

  /** Array of slide objects: { src: string, cardHTML: string } */
  set slides(value) {
    this._slides = value;
  }

  /** Swiper config object, e.g. { initialSlide: 2, loop: true, ... } */
  set config(value) {
    this._config = value;
  }

  /** Pause, reset and mute all videos in the modal */
  _muteAndResetAllVideos() {
    this._overlay.querySelectorAll("video").forEach((video) => {
      video.pause();
      video.currentTime = 0;
      video.muted = ModalSwiper.globalMuted;
    });
  }

  /** Get the global play/pause button element */
  _getPlayPauseButton() {
    return this._overlay.querySelector(".shoppable-video__control-button");
  }

  /** Show the "play" icon on the play/pause button */
  _showPlayIcon() {
    const btn = this._getPlayPauseButton();
    if (!btn) return;
    btn.classList.remove("shoppable-video__control-button--pause");
    btn.classList.add("shoppable-video__control-button--play");
  }

  /** Show the "pause" icon on the play/pause button */
  _showPauseIcon() {
    const btn = this._getPlayPauseButton();
    if (!btn) return;
    btn.classList.remove("shoppable-video__control-button--play");
    btn.classList.add("shoppable-video__control-button--pause");
  }

  /** Play only the video in the currently active slide, respecting globalMuted,
   and reset play/pause button state to "pause" */
  _playActiveSlideVideo() {
    const activeVid = this._overlay.querySelector(".swiper-slide-active video");
    if (!activeVid) return;

    activeVid.muted = ModalSwiper.globalMuted;
    activeVid.play();

    this._showPlayIcon();
  }

  /** Listen for clicks on the "Add" button and pause active video */
  _wireAddButtonListener() {
    this._overlay.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".shoppable-video__add-button");
      if (!addBtn) return;

      const activeVid = this._overlay.querySelector(
        ".swiper-slide-active video",
      );
      if (activeVid) {
        activeVid.pause();
        this._showPauseIcon();
      }
    });
  }

  /** Wire play/pause & mute/unmute buttons, supporting single-slide fallback */
  _wireControlEvents() {
    // helper to get the current video
    const getActiveVideo = () =>
      this._overlay.querySelector(".swiper-slide-active video") ||
      this._overlay.querySelector("video");

    // Play/Pause toggle
    const playBtn = this._overlay.querySelector(
      ".shoppable-video__control-button",
    );
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        const vid = getActiveVideo();
        if (!vid) return;

        if (vid.paused) {
          vid.play();
          // now show "play" icon
          this._showPlayIcon();
        } else {
          vid.pause();
          // now show "pause" icon
          this._showPauseIcon();
        }
      });
    }

    // Mute/Unmute (global)
    const soundBtnEl = this._overlay.querySelector(".wt-video__sound-toggle");
    if (soundBtnEl) {
      soundBtnEl.addEventListener("click", () => {
        ModalSwiper.globalMuted = !ModalSwiper.globalMuted;
        this._overlay.querySelectorAll("video").forEach((v) => {
          v.muted = ModalSwiper.globalMuted;
        });
        soundBtnEl.dataset.sound = ModalSwiper.globalMuted ? "off" : "on";
      });
    }
  }

  open() {
    // 1) Build & append the overlay
    this._renderOverlay();
    document.body.appendChild(this._overlay);
    document.body.classList.add(this.bodyActiveModalClass);

    // 2) Decorate icons & respect config flags
    this._decorateIcons();
    this._applyConfigFlags();

    // 3) Seed videos – mute, loop, playsInline, disable autoplay
    this._overlay.querySelectorAll("video").forEach((video) => {
      video.muted = ModalSwiper.globalMuted;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = false;
    });

    // sync the sound button state
    const soundBtn = this._overlay.querySelector(".wt-video__sound-toggle");
    if (soundBtn) {
      soundBtn.dataset.sound = ModalSwiper.globalMuted ? "off" : "on";
    }

    // 4) Initialize Swiper if multiple slides
    const container = this._overlay.querySelector(".swiper-container");
    if (this._slides.length > 1) {
      this._swiper = new Swiper(container, this._config);

      // on init: mute/reset all, then play only the initial active slide
      this._muteAndResetAllVideos();
      this._playActiveSlideVideo();

      // before slide change: mute/reset all videos
      this._swiper.on("slideChangeTransitionStart", () => {
        this._muteAndResetAllVideos();
      });

      // after slide change: play only the new active slide
      this._swiper.on("slideChangeTransitionEnd", () => {
        this._playActiveSlideVideo();
      });

      // prev/next nav buttons
      this._overlay
        .querySelector(".video-reels-modal__nav--prev")
        .addEventListener("click", () => this._swiper.slidePrev());
      this._overlay
        .querySelector(".video-reels-modal__nav--next")
        .addEventListener("click", () => this._swiper.slideNext());

      if (this._config.autoAdvanceOnEnd) {
        this._setupAutoAdvance(container);
      }
    } else {
      // single-slide case: manually mark slide as active
      const singleSlide = this._overlay.querySelector(".swiper-slide");
      if (singleSlide) {
        singleSlide.classList.add("swiper-slide-active");

        // enable autoplay on the single video
        const singleVid = singleSlide.querySelector("video");
        if (singleVid) {
          singleVid.autoplay = true;
        }
      }
      this._muteAndResetAllVideos();
      this._playActiveSlideVideo();

      // hide navigation buttons
      this._overlay
        .querySelectorAll(
          ".video-reels-modal__nav--prev, .video-reels-modal__nav--next",
        )
        .forEach((btn) => (btn.style.display = "none"));
    }

    // 5) Close button
    this._overlay
      .querySelector(".video-reels-modal__close")
      .addEventListener("click", () => this.close());

    // 6) Optional features
    this._setupProgressBars();
    this._wireControlEvents();

    // 7) Listen for "Add" clicks on the modal
    this._wireAddButtonListener();

    // 8) Auto-hide swipe hint after a few seconds
    const swipeHint = this._overlay.querySelector(
      ".video-reels-modal__swiping",
    );

    if (swipeHint) {
      const swipeHintHideClass = "video-reels-modal__swiping--hidden";

      swipeHint.classList.add(swipeHintHideClass);
      if (this._slides.length > 1) {
        swipeHint.classList.remove(swipeHintHideClass);
        setTimeout(() => {
          swipeHint.classList.add(swipeHintHideClass);
        }, 3000);
      }
    }
  }

  close() {
    if (this._swiper) {
      this._swiper.destroy(true, true);
      this._swiper = null;
    }
    if (this._overlay?.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    document.body.classList.remove(this.bodyActiveModalClass);
    this.remove();
  }

  _applyConfigFlags() {
    if (!this._config.showPlayPause) {
      this._overlay.querySelector(".shoppable-video__control-button")?.remove();
    }
    if (!this._config.showUnmute) {
      this._overlay.querySelector(".wt-video__sound-toggle")?.remove();
    }
    const ctrls = this._overlay.querySelector(".video-reels-modal__controls");
    if (ctrls && ctrls.children.length === 0) {
      ctrls.style.display = "none";
    }
  }

  _renderOverlay() {
    const swipeDirClass =
      this._config.direction === "vertical"
        ? " video-reels-modal__swiping--vertical"
        : "";
    const controlMods = [
      this._config.showPlayPause &&
        "video-reels-modal__controls--has-playpause",
      this._config.showUnmute && "video-reels-modal__controls--has-unmute",
    ]
      .filter(Boolean)
      .join(" ");

    this._overlay = document.createElement("div");
    this._overlay.className = "video-reels-modal";
    this._overlay.innerHTML = `
      <div class="video-reels-modal__content">
        <div class="swiper-container video-reels-modal__swiper-container">
          <div class="swiper-wrapper wt-slider__wrapper">
            ${this._slides
              .map(
                (s) => `
              <div class="swiper-slide wt-slider__slide">
                <video class="video-reels-modal__video" src="${s.src}" playsinline></video>
                ${s.cardHTML}
                <div class="video-reels-modal__progress">
                  <div class="video-reels-modal__progress__indicator"></div>
                </div>
              </div>`,
              )
              .join("")}
          </div>
          <div class="video-reels-modal__controls ${controlMods}"></div>
          <button class="video-reels-modal__close" aria-label="Close"></button>
          <div class="video-reels-modal__swiping${swipeDirClass}">
            <div class="video-reels-modal__swiping__prev"></div>
            <div class="video-reels-modal__swiping__text">
              ${this._config.swipeInfo || "Swipe"}
            </div>
            <div class="video-reels-modal__swiping__next"></div>
          </div>
        </div>
      </div>
      <div class="video-reels-modal__nav__container">
        <button class="video-reels-modal__nav video-reels-modal__nav--prev" aria-label="Prev"></button>
        <button class="video-reels-modal__nav video-reels-modal__nav--next" aria-label="Next"></button>
      </div>
    `;
  }

  _setupAutoAdvance(container) {
    this._overlay
      .querySelectorAll(".video-reels-modal__video")
      .forEach((vid) => {
        vid.loop = false;
        vid.addEventListener("ended", (e) => {
          const slideEl = e.target.closest(".swiper-slide");
          if (!slideEl.classList.contains("swiper-slide-active")) return;
          this._swiper.slideNext();
          setTimeout(() => {
            const nextVid = container.querySelector(
              ".swiper-slide-active video",
            );
            if (nextVid) nextVid.play();
          }, 50);
        });
      });
  }

  _setupProgressBars() {
    this._overlay.querySelectorAll(".swiper-slide").forEach((slide) => {
      const vid = slide.querySelector("video");
      const ind = slide.querySelector(
        ".video-reels-modal__progress__indicator",
      );
      ind.style.width = "0%";
      vid.addEventListener("timeupdate", () => {
        if (!vid.duration) return;
        ind.style.width = (vid.currentTime / vid.duration) * 100 + "%";
      });
    });
  }

  _decorateIcons() {
    const arrowsTpl = document.querySelector("#video-reels-arrows");
    if (arrowsTpl) {
      const realPrev = this._overlay.querySelector(
        ".video-reels-modal__nav--prev",
      );
      const realNext = this._overlay.querySelector(
        ".video-reels-modal__nav--next",
      );
      const tplPrevSvg = arrowsTpl.content.querySelector(
        ".video-reels-modal__nav--prev svg",
      );
      const tplNextSvg = arrowsTpl.content.querySelector(
        ".video-reels-modal__nav--next svg",
      );

      if (realPrev && tplPrevSvg) {
        realPrev.textContent = "";
        realPrev.appendChild(tplPrevSvg.cloneNode(true));
      }
      if (realNext && tplNextSvg) {
        realNext.textContent = "";
        realNext.appendChild(tplNextSvg.cloneNode(true));
      }
    }

    if (arrowsTpl) {
      const prevSvg = arrowsTpl.content.querySelector(
        ".video-reels-modal__nav--prev svg",
      );
      const nextSvg = arrowsTpl.content.querySelector(
        ".video-reels-modal__nav--next svg",
      );
      const swipePrev = this._overlay.querySelector(
        ".video-reels-modal__swiping__prev",
      );
      const swipeNext = this._overlay.querySelector(
        ".video-reels-modal__swiping__next",
      );

      if (swipePrev && prevSvg) swipePrev.appendChild(prevSvg.cloneNode(true));
      if (swipeNext && nextSvg) swipeNext.appendChild(nextSvg.cloneNode(true));
    }

    const closeTpl = document.querySelector("#video-reels-close-icon");
    const realClose = this._overlay.querySelector(".video-reels-modal__close");
    if (realClose && closeTpl) {
      realClose.textContent = "";
      const svg = closeTpl.content.querySelector("svg");
      if (svg) realClose.appendChild(svg.cloneNode(true));
    }

    const controlsTpl = document.querySelector("#video-reels-controls");
    const realControls = this._overlay.querySelector(
      ".video-reels-modal__controls",
    );
    if (controlsTpl && realControls) {
      controlsTpl.content.childNodes.forEach((node) =>
        realControls.appendChild(node.cloneNode(true)),
      );
    }
  }
}

customElements.define("modal-swiper", ModalSwiper);
