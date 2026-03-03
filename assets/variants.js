if (!customElements.get("variant-options")) {
  customElements.define(
    "variant-options",
    class VariantOptions extends HTMLElement {
      whenLoaded = Promise.all([customElements.whenDefined("gallery-section")]);
      constructor() {
        super();
        this.addEventListener("change", this.onVariantChange);
        this.addEventListener("keydown", this.onKeyDown);

        this.container = document.querySelector(
          `section[data-product-handle="${this.getAttribute("data-product-handle")}"]`,
        );
      }

      connectedCallback() {
        this.whenLoaded.then(() => {
          this.initialize();
        });
      }

      disconnectedCallback() {}

      initialize() {
        this.updateOptions();
        this.updateMasterId();
        this.updateGallery();
        this.updateVariantStatuses();
        this.updateDropdownButtons();
      }

      onKeyDown(event) {
        if (event.key === "Enter" || event.keyCode === 13) {
          const input = event.target.querySelector("input");
          input?.click();
          // this.onVariantChange();
        }
      }

      onVariantChange() {
        const variantChangeStartEvent = new CustomEvent("variantChangeStart", {
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(variantChangeStartEvent);
        this.updateOptions();
        this.updateMasterId();
        this.updateGallery();
        this.toggleAddButton(true, "", false);
        this.updatePickupAvailability();
        this.removeErrorMessage();
        this.updateVariantStatuses();
        this.updateDropdownButtons();

        if (!this.currentVariant) {
          this.toggleAddButton(true, "", true);
          this.setUnavailable();
        } else {
          this.updateMedia();
          this.lenOfVariantOptions =
            document.querySelectorAll("variant-options").length;
          if (this.lenOfVariantOptions === 1) {
            this.updateURL();
          }
          this.updateVariantInput();
          this.renderProductInfo();
          this.updateShareUrl();
        }
        const variantChangeEndEvent = new CustomEvent("variantChangeEnd", {
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(variantChangeEndEvent);
      }

      updateGallery() {
        const mediaGallery = document.getElementById(
          `MediaGallery-${this.dataset.section}`,
        );

        let media_id = false;
        if (this.currentVariant && this.currentVariant.featured_media) {
          media_id = this.currentVariant.featured_media.id;
        }

        try{
          mediaGallery?.filterSlides(this.options, media_id, true);
        } catch (error) {}
      }

      updateDropdownButtons(){
        const fieldsets = Array.from(
          this.querySelectorAll(".wt-product__option"),
        );
        this.options = fieldsets.map((fieldset) => {
          return Array.from(fieldset.querySelectorAll("input")).find(
            (radio) => radio.checked,
          )?.value || '';
        });

        fieldsets.forEach((fieldset) => {
          const dropdown = fieldset.querySelector(
            ".wt-product__option__dropdown",
          );
          if (dropdown) {
            const checkedInput = fieldset.querySelector('fieldset input:checked')
            if(!checkedInput) return
            const isInputDisabled = checkedInput?.classList.contains('disabled')
            dropdown.classList.toggle('wt-product__option__dropdown--unavailable', isInputDisabled)
          }
        });
      }

      updateOptions() {
        const fieldsets = Array.from(
          this.querySelectorAll(".wt-product__option"),
        );
        this.options = fieldsets.map((fieldset) => {
          return (
            Array.from(fieldset.querySelectorAll("input")).find(
              (radio) => radio.checked,
            )?.value || ""
          );
        });

        this.checkedOptions = fieldsets.map((fieldset) => {
          return Array.from(fieldset.querySelectorAll("input")).find(
            (radio) => radio.checked,
          ) || '';
        });

        fieldsets.forEach((fieldset, index) => {
          const selectedOption = this.options[index];

          if (!selectedOption) return;

          fieldset.querySelector(
            ".wt-product__option__title .value",
          ).innerHTML = selectedOption;
          const dropdownSpan = fieldset.querySelector(
            ".wt-product__option__dropdown span",
          );
          if (dropdownSpan) dropdownSpan.innerHTML = selectedOption;
        });
      }

      updateMasterId() {
        this.currentVariant = this.getVariantData()?.find((variant) => {
          return !variant.options
            .map((option, index) => {
              return this.options[index] === option;
            })
            .includes(false);
        });
      }

      updateMedia() {
        if (!this.currentVariant) return;
        this.setAttribute("data-variant-id", this.currentVariant?.id);
        if (!this.currentVariant.featured_media) return;
        this.setAttribute(
          "data-featured-image",
          this.currentVariant?.featured_media?.preview_image?.src,
        );
        this.setAttribute(
          "data-featured-image-id",
          this.currentVariant?.featured_media?.id,
        );

        const modalContent = document.querySelector(
          `#ProductModal-${this.dataset.section} .product-media-modal__content`,
        );
        if (!modalContent) return;
        const newMediaModal = modalContent.querySelector(
          `[data-media-id="${this.currentVariant.featured_media.id}"]`,
        );
        modalContent.prepend(newMediaModal);
      }

      updateURL() {
        if (!this.currentVariant || this.dataset.updateUrl === "false") return;
        window.history.replaceState(
          {},
          "",
          `${this.dataset.url}?variant=${this.currentVariant.id}`,
        );
      }

      updateShareUrl() {
        const shareButton = document.getElementById(
          `Share-${this.dataset.section}`,
        );
        if (!shareButton || !shareButton.updateUrl) return;
        shareButton.updateUrl(
          `${window.shopUrl}${this.dataset.url}?variant=${this.currentVariant.id}`,
        );
      }

      updateVariantInput() {
        const productForms = document.querySelectorAll(
          `#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`,
        );
        productForms.forEach((productForm) => {
          const input = productForm.querySelector('input[name="id"]');
          input.value = this.currentVariant.id;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }

      updateVariantStatuses() {
        // const selectedOptionOneVariants = this.variantData.filter(
        //   (variant) => this.querySelector(':checked').value === variant.option1
        //   );
        const selectedOptionOneVariants = this.variantData?.filter(
          (variant) => variant.available === true,
        );
        const inputWrappers = [
          ...this.querySelectorAll(".product-form__input"),
        ];

        const checkedInputs = [...this.querySelectorAll('.product-form__input :checked')]
        const checkedInputsValues = [...this.querySelectorAll('.product-form__input :checked')].map(input => input.getAttribute('value'))

        const previousSelectedOptions = []
        inputWrappers.forEach((option, index) => {
          if (index === 0 && this.currentVariant?.options.length > 1) return;

          const optionInputs = [
            ...option.querySelectorAll('input[type="radio"], option'),
          ];
          const previousOptionSelected =
            inputWrappers[index - 1]?.querySelector(":checked")?.value;
          
            previousSelectedOptions.push(previousOptionSelected)

              const availableOptionInputsValue = selectedOptionOneVariants
              .filter(
                (variant) => {
                  if (index === 2){
                    return variant.available &&
                    variant[`option1`] === previousSelectedOptions[0] &&
                    variant[`option2`] === previousSelectedOptions[1]
                  } else {
                    return variant.available &&
                    variant[`option${index}`] === previousOptionSelected
                  }
                }
              )
              .map((variantOption) => variantOption[`option${index + 1}`]);
              this.setInputAvailability(optionInputs, availableOptionInputsValue, checkedInputsValues, index, checkedInputs);
        });
      }

      setInputAvailability(listOfOptions, listOfAvailableOptions, checkedInputsValues, index, checkedInputs) {
        // helper function to check if array contains another array
        function containsSubarray(arr, subarr) {
          return arr.join(',').includes(subarr.join(','));
        }
        
        const checkedValues = checkedInputsValues.slice(0, index)

        const listOfAvailableVariants= this.getVariantData().filter(variant => {
            if(containsSubarray(variant.options, checkedValues)) return true
        })

        const isPreviousOptionChecked = checkedInputs.find(input => input.dataset.position === `${index}`) || index === 0
        

        listOfOptions.forEach((input) => {          
          if(!isPreviousOptionChecked) return;
          if (listOfAvailableOptions.includes(input.getAttribute("value"))) {
            input.classList.remove("disabled");
          } else {
            input.classList.add("disabled");
          }

          // check if option exist. If not, it should be disabled
          let inputOccurs = false;
          listOfAvailableVariants.forEach(variant => {
            if(variant.options.includes(input.getAttribute("value"))) {
              inputOccurs = true
            }
          })

          if(!inputOccurs) input.classList.add("disabled");

        });
      }

      updatePickupAvailability() {
        const pickUpAvailability = document.querySelector(
          "pickup-availability",
        );
        if (!pickUpAvailability) return;

        pickUpAvailability.dataset.variantId = this.currentVariant?.id;
        if (this.currentVariant && this.currentVariant.available) {
          pickUpAvailability.fetchAvailability(this.currentVariant.id);
        } else {
          pickUpAvailability.removeAttribute("available");
          pickUpAvailability.innerHTML = "";
        }
      }

      removeErrorMessage() {
        const section = this.closest("section");
        if (!section) return;

        const productForm = section.querySelector("product-form");
        try {
          productForm?.handleErrorMessage();
        } catch (err) {
          console.log(err);
        }
      }

      renderProductInfo() {
        const requestedVariantId = this.currentVariant?.id;
        const sectionId = this.dataset.originalSection
          ? this.dataset.originalSection
          : this.dataset.section;

        fetch(
          `${this.dataset.url}?variant=${requestedVariantId}&section_id=${
            this.dataset.originalSection
              ? this.dataset.originalSection
              : this.dataset.section
          }`,
        )
          .then((response) => response.text())
          .then((responseText) => {
            // prevent unnecessary ui changes from abandoned selections
            if (this.currentVariant?.id !== requestedVariantId) return;

            const html = new DOMParser().parseFromString(
              responseText,
              "text/html",
            );
            const destination = document.getElementById(
              `price-${this.dataset.section}`,
            );
            const source = html.getElementById(
              `price-${this.dataset.originalSection ? this.dataset.originalSection : this.dataset.section}`,
            );
            const skuSource = html.getElementById(
              `Sku-${this.dataset.originalSection ? this.dataset.originalSection : this.dataset.section}`,
            );
            const skuDestination = document.getElementById(
              `Sku-${this.dataset.section}`,
            );
            const inventorySource = html.getElementById(
              `Inventory-${this.dataset.originalSection ? this.dataset.originalSection : this.dataset.section}`,
            );
            const inventoryDestination = document.getElementById(
              `Inventory-${this.dataset.section}`,
            );

            if (source && destination) destination.innerHTML = source.innerHTML;
            if (inventorySource && inventoryDestination)
              inventoryDestination.innerHTML = inventorySource.innerHTML;
            if (skuSource && skuDestination) {
              skuDestination.innerHTML = skuSource.innerHTML;
              skuDestination.classList.toggle(
                "visibility-hidden",
                skuSource.classList.contains("visibility-hidden"),
              );
            }

            const price = document.getElementById(
              `price-${this.dataset.section}`,
            );

            if (price) price.classList.remove("visibility-hidden");

            if (inventoryDestination)
              inventoryDestination.classList.toggle(
                "visibility-hidden",
                inventorySource.innerText === "",
              );

            const addButtonUpdated = html.getElementById(
              `ProductSubmitButton-${sectionId}`,
            );
            this.toggleAddButton(
              addButtonUpdated
                ? addButtonUpdated.hasAttribute("disabled")
                : true,
              window.variantStrings.soldOut,
            );

            publish(PUB_SUB_EVENTS.variantChange, {
              data: {
                sectionId: sectionId,
                html,
                variant:this.currentVariant
              },
            });
          });
      }

      toggleAddButton(disable = true, text, modifyClass = true) {
        const productForm = document.getElementById(
          `product-form-${this.dataset.section}`,
        );
        if (!productForm) return;
        const addButton = productForm.querySelector('[name="add"]');
        const addButtonText = productForm.querySelector('[name="add"] > span');
        if (!addButton) return;

        if (disable) {
          addButton.setAttribute("disabled", "disabled");
          if (text) addButtonText.textContent = text;
        } else {
          addButton.removeAttribute("disabled");
          addButtonText.textContent = window.variantStrings.addToCart;
        }

        if (!modifyClass) return;
      }

      setUnavailable() {
        const button = document.getElementById(
          `product-form-${this.dataset.section}`,
        );
        const addButton = button.querySelector('[name="add"]');
        const addButtonText = button.querySelector('[name="add"] > span');
        const price = document.getElementById(`price-${this.dataset.section}`);
        const inventory = document.getElementById(
          `Inventory-${this.dataset.section}`,
        );
        const sku = document.getElementById(`Sku-${this.dataset.section}`);

        if (!addButton) return;
        addButtonText.textContent = window.variantStrings.unavailable;
        if (price) price.classList.add("visibility-hidden");
        if (inventory) inventory.classList.add("visibility-hidden");
        if (sku) sku.classList.add("visibility-hidden");
      }

      getVariantData() {
        this.variantData =
          this.variantData ||
          JSON.parse(
            this.querySelector('[type="application/json"]').textContent,
          );
        return this.variantData;
      }
    },
  );
}
// customElements.define('variant-options', VariantOptions);
