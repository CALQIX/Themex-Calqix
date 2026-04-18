# PREFLIGHT REPORT — Shopify Theme (CALQIX Repo)

Read-only audit. No files changed. Companion report: `calqix-capi/PREFLIGHT_REPORT.md`.

Date: 2026-04-18
Branch: `main`
Git status: clean except two untracked docs (`calqix-capi/docs/codebase-audit-for-claude.md`, `calqix-capi/envvars.tsv`)

---

## Critical correction to prompt v3 context

The prompt assumes an active GTM server container via TAGGRS at `sst.calqix.com` (`GTM-K4LPNF8L`). **This is no longer present.** TAGGRS was fully removed in the prior tracking overhaul. The live stack is:

- **Browser**: GTM web `GTM-T86BFXXW` (loaded in `layout/theme.liquid:27`) + `calqix-meta-bridge.js` (loaded in `layout/theme.liquid:320`).
- **Server**: `calqix-capi` Vercel webhook app (deployed at `https://calqix-capi.vercel.app`) sends Meta CAPI directly via `lib/meta-capi.js`.
- **No second server-side CAPI source exists.** `calqix-capi` is the canonical server source, not a legacy candidate for removal.

This reframes Task 9 entirely: dedup fix is between GTM web (browser pixel) and `calqix-capi` (server CAPI), not between GTM web and a GTM server container.

---

## Repo structure finding

`calqix-capi/` is a **subdirectory** of the theme repo, sharing the same git root. The prompt's suggested dual workflow (theme live, capi on `fix/meta-dedup-cleanup`) is not viable with one git repo. Proposed alternative: execute all changes on a single branch `fix/meta-dedup-v3`, or stay on `main` per the existing "work live" convention for the theme, depending on your preference.

---

## 1. Locale files

32 locale files present in `locales/`. The 8 customer-facing locales called out in v3 are all present:

- `en.default.json`, `nl.json`, `de.json`, `fr.json`, `fi.json`, `nb.json`, `sv.json`, `da.json` ✅

Additional installed locales (not all may be published in Shopify storefront): ar, bg-BG, cs, el, es, hr-HR, hu, id, it, ja, ko, lt-LT, pl, pt-BR, pt-PT, ro-RO, ru, sk-SK, sl-SI, th, tr, vi, zh-CN, zh-TW.

---

## 2. Author / Elena references

Legacy "Dr. Elena Hartwell" author identity and `calqix-elena-writes` blog handle still present:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\article.calqix-research.json:18` — `"author_name": "Dr. Elena Hartwell"` (seeded default)
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-blog-article.liquid:1144` — uses `section.settings.author_name | default: article.author`
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-blog-article.liquid:1304` — schema default `"Dr. Elena Hartwell"`
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\main-article.liquid:88` — uses `article.author` via `blogs.article.posted_by` locale key
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\article-card.liquid:57` — `{{ article.author }}`
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\index.json:377` — `"blog": "calqix-elena-writes"`
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\product.oralbiome.json:310` — CTA URL `shopify://blogs/calqix-elena-writes/...`

Scripts referencing `calqix-elena-writes` (admin tooling only, not rendered): `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\shopify-update-menu.js`, `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\shopify-create-article.js`, `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\shopify-fix-menu.js`, `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\shopify-add-crosslinks.js`.

## 3. Tracking tags in theme

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid`:

- Line 22-27: GTM web container `GTM-T86BFXXW` loaded in `<head>`.
- Line 215-217: GTM noscript iframe for `GTM-T86BFXXW`.
- Line 319-320: `calqix-meta-bridge.js` deferred script.
- No direct `fbq(` calls in theme.liquid.
- No direct `gtag(` calls in theme.liquid.
- No `sst.calqix.com` references anywhere in theme (TAGGRS fully removed, confirmed).

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-meta-bridge.js`: reads `_fbp`/`_fbc` cookies, syncs them to cart attributes `_meta_fbc`/`_meta_fbp` via `/cart/update.js`, exposes `window.calqixMeta.track()` helper with event_id wrapping, auto-identity capture, and `/api/add-to-cart` forwarding. 17 matches of the relevant tracking tokens in this one file.

Additional tracking surfaces found:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\oralbiome-video-reviews.liquid`: single `dataLayer`-related reference, verify relevance during implementation.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\shopify-custom-pixel.js`: Shopify Customer Events pixel script (server-only, no `fbq` calls).

## 4. Shopify Customer Events pixels & installed apps

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\config\settings_data.json`:

- No inline customer-events pixel code here (that lives in Shopify admin outside the repo).
- App block `shopify://apps/google-youtube/...` active at key `6159598353363395418` (Google & YouTube channel). Risk: the memory note warns this can auto-connect GA4 bypassing GTM server. Cannot determine from repo whether data sharing is active.

Admin-side items that cannot be inspected from the repo (operator to verify):

- Shopify admin > Settings > Customer events: which custom pixels are installed (e.g., the one defined in `calqix-capi/shopify-custom-pixel.js`)?
- Shopify admin > Sales channels > Facebook & Instagram > Settings > Data sharing: currently "Maximum" or "Standard"? Any Conversions API toggle on?
- Shopify admin > Sales channels > Google & YouTube: is GA4 connected directly?

## 5. Shopify CLI live theme

Not executed (requires interactive auth). Deferred to implementation phase. Command for operator:

```powershell
shopify theme list --store=calqix.myshopify.com
```

---

## Outstanding questions before implementation

1. **Single repo, branching strategy**: proceed on `main` per existing theme workflow, or create `fix/meta-dedup-v3` for all Task 9/10 work?
2. **Shopify F&I channel state**: confirm whether Data sharing is "Maximum" or "Standard" today, since that determines whether duplicate browser + server events are still coming from Shopify's native integration.
3. **Customer Events pixel install state**: is `calqix-capi/shopify-custom-pixel.js` currently installed in the admin? If yes, its server-only nature is part of the 58.79% problem and we need to add matching `fbq` calls to it. If no, we install it after adding those calls.
4. **8 vs 32 locales**: Task rules say "all 8 locale files for any customer-facing string." Do we touch only en/nl/de/fr/fi/nb/sv/da or also the broader set when customer-facing strings change? The prompt implies only the 8.

---

## Planned Task 9 revision (summary, not yet implemented)

- **9a**: confirmed only two sources (GTM web browser + `calqix-capi` server). No consolidation needed beyond disabling Shopify F&I automatic events.
- **9b**: deterministic event_ids already live on server (`ic_{token}`, `purchase_{token}`, `cart_{id}`, `lead_{customer_id}`). Fix is to make browser emit the same ids: update `calqix-capi/shopify-custom-pixel.js` to additionally call `fbq('track', 'Purchase', data, { eventID: 'purchase_' + token })` and `fbq('track', 'InitiateCheckout', data, { eventID: 'ic_' + token })`; ensure GTM web Meta Pixel tag reads `event_id` from dataLayer for ViewContent.
- **9c**: add `external_id` to browser dataLayer via `layout/theme.liquid` customer block + GTM web Meta Pixel Advanced Matching config.
- **9d**: `calqix-meta-bridge.js` already syncs `_fbp`/`_fbc` to cart attributes and `lib/webhook-utils.js` `extractMetaBrowserIds()` reads them. Server-side fbp at 0% means the chain is broken somewhere — investigate during implementation (likely cart attribute not populated before checkout, or webhook firing before browser has set cookies).
- **9e**: produce a GTM **web** container export (not server), plus revised operator instructions.
- **9f**: Shopify F&I disable still applies — biggest single lever. Validate current state first.
- **9g/9h/9i**: audit script + validation plan as specified.

## Planned Task 10 revision (summary)

- **10a**: add `await` to `isDuplicate()` at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js:80` — confirmed bug, low impact because endpoint is diagnostic-only.
- **10b**: `doPublish()` in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\publisher.js:179-193` is a live stub returning `{ ok: true }` without calling any API. It IS called at `:154`. Recommendation: keep stubbed but throw an explicit error until Meta Pages/IG API is implemented, or replace with a Predis publish call to match existing architecture.
- **10c**: `@anthropic-ai/sdk` is **NOT** in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\package.json` dependencies. Finding already resolved. Skip.
- **10d**: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\predis-callback.js` and `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhooks\predis-callback.js` both present. Consolidate to `api/webhooks/` (plural), redirect from singular.
- **10e**: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\bootstrap.js:192` configures optimizer cron as `0 7,9,11,13,15,17,19,21,23 * * *` = **9x/day**, not 3x/day. 23 schedules total. Prompt's claim of 3x/day in code is stale. No reconciliation needed — schedule is 9x/day per current code.
- **10f**: `calqix-capi` **IS** the active server-side Meta CAPI source and must be preserved. Not a legacy candidate for removal. Document in `META_CAPI_ROLE.md`.

---

Waiting for confirmation before any file edits.
