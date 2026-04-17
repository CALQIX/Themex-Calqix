/* CALQIX Product Flavor Picker
   - Shows under the bundle picker (.cqbp) for OralBiome products when tier 2 or 3 is selected.
   - Tracks per-slot flavor selections (defaults to the current product variant).
   - Intercepts product-form submit at capture phase when tier >= 2 and there are
     flavor selections, posting an items[] payload to /cart/add.js.
   - Preserves selling_plan and the _bundle_tier line item property.
*/
(function () {
  "use strict";

  function findPicker() {
    return document.querySelector(".cqpfp");
  }

  function getActiveTierFromBundle() {
    var active = document.querySelector(".cqbp__card.is-active");
    if (!active) return 1;
    var t = parseInt(active.dataset.tier, 10);
    return isNaN(t) ? 1 : t;
  }

  function applyTier(picker, tier) {
    if (!picker) return;
    var slots = picker.querySelectorAll(".cqpfp__slot");
    slots.forEach(function (slot) {
      var slotNum = parseInt(slot.dataset.slot, 10) || 1;
      if (slotNum <= tier) slot.hidden = false;
      else slot.hidden = true;
    });
    if (tier >= 2) {
      picker.hidden = false;
      // next frame so the max-height transition plays
      requestAnimationFrame(function () {
        picker.dataset.active = "true";
      });
    } else {
      picker.dataset.active = "false";
      // wait for transition to finish before setting [hidden]
      setTimeout(function () {
        if (picker.dataset.active !== "true") picker.hidden = true;
      }, 360);
    }
    picker.dataset.tier = String(tier);
  }

  function initSelections(picker) {
    if (!picker) return;
    var currentVariantId = String(picker.dataset.currentVariantId || "");
    var currentHandle = picker.dataset.currentHandle || "";
    var slots = picker.querySelectorAll(".cqpfp__slot");
    slots.forEach(function (slot) {
      slot.dataset.selectedVariantId = currentVariantId;
      slot.dataset.selectedHandle = currentHandle;
    });
  }

  function wireJarClicks(picker) {
    if (!picker) return;
    picker.querySelectorAll(".cqpfp__slot").forEach(function (slot) {
      var jars = Array.prototype.slice.call(slot.querySelectorAll(".cqpfp__jar"));
      jars.forEach(function (jar) {
        jar.addEventListener("click", function () {
          jars.forEach(function (j) {
            j.classList.remove("is-selected");
            j.setAttribute("aria-checked", "false");
          });
          jar.classList.add("is-selected");
          jar.setAttribute("aria-checked", "true");
          slot.dataset.selectedVariantId = jar.dataset.variantId || "";
          slot.dataset.selectedHandle = jar.dataset.handle || "";
        });
      });
    });
  }

  function wireBundleSync(picker) {
    var bp = document.querySelector(".cqbp");
    if (!bp) return;
    bp.querySelectorAll(".cqbp__card").forEach(function (card) {
      card.addEventListener("click", function () {
        var t = parseInt(card.dataset.tier, 10) || 1;
        applyTier(picker, t);
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          var t = parseInt(card.dataset.tier, 10) || 1;
          setTimeout(function () { applyTier(picker, t); }, 0);
        }
      });
    });
  }

  // ── Submit interceptor ─────────────────────────────────────
  function getProductForm() {
    return document.querySelector('product-form form[action*="/cart/add"]')
        || document.querySelector('form[action*="/cart/add"]');
  }

  function getSellingPlanId(form) {
    if (!form) return "";
    var sp = form.querySelector('input[name="selling_plan"]');
    if (sp && sp.value) return sp.value;
    return "";
  }

  function getBundleTier(form) {
    if (!form) return 0;
    var el = form.querySelector('input[name="properties[_bundle_tier]"]');
    if (el && el.value) return parseInt(el.value, 10) || 0;
    return 0;
  }

  function collectSlotCounts(picker, tier) {
    var counts = Object.create(null);
    var slots = picker.querySelectorAll(".cqpfp__slot");
    slots.forEach(function (slot) {
      var slotNum = parseInt(slot.dataset.slot, 10) || 1;
      if (slotNum > tier) return;
      var vid = slot.dataset.selectedVariantId;
      if (!vid) return;
      counts[vid] = (counts[vid] || 0) + 1;
    });
    return counts;
  }

  function buildItemsPayload(counts, sellingPlanId, tier) {
    var items = [];
    Object.keys(counts).forEach(function (vid) {
      var item = {
        id: parseInt(vid, 10),
        quantity: counts[vid]
      };
      if (sellingPlanId) item.selling_plan = sellingPlanId;
      if (tier >= 2) item.properties = { _bundle_tier: String(tier) };
      items.push(item);
    });
    return items;
  }

  function refreshCart() {
    try {
      document.dispatchEvent(new CustomEvent("cart-drawer:refresh", { bubbles: true, composed: true }));
    } catch (e) {}
    if (typeof window.publish === "function" && window.PUB_SUB_EVENTS) {
      try {
        window.publish(window.PUB_SUB_EVENTS.cartUpdate, { source: "product-flavor-picker" });
      } catch (e) {}
    }
  }

  function openCartDrawer() {
    var drawer = document.querySelector("cart-drawer");
    if (!drawer) return;
    // Try known API first
    if (typeof drawer.open === "function") {
      try { drawer.open(); return; } catch (e) {}
    }
    // Fallback: toggle body class used by theme
    document.body.classList.add("page-overlay-cart-on");
    try { drawer.classList.remove("is-empty"); } catch (e) {}
  }

  function setButtonLoading(form, isLoading) {
    if (!form) return;
    var btn = form.querySelector('button[type="submit"][name="add"], .js-add-to-cart');
    var loader = form.querySelector(".loading-overlay__spinner");
    if (!btn) return;
    if (isLoading) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("loading");
      if (loader) loader.classList.remove("hidden");
    } else {
      btn.removeAttribute("aria-disabled");
      btn.classList.remove("loading");
      if (loader) loader.classList.add("hidden");
    }
  }

  function interceptSubmit() {
    if (window.__cqpfpInterceptInstalled) return;
    window.__cqpfpInterceptInstalled = true;
    document.addEventListener("submit", function (evt) {
      var form = evt.target;
      if (!form || !(form instanceof HTMLFormElement)) return;
      if (!form.matches('form[action*="/cart/add"]')) return;

      var picker = findPicker();
      if (!picker || picker.dataset.active !== "true") return;

      var tier = parseInt(picker.dataset.tier, 10) || 1;
      if (tier < 2) return;

      // Build counts and decide whether to intercept
      var counts = collectSlotCounts(picker, tier);
      var variantIds = Object.keys(counts);
      if (variantIds.length === 0) return;

      // Always intercept for tier >= 2 so flavor slots are respected.
      // Halt native product-form handler (which is attached on the form itself).
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      var sellingPlanId = getSellingPlanId(form);
      var items = buildItemsPayload(counts, sellingPlanId, tier);

      setButtonLoading(form, true);

      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: items })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j && j.description || "add failed"); });
          return r.json();
        })
        .then(function () {
          refreshCart();
          openCartDrawer();
        })
        .catch(function (err) {
          console.error("[cqpfp] add failed", err);
          // Fallback: submit the form natively so the user still gets feedback
          try { form.removeEventListener("submit", arguments.callee); } catch (e) {}
          try { form.submit(); } catch (e) {}
        })
        .finally(function () {
          setTimeout(function () { setButtonLoading(form, false); }, 200);
        });
    }, true); // capture phase — runs before product-form's handler
  }

  function init() {
    var picker = findPicker();
    if (!picker || picker.getAttribute("data-cqpfp-ready") === "1") return;
    picker.setAttribute("data-cqpfp-ready", "1");

    initSelections(picker);
    wireJarClicks(picker);
    wireBundleSync(picker);

    // Apply initial tier from bundle picker (default: 1)
    applyTier(picker, getActiveTierFromBundle());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      interceptSubmit();
    });
  } else {
    init();
    interceptSubmit();
  }
})();
