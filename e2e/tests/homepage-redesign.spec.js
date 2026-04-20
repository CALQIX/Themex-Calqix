// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Verification suite for the Phase A + B homepage redesign.
 *
 * Phase A (flying-tooth cart animation) tests run against any page, so they
 * pass as soon as the theme is deployed.
 *
 * Phase B (Rebuild Kit hero, Flavor banner) tests only pass after the operator
 * drags those sections onto the homepage in Theme Editor. Until then they are
 * skipped automatically so the suite stays green.
 */

// ----------------------------------------------------------------
// Phase A — flying-tooth animation infrastructure
// ----------------------------------------------------------------

test('Phase A: cart-animation CSS + JS are loaded site-wide', async ({ page }) => {
  const assetsLoaded = { css: false, js: false };

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('calqix-cart-animation.css')) assetsLoaded.css = true;
    if (url.includes('calqix-cart-animation.js')) assetsLoaded.js = true;
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(assetsLoaded.css, 'calqix-cart-animation.css must be requested').toBe(true);
  expect(assetsLoaded.js, 'calqix-cart-animation.js must be requested').toBe(true);
});

test('Phase A: cart icon target #cart-icon-bubble exists in header', async ({ page }) => {
  await page.goto('/');
  const cartTarget = page.locator('#cart-icon-bubble').first();
  await expect(cartTarget).toBeAttached({ timeout: 10_000 });
});

test('Phase A: flying-tooth element is injected after ATC click', async ({ page }) => {
  // Decline cookie consent if present, to avoid click interception
  await page.goto('/products/oralbiome-pro-freshmint');
  await page.waitForLoadState('networkidle');

  // Accept or dismiss Shopify privacy banner if visible
  const decline = page.locator('#shopify-pc__banner__btn-decline');
  if (await decline.isVisible().catch(() => false)) {
    await decline.click().catch(() => {});
  }

  const addBtn = page.locator('button[name="add"]').first();
  await expect(addBtn).toBeVisible({ timeout: 15_000 });

  // Trigger ATC; don't wait for full cart state, just fire the click
  await addBtn.click().catch(() => {});

  // The flying tooth div is appended to body on first ATC.
  // Allow up to 3s for Wonder's cartUpdate event to fire + our subscriber.
  const tooth = page.locator('.calqix-flying-tooth');
  await expect(tooth).toBeAttached({ timeout: 3000 });
});

// ----------------------------------------------------------------
// Phase B — new sections (conditional; only runs if operator has placed them)
// ----------------------------------------------------------------

test('Phase B: Rebuild Kit hero renders if placed on homepage', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const heroCount = await page.locator('.calqix-rebuild-kit-hero').count();
  test.skip(heroCount === 0, 'Rebuild Kit hero not placed on homepage yet — skipping.');

  const hero = page.locator('.calqix-rebuild-kit-hero').first();
  await expect(hero.locator('[data-cq-rk-atc]').first()).toBeVisible();
  await expect(hero.locator('.cq-rk__items__row')).toHaveCount(2);
  await expect(hero.locator('.cq-rk__price__current')).toBeVisible();
});

test('Phase B: Flavor banner renders + chip selection switches accent', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const bannerCount = await page.locator('.calqix-flavor-banner').count();
  test.skip(bannerCount === 0, 'Flavor banner not placed on homepage yet — skipping.');

  const banner = page.locator('.calqix-flavor-banner').first();
  const chips = banner.locator('[data-cq-fb-chip]');
  const chipCount = await chips.count();
  expect(chipCount).toBeGreaterThan(0);

  // First chip is selected by default
  await expect(chips.nth(0)).toHaveAttribute('aria-selected', 'true');

  // Click second chip (if it exists), accent color should change
  if (chipCount >= 2) {
    const before = await banner.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--fb-accent'),
    );
    await chips.nth(1).click();
    await page.waitForTimeout(400);
    const after = await banner.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--fb-accent'),
    );
    expect(after.trim()).not.toBe(before.trim());
    await expect(chips.nth(1)).toHaveAttribute('aria-selected', 'true');
  }
});
