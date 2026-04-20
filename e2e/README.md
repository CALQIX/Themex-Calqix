# CALQIX E2E (Playwright)

Browser automation layer for CALQIX. Lets Cascade **observe** the live Shopify
storefront, verify Meta Pixel / GTM / CAPI behavior end-to-end, reproduce bugs
with screenshots + traces, and run smoke tests against `calqix.com`.

Kept separate from `calqix-capi/` so Vercel deployments stay minimal.

## One-time setup

```powershell
cd e2e
npm install
npm run install-browsers
```

The second command downloads Chromium (~170MB) and its OS deps.

## Daily use

```powershell
# Headless smoke run (fast, CI-style)
npm test

# Watch the browser window (great for debugging or just seeing what Cascade is doing)
npm run test:headed

# Full UI with timeline, network, console
npm run test:ui

# Step through a test interactively
npm run test:debug

# Record a new test by clicking around calqix.com
npm run codegen

# Open the last HTML report (traces, videos, screenshots)
npm run report
```

## Targeting another environment

Default base URL is `https://calqix.com`. Override per-run:

```powershell
$env:E2E_BASE_URL = "https://calqix-staging.myshopify.com"; npm test
```

## What the smoke tests cover

See `tests/smoke.spec.js`:

1. Homepage loads with CALQIX in the title.
2. Meta Pixel fires PageView (network-level check on `facebook.com/tr`).
3. Product detail page `/products/oralbiome` renders and exposes an
   add-to-cart button.

Extend freely under `tests/` — `*.spec.js` is auto-discovered.

## Artifacts

On failure you get automatically:

- `test-results/**/trace.zip` — full Playwright trace (open with `npx playwright show-trace`)
- `test-results/**/*.png` — screenshot at the failure moment
- `test-results/**/*.webm` — video of the run
- `playwright-report/` — HTML report (open with `npm run report`)

All of these are git-ignored.
