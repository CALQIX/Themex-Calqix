/*
 * CALQIX /cart -> last-viewed product + sidecart (deferred half)
 *
 * Responsibilities:
 *   1. On every page, remember the last product page the customer viewed this
 *      session in sessionStorage (`cx:lastProduct`) so the /cart route can
 *      return them to it. Locale-prefixed paths (/fr/products/...) are kept.
 *   2. When a page loads with `?open_cart=1` (arrival state after the redirect),
 *      programmatically click the existing sidecart trigger so the drawer
 *      opens, then strip the flag from the URL so it does not leak into
 *      analytics, share links or history.
 *
 * Compatibility:
 *   - The inline head snippet (cx-cart-redirect-head.liquid) owns the /cart
 *     redirect decision using Shopify's locale-aware routes + cart.item_count.
 *   - Skipped inside the Shopify theme editor (`Shopify.designMode`).
 *   - Relies on the sidecart trigger having class `.wt-cart__trigger`
 *     (see sections/page-header.liquid and cx-header.liquid).
 */
(function () {
  if (window.Shopify && window.Shopify.designMode) return;

  // 1. Remember the last product page viewed this session.
  try {
    if (location.pathname.indexOf('/products/') !== -1) {
      sessionStorage.setItem('cx:lastProduct', location.pathname);
    }
  } catch (e) {}

  // 2. Auto-open the drawer if we arrived with the flag.
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
  var maxAttempts = 40; // ~4 seconds at 100 ms; covers slow custom element upgrade
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
