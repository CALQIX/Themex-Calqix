import Swiper from "./swiper-bundle.esm.browser.min.js";
import PhotoSwipeLightbox from "./photoswipe-lightbox.esm.min.js";

const badges = document.querySelector(".photoswipe > .card__badges");

const lightbox = new PhotoSwipeLightbox({
  // may select multiple "galleries"
  gallery: ".photoswipe",

  // Elements within gallery (slides)
  children: "a",

  // setup PhotoSwipe Core dynamic import
  pswpModule: () => import("./photoswipe.esm.min.js"),

  bgOpacity: 1,
});
lightbox.init();
lightbox.on("beforeOpen", () => {
  badges?.classList.add("hide");
});

lightbox.on("destroy", () => {
  badges?.classList.remove("hide");
});

if (!customElements.get("gallery-section")) {
  customElements.define(
    "gallery-section",
    class GallerySection extends HTMLElement {
      updateSwiperAutoHeight = () => {
        if (this.resolution != this.matchResolution()) {
          this.resolution = this.matchResolution();
          this.destroyCarouselGallery();
          this.initializeGallery();
          this.setStickyGallery();
        }
      };

      constructor() {
        super();
      }

      connectedCallback() {
        this.isProductPage = this.dataset.productPage === "";

        this.galleryLoader = this.querySelector("#gallery-loader");
        this.renderedSlides = [];
        this.readConfiguration();
        this.initializeGallery();
        this.galleryLoader?.classList.add("hidden");
        this.classList.remove("loading");
        this.classList.add("loaded");

        this.setStickyGallery();
      }

      disconnectedCallback() {
        // this.destroyGallery();
      }

      setStickyGallery() {
        if (this.isProductPage) {
          const headerHeight =
            document.querySelector(".wt-header")?.offsetHeight;
          const swiperRect = this.getBoundingClientRect();

          const fitsInViewport =
            swiperRect.top >= 0 &&
            swiperRect.left >= 0 &&
            swiperRect.height <= window.innerHeight;

          const positionTopValue = `${headerHeight + 16}px`;

          this.style.setProperty("--position-top", positionTopValue);
          this.classList.add("wt-product__gallery--sticky", fitsInViewport);
        }
      }

      readConfiguration() {
        // general configuration
        this.configuration = [];

        this.elements = {
          section: this,
          gallery: this.querySelector("[data-gallery]"),
          thumbs: this.querySelector("[data-thumbs]"),
          galleryContainer: this.querySelector("[data-gallery]").querySelector(
            "[data-swiper-container]",
          ),
          thumbsContainer: this.querySelector("[data-thumbs]").querySelector(
            "[data-swiper-container]",
          ),
        };

        this.elements.gallerySlides = Array.from(
          this.elements.gallery.querySelectorAll("[data-swiper-slide]"),
        ).map((e) => e.cloneNode(true));
        this.elements.thumbsSlides = Array.from(
          this.elements.thumbs.querySelectorAll("[data-swiper-slide]"),
        ).map((e) => e.cloneNode(true));

        const default_configuration = {
          sliderEnabledBreakpoint: 900,
          desktopLayout: "carousel-vertical",
        };

        const custom_configuration = JSON.parse(
          this.elements.section.querySelector("[data-configuration]").innerHTML,
        );
        this.configuration = {
          ...default_configuration,
          ...custom_configuration,
        };

        let autoHeightEnabled = window.innerWidth <= 768;

        const UNMUTE_CLASS_TOGGLE = "wt-hero-video__sound-toggle--unmuted";

        function handleSlideVideos(swiper) {
          const allVideos = Array.from(swiper.slides).flatMap((slide) =>
            Array.from(slide.querySelectorAll("video")),
          );
          const allToggleBtns = Array.from(swiper.slides).flatMap((slide) =>
            Array.from(slide.querySelectorAll(".wt-hero-video__sound-toggle")),
          );

          // pause, mute & disable controls for all videos
          allVideos.forEach((video) => {
            video.pause();
            video.currentTime = 0;
            video.muted = true;
            video.controls = false;
            clearTimeout(video._hideCtrlsTimer);
          });

          // reset all toggle buttons to "off" state
          allToggleBtns.forEach((btn) => {
            btn.setAttribute("data-sound", "off");
            btn.classList.remove(UNMUTE_CLASS_TOGGLE);
          });

          // play & keep muted the active slide's video
          const activeSlide = swiper.slides[swiper.activeIndex];
          const activeVideo = activeSlide?.querySelector("video");
          if (activeVideo) {
            activeVideo.muted = true;
            activeVideo.play().catch((err) => {
              console.warn("Video playback failed:", err);
            });
          }
        }

        function initVideoInteractions(swiper) {
          handleSlideVideos(swiper);

          // add delegation listener for clicks
          swiper.el.addEventListener("click", (e) => {
            // Video element tapped -> show native controls temporarily
            const video = e.target.closest("video");
            if (video) {
              video.controls = true;
              video.blur();
              clearTimeout(video._hideCtrlsTimer);
              video._hideCtrlsTimer = setTimeout(() => {
                video.controls = false;
              }, 3000);
              return;
            }
          });
        }

        // gallery swiper configuration
        const default_gallery_configuration = {
          autoHeight: autoHeightEnabled,
          threshold: 10,
          grabCursor: true,
          navigation: {
            nextEl: ".wt-slider__nav-next",
            prevEl: ".wt-slider__nav-prev",
          },
          scrollbar: {
            el: ".wt-slider__scrollbar",
            draggable: true,
          },
          pagination: {
            el: ".swiper-pagination",
            type: "fraction",
          },
          on: {
            afterInit: initVideoInteractions,
            slideChangeTransitionEnd: handleSlideVideos,
          },
        };

        const custom_gallery_configuration = JSON.parse(
          this.elements.gallery.querySelector("[data-swiper-configuration]")
            .innerHTML,
        );
        this.gallery_configuration = {
          ...default_gallery_configuration,
          ...custom_gallery_configuration,
        };

        const updateThumbsSwiperClasses = (swiperInstance) => {
          const container = swiperInstance.el;
          const cls = {
            beginning: "swiper-at-beginning",
            end: "swiper-at-end",
            locked: "swiper-locked",
            ready: "swiper-thumbs-ready",
          };

          container.classList.remove(
            cls.beginning,
            cls.end,
            cls.locked,
            cls.ready,
          );

          if (swiperInstance.isLocked) {
            container.classList.add(cls.locked);
            return;
          }

          container.classList.add(cls.ready);

          if (swiperInstance.isBeginning)
            container.classList.add(cls.beginning);
          if (swiperInstance.isEnd) container.classList.add(cls.end);
        };

        // gallery thumbs swiper configuration
        const default_thumbs_configuration = {
          grabCursor: true,
          spaceBetween: 8,
          slidesPerView: 4,
          freeMode: false,
          threshold: 5,
          direction: "horizontal",
          watchSlidesVisibility: true,
          watchSlidesProgress: true,
          watchOverflow: true,
          navigation: {
            nextEl: ".wt-slider__nav-next",
            prevEl: ".wt-slider__nav-prev",
          },
          on: {
            afterInit(swiper) {
              updateThumbsSwiperClasses(swiper);
            },
            lock: updateThumbsSwiperClasses,
            unlock: updateThumbsSwiperClasses,
            slideChange: updateThumbsSwiperClasses,
            observerUpdate: updateThumbsSwiperClasses,
            resize: updateThumbsSwiperClasses,
          },
        };

        const custom_thumbs_configuration = JSON.parse(
          this.elements.thumbs.querySelector("[data-swiper-configuration]")
            .innerHTML,
        );
        this.thumbs_configuration = {
          ...default_thumbs_configuration,
          ...custom_thumbs_configuration,
        };
        this.resolution = this.matchResolution();
      }

      initializeGallery() {
        window.addEventListener("resize", () => {
          this.updateSwiperAutoHeight(this.gallerySwiper);
        });

        switch (this.configuration.desktopLayout) {
          case "carousel-vertical":
          case "carousel-horizontal":
            this.initializeCarouselGallery();
            break;
          case "masonry":
            window.addEventListener(
              "resize",
              function () {
                this.handleMassonry();
              }.bind(this),
            );
            this.handleMassonry();
            break;
          case "collage":
            window.addEventListener(
              "resize",
              function () {
                this.handleCollage();
              }.bind(this),
            );
            this.handleCollage();
            break;
        }
      }

      initializeCarouselGallery() {
        if (this.thumbsSwiper == null) {
          this.decorateSwiper(
            this.elements.thumbs,
            "wt-slider__container--thumbs",
          );
          this.thumbsSwiper = this.swiperThumbsInitilize();
        }
        this.decorateSwiper(this.elements.gallery);
        this.swiperGalleryInitilize(this.thumbsSwiper);

        const disableTouchSlide =
          this.elements.gallery.querySelector(".disable-touch");
        if (disableTouchSlide) {
          disableTouchSlide.classList.add("swiper-no-swiping");
        }
      }

      swiperGalleryInitilize(thumbsSwiper) {
        if (this.gallerySwiper == null) {
          const thumbs_configuration = {
            thumbs: {
              swiper: thumbsSwiper,
            },
          };
          const desktopRatio = this.getAttribute("desktop-ratio");

          const useAlwaysAutoHeight =
            (this.configuration.desktopLayout === "carousel-vertical" &&
              desktopRatio === "original") ||
            this.configuration.desktopLayout === "carousel-horizontal";

          let autoHeightEnabled = useAlwaysAutoHeight
            ? true
            : window.innerWidth <= 900;
          if (thumbsSwiper)
            this.gallery_configuration = {
              ...this.gallery_configuration,
              ...thumbs_configuration,
              autoHeight: autoHeightEnabled,
            };
          this.gallerySwiper = new Swiper(
            this.elements.gallery,
            this.gallery_configuration,
          );
        }
      }

      swiperThumbsInitilize() {
        let autoHeightEnabled = window.innerWidth <= 900;
        this.thumbs_configuration = {
          ...this.thumbs_configuration,
          autoHeight: autoHeightEnabled,
        };
        const swiper = new Swiper(
          this.elements.thumbs,
          this.thumbs_configuration,
        );
        return swiper;
      }

      destroyCarouselGallery() {
        if (this.thumbsSwiper != null) {
          this.thumbsSwiper.destroy();
          this.thumbsSwiper = null;
          this.undecorateSwiper(
            this.elements.thumbs,
            "wt-slider__container--thumbs",
          );
        }
        if (this.gallerySwiper != null) {
          this.gallerySwiper.destroy();
          this.undecorateSwiper(this.elements.gallery);
          this.gallerySwiper = null;
        }
      }

      handleMassonry() {
        if (this.matchResolution() == "desktop") {
          this.destroyCarouselGallery();
          this.initializeMasonryGallery();
        } else {
          this.destroyMasonryGallery();
          this.initializeCarouselGallery();
        }
      }

      handleCollage() {
        if (this.matchResolution() == "desktop") {
          this.destroyCarouselGallery();
          this.initializeCollageGallery();
        } else {
          this.destroyCollageGallery();
          this.initializeCarouselGallery();
        }
      }

      decorateSwiper(el, element_class) {
        el.classList.add("swiper", "wt-slider__container", element_class);
        el.querySelector("[data-swiper-container]")?.classList.add(
          "swiper-wrapper",
          "wt-slider__wrapper",
        );
        el.querySelectorAll("[data-swiper-slide]").forEach(function (e) {
          e.classList.add("swiper-slide", "wt-slider__slide");
        });
        this.galleryUpdateEvent();
      }

      undecorateSwiper(el, element_class) {
        el.classList.remove("swiper", "wt-slider__container", element_class);
        el.querySelector("[data-swiper-container]").classList.remove(
          "swiper-wrapper",
          "wt-slider__wrapper",
        );
        el.querySelectorAll("[data-swiper-slide]").forEach(function (e) {
          e.classList.remove("swiper-slide", "wt-slider__slide");
        });
      }

      decorateCollage(el, element_class) {
        el.classList.add(`wt-${element_class}`);
        el.querySelector("[data-swiper-container]").classList.add(
          `wt-${element_class}__wrapper`,
        );
        el.querySelectorAll("[data-swiper-slide]").forEach(function (e) {
          e.classList.add(`wt-${element_class}__slide`);
        });
        this.galleryUpdateEvent();
      }

      undecorateCollage(el, element_class) {
        el.classList.remove(`wt-${element_class}`);
        el.querySelector("[data-swiper-container]").classList.remove(
          `wt-${element_class}__wrapper`,
        );
        el.querySelectorAll("[data-swiper-slide]").forEach(function (e) {
          e.classList.remove(`wt-${element_class}__slide`);
        });
      }

      initializeCollageGallery() {
        this.decorateCollage(this.elements.gallery, "collage");
      }

      destroyCollageGallery() {
        this.undecorateCollage(this.elements.gallery, "collage");
      }

      initializeMasonryGallery() {
        this.decorateCollage(this.elements.gallery, "masonry");
      }

      destroyMasonryGallery() {
        this.undecorateCollage(this.elements.gallery, "masonry");
      }

      sortSlides(slides, featured_media_id) {
        // Find the index of the slide with featured_media_id
        const featuredIndex = slides.findIndex((slide) => {
          const mediaId = slide.querySelector("img")
            ? Number(slide.querySelector("img").getAttribute("data-media-id"))
            : null;
          return mediaId === Number(featured_media_id);
        });

        // If a slide with featured_media_id is found, move it to the beginning of the array
        if (featuredIndex > -1) {
          const featuredSlide = slides[featuredIndex];
          slides.splice(featuredIndex, 1);
          slides.unshift(featuredSlide);
        }

        return slides;
      }

      beforeGalleryChange() {
        this.classList.add("loading");
        this.galleryLoader?.classList.remove("hidden");
        this.style.minHeight = `${this.offsetHeight}px`;
      }

      afterGalleryChange() {
        this.style.minHeight = "unset";
        this.galleryLoader?.classList.add("hidden");
        this.classList.remove("loading");
      }

      filterSlidesByOptions(
        slides,
        options,
        featured_media_id,
        matchAll = true,
      ) {
        const lowercaseOptions = options.map((option) =>
          option.toLowerCase().replace(/\s/g, ""),
        );

        return slides.filter((slide) => {
          let media = slide.querySelector("img");
          if (media == null) media = slide?.querySelector("video");
          const alt = media ? media.getAttribute("alt") : "";
          const mediaId = media ? media.getAttribute("data-media-id") : "";

          if (mediaId === featured_media_id) return true;

          const altHashtags = (alt?.match(/#[^\s#]+/g) || []).map((hashtag) =>
            hashtag.slice(1).toLowerCase(),
          );

          if (altHashtags.length === 0) return true;
          if (altHashtags.some((tag) => tag.split("|").includes("all")))
            return true;

          if (matchAll) {
            return altHashtags.every((tag) =>
              tag
                .split("|")
                .some((variant) => lowercaseOptions.includes(variant.trim())),
            );
          } else {
            return altHashtags.some((tag) =>
              tag
                .split("|")
                .some((variant) => lowercaseOptions.includes(variant.trim())),
            );
          }
        });
      }

      galleryUpdateEvent(opt) {
        const galleryEvent = new CustomEvent("gallery:updated", {
          bubbles: true,
          cancelable: true,
          detail: {
            desc: "gallery updated",
            selector: ".wt-product__gallery",
            ...opt,
          },
        });
        document.dispatchEvent(galleryEvent);
      }

      filterSlides(options, featured_media_id, matchAll = true, callback) {
        if (!this.elements) return;
        const originalGallerySlides = Array.from(
          this.elements.gallerySlides,
          (el) => el.cloneNode(true),
        );
        const originalThumbsSlides = Array.from(
          this.elements.thumbsSlides,
          (el) => el.cloneNode(true),
        );

        const getMediaId = (item) => item?.dataset?.mediaId;

        let filteredGallerySlides = this.filterSlidesByOptions(
          originalGallerySlides,
          options,
          featured_media_id,
          matchAll,
        );
        let filteredThumbsSlides = this.filterSlidesByOptions(
          originalThumbsSlides,
          options,
          featured_media_id,
          matchAll,
        );

        if (filteredGallerySlides.length === 0) {
          filteredGallerySlides = [...originalGallerySlides];
          filteredThumbsSlides = [...originalThumbsSlides];
        }

        if (featured_media_id) {
          filteredGallerySlides = this.sortSlides(
            filteredGallerySlides,
            featured_media_id,
          );
          filteredThumbsSlides = this.sortSlides(
            filteredThumbsSlides,
            featured_media_id,
          );
        }

        const renderedSlidesChanged =
          this.renderedSlides.map(getMediaId).toString() !==
          filteredGallerySlides.map(getMediaId).toString();

        if (this.gallerySwiper && this.thumbsSwiper && renderedSlidesChanged) {
          this.beforeGalleryChange();
          const thumbSlidesWrapper = this.querySelector(
            "[data-thumbs] [data-swiper-container]",
          );
          const gallerySlidesWrapper = this.querySelector(
            "[data-gallery] [data-swiper-container]",
          );

          // Assuming this.gallerySwiper is the swiper instance for the main gallery
          this.gallerySwiper.removeAllSlides();
          gallerySlidesWrapper.innerHTML = "";
          const swiperContainer = this.querySelector(".swiper-wrapper");
          filteredGallerySlides.forEach((slide, idx) => {
            if (idx === 0) {
              const slideImg = slide.querySelector("img");
              if (slideImg)
                slideImg.onload = function () {
                  swiperContainer.style.height = "auto";
                };
            }
            this.gallerySwiper.appendSlide(slide);
          });
          this.decorateSwiper(this.elements.gallery);

          // Assuming this.thumbsSwiper is the swiper instance for the thumbnails
          this.thumbsSwiper.removeAllSlides();
          thumbSlidesWrapper.innerHTML = "";

          filteredThumbsSlides.forEach((slide) =>
            this.thumbsSwiper.appendSlide(slide),
          );

          this.decorateSwiper(
            this.elements.thumbs,
            "wt-slider__container--thumbs",
          );

          this.thumbsSwiper.update();
          this.gallerySwiper.update();
        } else if (
          this.configuration.desktopLayout == "collage" ||
          this.configuration.desktopLayout == "masonry"
        ) {
          if (renderedSlidesChanged) {
            this.beforeGalleryChange();
            // Remove all existing slides
            this.elements.gallery
              .querySelectorAll("[data-swiper-slide]")
              .forEach((slide) => slide.remove());
            this.elements.thumbs
              .querySelectorAll("[data-swiper-slide]")
              .forEach((slide) => slide.remove());

            filteredGallerySlides.forEach((slide) =>
              this.elements.gallery
                .querySelector("[data-swiper-container]")
                .append(slide),
            );
            filteredThumbsSlides.forEach((slide) =>
              this.elements.thumbs
                .querySelector("[data-swiper-container]")
                .append(slide),
            );

            this.decorateCollage(
              this.elements.gallery,
              this.configuration.desktopLayout,
            );

            // add wt-product__gallery --even --odd classes to MediaGallery container depends on number of slides
            this.elements.gallery.classList.remove("wt-product__gallery--even");
            this.elements.gallery.classList.remove("wt-product__gallery--odd");
            if (filteredGallerySlides.length % 2 == 0) {
              this.elements.gallery.classList.add("wt-product__gallery--even");
            } else {
              this.elements.gallery.classList.add("wt-product__gallery--odd");
            }
          }
        }

        if (featured_media_id) {
          this.setActiveMedia(featured_media_id, true);
        } else {
          this.setActiveMedia(
            filteredGallerySlides[0]
              ?.querySelector("img")
              ?.getAttribute("data-media-id"),
            true,
          );
        }
        this.gallerySwiper?.update();

        if (renderedSlidesChanged) {
          setTimeout(this.afterGalleryChange.bind(this), 300);
        }

        this.renderedSlides = [...filteredGallerySlides];
      }

      setActiveMedia(mediaId, prepend) {
        let media = this.elements.gallery.querySelector(
          `[data-media-id="${mediaId}"]`,
        );

        if (this.gallerySwiper != null) {
          this.gallerySwiper.slideTo(this.indexInParent(media));
          this.thumbsSwiper.slideTo(this.indexInParent(media));
        }
      }

      matchResolution() {
        if (window.innerWidth < this.configuration.sliderEnabledBreakpoint) {
          return "mobile";
        } else {
          return "desktop";
        }
      }

      indexInParent(node) {
        if (!node) return -1;
        let children = node.parentNode.childNodes;
        let num = 0;
        for (let i = 0; i < children.length; i++) {
          if (children[i] == node) return num;
          if (children[i].nodeType == 1) num++;
        }
        return -1;
      }
    },
  );
}
