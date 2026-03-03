if (!customElements.get("shoppable-video")) {
  customElements.define(
    "shoppable-video",
    class ShoppableVideo extends HTMLElement {
      constructor() {
        super();
      }

      bindMethods() {
        this.togglePlayPause = this.togglePlayPause.bind(this);
        this.toggleVideoIcon = this.toggleVideoIcon.bind(this);
        this.playVideo = this.playVideo.bind(this);
        this.updateScrollPosition = this.updateScrollPosition.bind(this);
        this.throttleUpdateScroll = this.throttle(
          this.updateScrollPosition,
          250,
        );
        this.checkDominantProductElement =
          this.checkDominantProductElement.bind(this);
        this.handleScrollAndUpdateVideoPosition =
          this.handleScrollAndUpdateVideoPosition.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
      }

      setupElements() {
        this.productsInfo = JSON.parse(this.dataset.products);
        this.productsInfoArr = Object.entries(this.productsInfo);
        this.video = this.querySelector("video");
        this.productsContainer = this.querySelector(
          ".shoppable-video__products",
        );
        this.controlButton = this.querySelector(
          ".shoppable-video__control-button",
        );
        this.products = this.productsContainer.querySelectorAll(
          ".shoppable-video__product",
        );
        this.emptyProduct = this.productsContainer.querySelector(
          ".shoppable-video__empty-product",
        );
        this.playButtons = this.productsContainer.querySelectorAll(
          ".shoppable-video__rewind-button",
        );
        this.lastScrolledToProductIndex = null;

        this.playButtonsListeners = [];
        this.isTouching = false;
        this.startX = 0;
        this.startY = 0;
        this.scrollLeftStart = 0;
        this.scrollTopStart = 0;
        this.lastScrollLeft = 0;
        this.dominantProductIndex = 0;
        this.scrollTimeout = null;
        this.touchEnded = false;

        this.calculateEmptyProductWidth();
      }

      addEventListeners() {
        this.controlButton.addEventListener("click", this.togglePlayPause);

        this.video?.addEventListener("timeupdate", this.throttleUpdateScroll);
        this.video?.addEventListener("play", this.toggleVideoIcon);
        this.video?.addEventListener("pause", this.toggleVideoIcon);

        this.productsContainer.addEventListener(
          "touchstart",
          this.handleTouchStart,
        );

        this.productsContainer.addEventListener(
          "scroll",
          this.handleScrollAndUpdateVideoPosition,
        );
        this.productsContainer.addEventListener(
          "touchmove",
          this.handleScrollAndUpdateVideoPosition,
        );

        this.productsContainer.addEventListener(
          "touchend",
          this.handleTouchEnd,
        );

        this.playButtons.forEach((btn, index) => {
          const boundClickRewindButton = this.clickRewindButton.bind(this, btn);
          btn.addEventListener("click", boundClickRewindButton);
          // Store the bound function for later removal
          this.playButtonsListeners.push({ btn, boundClickRewindButton });
        });
      }

      handleTouchStart(e) {
        this.video?.pause();
        this.isTouching = true;
        this.startX = e.touches[0].pageX;
        this.startY = e.touches[0].pageY;
        this.scrollLeftStart = this.productsContainer.scrollLeft;
        this.scrollTopStart = this.productsContainer.scrollTop;
      }

      handleTouchEnd() {
        this.touchEnded = true;
      }

      handleScrollAndUpdateVideoPosition() {
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);

        const currentScrollLeft = this.productsContainer.scrollLeft;
        const scrolledRight = currentScrollLeft > this.lastScrollLeft;
        const scrolledLeft = currentScrollLeft < this.lastScrollLeft;

        // Update lastScrollLeft for the next scroll event
        this.lastScrollLeft = currentScrollLeft;

        // Now, check which product element is dominant
        this.checkDominantProductElement(scrolledRight, scrolledLeft);

        // if (this.touchEnded) {
        if (!this.isTouching) return;

        this.scrollTimeout = setTimeout(() => {
          const startSecond =
            this.productsInfoArr[this.dominantProductIndex][1];
          this.lastScrolledToProductIndex = this.dominantProductIndex - 1;
          if (this.video) {
            this.video.currentTime = startSecond;
            this.video.play();
          }
        }, 250);
      }

      checkDominantProductElement() {
        let dominantProductIndex = -1;
        let maxVisibleWidth = -1;

        this.products.forEach((product, index) => {
          const { left, right } = product.getBoundingClientRect();
          const containerRect = this.productsContainer.getBoundingClientRect();

          // Calculate visibility
          const visibleWidth =
            Math.min(containerRect.right, right) -
            Math.max(containerRect.left, left);

          if (visibleWidth > maxVisibleWidth) {
            maxVisibleWidth = visibleWidth;
            dominantProductIndex = index;
          }
        });

        // After identifying the dominant product, check if it's more than 20% visible
        if (maxVisibleWidth / this.productsContainer.offsetWidth > 0.2) {
          this.dominantProductIndex = dominantProductIndex;
        }
      }

      calculateEmptyProductWidth() {
        const firstProductWidth = this.products[1].offsetWidth;
        this.gap = parseFloat(
          window
            .getComputedStyle(this.productsContainer)
            .getPropertyValue("gap"),
        );
        this.emptyProduct.style.width = `calc(100% - ${firstProductWidth}px - ${this.gap}px)`;
      }

      setContainerMargin() {
        // Initialize a variable to keep track of the maximum height found
        let maxHeight = 0;

        // Initialize a variable to keep track of the element with the maximum height
        let elementWithMaxHeight = null;

        // Iterate through the NodeList
        this.products.forEach((element) => {
          // Get the current element's height
          const elementHeight = element.offsetHeight;

          // Check if the current element's height is greater than the maxHeight found so far
          if (elementHeight > maxHeight) {
            // Update maxHeight and the reference to the element with the new maximum height
            maxHeight = elementHeight;
            elementWithMaxHeight = element;
          }
        });

        const marginValue = window.innerWidth > 900 ? 46 : 34;
        this.productsContainer.style.marginTop = `-${maxHeight + marginValue}px`;
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

      removeEventListeners() {
        this.controlButton.removeEventListener("click", this.togglePlayPause);

        this.video?.removeEventListener("click", this.togglePlayPause);
        this.video?.removeEventListener(
          "timeupdate",
          this.throttleUpdateScroll,
        );
        this.video?.removeEventListener("play", this.toggleVideoIcon);
        this.video?.removeEventListener("pause", this.toggleVideoIcon);

        this.productsContainer.removeEventListener(
          "touchstart",
          this.handleTouchStart,
        );

        this.productsContainer.removeEventListener(
          "scroll",
          this.handleScrollAndUpdateVideoPosition,
        );
        this.productsContainer.removeEventListener(
          "touchend",
          this.handleTouchEnd,
        );

        this.playButtonsListeners.forEach(({ btn, boundClickPlayButton }) => {
          btn.removeEventListener("click", boundClickPlayButton);
        });
      }

      clickRewindButton(btn) {
        const productIndex = btn.dataset.productIndex;
        const startSecond = this.productsInfo[productIndex];
        this.video.currentTime = startSecond;
        this.playVideo();
        this.animateScrollToNextProduct(productIndex);
      }

      animateScrollToNextProduct(productIndex) {
        const productWidth = this.products[productIndex]?.offsetWidth;
        const nextScrollPosition =
          (Number(this.productsInfoArr[productIndex][0]) + 1) *
          (productWidth + this.gap);

        // this.lastScrolledToProductIndex = i;
        const maxScrollLeft =
          this.productsContainer.scrollWidth -
          this.productsContainer.clientWidth;
        const clampedNextScrollPosition = Math.min(
          nextScrollPosition,
          maxScrollLeft,
        ); // Clamp the position

        const startPosition = this.productsContainer.scrollLeft;
        const duration = 250; // duration in milliseconds
        this.animateScroll(startPosition, clampedNextScrollPosition, duration);
        this.lastScrolledToProductIndex = productIndex;
      }

      togglePlayPause(e) {
        e.preventDefault(); // Prevent default click behavior
        const videoElement = this.video; // Ensure this is your video element
        if (!videoElement) return; // Exit if videoElement is not defined

        // Toggle play/pause based on the current state
        if (videoElement.paused || videoElement.ended) {
          videoElement.play();
        } else {
          videoElement.pause();
        }
      }

      playVideo() {
        const videoElement = this.video; // Ensure this is your video element
        if (!videoElement) return; // Exit if videoElement is not defined

        // Toggle play/pause based on the current state
        if (videoElement.paused || videoElement.ended) {
          videoElement.play();
        }
      }

      updateScrollPosition() {
        const currentTime = this.video.currentTime;
        const isMobile = window.innerWidth <= 400; // Adjust this to match your mobile breakpoint
        this.isTouching = false;

        // Scroll to start if the video just started
        if (
          currentTime < 1 &&
          currentTime > 0 &&
          this.lastScrolledToProductIndex !== 0
        ) {
          this.lastScrolledToProductIndex = 0;
          this.productsContainer.scrollTo({
            left: 0,
            behavior: "smooth",
          });
          return;
        }

        // Find and scroll to the current product, if needed
        for (
          let i = this.lastScrolledToProductIndex || 0;
          i < this.productsInfoArr.length;
          i++
        ) {
          const itemTime = Number(this.productsInfoArr[i][1]);
          const shouldScrollMove =
            currentTime > itemTime && currentTime < itemTime + 1;
          let nextScrollPosition;

          if (isMobile) {
            // Mobile: target element 10px from the left
            nextScrollPosition = this.products[i].offsetLeft - 10; // Subtract 10px to have a 10px gap from the left
          } else {
            // Desktop: target element 20px from the right
            const productRightOffset =
              this.products[i].offsetLeft +
              this.products[i].offsetWidth -
              this.productsContainer.offsetWidth +
              20; // Adjust so there's a 20px gap from the right
            nextScrollPosition = productRightOffset;
          }

          nextScrollPosition = Math.max(nextScrollPosition, 0); // Ensure it doesn't go below 0

          // If we need to scroll and we're not already at this position
          if (
            shouldScrollMove &&
            Math.abs(this.productsContainer.scrollLeft - nextScrollPosition) > 1
          ) {
            // Added a tolerance for scroll comparison
            this.lastScrolledToProductIndex = i;
            const clampedNextScrollPosition = Math.min(
              nextScrollPosition,
              this.productsContainer.scrollWidth -
                this.productsContainer.clientWidth,
            ); // Clamp the position

            const startPosition = this.productsContainer.scrollLeft;
            const duration = 250; // duration in milliseconds
            this.animateScroll(
              startPosition,
              clampedNextScrollPosition,
              duration,
            );
            break; // No need to continue once we've found our product
          }
        }
      }

      throttle(func, limit) {
        let inThrottle;
        return function () {
          const args = arguments;
          const context = this;
          if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
          }
        };
      }

      animateScroll(startPosition, endPosition, duration) {
        const start = performance.now();
        const animate = (time) => {
          const timeElapsed = time - start;
          const progress = Math.min(timeElapsed / duration, 1);
          const currentPosition =
            startPosition +
            (endPosition - startPosition) * this.easeOutSine(progress);
          this.productsContainer.scrollLeft = currentPosition;

          if (timeElapsed < duration) {
            requestAnimationFrame(animate);
          } else {
            this.productsContainer.scrollLeft = endPosition;
          }
        };
        requestAnimationFrame(animate);
      }

      easeOutSine(t) {
        return Math.sin((t * Math.PI) / 2);
      }

      connectedCallback() {
        this.setupElements();
        this.bindMethods();

        this.addEventListeners();
      }

      disconnectedCallback() {
        this.removeEventListeners();
      }
    },
  );
}
