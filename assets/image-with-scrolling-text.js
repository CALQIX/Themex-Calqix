if (!customElements.get("image-with-scrolling-text")) {
  customElements.define(
    "image-with-scrolling-text",
    class Storytelling extends HTMLElement {
      constructor() {
        super();
        this.images = this.querySelectorAll(".image-wrapper > *");
        this.items = this.querySelectorAll(".wt-image-with-scrolling-text__text > div");
        this.onScroll = this.onScroll.bind(this);
        this.onResize = this.onResize.bind(this);
      }

      connectedCallback() {
        this.init();
      }

     makeOneVisible() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
            if (entry.isIntersecting) {
                const index = Array.from(this.items).indexOf(entry.target); 

                this.images.forEach(img => {
                img.style.opacity = '0';
                });

                if (this.images[index]) {
                this.images[index].style.opacity = '1';
                }
            }
            });
        }, {
            root: null,
            rootMargin: "-50% 0px -40% 0px", 
            threshold: 0
        });

        this.items.forEach(block => observer.observe(block));
     }

      onScroll() {
        const container = this.querySelector('.wt-image-with-scrolling-text__image'); 
        const containerRect = container.getBoundingClientRect();

        if (containerRect.top < 0 || containerRect.bottom > window.innerHeight) {
          return;
        }

        const centerY = window.innerHeight / 2;

        this.items.forEach((item, i) => {
          const rect = item.getBoundingClientRect();
          const elementCenter = rect.top + rect.height / 2;
          const distanceFromCenter = Math.abs(elementCenter - centerY);

          const maxDistance = window.innerHeight / 2;
          const opacity = 1 - Math.min(distanceFromCenter / maxDistance, 1);

          item.style.opacity = opacity;
        });
      }

      onResize(){
        if(!this.outer || this.inners.length === 0) return;

        const firstHeight = this.inners[0].offsetHeight;
        const lastHeight = this.inners[this.inners.length - 1].offsetHeight;
        const vh = window.innerHeight;

        this.outer.style.marginTop = (vh / 2 - firstHeight / 2) + 'px';
        this.outer.style.marginBottom = (vh / 2 - lastHeight / 2) + 'px';
      }

      init() {
        this.makeOneVisible();
        window.addEventListener('scroll', this.onScroll);
        this.onScroll(); 
        window.addEventListener('resize', this.onResize);
        this.outer = this.querySelector('.wt-image-with-scrolling-text__text');
        this.inners = this.querySelectorAll('.wt-image-with-scrolling-text__text > div');
        this.onResize();
      }

      disconnectedCallback() {
        window.removeEventListener('scroll', this.onScroll);
        window.removeEventListener('resize', this.onResize);
      }
    },
  );
}
