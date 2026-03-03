if (!customElements.get("parallax-section")) {
  customElements.define(
    "parallax-section",
    class Parallax extends HTMLElement {
      constructor() {
        super();
        this.images = this.querySelectorAll(".wt-parallax__img");
      }

      connectedCallback() {
        this.init();
      }

      decorateImages() {
        const listItems = this.querySelectorAll(".wt-parallax__gallery__item");
        listItems.forEach((item, index) => {
          const image = item.querySelector(".wt-parallax__img");
          image.classList.add(
            `wt-parallax__img--${index % 2 === 0 ? "odd" : "even"}`,
          );
        });
      }

      rotateOnScroll() {
        const { images } = this;
        const maxRotation = parseInt(this.dataset.rotation, 10) || 5;

        document.addEventListener("scroll", function () {
          images.forEach((image) => {
            const imageRect = image.getBoundingClientRect();
            const windowHeight = window.innerHeight;

            if (imageRect.top < windowHeight) {
              let visiblePart = windowHeight - imageRect.top;
              let visiblePercent = (visiblePart / windowHeight) * 100;
              let rotationDegree = Math.min(
                (visiblePercent / 100) * maxRotation,
                maxRotation,
              );

              if (image.classList.contains("wt-parallax__img--odd")) {
                rotationDegree *= -1;
              }

              window.requestAnimationFrame(() => {
                image.style.transform = `translate3d(0px, 0px, 0px) rotate(${rotationDegree}deg)`;
              });
            }
          });
        });
      }

      init() {
        this.decorateImages();
        this.rotateOnScroll();
      }
    },
  );
}
