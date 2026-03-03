class DrawerSearchSection extends HTMLElement {
  constructor() {
    super();

    this.isOpen = false;
    this.drawerClass = "wt-drawer-search";
    this.drawer = document.querySelector(`.${this.drawerClass}`);
    this.classDrawerActive = `${this.drawerClass}--active`;
    this.pageOverlayClass = "search-overlay";
    this.activeOverlayBodyClass = `${this.pageOverlayClass}-on`;
    this.body = document.body;

    this.triggerQuery = [
      ".wt-header__search-trigger",
      ".wt-header__search__close",
      ".search-results__terms",
    ].join(", ");
    this.triggers = () => document.querySelectorAll(this.triggerQuery);

    // search stuff
    this.cachedResults = {};
    this.input = this.querySelector('input[name="q"]');
    this.clearButton = this.querySelector(".wt-header__search__clear-button");
    this.closeButton = this.querySelector(".wt-header__search__close");
    this.predictiveSearchResults = this.querySelector(
      "[data-predictive-search]",
    );
    this.searchProperties = this.dataset.searchProperties;

    this.mainTrigger = this.querySelector(".wt-header__search-trigger");
    this.emptyAnnouncement = this.querySelector(".search-empty");
    this.searchResultTop = this.querySelector(".search-result-top");

    this.isVisibleClearButton = false;

    this.saveSuggestionMenuInDesignMode =
      this.saveSuggestionMenuInDesignMode.bind(this);
    this.setupEventListeners();

    this.toggleTabindexElements = [this.input, this.closeButton];

    this.suggestionMenuContent = this.querySelector(".search-result-top").cloneNode(true);
    this.timeOut = null;
    this.init();
  }


  getFocusableElements() {
    const focusableElementsSelector =
      "button, [href], input:not([type='hidden']), select, [tabindex]";
    const focusableElements = () =>
      Array.from(this.querySelectorAll(focusableElementsSelector)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0,
      );

    return {
      focusableElements,
      first: focusableElements()[0],
      last: focusableElements()[focusableElements().length - 1],
    };
  }

  // fixOverlayIssue() {
  //     const body = this.body;
  //
  //     if(body.classList.contains(this.activeOverlayBodyClass)) {
  //         const offsetTop = -parseInt(body.style.top);
  //         body.style.position = 'initial';
  //         body.style.top = 'initial';
  //         body.style.left = 'initial';
  //         window.scrollTo(0, offsetTop);
  //
  //     } else {
  //         // body.style.top = -document.documentElement.scrollTop+'px';
  //         // body.style.left = '0px';
  //         // body.style.position = 'fixed';
  //     }
  // }

  onToggle() {
    if (this.hasAttribute("open")) {
      this.removeAttribute("open");
      setTabindex(this.toggleTabindexElements, "-1");
      setTabindex([this.mainTrigger], "0");
      this.isOpen = false;
      setTimeout(() => {
        this.mainTrigger.focus();
      }, 0);
    } else {
      this.setAttribute("open", "");
      setTabindex(this.toggleTabindexElements, "0");
      setTabindex([this.mainTrigger], "-1");
      this.input.focus();
      this.input.setSelectionRange(
        this.input.value.length,
        this.input.value.length,
      );
      this.isOpen = true;
    }
  }

  toggleDrawerClasses() {
    this.onToggle();
    // this.fixOverlayIssue();
    this.drawer.classList.toggle(this.classDrawerActive);
    this.body.classList.toggle(this.activeOverlayBodyClass);
  }

  init() {
    const isPredictiveSearchAvailable = this.hidePredictiveSearch();
    if (!isPredictiveSearchAvailable) return;

    this.triggers().forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleDrawerClasses();
      });
    });

    this.clearButton.addEventListener("click", () => {
      this.input.value = "";
      this.clearButton.style.display = "none";
      this.isVisibleClearButton = false;
      this.clearResults();
    });

    this.addEventListener("keydown", (e) => {
      const isTabPressed =
        e.key === "Tab" || e.keyCode === 9 || e.code === "Tab";
      const { first, last } = this.getFocusableElements();

      if (e.key === "Escape" || e.keyCode === 27 || e.code === "Escape") {
        if (this.isOpen) {
          this.toggleDrawerClasses();
        }
      }

      if (isTabPressed) {
        if (this.isOpen) {
          if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    });

    this.input.addEventListener("input", () => {
      if (this.input.value.length > 0 && !this.isVisibleClearButton) {
        this.clearButton.style.display = "flex";
        this.clearButton.setAttribute("tabindex", "0");
        this.isVisibleClearButton = true;
      } else if (this.input.value.length === 0 && this.isVisibleClearButton) {
        this.clearButton.style.display = "none";
        this.clearButton.setAttribute("tabindex", "-1");
        this.isVisibleClearButton = false;
      }
    });
  }

  hidePredictiveSearch() {
    // when predictive search is not available, we need to hide the predictive search results
    const featuresTag = document.getElementById("shopify-features");
    if (featuresTag) {
      const featuresData = JSON.parse(featuresTag.textContent);
      if (featuresData.predictiveSearch === false) {
        const searchPageUrl = this.dataset.searchPageUrl;
        this.triggers().forEach((trigger) => {
          trigger.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.href = searchPageUrl;
          });
        });
        return false;
      }
    }
    return true;
  }

  // search stuff
  setupEventListeners() {
    const form = this.querySelector("form.store-search-form");
    form.addEventListener("submit", this.onFormSubmit.bind(this));
    this.input.addEventListener(
      "input",
      debounce((event) => {
        this.onChange(event);
      }, 300).bind(this),
    );

    if (Shopify.designMode) {
      document.addEventListener(
        "shopify:section:load",
        this.saveSuggestionMenuInDesignMode,
      );
    }
  }

  saveSuggestionMenuInDesignMode() {
    if (this.body.classList.contains(this.activeOverlayBodyClass))
      this.drawer.classList.toggle(this.classDrawerActive);
  }

  getQuery() {
    return this.input.value.trim();
  }

  onChange() {
    const searchTerm = this.getQuery();

    if (searchTerm.length) {
      this.getSearchResults(searchTerm);
      this.removeAttribute("empty");
    } else {
      this.clearResults();
    }
  }

  onFormSubmit(event) {
    if (
      !this.getQuery().length ||
      this.querySelector('[aria-selected="true"] a')
    )
      event.preventDefault();
  }

  getSearchResults(searchTerm) {
    const queryKey = searchTerm.replace(" ", "-").toLowerCase();
    this.setLiveRegionLoadingState();

    if (this.cachedResults[queryKey]) {
      this.renderSearchResults(this.cachedResults[queryKey]);
      return;
    }

    fetch(
      `${routes.predictive_search_url}?q=${encodeURIComponent(searchTerm)}&${encodeURIComponent("resources[type]")}=product,page,article,collection,query&${encodeURIComponent("resources[limit_scope]")}=each&${encodeURIComponent("resources[limit]")}=6&${encodeURIComponent("resources[options][fields]")}=${encodeURIComponent(this.searchProperties)}&section_id=predictive-search`,
    )
      .then((response) => {
        if (!response.ok) {
          let error = new Error(response.status);
          throw error;
        }
        return response.text();
      })
      .then((text) => {
        const resultsMarkup = new DOMParser()
          .parseFromString(text, "text/html")
          .querySelector("#shopify-section-predictive-search").innerHTML;
        this.cachedResults[queryKey] = resultsMarkup;
        this.renderSearchResults(resultsMarkup);
      })
      .catch((error) => {
        throw error;
      });
  }

  setLiveRegionLoadingState() {
    this.statusElement =
      this.statusElement || this.querySelector(".predictive-search-status");
    this.loadingText =
      this.loadingText || this.getAttribute("data-loading-text");

    this.setLiveRegionText(this.loadingText);
    this.setAttribute("loading", true);
  }

  setLiveRegionText(statusText) {
    this.statusElement.setAttribute("aria-hidden", "false");
    this.statusElement.textContent = statusText;

    this.timeOut = setTimeout(() => {
      this.statusElement.setAttribute("aria-hidden", "true");
    }, 1000);
  }

  renderSearchResults(resultsMarkup) {
    this.predictiveSearchResults.innerHTML = resultsMarkup;

    this.setAttribute("results", true);

    this.setLiveRegionResults();
  }

  setLiveRegionResults() {
    this.removeAttribute("loading");
    this.setLiveRegionText(
      this.querySelector("[data-predictive-search-live-region-count-value]")
        ?.textContent,
    );
  }

  clearResults() {
    this.input.value = "";
    this.removeAttribute("results");
    this.setAttribute("empty", true);
    this.statusElement.innerHTML = this.suggestionMenuContent.innerHTML || '';

    clearTimeout(this.timeOut);
    setTimeout(() => {
      this.statusElement.removeAttribute("aria-hidden");
    }, 300);
  }
}

customElements.define("search-drawer", DrawerSearchSection);
