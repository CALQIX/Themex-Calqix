if (!customElements.get("video-controls")) {
    customElements.define(
      "video-controls",
      class VideoControls extends HTMLElement {
        constructor() {
          super();
        }
        

        connectedCallback() {
          this.video = this.querySelector("video");
          this.hasVideoClickToggle = this.dataset.videoClick === "false" ? false : true;
          this.productsContainer = this.querySelector(
            ".shoppable-video__products",
          );
          this.controlButton = this.querySelector(
            ".shoppable-video__control-button",
          );
          
          this.togglePlayPause = this.togglePlayPause.bind(this);
          this.toggleVideoIcon = this.toggleVideoIcon.bind(this);

          this.addEventListeners();
          if(this.controlButton && this.video) this.toggleVideoIcon();
        }
        
        addEventListeners() {
          if(this.controlButton) this.controlButton.addEventListener("click", this.togglePlayPause);
          if(this.video && this.hasVideoClickToggle) this.video.addEventListener("click", this.togglePlayPause);
          if(this.controlButton && this.video){
            this.video.addEventListener("play", this.toggleVideoIcon);
            this.video.addEventListener("pause", this.toggleVideoIcon);
          }
        }
        
        removeEventListeners() {
          if(this.controlButton) this.controlButton.removeEventListener("click", this.togglePlayPause);
          if(this.video && this.hasVideoClickToggle) this.video.removeEventListener("click", this.togglePlayPause);
          if(this.controlButton && this.video){
            this.video.removeEventListener("play", this.toggleVideoIcon);
            this.video.removeEventListener("pause", this.toggleVideoIcon);
          }
        }

        toggleVideoIcon() {
          const isPlaying = !this.video.paused;
          this.controlButton.classList.toggle(
            "shoppable-video__control-button--play",
            isPlaying,
          );
          this.controlButton.classList.toggle(
            "shoppable-video__control-button--pause",
            !isPlaying,
          );
        }

        togglePlayPause(e) {
          e.preventDefault();
          const videoElement = this.video;      
          
          if (!videoElement) return;

          if (videoElement.paused || videoElement.ended) {
            videoElement.play();
          } else {
            videoElement.pause();
          }
        }

        disconnectedCallback(){
          this.removeEventListeners();
        }

      },
    );
  }
  