// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Smoke tests for calqix.com.
 * Verifies homepage loads, Meta Pixel fires, and PDP is reachable.
 */

test('homepage loads and has CALQIX title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CALQIX/i);
  await expect(page.locator('body')).toBeVisible();
});

test('Meta Pixel fires on homepage (PageView)', async ({ page }) => {
  /** @type {string[]} */
  const fbqCalls = [];
  /** @type {string[]} */
  const pixelRequests = [];

  await page.exposeFunction('__recordFbq', (/** @type {string} */ args) => {
    fbqCalls.push(args);
  });

  await page.addInitScript(() => {
    const origPush = Array.prototype.push;
    const hook = setInterval(() => {
      // @ts-ignore
      if (typeof window.fbq === 'function') {
        // @ts-ignore
        const orig = window.fbq;
        // @ts-ignore
        window.fbq = function hooked(...args) {
          // @ts-ignore
          window.__recordFbq(JSON.stringify(args));
          return orig.apply(this, args);
        };
        // @ts-ignore
        Object.assign(window.fbq, orig);
        clearInterval(hook);
      }
    }, 50);
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('facebook.com/tr') || url.includes('connect.facebook.net')) {
      pixelRequests.push(url);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('fbq calls:', fbqCalls);
  console.log('pixel requests:', pixelRequests.length);

  // At least one pixel-related request should fire on a CALQIX page.
  expect(pixelRequests.length).toBeGreaterThan(0);
});

test('PDP is reachable and has a cart-add button', async ({ page }) => {
  // Canonical PDP for the flagship SKU. Shopify locale routing rewrites this
  // to e.g. /nl/products/oralbiome-pro-verse-munt — both are valid.
  await page.goto('/products/oralbiome-pro-freshmint');

  // Accept any localized variant of the PDP URL
  await expect(page).toHaveURL(/\/products\//);

  // Theme renders the add-to-cart button as <button name="add" type="submit">
  // inside a form[action$="/cart/add"]. There's a second duplicate button in
  // the sticky buy-bar. Either must be visible.
  const addToCart = page.locator('button[name="add"]').first();
  await expect(addToCart).toBeVisible({ timeout: 15_000 });

  // And it must have the expected Dutch CTA copy
  await expect(addToCart).toHaveText(/winkelwagen|toevoegen|add to cart/i);
});
