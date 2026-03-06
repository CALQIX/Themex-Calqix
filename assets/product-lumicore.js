(() => {
  const SELECTORS = {
    root: "[data-lumicore-root]",
    toggleCard: "[data-lumicore-toggle]",
    priceBlock: "[data-lumicore-price]",
    priceCurrent: ".lumicore-price-current",
    priceCompare: ".lumicore-price-compare",
    priceSave: ".lumicore-price-save",
    priceNote: "[data-lumicore-price-note]",
    form: "form[data-lumicore-form]",
    formWrapper: "[data-lumicore-form-wrapper]",
    accordion: "[data-lumicore-accordion]",
    accordionTrigger: "[data-lumicore-accordion-trigger]",
    accordionBody: "[data-lumicore-accordion-body]",
    thumbnails: "[data-lumicore-thumbnails]",
    thumb: "[data-lumicore-thumb]",
    mainImage: ".lumicore-gallery-image",
    subscriptionTarget: "[data-lumicore-subscription-target]",
    cartCount: "[data-cart-count]",
  };

  function setSelectedPurchaseMode(root, mode) {
    const cards = root.querySelectorAll(SELECTORS.toggleCard);
    cards.forEach((card) => {
      const isSelected = card.getAttribute("data-lumicore-toggle") === mode;
      card.classList.toggle("selected", isSelected);
    });

    const subWrap = root.querySelector(`${SELECTORS.formWrapper}[data-lumicore-form-wrapper="subscription"]`);
    const onceWrap = root.querySelector(`${SELECTORS.formWrapper}[data-lumicore-form-wrapper="once"]`);

    if (mode === "subscription") {
      subWrap?.classList.remove("hidden");
      onceWrap?.classList.remove("visible");
    } else {
      subWrap?.classList.add("hidden");
      onceWrap?.classList.add("visible");
    }

    updatePriceDisplay(root, mode);
  }

  function updatePriceDisplay(root, mode) {
    const priceBlock = root.querySelector(SELECTORS.priceBlock);
    if (!priceBlock) return;

    const priceOnce = priceBlock.getAttribute("data-price-once") || "";
    const priceSub = priceBlock.getAttribute("data-price-sub") || "";
    const discountPct = priceBlock.getAttribute("data-discount-pct") || "";

    const currentEl = priceBlock.querySelector(SELECTORS.priceCurrent);
    const compareEl = priceBlock.querySelector(SELECTORS.priceCompare);
    const saveEl = priceBlock.querySelector(SELECTORS.priceSave);

    if (mode === "subscription") {
      if (currentEl) currentEl.textContent = priceSub;
      if (compareEl) {
        compareEl.style.display = "inline";
        compareEl.textContent = priceOnce;
      }
      if (saveEl) {
        saveEl.style.display = "inline-flex";
        saveEl.textContent = `Save ${discountPct}%`;
      }
    } else {
      if (currentEl) currentEl.textContent = priceOnce;
      if (compareEl) compareEl.style.display = "none";
      if (saveEl) saveEl.style.display = "none";
    }

    const note = root.querySelector(SELECTORS.priceNote);
    if (note) {
      const noteOnce = note.getAttribute("data-note-once") || "";
      const noteSub = note.getAttribute("data-note-sub") || "";
      note.textContent = mode === "subscription" ? noteSub : noteOnce;
    }
  }

  function initPurchaseToggle(root) {
    const cards = root.querySelectorAll(SELECTORS.toggleCard);
    if (!cards.length) return;

    cards.forEach((card) => {
      const handler = () => {
        const mode = card.getAttribute("data-lumicore-toggle");
        if (mode !== "subscription" && mode !== "once") return;
        setSelectedPurchaseMode(root, mode);
      };

      card.addEventListener("click", handler);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      });
    });

    setSelectedPurchaseMode(root, "subscription");
  }

  function initSellingPlanDetection(root) {
    const subForm = root.querySelector('form[data-lumicore-form="subscription"]');
    if (!subForm) return;

    const sellingPlanId = subForm.getAttribute("data-selling-plan-id");
    if (!sellingPlanId) return;

    const input = subForm.querySelector('input[name="selling_plan"]');
    if (!input) return;

    if (!input.value) {
      input.value = sellingPlanId;
    }
  }

  function closeAllAccordionItems(accordion) {
    accordion.querySelectorAll(SELECTORS.accordionBody).forEach((body) => {
      body.classList.remove("open");
    });
    accordion.querySelectorAll(SELECTORS.accordionTrigger).forEach((trigger) => {
      trigger.classList.remove("open");
    });
  }

  function initAccordion(root) {
    const accordion = root.querySelector(SELECTORS.accordion);
    if (!accordion) return;

    accordion.querySelectorAll(SELECTORS.accordionTrigger).forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const body = trigger.parentElement?.querySelector(SELECTORS.accordionBody);
        if (!body) return;

        const isOpen = body.classList.contains("open");
        closeAllAccordionItems(accordion);
        if (!isOpen) {
          body.classList.add("open");
          trigger.classList.add("open");
        }
      });
    });
  }

  function initThumbnailSwitcher(root) {
    const thumbsContainer = root.querySelector(SELECTORS.thumbnails);
    if (!thumbsContainer) return;

    const mainImg = root.querySelector(SELECTORS.mainImage);
    const thumbs = thumbsContainer.querySelectorAll(SELECTORS.thumb);

    thumbs.forEach((thumb) => {
      thumb.addEventListener("click", () => {
        thumbs.forEach((t) => t.classList.remove("active"));
        thumb.classList.add("active");

        const fullSrc = thumb.getAttribute("data-full-src") || "";
        if (mainImg && fullSrc) {
          mainImg.setAttribute("src", fullSrc);
          mainImg.setAttribute("srcset", fullSrc);
        }
      });
    });
  }

  function initScrollReveal() {
    const elements = document.querySelectorAll(".reveal");
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    elements.forEach((el) => observer.observe(el));
  }

  async function updateCartCount() {
    try {
      const res = await fetch("/cart.js", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const cart = await res.json();
      const count = typeof cart?.item_count === "number" ? cart.item_count : 0;
      document.querySelectorAll(SELECTORS.cartCount).forEach((el) => {
        el.textContent = String(count);
      });
    } catch {
    }
  }

  function setButtonState(button, state, originalText) {
    if (!button) return;

    if (state === "loading") {
      button.disabled = true;
      button.textContent = "Adding…";
      return;
    }

    if (state === "success") {
      button.disabled = true;
      button.textContent = "Added to Cart ✓";
      return;
    }

    button.disabled = false;
    button.textContent = originalText;
  }

  function initAjaxAddToCart(root) {
    root.querySelectorAll(SELECTORS.form).forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitButton = form.querySelector('button[type="submit"]');
        if (!submitButton) return;
        if (submitButton.disabled) return;

        const originalText = submitButton.textContent || "";
        setButtonState(submitButton, "loading", originalText);

        try {
          const formData = new FormData(form);
          const res = await fetch("/cart/add.js", {
            method: "POST",
            body: formData,
            headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
          });

          if (!res.ok) {
            throw new Error("cart_add_failed");
          }

          await res.json();
          await updateCartCount();

          setButtonState(submitButton, "success", originalText);
          setTimeout(() => {
            setButtonState(submitButton, "idle", originalText);
          }, 2000);
        } catch {
          submitButton.disabled = false;
          submitButton.textContent = "Something went wrong — try again";
          setTimeout(() => {
            submitButton.textContent = originalText;
          }, 2000);
        }
      });
    });
  }

  function initCtaScrollToSubscription() {
    document.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const trigger = target?.closest("[data-lumicore-scroll-to-subscription]");
      if (!trigger) return;

      const root = document.querySelector(SELECTORS.root);
      if (!root) return;

      setSelectedPurchaseMode(root, "subscription");
      const subTarget = root.querySelector(SELECTORS.subscriptionTarget);
      if (!subTarget) return;

      subTarget.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function initRoot(root) {
    initPurchaseToggle(root);
    initSellingPlanDetection(root);
    initAccordion(root);
    initThumbnailSwitcher(root);
    initAjaxAddToCart(root);
    updatePriceDisplay(root, "subscription");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(SELECTORS.root).forEach((root) => initRoot(root));
    initScrollReveal();
    initCtaScrollToSubscription();
  });
})();
