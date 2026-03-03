import noUiSlider from "./nouislider.min.mjs";

class PriceSlider extends HTMLElement {
  constructor() {
    super();
    this.init();
  }

  init() {
    const priceSlider = this.querySelector(".f-price__slider");
    const inputFrom = this.querySelector(".f-price__input--from");
    const inputTo = this.querySelector(".f-price__input--to");
    const rangeMin = parseInt(priceSlider.dataset.min);
    const rangeMax = parseInt(priceSlider.dataset.max);
    const step = parseInt(priceSlider.dataset.step);
    const currency = priceSlider.dataset.currency;
    const applyButton = document.querySelector(".wt-filter__footer .wt-cart__cta");
    const facetForm = document.querySelector("facet-filters-form > form");
    const isSliderInCollapsible = this.closest(".f-price-slider ");
    const isRtl = document.documentElement.getAttribute("dir") === "rtl";

    noUiSlider.create(priceSlider, {
      start: [inputFrom.value || 0, inputTo.value || 0],
      connect: true,
      step,
      tooltips: [true, true],
      range: {
        min: rangeMin,
        max: rangeMax,
      },
      direction: isRtl ? "rtl" : "ltr",
      format: wNumb({
        decimals: 0,
        thousand: "",
        prefix: "",
      }),
    });

    if (isSliderInCollapsible) {
      const uiHandlers = priceSlider.querySelectorAll(".noUi-handle");
      setTabindex(uiHandlers, "-1");
    }

    const debouncedUpdate = debounce((values, handle) => {
      let value = values[handle];
      if (handle) {
        inputTo.value = value;
        inputTo.setAttribute("value", value);
        inputTo.dispatchEvent(new Event("change"));
      } else {
        inputFrom.value = value;
        inputFrom.setAttribute("value", value);
        inputFrom.dispatchEvent(new Event("change"));
      }

      facetForm.dispatchEvent(new Event("input"));
    }, 300);

    priceSlider.noUiSlider.on("change", function (values, handle) {
      debouncedUpdate(values, handle);
    });

    inputFrom.addEventListener("change", function () {
      priceSlider.noUiSlider.set([this.value, null]);
    });

    inputTo.addEventListener("change", function () {
      priceSlider.noUiSlider.set([null, this.value]);
    });

    applyButton.addEventListener("click", () => {
      inputTo.dispatchEvent(new Event("change"));
      inputFrom.dispatchEvent(new Event("change"));
    });
  }

  debounce(func, wait) {
    let timeout;
    return function (...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }
}

customElements.define("price-slider", PriceSlider);
