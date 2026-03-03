if (!customElements.get("low-power-video")) {
  customElements.define(
    "low-power-video",
    class LowPowerVideo extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.video_section = this.querySelector(".wt-video");
        this.video_background_section = this.querySelector(
          ".hero--video-background",
        );
        if (this.video_section) {
          this.checkAndPlayVideoSection(this.video_section);
        } else if (this.video_background_section) {
          this.checkAndPlayBackgroundVideoSection(
            this.video_background_section,
          );
        }
      }

      checkAndPlayBackgroundVideoSection(video_background_section) {
        const hero_overlay =
          video_background_section.querySelector(".hero__overlay");
        const video_element = video_background_section.querySelector("video");
        if (video_element) {
          hero_overlay.addEventListener("touchstart", () =>
            this.playVideo(video_element),
          );
          hero_overlay.addEventListener("click", () =>
            this.playVideo(video_element),
          );
        }
      }

      checkAndPlayVideoSection(video) {
        const video_element = video.querySelector("video");
        if (video_element) {
          video.addEventListener("touchstart", () =>
            this.playVideo(video_element),
          );
          video.addEventListener("click", () => this.playVideo(video_element));
        }
      }

      playVideo(video_element) {
        if (!video_element.playing) {
          video_element.play();
        }
      }

      disconnectedCallback() {
        if (this.video_section) {
          this.video_section.removeEventListener("touchstart", this.playVideo);
          this.video_section.removeEventListener("click", this.playVideo);
        }
        if (this.video_background_section) {
          const hero_overlay =
            this.video_background_section.querySelector(".hero__overlay");
          const video_element =
            this.video_background_section.querySelector("video");
          if (video_element) {
            hero_overlay.removeEventListener("touchstart", () =>
              this.playVideo(video_element),
            );
            hero_overlay.removeEventListener("click", () =>
              this.playVideo(video_element),
            );
          }
        }
      }
    },
  );
}
