/*
 * CALQIX /cart -> product-page redirect (deferred half)
 *
 * Responsibilities:
 *   1. Remember the last product page the customer viewed this session, so
 *      the inline head script (snippets/cx-cart-redirect-head.liquid) has a
 *      destination to send /cart visitors back to.
 *   2. When a page loads with `?open_cart=1` in the URL (arrival state after
 *      the redirect), programmatically click the existing sidecart trigger
 *      so the drawer opens, then strip the query flag from the URL so it
 *      does not pollute subsequent links or analytics.
 *
 * Compatibility:
 *   - Matches all locale-prefixed URLs (`/en/products/foo`, `/de-DE/products/bar`).
 *   - Skipped inside Shopify theme editor (`Shopify.designMode`) so merchants
 *     can browse the cart template without it vanishing.
 *   - Relies on the sidecart trigger having class `.wt-cart__trigger`
 *     (see sections/page-header.liquid and cx-header.liquid).
 */
(function () {
  if (window.Shopify && window.Shopify.designMode) return;

  // --- 1. Remember current product page ---
  try {
    var path = location.pathname;
    var stripped = path.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '');
    if (stripped.indexOf('/products/') === 0) {
      sessionStorage.setItem('cx:lastProduct', path + location.search);
    }
  } catch (e) { /* storage unavailable (Safari private mode etc.) */ }

  // --- 2. Auto-open drawer if arrived with the flag ---
  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  if (params.get('open_cart') !== '1') return;

  // Clean the URL so the flag does not leak into analytics, share links or
  // the browser history for subsequent navigations.
  params.delete('open_cart');
  var cleanSearch = params.toString();
  var cleanUrl = location.pathname + (cleanSearch ? '?' + cleanSearch : '') + location.hash;
  try { history.replaceState(null, '', cleanUrl); } catch (e) {}

  var attempts = 0;
  var maxAttempts = 40; // ~4 seconds at 100 ms — covers slow custom element upgrade
  function tryOpen() {
    var trigger = document.querySelector('.wt-cart__trigger');
    if (trigger) {
      trigger.click();
      return;
    }
    if (attempts++ < maxAttempts) {
      setTimeout(tryOpen, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryOpen);
  } else {
    tryOpen();
  }
})();
