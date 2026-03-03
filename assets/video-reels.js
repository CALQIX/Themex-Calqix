if (!customElements.get("video-reels")) {
  customElements.define(
    "video-reels",
    class VideoReels extends HTMLElement {
      constructor() {
        super();
        this.activeClass = "active";
        this.swiper = this.querySelector(".wt-slider__container");
      }

      connectedCallback() {
        this.init();
      }

      updateAllVideosSound(swiper) {
        const soundOn = swiper.el.dataset.sound === "on";
        swiper.slides.forEach((slide) => {
          let video = slide.querySelector("video");
          if (video) {
            video.muted = !soundOn;
          }
        });
      }

      observeSection() {
        const observerOptions = {
          root: null,
          rootMargin: "0px",
          threshold: 0.1,
        };

        const sectionObserver = new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              const video = this.querySelector(".swiper-slide-active video");

              if (video) {
                if (entry.isIntersecting) {
                  video.play();
                } else {
                  video.pause();
                }
              }
            });
          },
          observerOptions,
        );

        sectionObserver.observe(this);
      }

      handleSoundToggle(swiper) {
        swiper.slides.forEach((slide, index) => {
          const button = slide.querySelector(".wt-video__sound-toggle");
          const video = slide.querySelector("video");
          const that = this;

          button.addEventListener("click", function () {
            if (!video) return;
            if (video.muted) {
              video.muted = false;
              swiper.el.dataset.sound = "on";
            } else {
              video.muted = true;
              swiper.el.dataset.sound = "off";
            }
            that.updateAllVideosSound(swiper);
          });
        });
      }

      pasueAllVideos() {
        const videos = this.querySelectorAll("video");
        videos.forEach((video) => {
          video.pause();
        });
      }

      playVideoInActiveSlide(swiper) {
        const sound = swiper.el.dataset.sound;
        const activeSlideVideo =
          this.findActiveSlide(swiper)?.querySelector("video");
        if (activeSlideVideo) {
          activeSlideVideo.muted = sound !== "on"; // if sound !== "on", keep it muted

          setTimeout(() => {
            activeSlideVideo.play().catch((err) => {
              console.warn("Autoplay was prevented:", err);
            });
          }, 100);
        }
      }

      findActiveSlide(swiper) {
        const activeSlide = swiper.slides[swiper.activeIndex];
        return activeSlide;
      }

      toggleActiveClass(swiper) {
        const activeSlide = this.findActiveSlide(swiper);
        swiper.slides.forEach((slide) => {
          slide.classList.remove(this.activeClass);

          if (activeSlide === slide) {
            slide.classList.add(this.activeClass);
          }
        });
      }

      handleSlideChange(swiper) {
        this.pasueAllVideos();
        this.toggleActiveClass(swiper);
        this.playVideoInActiveSlide(swiper);
      }

      addVideoEventHandlers(swiper) {
        const that = this;
        swiper.on("slideChange", (swp) => that.handleSlideChange(swp));
      }

      checkSwiperInitialization() {
        const swiperContainer = this.swiper;
        const mySwiperInstance = swiperContainer.swiper;

        if (swiperContainer.classList.contains("swiper-initialized")) {
          this.addVideoEventHandlers(mySwiperInstance);
          this.handleSlideChange(mySwiperInstance);
          this.handleSoundToggle(mySwiperInstance);
          this.observeSection();
          clearInterval(this.checkInterval);
        }
      }

      init() {
        this.checkInterval = setInterval(
          this.checkSwiperInitialization.bind(this),
          500,
        );
      }
    },
  );
}
