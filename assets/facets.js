class FacetFiltersForm extends HTMLElement {
  constructor() {
    super();
    this.onActiveFilterClick = this.onActiveFilterClick.bind(this);
    this.debouncedOnSubmit = debounce((event) => {
      this.onSubmitHandler(event);
    }, 500);

    const facetForm = this.querySelector("form");
    facetForm.addEventListener("input", this.debouncedOnSubmit.bind(this));
    const facetWrapper = this.querySelector("#FacetsWrapperDesktop");
    if (facetWrapper) facetWrapper.addEventListener("keyup", onKeyUpEscape);
  }

  connectedCallback() {
    const facetForm = this.querySelector("form");
    facetForm.addEventListener("input", this.debouncedOnSubmit.bind(this));
    // const filterButton = document.querySelector(
    //   ".collection__filter-trigger.wt-filter__trigger.wt-filter__trigger--drawer",
    // );
    // filterButton?.addEventListener("keydown", (e) => {
    //   if (e.key === "Enter" || e.keyCode === 13) {
    //     document.querySelector("collection-section").toggleDrawer();
    //     document
    //       .querySelector(".svg-icon.svg-icon--close.wt-filter__close")
    //       ?.focus();
    //   }
    // });
    // const checkboxInputs = this.querySelectorAll(".form-checkbox__input");
    // checkboxInputs.forEach((input) => {
    //   input.addEventListener("keydown", (e) => {
    //     if (e.key === "Enter" || e.keyCode === 13) {
    //       input.checked = !input.checked;
    //     }
    //   });
    // });
  }

  static setListeners() {
    const onHistoryChange = (event) => {
      const searchParams = event.state
        ? event.state.searchParams
        : FacetFiltersForm.searchParamsInitial;
      if (searchParams === FacetFiltersForm.searchParamsPrev) return;
      FacetFiltersForm.renderPage(searchParams, null, false);
    };
    window.addEventListener("popstate", onHistoryChange);
  }

  static toggleActiveFacets(disable = true) {
    document.querySelectorAll(".js-facet-remove").forEach((element) => {
      element.classList.toggle("disabled", disable);
    });
  }

  static fireCustomEvent(options) {
    const facetsChange = new CustomEvent("facets:change", {
      bubbles: true,
      cancelable: true,
      detail: {
        desc: "facets changed",
        ...options,
      },
    });
    document.dispatchEvent(facetsChange);
  }

  static renderPage(searchParams, event, updateURLHash = true) {
    FacetFiltersForm.searchParamsPrev = searchParams;

    const sections = FacetFiltersForm.getSections();
    const countContainer = document.getElementById("ProductCount");
    const countContainerDesktop = document.getElementById(
      "ProductCountDesktop",
    );
    // document.getElementById('ProductGridContainer').querySelector('.collection').classList.add('loading');
    // if (countContainer) {
    //   countContainer.classList.add('loading');
    // }
    // if (countContainerDesktop) {
    //   countContainerDesktop.classList.add('loading');
    // }

    sections.forEach((section) => {
      const url = `${window.location.pathname}?section_id=${section.section}&${searchParams}`;
      const filterDataUrl = (element) => element.url === url;

      FacetFiltersForm.filterData.some(filterDataUrl)
        ? FacetFiltersForm.renderSectionFromCache(filterDataUrl, event)
        : FacetFiltersForm.renderSectionFromFetch(url, event);
    });

    if (updateURLHash) FacetFiltersForm.updateURLHash(searchParams);
  }

  static renderSectionFromFetch(url, event) {
    fetch(url)
      .then((response) => response.text())
      .then((responseText) => {
        const html = responseText;
        FacetFiltersForm.filterData = [
          ...FacetFiltersForm.filterData,
          { html, url },
        ];


        FacetFiltersForm.renderFilters(html, event);
        FacetFiltersForm.renderProductGridContainer(html);
        // FacetFiltersForm.renderProductCount(html);
        if (typeof initializeScrollAnimationTrigger === "function")
          initializeScrollAnimationTrigger(html.innerHTML);
      })
      .finally(() => FacetFiltersForm.fireCustomEvent());
  }

  static renderSectionFromCache(filterDataUrl, event) {
    const html = FacetFiltersForm.filterData.find(filterDataUrl).html;
    

    FacetFiltersForm.renderFilters(html, event);
    FacetFiltersForm.renderProductGridContainer(html);
    // FacetFiltersForm.renderProductCount(html);
    if (typeof initializeScrollAnimationTrigger === "function")
      initializeScrollAnimationTrigger(html.innerHTML);
  }

  static renderProductGridContainer(html) {
    document.getElementById("ProductGridContainer").innerHTML = new DOMParser()
      .parseFromString(html, "text/html")
      .getElementById("ProductGridContainer").innerHTML;
  }

  static renderProductCount(html) {
    const count = new DOMParser()
      .parseFromString(html, "text/html")
      .getElementById("ProductCount").innerHTML;
    const container = document.getElementById("ProductCount");
    const containerDesktop = document.getElementById("ProductCountDesktop");
    container.innerHTML = count;
    container.classList.remove("loading");
    if (containerDesktop) {
      containerDesktop.innerHTML = count;
      containerDesktop.classList.remove("loading");
    }
  }

  static renderFilters(html, event) {
    const parsedHTML = new DOMParser().parseFromString(html, "text/html");

    const facetDetailsElements = parsedHTML.querySelectorAll(
      "#FacetFiltersForm .js-filter, #FacetFiltersFormMobile .js-filter, #FacetFiltersPillsForm .js-filter",
    );
    const matchesIndex = (element) => {
      const jsFilter = event ? event.target.closest(".js-filter") : undefined;
      return jsFilter
        ? element.dataset.index === jsFilter.dataset.index
        : false;
    };
    const facetsToRender = Array.from(facetDetailsElements).filter(
      (element) => !matchesIndex(element),
    );
    const countsToRender = Array.from(facetDetailsElements).find(matchesIndex);

    facetsToRender.forEach((element) => {
      // const newElement = document.createElement(element.tagName);
      // newElement.innerHTML = element.innerHTML;
      const newElement = element;

      const tabIndexElements = newElement.querySelectorAll(
        ".wt-collapse__trigger",
      );
      tabIndexElements.forEach((el) => el.setAttribute("tabindex", "0"));

      const container = document.querySelector(
        `.js-filter[data-index="${element.dataset.index}"]`,
      );

      container.innerHTML = ""; // clear existing content
      container.appendChild(newElement); // append new element
    });

    FacetFiltersForm.renderActiveFacets(parsedHTML);
    FacetFiltersForm.renderAdditionalElements(parsedHTML);

    if (countsToRender)
      FacetFiltersForm.renderCounts(
        countsToRender,
        event.target.closest(".js-filter"),
      );
  }

  static renderActiveFacets(html) {
    const activeFacetElementSelectors = [".active-facets"];

    activeFacetElementSelectors.forEach((selector) => {
      const activeFacetsElement = html.querySelector(selector);
      if (!activeFacetsElement) return;
      document.querySelector(selector).innerHTML =
        activeFacetsElement.innerHTML;
    });

    FacetFiltersForm.toggleActiveFacets(false);
  }

  static renderAdditionalElements(html) {
    const mobileElementSelectors = [
      ".mobile-facets__open",
      ".mobile-facets__count",
      ".sorting",
    ];

    mobileElementSelectors.forEach((selector) => {
      if (!html.querySelector(selector)) return;
      document.querySelector(selector).innerHTML =
        html.querySelector(selector).innerHTML;
    });

    // document.getElementById('FacetFiltersFormMobile').closest('menu-drawer').bindEvents();
  }

  static renderCounts(source, target) {
    const targetElement = target.querySelector(".facets__selected");
    const sourceElement = source.querySelector(".facets__selected");

    const targetElementAccessibility = target.querySelector(".facets__summary");
    const sourceElementAccessibility = source.querySelector(".facets__summary");

    if (sourceElement && targetElement) {
      target.querySelector(".facets__selected").outerHTML =
        source.querySelector(".facets__selected").outerHTML;
    }

    if (targetElementAccessibility && sourceElementAccessibility) {
      target.querySelector(".facets__summary").outerHTML =
        source.querySelector(".facets__summary").outerHTML;
    }
  }

  static updateURLHash(searchParams) {
    history.pushState(
      { searchParams },
      "",
      `${window.location.pathname}${searchParams && "?".concat(searchParams)}`,
    );
  }

  static getSections() {
    return [
      {
        section: document.getElementById("product-grid").dataset.id,
      },
    ];
  }

  createSearchParams(form) {
    const q = new URL(location.href).searchParams.get('q'); 
    const formData = new FormData(form);
    if(q && !formData.has('q'))formData.append('q', q);

    return new URLSearchParams(formData).toString();
  }

  onSubmitForm(searchParams, event) {
    FacetFiltersForm.renderPage(searchParams, event);
  }

  onSubmitHandler(event) {
    event.preventDefault();
    const sortFilterForms = document.querySelectorAll(
      "facet-filters-form form",
    );
    if (event.srcElement.className == "mobile-facets__checkbox") {
      const searchParams = this.createSearchParams(
        event.target.closest("form"),
      );
      
      this.onSubmitForm(searchParams, event);
    } else {
      const forms = [];
      const isMobile =
        event.target.closest("form")?.id === "FacetFiltersFormMobile";

      sortFilterForms.forEach((form) => {
        if (!isMobile) {
          if (
            form.id === "FacetSortForm" ||
            form.id === "FacetFiltersForm" ||
            form.id === "FacetSortDrawerForm"
          ) {
            const noJsElements = document.querySelectorAll(".no-js-list");
            noJsElements.forEach((el) => el.remove());
            forms.push(this.createSearchParams(form));
          }
        } else if (form.id === "FacetFiltersFormMobile") {
          forms.push(this.createSearchParams(form));
        }
      });
      this.onSubmitForm(forms.join("&"), event);
    }
  }

  onActiveFilterClick(event) {
    event.preventDefault();
    FacetFiltersForm.toggleActiveFacets();
    const url =
      event.currentTarget.href.indexOf("?") == -1
        ? ""
        : event.currentTarget.href.slice(
            event.currentTarget.href.indexOf("?") + 1,
          );
    FacetFiltersForm.renderPage(url);
  }
}

FacetFiltersForm.filterData = [];
FacetFiltersForm.searchParamsInitial = window.location.search.slice(1);
FacetFiltersForm.searchParamsPrev = window.location.search.slice(1);
customElements.define("facet-filters-form", FacetFiltersForm);
FacetFiltersForm.setListeners();

class PriceRange extends HTMLElement {
  constructor() {
    super();
    this.querySelectorAll("input").forEach((element) =>
      element.addEventListener("input", this.onRangeChange.bind(this)),
    );
    this.setMinAndMaxValues();
  }

  onRangeChange(event) {
    this.adjustToValidValues(event.currentTarget);
    this.setMinAndMaxValues();
  }

  setMinAndMaxValues() {
    const inputs = this.querySelectorAll("input");
    const minInput = inputs[0];
    const maxInput = inputs[1];
    if (maxInput.value) minInput.setAttribute("max", maxInput.value.trim());
    if (minInput.value) maxInput.setAttribute("min", minInput.value.trim());
    if (minInput.value === "") maxInput.setAttribute("min", 0);
    if (maxInput.value === "")
      minInput.setAttribute("max", maxInput.getAttribute("max"));
  }

  adjustToValidValues(input) {
    const fromInput = this.querySelector('[name="filter.v.price.gte"]');
    const toInput = this.querySelector('[name="filter.v.price.lte"]');
    const sliderEl = this.querySelector(".f-price__slider");

    const globalMax = sliderEl
      ? Number(sliderEl.dataset.max) || 999999
      : 999999;

    let fromValue = parseFloat(fromInput.value) || 0;
    let toValue = parseFloat(toInput.value) || 0;

    if (input.name === "filter.v.price.gte") {
      if (fromValue < 0) {
        fromValue = 0;
      }
      if (fromValue > toValue) {
        fromValue = toValue;
      }
      if (fromValue > globalMax) {
        fromValue = globalMax;
      }
      fromInput.value = fromValue;
    } else {
      if (toValue < fromValue) {
        toValue = fromValue;
      }
      if (toValue > globalMax) {
        toValue = globalMax;
      }
      toInput.value = toValue;
    }
  }
}

customElements.define("price-range", PriceRange);

class FacetRemove extends HTMLElement {
  constructor() {
    super();
    const facetLink = this.querySelector("a");
    facetLink.setAttribute("role", "button");
    facetLink.addEventListener("click", this.closeFilter.bind(this));
    facetLink.addEventListener("keyup", (event) => {
      if (event.code.toUpperCase() === "SPACE") {
        event.preventDefault();
        this.closeFilter(event);
      }
    });
    FacetFiltersForm.fireCustomEvent();
  }

  closeFilter(event) {
    event.preventDefault();
    const form =
      this.closest("facet-filters-form") ||
      document.querySelector("facet-filters-form");
    const priceRanges = document.querySelectorAll(
      ".f-price__inputs > .f-price__val",
    );

    if (
      (event.target.className === "filter__remove" ||
        event.target.parentNode.classList.contains("price_range")) &&
      priceRanges
    ) {
      const priceSlider = document.querySelector(".f-price__slider");

      if (priceSlider) {
        const maxPrice = document
          .querySelectorAll("price-range > div")[0]
          .getAttribute("data-max");
        const currency = document
          .querySelectorAll("price-range > div")[0]
          .getAttribute("data-currency");
        const minPriceRange = priceRanges[0].querySelector("input");
        const maxPriceRange = priceRanges[1].querySelector("input");

        priceSlider.noUiSlider.set([
          priceSlider.dataset.min,
          priceSlider.dataset.max,
        ]);

        minPriceRange.value = 0;
        minPriceRange.max = maxPrice;

        maxPriceRange.value = maxPrice;
        maxPriceRange.min = 0;
      }
    }
    form.onActiveFilterClick(event);
  }
}

customElements.define("facet-remove", FacetRemove);
