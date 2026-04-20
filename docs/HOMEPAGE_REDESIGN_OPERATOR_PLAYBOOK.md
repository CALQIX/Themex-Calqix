# Homepage Redesign — Operator Playbook

Status: **Phase A + B code is in branch `fix/multi-locale-currency-20260420`.**
Last updated: 2026-04-20.

## Overview

Three commits on the feature branch:

- **`19f590a`** Phase A — flying-tooth cart animation (site-wide).
- **`2aaa97b`** Phase B1 — Rebuild Kit hero + Flavor banner + FlowCore hide toggle + EN locale.
- **`eeb9ce6`** Phase B2 — 32 locale translations (NL/DE/FR native; FI/NB/SV/DA best-effort; rest English fallback).

All three are additive. Nothing existing was renamed, deleted, or destructively rewritten.

## Step 1 — Deploy the theme

The repo uses a feature branch. Shopify only auto-syncs from `main` if GitHub integration is set up. Pick one:

### Option A: Merge the branch into `main`

```powershell
git checkout main
git merge fix/multi-locale-currency-20260420
git push origin main
```

If Shopify Theme ↔ GitHub integration is connected to `main`, the theme updates automatically within 1 minute.

### Option B: Push the theme directly via Shopify CLI

```powershell
shopify theme push --theme "Live" --only layout/theme.liquid --only assets/calqix-cart-animation.css --only assets/calqix-cart-animation.js --only sections/calqix-rebuild-kit-hero.liquid --only sections/calqix-flavor-banner.liquid --only sections/flowcore-banner.liquid --only locales
```

This pushes only the files changed by Phase A + B to the Live theme without merging the branch.

### Option C: Upload via Shopify Admin UI

Less recommended for multi-file changes. Skip unless the first two are blocked.

## Step 2 — Verify Phase A is live (should be immediate)

In any browser, visit `https://calqix.com` and:

1. Open DevTools → Network tab, refresh. Filter for `calqix-cart-animation`. Two requests expected:
   - `calqix-cart-animation.css`
   - `calqix-cart-animation.js`
2. Visit a product page, click **In winkelwagen**. Watch the header: a small gold-outlined tooth icon should arc from the button to the cart icon in ~1 second, then the cart counter bumps and the side drawer opens.
3. Automated verification via Playwright:

```powershell
cd e2e
npm test -- tests/homepage-redesign.spec.js
```

The three Phase A tests must pass. Phase B tests auto-skip until Step 3 is done.

## Step 3 — Place the new sections in Theme Editor

Shopify Admin → **Online Store → Themes → Live → Customize** → select **Home page** in the dropdown.

### 3a. Rebuild Kit Hero (new section)

1. Click **Add section** in the sidebar.
2. Find **Rebuild Kit Hero** under the CALQIX category.
3. Drag it to where you want it (recommended: top, above FlowCore Banner).
4. Configure:
   - **Stap 1 (FlowCore):** pick your FlowCore water flosser product (e.g. `calqix-flowcore`).
   - **Stap 2 (OralBiome Pro):** pick your default flavor (recommended: `oralbiome-pro-freshmint`).
   - **Bundle korting %:** 25 (default).
   - **Abonnement korting % (fallback):** 20, overridden automatically if the OralBiome Pro product has a Recharge selling plan.
   - **Achtergrond:** `#F7F4EC` (cream, default).
   - **Accent (goud):** `#C9A84C` (default).
5. Save.

### 3b. Flavor Banner (new section)

1. **Add section → Flavor Banner**. Drag below the Rebuild Kit hero.
2. Configure:
   - **Abonnement korting % (fallback):** 20.
3. Save.

The section auto-reads the 5 OralBiome Pro products from Shopify by handle. If any of the 5 handles don't exist, that chip is omitted automatically.

### 3c. Hide the legacy FlowCore Banner (optional)

Per your decision in the planning phase:

1. Scroll to the existing **FlowCore Banner** section.
2. Find **Zichtbaarheid → Verberg deze banner (behoud configuratie)**.
3. Check the box. All your existing settings remain intact; the section stops rendering.
4. Save.

You can re-enable it at any time by unchecking the box.

### 3d. Section order

Recommended final order on Home:

1. Rebuild Kit Hero *(new)*
2. Flavor Banner *(new)*
3. FlowCore Banner *(hidden via toggle, optional)*
4. Rich text + image
5. Featured collection
6. Benefits product
7. Video reels
8. Scrolling text banner
9. CALQIX science story
10. CALQIX tooth science
11. Blog posts
12. CALQIX reviews
13. Rich text

## Step 4 — Smoke test Phase B

After placing both sections, run:

```powershell
cd e2e
npm test -- tests/homepage-redesign.spec.js
```

All five tests should now pass (three Phase A + two Phase B).

Manually verify:

- **Rebuild Kit Hero:** the bundle price equals `FlowCore price + OralBiome Pro price − 25%`. Click **Voeg Rebuild Kit toe** → the cart drawer opens with both line items and the gold-outlined tooth flies to the cart icon.
- **Flavor Banner:** click each of the 5 chips → background gradient, tablet letters (FM/GR/PE/CO/CM), accent color, price, and description all update without a page reload. Click **Toevoegen aan winkelmand** → the selected flavor is added.

## Step 5 — Tracking verification

After a Rebuild Kit ATC on live:

1. Check Meta Events Manager → Test Events OR Events Manager timeline. Expect exactly **one** AddToCart event with `contents` containing both SKUs (FlowCore + OralBiome Pro variant ids) and `value` equal to the bundle price.
2. In Upstash Redis (or `calqix-capi` logs), confirm the `event_id` is `cart_{id}` with both SKUs merged in one event.

The Shopify `carts/create` webhook fires once per session with all `line_items`. Our server-side CAPI at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js` already handles this correctly without changes.

## Rollback

### Rollback the JS/CSS (Phase A)

1. Revert commit `19f590a` OR delete `@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-cart-animation.css` + `@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-cart-animation.js` + the 3-line insertion in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid:137-139`.

### Rollback the new sections (Phase B)

Two options:

- **Soft rollback (recommended):** in Theme Editor, delete the section from the homepage. The section file stays in the theme; you can re-add it later.
- **Hard rollback:** revert commits `2aaa97b` + `eeb9ce6`. Locale keys also disappear; any page still referencing them would break, but no other section does.

### Nuclear rollback

Shopify Admin → Themes → **Theme versions** → restore a snapshot from before the merge. Available for 30 days.

## Translation QA follow-ups

### Needs native review

- **fi.json, nb.json, sv.json, da.json** — `homepage_sections.*` keys are best-effort. Ask a native speaker to review the flavor descriptions (they are the subtlest copy). Flavor names (`Fresh Mint`, `Grape`, etc.) stay in English across all locales since they are product SKU identifiers.

### English fallback (acceptable for launch, replace over time)

- 22 locales: `ar, bg-BG, cs, el, es, hr-HR, hu, id, it, ja, ko, lt-LT, pl, pt-BR, pt-PT, ro-RO, ru, sk-SK, sl-SI, th, tr, vi, zh-CN, zh-TW` — all show English copy for the new sections. Shopify Admin → Settings → Languages → (locale) → **Translate** lets you replace keys one at a time without a code deploy.

### Re-running the locale propagator

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\add-homepage-sections-locales.js` is idempotent. If you add more primary-locale translations, add them to the script's `TRANSLATIONS` map and re-run:

```powershell
node scripts/add-homepage-sections-locales.js
git diff locales
```

Only the changed locale files will show up in the diff.

## Phase C (not started)

Five tasks from the original Claude prompt remain unbuilt per the review in
`@c:\Users\Gebruiker\Desktop\CALQIX Repo\docs\HOMEPAGE_REDESIGN_REVIEW.md`:

- Navy two-step protocol section.
- Interactive tooth anatomy section (possibly redundant with existing `calqix-tooth-science`).
- Before/after slider.
- Final CTA section.
- Announcement bar redesign.

These require a duplicate Shopify theme slot for staging. Tell me when you want to start Phase C and we will set that up first.
