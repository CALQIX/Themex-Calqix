// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright config for CALQIX live-site observation and smoke tests.
 *
 * Usage:
 *   npm run test             # headless Chromium smoke tests
 *   npm run test:headed      # visible browser so operator can watch
 *   npm run test:ui          # Playwright Test UI (timeline, watch mode)
 *   npm run test:debug       # step through with Playwright Inspector
 *   npm run codegen          # record actions on calqix.com to generate scripts
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://calqix.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    // Respect cookie consent: default to "accept all" via a localStorage flag
    // if the theme uses one; adjust per-test if needed.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
