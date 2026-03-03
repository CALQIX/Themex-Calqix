if (!customElements.get("search-tab")) {
  customElements.define(
    "search-tab",
    class SearchTab extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.tabButtons = this.querySelectorAll(".search-results-tab__item");
        this.tabContainers = document.querySelectorAll(
          ".main-search-tab__container .collection__grid",
        );

        this.paginationWrapper = document.querySelector(
          ".wt-pagination-wrapper",
        );
        this.toolbarWrapper = document.querySelector(
          ".collection__sticky-header",
        );

        this.asideFilters = document.querySelector(".collection__aside");
        this.resultProducts = Array(
          ...document.querySelectorAll("#product-grid .collection__grid__item"),
        );
        this.currentContainer = "products";
        this.sectionId = this.dataset.sectionId;
        this.terms = this.dataset.terms;
        this.eventCounter = 0;
        this.timeout;

        this.fetchArticles = this.fetchArticles.bind(this);
        this.fetchPages = this.fetchPages.bind(this);
        this.fetchData = this.fetchData.bind(this);
        this.onEventTriggered = this.onEventTriggered.bind(this);
        this.hideAsideFilters = this.hideAsideFilters.bind(this);

        this.addEventListeners();
        this.fetchData();

        this.hideAsideFilters();
      }

      hideAsideFilters(buttonId = "products") {
        if (!this.asideFilters) return;

        const shouldHidden = buttonId !== "products";
        this.asideFilters.classList.toggle("hidden", shouldHidden);
      }

      fetchData() {
        this.fetchArticles();
        this.fetchPages();
      }

      onEventTriggered() {
        this.eventCounter++;
        clearTimeout(this.timeout);

        this.timeout = setTimeout(() => {
          if (this.eventCounter > 0) {
            this.fetchData();
            this.eventCounter = 0;
          }
        }, 1000);
      }

      setActiveButton(event) {
        const buttonId = event.target.id;
        if (buttonId === this.currentContainer) return;
        this.tabButtons.forEach((btn) => btn.classList.remove("active"));
        event.target.classList.add("active");
      }

      changeCategoryTab(event) {
        const buttonId = event.target.id;
        if (buttonId === this.currentContainer) return;

        const tabElements = {
          products: "#product-grid",
          articles: "#product-grid-articles",
          pages: "#product-grid-pages",
        };

        for (const [key, value] of Object.entries(tabElements)) {
          const productGrid = document.querySelector(value);
          if (buttonId === key) {
            productGrid.classList.add("active");
          } else {
            productGrid.classList.remove("active");
          }
        }
        this.currentContainer = buttonId;

        this.hideAsideFilters(buttonId);
      }

      toggleFiltersAndPagination(buttonId) {
        if (buttonId === "products") {
          this.toolbarWrapper.classList.remove("transition");
          this.paginationWrapper.classList.remove("transition");
        } else {
          this.toolbarWrapper?.classList.add("transition");
          this.paginationWrapper?.classList.add("transition");
        }
      }

      fetchArticles() {
        fetch(
          window.Shopify.routes.root +
            `search?section_id=${this.sectionId}&q=${this.terms}&type=article&options[prefix]=last&options[unavailable_products]=last`,
        )
          .then((response) => response.text())
          .then((html) => {
            const resultsMarkup = new DOMParser()
              .parseFromString(html, "text/html")
              .querySelector(".collection__grid--search-category");
            const articlesGrid = document.querySelector(
              "#product-grid-articles",
            );
            const articles = resultsMarkup.querySelectorAll(
              ".collection__grid__item",
            );
            const searchResult = resultsMarkup.querySelector(
              ".search-results__no-results",
            );
            const loader = articlesGrid.querySelector(
              ".collection__grid__loader__container",
            );
            if (loader) loader.classList.add("hidden");
            articlesGrid.innerHTML = "";
            if (searchResult) articlesGrid.appendChild(searchResult);
            articles.forEach((result) => articlesGrid.appendChild(result));
          })
          .catch((error) => {
            console.error("Error fetching paginated results:", error);
          });
      }

      fetchPages() {
        fetch(
          window.Shopify.routes.root +
            `search?section_id=${this.sectionId}&q=${this.terms}&type=page&options[prefix]=last&options[unavailable_products]=last`,
        )
          .then((response) => response.text())
          .then((html) => {
            const resultsMarkup = new DOMParser()
              .parseFromString(html, "text/html")
              .querySelector(".collection__grid--search-category");
            const pagesGrid = document.querySelector("#product-grid-pages");
            const pages = resultsMarkup.querySelectorAll(
              ".collection__grid__item",
            );
            const searchResult = resultsMarkup.querySelector(
              ".search-results__no-results",
            );
            const loader = pagesGrid.querySelector(
              ".collection__grid__loader__container",
            );
            if (loader) loader.classList.add("hidden");
            pagesGrid.innerHTML = "";
            if (searchResult) pagesGrid.appendChild(searchResult);
            pages.forEach((result) => pagesGrid.appendChild(result));
          })
          .catch((error) => {
            console.error("Error fetching paginated results:", error);
          });
      }

      addEventListeners() {
        this.tabButtons.forEach((button) => {
          button.addEventListener("click", (event) => {
            this.setActiveButton(event);
            this.changeCategoryTab(event);
          });
        });

        document.addEventListener("facets:change", this.onEventTriggered);
      }

      removeEventListeners() {
        this.tabButtons.forEach((button) => {
          button.removeEventListener("click", (event) => {
            this.setActiveButton(event);
            this.changeCategoryTab(event);
          });
        });

        document.removeEventListener("facets:change", this.onEventTriggered);
      }

      disconnectedCallback() {
        this.removeEventListeners();
      }
    },
  );
}
