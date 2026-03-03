if (!customElements.get("quick-add")) {
  customElements.define(
    "quick-add",
    class QuickAdd extends HTMLElement {
      getFocusableElements(parent) {
        const focusableElementsSelector =
          "button:not(.wt-product__sticky-buy__button), [href], input:not(.disabled):not([type='hidden']), select, .close-btn";
        const focusableElements = () =>
          Array.from(parent.querySelectorAll(focusableElementsSelector)).filter(
            (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0,
          );

        return {
          focusableElements,
          first: focusableElements()[0],
          last: focusableElements()[focusableElements().length - 1],
        };
      }

      connectedCallback() {
        this.add_button = this.querySelector("button");
        this.isDrawerOpen = false;
        this.isMobile = window.innerWidth < 768;
          if (this.add_button)
            this.add_button.addEventListener("click", (e) => {
          const button = e.currentTarget;
          const cardLink = button
          .closest(".card__picture-container")
          ?.querySelector("a.card");
          this.product_url = this.add_button.getAttribute("data-product-url");
            this.currentTrigger = cardLink;
            this.fetchProduct(this.product_url);
          });

        this.handleInteractionOutside =
          this.handleInteractionOutside.bind(this);

        this.getFocusableElements = this.getFocusableElements.bind(this);

        this.lastFeaturedImage;
        this.firstMedia;
        this.hasFirstMediaImg;

        this.fetchProduct = this.fetchProduct.bind(this);
        this.galleryObserver = this.galleryObserver.bind(this);
        this.observerCallback = this.observerCallback.bind(this);
        this.disconnectObserver = this.disconnectObserver.bind(this);
        this.removeButtonEventListener =
          this.removeButtonEventListener.bind(this);
      }

      fetchProduct(product_url) {
        this.lastFeaturedImage = null;
        this.firstMedia = null;
        this.hasFirstMediaImg = null;
        this.quick_add = document.querySelector(".wt__quick-buy");
        this.quick_add_container = document.querySelector(
          ".wt__quick-buy__container",
        );
        this.quick_add_wrapper = document.querySelector(
          ".wt__quick-buy--wrapper",
        );
        this.quick_add_product = this.quick_add.querySelector(
          ".wt__quick-buy--product",
        );
        this.close_button = this.quick_add.querySelector(".close-btn");
        this.loader = this.quick_add.querySelector(".wt__quick-buy-loader");
        this.page_overlay = document.querySelector(
          ".wt__quick-buy--page-overlay",
        );
        this.body = document.body;

        const controller = new AbortController();
        const signal = controller.signal;

        const allWtProducts =
          this.quick_add_wrapper.querySelectorAll(".wt-product");
        allWtProducts?.forEach((product) => product.remove());
        this.quick_add.classList.remove("hidden");
        this.body.classList.add("quick-buy-page-overlay");
        this.page_overlay.classList.add("wt__quick-buy--page-overlay--open");

        this.interactiveEelements = () =>
          this.quick_add_container.querySelectorAll();

        this.quick_add_container.classList.add(
          "wt__quick-buy__container--open",
        );

        this.close_button.addEventListener("click", () => {
          controller.abort();
          this.closeCart();
          this.close_button.setAttribute("tabindex", "-1");
          this.currentTrigger?.focus();
        });

        this.quick_add_container.addEventListener("keydown", (e) => {
          const isTabPressed =
            e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
          const { first, last } = this.getFocusableElements(
            this.quick_add_container,
          );

          if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
            this.close_button.click();
          }

          if (isTabPressed) {
            if (e.shiftKey && document.activeElement === first) {
              last.focus();
              e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
              first.focus();
              e.preventDefault();
            }
          }
        });

        fetch(product_url, { signal })
          .then((res) => res.text())
          .then((res) => {
            this.loader.classList.add("hidden");
            const htmlDocument = new DOMParser().parseFromString(
              res,
              "text/html",
            );
            this.productMain = htmlDocument.querySelector(".wt-product__main");
            this.productCard = htmlDocument.querySelector(".wt-product");
            this.productInfo = htmlDocument.querySelector(".wt-product__info");

            const animatedElements = this.productMain.querySelectorAll(
              ".scroll-trigger.animate--slide-in",
            );
            animatedElements?.forEach((element) =>
              element.classList.remove("scroll-trigger", "animate--slide-in"),
            );

            const productGallery =
            this.productCard.querySelector("gallery-section");


            this.removeElements(
              this.productCard,
              "collapsible-section",
              "[not-quick-add]",
              ".product__inventory",
              ".share-icons__container",
              "#gallery-loader",
              "pickup-availability",
              ".wt-product__sku",
              ".wt-product__feature-icons",
              "gallery-section",
            );

            const newVariantId =
              this.productCard.querySelector("variant-options");
            if (newVariantId) {
              newVariantId.dataset.updateUrl = "false";
              this.updateAttribute(
                newVariantId,
                "data-original-section",
                newVariantId.getAttribute("data-section"),
              );
              this.updateAttribute(
                newVariantId,
                "data-section",
                `quick-${newVariantId.getAttribute("data-section")}`,
              );
            }

          

            productGallery.style.display = "none";

            this.images = productGallery.querySelectorAll("img");
            this.updateAttribute(
              productGallery,
              "id",
              `MediaGallery-${newVariantId?.getAttribute("data-section")}`,
            );
            const firstImageFromGallery = productGallery.querySelector("li");
            if (firstImageFromGallery) {
              this.firstMedia = firstImageFromGallery;

              this.playBtn = this.firstMedia.querySelector(".model-btn");
              if (this.playBtn) this.playBtn.setAttribute("tabindex", "0");

              this.video = this.firstMedia.querySelector("video");
              if (this.video) this.video.setAttribute("tabindex", "0");

              this.hasFirstMediaImg = Boolean(
                firstImageFromGallery.querySelector("img"),
              );
            }

            firstImageFromGallery
              ?.querySelector("img")
              ?.removeAttribute("srcset");
            const imageContainer = document.createElement("div");
            imageContainer.setAttribute("class", "product-image");

            const productDetails = document.createElement("div");
            productDetails.setAttribute("class", "wt-product__details");

            const productAbout = document.createElement("div");
            productAbout.setAttribute("class", "product-info");
            const title = this.productInfo.querySelector(".wt-product__name");

            if (title) {
              const aElement = document.createElement("a");
              aElement.textContent = title.textContent;
              aElement.href = this.product_url;
              title.innerHTML = "";
              title.appendChild(aElement);
              title.setAttribute("tabindex", "0");
            }

            const productElementsToCopy = this.productInfo.querySelectorAll(
              ".wt-product__brand, .wt-product__name, .wt-rating, .wt-product__price, .product__tax",
            );

            productElementsToCopy.forEach((product) =>
              productAbout.appendChild(product),
            );

            imageContainer.innerHTML = firstImageFromGallery?.innerHTML || "";
            productDetails.appendChild(imageContainer);
            productDetails.appendChild(productAbout);
            this.productInfo.prepend(productDetails);

            this.galleryObserver();

            const mainProductPrice =
              this.productCard.querySelector(".wt-product__price");
            this.updateAttribute(
              mainProductPrice,
              "id",
              `price-${newVariantId?.getAttribute("data-section")}`,
            );

            const allFieldSets = this.productCard.querySelectorAll("fieldset");
            this.updateFieldSets(allFieldSets);

            const addBtn = this.productCard.querySelector('button[name="add"]');
            this.updateAttribute(
              addBtn,
              "id",
              `ProductSubmitButton-${newVariantId?.getAttribute("data-section")}`,
            );

            const form = this.productCard.querySelector(
              'form[method="post"][data-type="add-to-cart-form"]',
            );
            this.updateAttribute(
              form,
              "id",
              `product-form-${newVariantId?.getAttribute("data-section")}`,
            );

            const viewAllDetailsContainer =
              this.quick_add_wrapper.querySelector(
                ".wt__quick-buy__view-all-container",
              );
            this.quick_add_wrapper.removeChild(viewAllDetailsContainer);
            this.quick_add_wrapper.innerHTML += this.productCard.outerHTML;
            this.quick_add_wrapper.append(viewAllDetailsContainer);

            const giftCardInput = this.quick_add_wrapper.querySelector(
              '[name="properties[__shopify_send_gift_card_to_recipient]"]',
            );
            if (giftCardInput) giftCardInput.removeAttribute("disabled");

            this.addViewAllDetailsButton();
            this.isDrawerOpen = true;

            // Fire the quick-buy drawer–open event
            publish(PUB_SUB_EVENTS.quickBuyDrawerOpen, { source: "quick-add" });

            this.close_button.setAttribute("tabindex", "0");
            this.close_button.focus();

            document.addEventListener("click", this.handleInteractionOutside);
          })
          .catch((error) => {
            if (error.name === "AbortError") {
              console.error("Fetch aborted");
            } else {
              console.error("Fetch error:", error);
            }
          });
      }

      addViewAllDetailsButton() {
        const viewAllDetailsContainer = this.quick_add_wrapper.querySelector(
          ".wt__quick-buy__view-all-container",
        );
        const link = viewAllDetailsContainer.querySelector("a");
        link.href = this.product_url;
        link.setAttribute("tabindex", "0");
        viewAllDetailsContainer.classList.remove("hidden");
      }

      hideViewAllDetailsButton() {
        const viewAllDetailsContainer = this.quick_add_wrapper.querySelector(
          ".wt__quick-buy__view-all-container",
        );
        viewAllDetailsContainer.classList.add("hidden");
      }

      galleryObserver() {
        const config = {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true,
        };
        this.observer = new MutationObserver(this.observerCallback);
        this.observer.observe(this.quick_add_wrapper, config);
      }

      observerCallback(mutations) {
        for (const mutation of mutations) {
          if (mutation.target.localName === "variant-options") {
            this.quick_add = document.querySelector(".wt__quick-buy");
            const variantOptions =
              this.quick_add.querySelector("variant-options");
            const imageContainer =
              this.quick_add.querySelector(".product-image");
            const image = imageContainer.querySelector("img");
            const formInput = this.quick_add.querySelector(
              'form input[name="id"]',
            );
            if (variantOptions.getAttribute("data-variant-id")) {
              formInput.value = variantOptions.getAttribute("data-variant-id");
              formInput.setAttribute(
                "value",
                variantOptions.getAttribute("data-variant-id"),
              );
            }
            if (
              variantOptions.getAttribute("data-featured-image") &&
              this.lastFeaturedImage !==
                variantOptions.getAttribute("data-featured-image")
            ) {
              image?.setAttribute(
                "src",
                variantOptions.getAttribute("data-featured-image"),
              );
              image?.removeAttribute("srcset");

              this.lastFeaturedImage = variantOptions.getAttribute(
                "data-featured-image",
              );
              if (
                imageContainer.children[0]?.nodeName !== "IMG" &&
                imageContainer.children[0]?.nodeName !== "A"
              ) {
                const newImage = document.createElement("img");
                newImage.setAttribute(
                  "class",
                  "wt-product__img  wt-product__img--zoom-cursor",
                );
                newImage.setAttribute(
                  "src",
                  variantOptions.getAttribute("data-featured-image"),
                );
                newImage.removeAttribute("srcset");
                imageContainer.innerHTML = "";
                imageContainer.appendChild(newImage);
              } else {
                image.setAttribute(
                  "src",
                  variantOptions.getAttribute("data-featured-image"),
                );
                image.removeAttribute("srcset");
              }
              this.lastFeaturedImage = variantOptions.getAttribute(
                "data-featured-image",
              );
            } else {
              const hasFirstMediaModel =
                this.firstMedia?.querySelector("model-element");
              if (!this.hasFirstMediaImg || hasFirstMediaModel)
                imageContainer.innerHTML = this.firstMedia?.innerHTML;
            }
            break;
          }
        }
      }

      handleInteractionOutside(event) {
        // if (this.isDrawerOpen) {
        //   const clickInsideDrawer = this.quick_add_wrapper.contains(
        //     event.target,
        //   );
        //   const clickCloseBtn = document
        //     .querySelector(".icon.icon-close")
        //     .contains(event.target);
        //     console.log(event.target, this.page_overlay)
        //   if (!clickInsideDrawer || clickCloseBtn) {
        //     this.closeCart();
        //   }

        // }
        if (this.isDrawerOpen && event.target === this.page_overlay) {
          this.closeCart();
        }
      }

      closeCart() {
        // Fire the quick-buy drawer–close event
        publish(PUB_SUB_EVENTS.quickBuyDrawerClose, { source: "quick-add" });

        const loader = this.quick_add.querySelector(".wt__quick-buy-loader");
        loader.classList.remove("hidden");
        const product = this.quick_add.querySelector(".wt-product");

        if (product) product.remove();

        this.body.classList.remove("quick-buy-page-overlay");
        this.page_overlay.classList.remove("wt__quick-buy--page-overlay--open");
        this.quick_add_container.classList.remove(
          "wt__quick-buy__container--open",
        );
        this.isDrawerOpen = false;
        this.hideViewAllDetailsButton();
        document.removeEventListener("click", this.handleInteractionOutside);
        this.disconnectObserver();
        this.removeButtonEventListener();
      }

      removeElements(element, ...selectors) {
        selectors.forEach((selector) => {
          const elements = element.querySelectorAll(selector);
          elements.forEach((el) => el.remove());
        });
      }

      updateAttribute(element, attribute, value) {
        if (element) {
          element.setAttribute(attribute, value);
        }
      }

      updateFieldSets(fieldSets) {
        fieldSets.forEach((fieldset) => {
          const inputRadios = fieldset.querySelectorAll('input[type="radio"]');
          const labels = fieldset.querySelectorAll("label");

          inputRadios.forEach((radio) => {
            this.updateAttribute(
              radio,
              "id",
              `quick-${radio.getAttribute("id")}`,
            );
            this.updateAttribute(
              radio,
              "form",
              `product-form-${radio.getAttribute("id")}`,
            );
          });

          labels.forEach((label) => {
            this.updateAttribute(
              label,
              "for",
              `quick-${label.getAttribute("for")}`,
            );
          });
        });
      }

      disconnectObserver() {
        this.observer?.disconnect();
      }

      removeButtonEventListener() {
        if (this.add_button)
          this.add_button.removeEventListener("click", () =>
            this.fetchProduct(this.product_url),
          );
      }

      disconnectedCallback() {
        this.disconnectObserver();
        this.removeButtonEventListener();
      }
    },
  );
}
