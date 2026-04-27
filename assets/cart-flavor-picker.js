/* CALQIX Cart Flavor Picker
   - Expand/collapse with smooth max-height transitions
   - Per-slot selection tracking
   - Commits via /cart/change.js + /cart/add.js, then refreshes the drawer
   - Preserves selling plan (subscribe) and line item properties where possible
*/
(function () {
  "use strict";

  var INIT_ATTR = "data-cqfp-ready";
  var BODY_PROP = "_bundle_tier";

  function init(root) {
    if (!root || root.getAttribute(INIT_ATTR) === "1") return;
    root.setAttribute(INIT_ATTR, "1");

    // Toggle may live INSIDE root (legacy/full render) OR outside as a sibling
    // rendered inline in the cart item action row. In split-render mode the
    // toggle is paired to the panel by matching data-cqfp-pair-id.
    var toggle = root.querySelector(".cqfp__toggle");
    if (!toggle) {
      var pairId = root.dataset.cqfpPairId || root.dataset.lineIndex || "";
      if (pairId) {
        toggle = document.querySelector('.cqfp__toggle[data-cqfp-pair-id="' + pairId + '"]');
      }
    }
    var panel = root.querySelector(".cqfp__panel");
    if (!toggle || !panel) return;
    if (toggle.getAttribute(INIT_ATTR) === "1") return;
    toggle.setAttribute(INIT_ATTR, "1");

    var currentVariantId = String(root.dataset.currentVariantId || "");
    var lineKey = root.dataset.lineKey || "";
    var sellingPlanId = root.dataset.sellingPlanId || "";
    var qty = parseInt(root.dataset.quantity, 10) || 1;

    // Initial per-slot selection = current variant
    var slots = Array.prototype.slice.call(root.querySelectorAll(".cqfp__slot"));
    slots.forEach(function (slot) {
      slot.dataset.selectedVariantId = currentVariantId;
      slot.dataset.selectedHandle = root.dataset.currentHandle || "";
    });

    var cta = root.querySelector(".cqfp__cta");
    var updateBtn = root.querySelector(".cqfp__update");

    // ── Toggle expand ─────────────────────────────────────
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      if (open) collapse();
      else expand();
    });

    function expand() {
      panel.hidden = false;
      // force layout to get scrollHeight
      var h = panel.scrollHeight;
      panel.style.maxHeight = "0px";
      // next frame for transition
      requestAnimationFrame(function () {
        panel.style.maxHeight = h + "px";
        panel.setAttribute("data-open", "true");
        toggle.setAttribute("aria-expanded", "true");
      });
      // allow content to grow naturally after animation
      var cleanup = function (e) {
        if (e.propertyName !== "max-height") return;
        if (panel.getAttribute("data-open") === "true") {
          panel.style.maxHeight = "none";
        }
        panel.removeEventListener("transitionend", cleanup);
      };
      panel.addEventListener("transitionend", cleanup);
    }

    function collapse() {
      panel.style.maxHeight = panel.scrollHeight + "px";
      requestAnimationFrame(function () {
        panel.style.maxHeight = "0px";
        panel.removeAttribute("data-open");
        toggle.setAttribute("aria-expanded", "false");
      });
      var cleanup = function (e) {
        if (e.propertyName !== "max-height") return;
        panel.hidden = true;
        panel.removeEventListener("transitionend", cleanup);
      };
      panel.addEventListener("transitionend", cleanup);
    }

    // ── Jar selection per slot ────────────────────────────
    slots.forEach(function (slot) {
      var jars = Array.prototype.slice.call(slot.querySelectorAll(".cqfp__jar"));
      jars.forEach(function (jar) {
        jar.addEventListener("click", function () {
          jars.forEach(function (j) {
            j.classList.remove("is-selected", "is-pending");
            j.setAttribute("aria-checked", "false");
          });
          jar.classList.add("is-selected");
          jar.setAttribute("aria-checked", "true");

          slot.dataset.selectedVariantId = jar.dataset.variantId || "";
          slot.dataset.selectedHandle = jar.dataset.handle || "";

          // Pending marker if differs from original line handle
          if ((jar.dataset.handle || "") !== (root.dataset.currentHandle || "")) {
            jar.classList.add("is-pending");
          }

          updateCtaVisibility();

          // re-measure panel height
          if (panel.getAttribute("data-open") === "true") {
            panel.style.maxHeight = "none";
            var h = panel.scrollHeight;
            panel.style.maxHeight = h + "px";
            requestAnimationFrame(function () {
              panel.style.maxHeight = "none";
            });
          }
        });
      });
    });

    function buildTargetCounts() {
      var counts = Object.create(null);
      slots.forEach(function (slot) {
        var vid = slot.dataset.selectedVariantId;
        if (!vid) return;
        counts[vid] = (counts[vid] || 0) + 1;
      });
      // For extra quantity beyond visible slots (qty > 3), those extras stay on the original variant
      if (qty > slots.length && currentVariantId) {
        counts[currentVariantId] = (counts[currentVariantId] || 0) + (qty - slots.length);
      }
      return counts;
    }

    function hasPendingChange() {
      var counts = buildTargetCounts();
      var keys = Object.keys(counts);
      if (keys.length !== 1) return true;
      return keys[0] !== currentVariantId;
    }

    function updateCtaVisibility() {
      if (!cta || !updateBtn) return;
      if (hasPendingChange()) {
        cta.setAttribute("data-state", "ready");
        updateBtn.disabled = false;
      } else {
        cta.setAttribute("data-state", "idle");
        updateBtn.disabled = true;
      }
    }

    // ── Submit (commit changes) ───────────────────────────
    if (updateBtn) {
      updateBtn.addEventListener("click", function () {
        if (updateBtn.disabled) return;
        commitChanges().catch(function (err) {
          console.error("[cqfp] commit failed", err);
          cta.setAttribute("data-state", "ready");
          updateBtn.disabled = false;
        });
      });
    }

    async function commitChanges() {
      cta.setAttribute("data-state", "loading");
      updateBtn.disabled = true;

      var counts = buildTargetCounts();
      var currentTarget = counts[currentVariantId] || 0;
      // Other variants to add
      var otherEntries = Object.keys(counts)
        .filter(function (k) { return k !== currentVariantId; })
        .map(function (k) { return { id: parseInt(k, 10), quantity: counts[k] }; });

      // ── ORDER MATTERS ────────────────────────────────────────────────
      // Previously: change-down first, then add. That left a 1-frame
      // window where the cart could be empty when the customer was
      // swapping the only jar in their cart, occasionally causing the
      // cart drawer to render its empty-state and lose the close button.
      //
      // Fix: ADD the new flavour line(s) FIRST, then reduce the original
      // line. Cart is never empty during the swap, so the drawer markup
      // stays stable and the close button remains in the DOM.
      // ────────────────────────────────────────────────────────────────

      // 1) Add other flavor lines (if any)
      if (otherEntries.length > 0) {
        var addItems = otherEntries.map(function (entry) {
          var payload = { id: entry.id, quantity: entry.quantity };
          if (sellingPlanId) payload.selling_plan = sellingPlanId;
          return payload;
        });
        await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items: addItems })
        }).then(function (r) { if (!r.ok) throw new Error("add failed"); return r.json(); });
      }

      // 2) Reduce or keep the current line to currentTarget
      await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: lineKey, quantity: currentTarget })
      }).then(function (r) { if (!r.ok) throw new Error("change failed"); return r.json(); });

      // 3) Success feedback
      cta.setAttribute("data-state", "success");

      // 4) Refresh cart drawer to pull fresh state. A short delay lets
      //    the success animation breathe; the dispatched events are
      //    consumed by cart-drawer.js (refreshCartDrawer) and
      //    cx-cart-sync.js (counter mirror).
      setTimeout(function () {
        document.dispatchEvent(new CustomEvent("cart-drawer:refresh"));
        if (typeof window.publish === "function" && window.PUB_SUB_EVENTS) {
          try { window.publish(window.PUB_SUB_EVENTS.cartUpdate, { source: "cart-flavor-picker" }); } catch (e) {}
        }
      }, 420);
    }
  }

  function initAll(scope) {
    var root = scope || document;
    var pickers = root.querySelectorAll(".cqfp");
    pickers.forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { initAll(); });
  } else {
    initAll();
  }

  // Re-init after cart drawer re-renders
  document.addEventListener("cart-drawer:refresh", function () {
    setTimeout(function () { initAll(); }, 120);
  });
  if (typeof window.subscribe === "function" && window.PUB_SUB_EVENTS) {
    try {
      window.subscribe(window.PUB_SUB_EVENTS.cartUpdate, function () {
        setTimeout(function () { initAll(); }, 120);
      });
    } catch (e) {}
  }

  // MutationObserver fallback — reliably re-init if the drawer DOM is swapped
  var drawer = document.querySelector("cart-drawer");
  if (drawer && "MutationObserver" in window) {
    var mo = new MutationObserver(function () {
      if (drawer.querySelector(".cqfp:not([" + INIT_ATTR + "])")) {
        initAll(drawer);
      }
    });
    mo.observe(drawer, { childList: true, subtree: true });
  }
})();
