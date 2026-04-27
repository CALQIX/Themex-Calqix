/*
 * CALQIX cart drawer addons — mobile collapsible toggle
 * ──────────────────────────────────────────────────────
 * Standalone asset because the inline <script> inside
 * snippets/cart-addons.liquid never re-executes when Shopify's section
 * refresh injects fresh markup via innerHTML. Binding once at the
 * document level here means the handler survives every drawer re-render
 * (cart-drawer:refresh, cartUpdate, etc.) without needing to re-attach.
 */
(function () {
  "use strict";
  if (window.__cqCartAddonsCollapsibleBoundV1) return;
  window.__cqCartAddonsCollapsibleBoundV1 = true;

  document.addEventListener(
    "click",
    function (e) {
      var trigger =
        e.target && e.target.closest && e.target.closest(".wt-cart__addons__trigger");
      if (!trigger) return;
      var wrap = trigger.closest(".wt-cart__addons--collapsible");
      if (!wrap) return;
      var isExpanded = wrap.classList.toggle("wt-cart__addons--expanded");
      trigger.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    },
    false
  );
})();
