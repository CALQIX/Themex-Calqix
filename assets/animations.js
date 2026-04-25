const SCROLL_ANIMATION_TRIGGER_CLASSNAME = "scroll-trigger";
const SCROLL_ANIMATION_OFFSCREEN_CLASSNAME = "scroll-trigger--offscreen";
const SCROLL_ANIMATION_CANCEL_CLASSNAME = "scroll-trigger--cancel";

// Scroll in animation logic.
// Uses style.setProperty so the cascade order does not wipe other inline
// styles already on the element (avoid setAttribute('style', ...)).
function onIntersection(elements, observer) {
  elements.forEach((element, index) => {
    if (element.isIntersecting) {
      const elementTarget = element.target;
      if (
        elementTarget.classList.contains(SCROLL_ANIMATION_OFFSCREEN_CLASSNAME)
      ) {
        elementTarget.classList.remove(SCROLL_ANIMATION_OFFSCREEN_CLASSNAME);
        if (elementTarget.hasAttribute("data-cascade")) {
          elementTarget.style.setProperty("--animation-order", index);
        }
      }
      observer.unobserve(elementTarget);
    } else {
      element.target.classList.add(SCROLL_ANIMATION_OFFSCREEN_CLASSNAME);
      element.target.classList.remove(SCROLL_ANIMATION_CANCEL_CLASSNAME);
    }
  });
}

/**
 * Safe helper: returns a root that supports querySelectorAll.
 */
function getQueryRoot(rootEl) {
  if (rootEl && typeof rootEl.querySelectorAll === "function") return rootEl;
  return document;
}

function initializeScrollAnimationTrigger(
  rootEl = document,
  isDesignModeEvent = false,
) {
  const root = getQueryRoot(rootEl);

  const animationTriggerElements = Array.from(
    root.getElementsByClassName(SCROLL_ANIMATION_TRIGGER_CLASSNAME),
  );

  if (animationTriggerElements.length === 0) return;

  if (isDesignModeEvent) {
    animationTriggerElements.forEach((element) => {
      element.classList.add("scroll-trigger--design-mode");
    });
    return;
  }

  const observer = new IntersectionObserver(onIntersection, {
    rootMargin: "0px 0px -50px 0px",
  });
  animationTriggerElements.forEach((element) => observer.observe(element));
}

// Robust boot: defer scripts SHOULD run before DOMContentLoaded, but with
// HTTP cache, browser back-forward cache, or fast navigations, the document
// can already be "interactive" / "complete" by the time this runs. In that
// case the DOMContentLoaded listener never fires and no observers attach,
// leaving every .scroll-trigger element stuck in its hidden base state.
function bootScrollAnimations() {
  initializeScrollAnimationTrigger();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootScrollAnimations, {
    once: true,
  });
} else {
  bootScrollAnimations();
}

// Re-init on Shopify section reload in BOTH design mode and production.
// Production: Shopify Apps and the cart section reload via /sections route
// — without re-initialising, freshly injected .scroll-trigger nodes never
// get observed and stay frozen at opacity 0.01.
function handleSectionReload(event, designMode) {
  initializeScrollAnimationTrigger(event ? event.target : document, designMode);
}
if (typeof Shopify !== "undefined" && Shopify.designMode) {
  document.addEventListener("shopify:section:load", (event) =>
    handleSectionReload(event, true),
  );
  document.addEventListener("shopify:section:reorder", () =>
    handleSectionReload(null, true),
  );
} else {
  document.addEventListener("shopify:section:load", (event) =>
    handleSectionReload(event, false),
  );
}

// Expose for other scripts (e.g. AJAX cart, instant search) so they can
// hook freshly inserted .scroll-trigger elements without reloading.
window.initializeScrollAnimationTrigger = initializeScrollAnimationTrigger;
