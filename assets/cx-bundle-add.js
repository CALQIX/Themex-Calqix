/*
 * CALQIX — Bundle add-to-cart (progressive enhancement)
 *
 * Intercepts <form data-cx-bundle-add> submits, posts both items to
 * /cart/add.js in a single request, then opens the existing sidecart
 * drawer instead of letting Shopify redirect to /cart (which would
 * trigger a full-page reload back to the homepage via our
 * cx-cart-redirect-head snippet).
 *
 * No-JS visitors fall back to the native form POST.
 */
(function () {
  'use strict';

  function openSideCart() {
    // The header cart icon and the mobile cart button both carry
    // .wt-cart__trigger; cart-drawer.js binds click on these.
    var trigger = document.querySelector('.wt-cart__trigger');
    if (trigger) {
      trigger.click();
      return;
    }
    // Fallback: dispatch the open event directly. cart-drawer.js
    // listens for it via PUB_SUB_EVENTS, but only after a count
    // refresh; safe no-op if missing.
    document.dispatchEvent(new CustomEvent('cart-drawer-open'));
  }

  function refreshCart() {
    // Tell every cart-listening section to re-render. cart-drawer.js
    // exposes `cart-drawer:refresh` for explicit reloads after non-form
    // mutations; cart-update is the broader pubsub event.
    document.dispatchEvent(new CustomEvent('cart-drawer:refresh'));
    document.dispatchEvent(new CustomEvent('cart-update'));
  }

  function handleSubmit(form, event) {
    event.preventDefault();

    var btn = form.querySelector('button[type="submit"]');
    var originalLabel = btn ? btn.innerHTML : null;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }

    var fd = new FormData(form);
    fetch((window.routes && window.routes.cart_add_url) || '/cart/add', {
      method: 'POST',
      body: fd,
      headers: { 'Accept': 'application/javascript', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          // Shopify returns { status, message, description } on failure
          var msg = (result.data && (result.data.description || result.data.message)) || 'Add to cart failed';
          console.warn('[cx-bundle-add]', msg);
          return;
        }
        refreshCart();
        // Give cart-drawer.js a moment to refetch the cart-icon-bubble
        // section before triggering the open click; otherwise the
        // counter and items can lag a beat behind the slide-in.
        window.setTimeout(openSideCart, 60);
      })
      .catch(function (err) {
        console.warn('[cx-bundle-add] network error', err);
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
          if (originalLabel != null) btn.innerHTML = originalLabel;
        }
      });
  }

  function bind() {
    var forms = document.querySelectorAll('form[data-cx-bundle-add]');
    forms.forEach(function (form) {
      if (form.dataset.cxBundleBound === '1') return;
      form.dataset.cxBundleBound = '1';
      form.addEventListener('submit', function (e) { handleSubmit(form, e); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // Re-bind on Shopify section reload (Theme Editor)
  document.addEventListener('shopify:section:load', bind);
})();
