# Homepage Redesign — Review & Improved Plan

Status: **DRAFT, awaits operator decision before implementation.**
Date: 2026-04-20.
Author: Cascade, reviewing the Claude-generated Windsurf Implementation Prompt.

## TL;DR

The Claude prompt is directionally useful but **factually incorrect on the current
theme, destructive to existing Theme Editor configuration, and technically unsafe
in several places**. Implementing it as-written would delete live homepage state,
create duplicate cart logic, and introduce tracking gaps.

A safer, smaller plan is proposed below that delivers 80% of the visual intent with
20% of the risk, extended with a clear path to the remaining 20% once the foundation
is validated.

## 1. Facts on the ground (what the prompt gets wrong)

### 1.1 The theme is Wonder (Themex), not ROOT

Evidence:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\cart-drawer.liquid:86-90` uses the
  `<cart-drawer>` custom element with `data-toggle-tabindex` — pure Wonder pattern.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\page-header.liquid:540` uses the
  `<page-header>` custom element.
- Class prefix `wt-*` (Wonder Theme) everywhere: `wt-cart__drawer`, `wt-header__panel`,
  `wt-product__add-to-cart_form`, `wt-video__movie`.
- Snippet `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\hero.liquid` is Wonder's
  fully-fledged hero, not a generic ROOT hero.

**Impact on the prompt:** every "find header section / find cart drawer" step assumes
Dawn-style conventions. Wonder has different lifecycle hooks, different event names
(`cart:open`, `cart:refresh`), and requires extending the existing custom elements,
not adding a sibling implementation.

### 1.2 The existing homepage already contains most of the prompt's "new" sections

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\index.json:556-569` order:

1. `flowcore-banner` (current hero — prompt wants to replace it).
2. `rich-text-with-image`.
3. `featured-collection`.
4. `benefits-product`.
5. `video-reels`.
6. `scrolling-text-banner`.
7. `calqix-science-story`.
8. `calqix-tooth-science` (**prompt task 6 duplicates this**).
9. `blog-posts`.
10. `calqix-reviews` (**prompt task 8 adds a second reviews section — duplicate**).
11. `rich-text`.
12. (one anonymous section).

And infrastructure already in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\`:

- `calqix-bundle-picker.liquid` — the prompt's "Rebuild Kit" concept is already a
  working tiered picker with Recharge-aware subscription math. See
  `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\calqix-bundle-picker.liquid:27-40`.
- `cart-flavor-picker.liquid` — flavor picking already exists inside the cart drawer.
- `calqix-subscribe-widget.liquid` — Recharge widget already wired.

**Impact:** wholesale replacement of `templates/index.json` (prompt task 8a) would
**wipe all existing Theme Editor-configured copy, imagery, colors, and pill text**
in `flowcore_banner_CUKft3` and 10 other configured sections. This is irreversible
outside the 30-day Theme Version rollback window.

### 1.3 Locale namespace collision

The prompt uses `homepage.hero.*`, `homepage.flavor.*`, etc. But
`@c:\Users\Gebruiker\Desktop\CALQIX Repo\locales\en.default.json:11` already defines
`"homepage": "Home"` as a top-level string (the nav label "Home"). Redefining it as
an object breaks that string everywhere it is used.

**Fix:** use `homepage_sections.*` or `pages.home.*` as the namespace, keep
`homepage` as the leaf string.

### 1.4 Cart icon IDs already exist

The prompt wants to add `#calqix-cart-target` and `#calqix-cart-count`. But Wonder's
header at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\page-header.liquid:518-530`
already exposes:

- `#cart-icon-bubble` — the wrapping link.
- `.wt-header__panel__counter` — the numeric badge, rendered only when
  `cart.item_count != 0` (an important UX detail the prompt drops: showing "0" is
  visually heavier than hiding the badge).

**Fix:** animate the existing elements. No new IDs. The flying-tooth animation only
needs `getBoundingClientRect()` on `#cart-icon-bubble`.

### 1.5 "Work on the live theme" conflicts with the stated risk

Wonder stores **every block setting as a schema id** — removing or renaming any
setting id wipes that setting from the admin. The prompt's
"replace FlowCore hero with Rebuild Kit hero" would lose the live Midnight Black /
Blush Pink / Lime Green / Clinical White product imagery and pill copy configured
at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\index.json:12-44`.

**Fix:** redesign in a **duplicated theme** named `CALQIX Homepage v2` in Shopify
Admin, iterate there, then merge to live in one go after operator approval. The
AGENTS.md guardrail "NEVER change section schema setting ids once they exist" is
reinforced by Wonder's architecture.

### 1.6 Bundle ATC tracking gap

The prompt's "Add Rebuild Kit to cart" posts two line items in one request. Meta
Pixel's Custom Pixel sees two `AddToCart` events (one per line item). The
flying-tooth animation fires once. Result:

- Meta receives 2× AddToCart. Our CAPI (`@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js`)
  also fires 2× AddToCart via the carts/create webhook.
- Deduplication relies on `event_id = cart_{id}` — but both AddToCart events share
  the same cart id, which will cause the **second** event to be deduplicated by Meta,
  not the first. This silently **under-reports** Rebuild Kit ATCs by 50%.

**Fix:** either (a) emit a single `AddToCart` with `contents` array containing both
SKUs and a bundled value, or (b) use distinct event ids
`cart_{id}_{line_item_key}` and accept 2 AddToCarts (cleaner per-SKU analytics).
Decision needed before build.

### 1.7 Subscription pricing claim is unverified

The prompt shows "Subscribe and save 20% more" as a CTA. Recharge's configured
discount may not be 20% for every SKU. Hardcoding 20% in Liquid/locales is fragile.

**Fix:** read the discount from `product.selling_plan_groups[0].selling_plans[0].price_adjustments[0]`
as already done in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\calqix-bundle-picker.liquid:29-40`.
No hardcoded percentage in locale files.

### 1.8 "All 8 locales" undersells the repo

The repo has 30+ locale JSONs. The 8 product-facing locales
(`en, nl, de, fr, fi, nb, sv, da`) are correct as the translation target, but
auxiliary locales (es, it, pt-PT, pl, …) still need at minimum an English fallback
or they will display raw keys like `homepage_sections.hero.heading` to shoppers in
those markets.

**Fix:** add the new keys to `en.default.json` first, then to all 30 locale files,
using English as the fallback for the 22 non-primary locales. Shopify's translation
UI can later replace the English strings per-locale if you expand market reach.

### 1.9 Accessibility gap in flavor banner

The prompt lists a11y for the tooth section but not for the flavor chips.
`role="tab"` + `aria-selected` + arrow-key navigation are needed; a flavor change
must also announce via `aria-live="polite"` so screen readers hear "Freshmint
selected, tablet changed."

### 1.10 Performance / LCP risk

A 100% new homepage with 5 flavor hero images, a before/after slider, an
interactive tooth SVG, and an animated navy protocol section pushes well past
Shopify's recommended 2.5s LCP target on mobile. The prompt never sets a budget.

**Fix:**

- Hero image `loading="eager"` with `fetchpriority="high"`, width/height attrs,
  AVIF + WebP fallback via Shopify `image_url` filters.
- Flavor gradient via CSS (already proposed) — but the 5 background colors must be
  pre-rendered, not JS-computed, or CLS will spike.
- Tooth SVG inline in the Liquid template, not fetched as an asset.
- Flying-tooth JS loaded `defer` (already in prompt).
- Before/after slider images `loading="lazy"`, `decoding="async"`.

### 1.11 Markdown/editorial issues in the prompt itself

The prompt uses em dashes (`—`) in at least 40 places despite its own
"No em dashes" rule. Copy delivered to production must be cleaned of em dashes.
Several Finnish and Danish translations in the prompt read as literal English
transcription (e.g. "Rebuild Kit" stays untranslated). Translations need a
native-speaker QA pass, or a clinical-tone LLM pass with source-language
constraint.

## 2. Improved plan — three phases

### Phase A — Safe foundation (ship this first)

Goal: deliver the flying-tooth + cart-bump + auto-opening drawer on the **existing**
theme state without touching any section markup or Theme Editor configuration.

- **A1.** Flying-tooth global animation wired to the existing
  `#cart-icon-bubble` and `.wt-header__panel__counter` targets. New assets:
  `@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-cart-animation.css` +
  `@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-cart-animation.js`. Loaded in
  `@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid` before `</head>`.
- **A2.** Auto-open the existing `<cart-drawer>` on any successful `/cart/add` (listen
  for Wonder's `cart:update` event or patch `PUB_SUB_EVENTS.cartUpdate` handler).
- **A3.** No locale changes required — Wonder already translates cart drawer strings.
- **Tracking invariant:** every existing AddToCart, InitiateCheckout, Purchase event
  continues to fire with the same event_id format. No CAPI impact.

Commit size: 3 files, ~200 LoC. Risk: **low**. Reversible: delete the 3 files.

### Phase B — Additive hero + flavor banner (ship after Phase A validated on live)

Goal: **add** (not replace) two new opt-in sections that the operator can toggle in
Theme Editor.

- **B1.** New section `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-rebuild-kit-hero.liquid`
  with schema settings for headline, 2 product references, bundle discount display,
  and ATC wiring using the already-existing `snippets/calqix-bundle-picker.liquid`
  for the price math. Decision needed: single AddToCart event with `contents[]` array
  **OR** two distinct ATC events with suffixed event ids.
- **B2.** New section `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-flavor-banner.liquid`
  that picks up the 5 OralBiome Pro products via schema product references, not hard-coded.
  Flavor switching via CSS custom properties, no JS layout-shift.
- **B3.** Add locale namespace `homepage_sections.rebuild_kit.*` and
  `homepage_sections.flavor_banner.*` across all 30 locale files (English fallback
  for non-primary ones).
- **B4.** The operator places these sections in Theme Editor; FlowCore banner stays
  until operator explicitly drags it off.

Commit size: ~8 files, ~1500 LoC, 200+ locale keys. Risk: **medium**, mitigated by
the additive approach. Reversible: remove the section from Theme Editor.

### Phase C — Full redesign (only if Phase A + B succeed and metrics improve)

Goal: the remaining 5 tasks from the Claude prompt, executed **on a duplicate theme**,
merged to live only after on-staging QA.

- **C1.** Duplicate `Live` theme in Shopify Admin to `Live v2`. Implement on `v2`.
- **C2.** Navy two-step protocol section (additive, or replacing `calqix-science-story`
  if operator confirms).
- **C3.** Interactive tooth section — **verify** it genuinely beats the existing
  `calqix-tooth-science` before replacing.
- **C4.** Before/after slider with real imagery (or fallback SVG with explicit
  disclaimer text approved by operator).
- **C5.** Final CTA + announcement bar review.
- **C6.** Remove deprecated sections from `templates/index.json` **only after** the
  operator confirms in Theme Editor preview on `Live v2`.
- **C7.** Publish `Live v2` during a low-traffic window. Keep old `Live` theme for
  30 days as rollback.

Commit size: large. Risk: **high** without staging. Risk: **low** with the
duplicate-theme approach.

## 3. Tracking & CAPI impact matrix

| Action | Pixel event | CAPI event | event_id format | Change vs today |
|---|---|---|---|---|
| Single-product ATC on PDP | AddToCart | AddToCart (carts/create webhook) | `cart_{id}` | none |
| Rebuild Kit ATC (2 SKUs) | 2× AddToCart | 2× AddToCart | needs change, see 1.6 | **breaking change** |
| Flavor-banner ATC | AddToCart | AddToCart | `cart_{id}` | none |
| Cart drawer opens after ATC | none | none | none | none |
| Cart-drawer re-fetch via /cart.js | none | none | none | none |

Action: before Phase B ships, pick the event_id strategy for bundles and document
it in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\META_CAPI_ROLE.md`.

## 4. Translation approach

- **Source of truth:** `@c:\Users\Gebruiker\Desktop\CALQIX Repo\locales\en.default.json`.
- **Primary markets:** `en, nl, de, fr, fi, nb, sv, da` — these get human-quality
  translations generated per the brand voice rules (clinical, evidence-based, no
  em dashes, no "groundbreaking"/"revolutionary" hype).
- **Secondary locales (22 files):** mirror English until native speakers or
  Shopify Markets Translate kicks in. Shopify never shows a broken key if the
  English fallback is present.
- **All translations reviewed** against the brand voice checklist before commit:
  1. No em dash (`—` or `–`).
  2. No superlatives without citation.
  3. "Nano-hydroxyapatite" stays untranslated (it is the scientific INN).
  4. Prices localized per Shopify Markets config, not hardcoded.

## 5. Open questions before any implementation starts

These are blocking. One-line answer each is fine.

1. **Scope choice:** Phase A only, Phase A+B, or all three phases?
2. **Staging theme:** if Phase C is in scope, do you have a duplicate theme slot
   available in Shopify Admin, or should we request one?
3. **Bundle ATC event strategy:** one combined AddToCart with `contents[]`, or two
   distinct AddToCarts with unique event ids per SKU?
4. **Rebuild Kit product structure:** does a combined "Rebuild Kit" SKU exist in
   Shopify, or do we post two line items in one `/cart/add` call?
5. **Flavor banner data source:** do we hardcode the 5 OralBiome Pro product handles
   in the section schema, or make them dynamic product references so you can swap
   products in Theme Editor without re-deploying?
6. **Recharge subscription discount:** confirm the actual percentage configured per
   SKU so we don't hardcode 20%.
7. **FlowCore hero fate:** keep, hide, or remove? If hide, behind a theme setting
   toggle or by operator dragging it off in Theme Editor?
8. **Before/after imagery:** can you supply real assets, or do we ship the
   illustrative SVG with the disclaimer?

## 6. What I will NOT do until answers are in

- Modify `templates/index.json` in any way.
- Change the schema of an existing section.
- Rename or remove any existing locale key.
- Ship bundle ATC wiring before the event_id strategy is decided.
- Translate 200+ keys before the scope is locked.

## 7. What I CAN do immediately with no downside

If you want a concrete first step today without deciding on scope yet, Phase A1
(the flying-tooth animation on the existing cart icon) is purely additive, reversible,
and touches zero schema. It is a 3-file, ~200-line commit. Say the word and it ships.
