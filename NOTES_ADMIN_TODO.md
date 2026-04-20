# Admin operator todos — Meta CAPI dedup fix v3

Repo-side changes land automatically via commits. The following items require human action in Shopify admin, Meta Business admin, and Google Tag Manager. Execute in order for best effect.

Baseline (Meta Events Manager, 18 April 2026): total dedup coverage 58.79%, Event ID coverage 58.79% (with 100% on both sides), External ID 0% on browser, FBP 0% on server. Target after these steps: ≥95% total coverage within 48 hours.

---

## 1. Shopify Facebook & Instagram channel — disable automatic events

**This is the single biggest lever.** Confirmed state: F&I channel on "Maximum" data sharing, so the native integration is firing browser Commerce Pixel events AND server CAPI events with random event_ids that never match our deterministic `ic_{token}` / `purchase_{token}`. That is the primary cause of the 58.79% dedup coverage. Disable these automatic events without uninstalling the app (catalog sync must remain for Advantage+).

Steps:

1. Shopify admin → Sales channels → **Facebook & Instagram (Meta)**.
2. Open channel settings (gear icon) → **Data sharing**.
3. Change from **Maximum** to **Standard**. Save.
   - Standard keeps catalog sync alive (required for Advantage+ shopping and dynamic ads).
   - Standard disables the automatic Commerce Pixel + automatic CAPI event firing.
4. Shopify admin → Settings → **Customer events**. Review the app pixel list.
   - Confirm **CALQIX Meta CAPI** (our Custom Pixel from `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\shopify-custom-pixel.js`) is present and connected.
   - If any other Facebook/Meta app pixel is listed and firing pixel events, disconnect it or scope it to catalog-sync only.
5. Wait 60 minutes, then open Meta Events Manager → Overview. Each event should now show exactly one browser source (GTM web / Custom Pixel) and one server source (calqix-capi) instead of the current mixed flows.

Success signal: in the 24-hour trailing view, Purchase and InitiateCheckout switch from "Browser + Server (mismatched ids)" to clean single-source or matched dedup pairs.

---

## 2. Shopify Custom Pixel — install (currently NOT INSTALLED — confirmed 2026-04-19)

Admin API verification on 2026-04-19 showed `webPixel` returns `RESOURCE_NOT_FOUND`: no CALQIX Custom Pixel is registered. The server-side tracking chain depends on this pixel to fire `InitiateCheckout` and `Purchase` events from the thank-you page. **This is a material gap.**

Pixel source ready at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\shopify-custom-pixel.for-admin.js` (mirror of `calqix-capi/shopify-custom-pixel.js` after [task-9c] enhancements: `external_id` + shipping address fields in the server payload).

Steps to install:

1. Shopify admin → Settings → **Customer events** → **Add custom pixel**.
2. Name: **CALQIX Meta CAPI**.
3. Paste the full contents of `scripts/shopify-custom-pixel.for-admin.js`.
4. Save, then **Connect**.
5. Customer privacy: set to **Customer Privacy API** so GDPR consent is respected.
6. Verify in Meta Events Manager → Test events by opening a fresh incognito checkout flow and confirming Purchase + InitiateCheckout arrive with `external_id` and `fbp` populated.

This single action closes the primary reason baseline dedup coverage sits at 58.79% — there are currently no paired browser events for Purchase / InitiateCheckout.

---

## 3. GTM web container (`GTM-T86BFXXW`) — Meta Pixel tag config

The theme now pushes customer identity to dataLayer via `calqix_user_data` event. GTM needs variables + Meta Pixel tag config to forward them.

### 3a. Create dataLayer variables — DONE 2026-04-19 10:00 AMS

Operator created all 9 DLVs in GTM workspace `GTM-T86BFXXW`:

| Variable name | Data Layer Variable Name | Version | Status |
|---|---|---|---|
| `DLV - user_data.external_id` | `user_data.external_id` | 2 | [x] |
| `DLV - user_data.em` | `user_data.em` | 2 | [x] |
| `DLV - user_data.ph` | `user_data.ph` | 2 | [x] |
| `DLV - user_data.fn` | `user_data.fn` | 2 | [x] |
| `DLV - user_data.ln` | `user_data.ln` | 2 | [x] |
| `DLV - user_data.ct` | `user_data.ct` | 2 | [x] |
| `DLV - user_data.st` | `user_data.st` | 2 | [x] |
| `DLV - user_data.zp` | `user_data.zp` | 2 | [x] |
| `DLV - user_data.country` | `user_data.country` | 2 | [x] |

### 3b. Meta Pixel tag — enable Advanced Matching

Open every Meta Pixel tag in the workspace (PageView, ViewContent, AddToCart, InitiateCheckout, Purchase) and configure as follows:

1. **Advanced Matching**: enabled.
2. Map each field to the matching DLV variable:
   - `external_id` → `{{DLV - user_data.external_id}}`
   - `em` → `{{DLV - user_data.em}}`
   - `ph` → `{{DLV - user_data.ph}}`
   - `fn` → `{{DLV - user_data.fn}}`
   - `ln` → `{{DLV - user_data.ln}}`
   - `ct` → `{{DLV - user_data.ct}}`
   - `st` → `{{DLV - user_data.st}}`
   - `zp` → `{{DLV - user_data.zp}}`
   - `country` → `{{DLV - user_data.country}}`
3. **Event ID** field: set to `{{DLV - event_id}}` (create if missing: `event_id`). This is the dedup key for ViewContent — AddToCart + InitiateCheckout + Purchase dedup is handled by the Custom Pixel / bridge path.

### 3c. Trigger review

Ensure the Meta Pixel tag for PageView fires on `Initialization - All Pages` or `DOM Ready`. The `calqix_user_data` dataLayer push happens in `<head>` synchronously for logged-in customers, so Advanced Matching variables are populated before any tag fires.

### 3d. Publish

Use GTM Preview mode first. Fire a test event on the live site (product page view) and inspect the Meta Pixel tag output:

- `user_data.external_id` present (logged-in customer id, or `cq_*` anon id for guests).
- `em`, `ph`, `fn`, `ln`, `ct`, `st`, `zp`, `country` present when customer is logged in.

Open Meta Events Manager → Test events and confirm EMQ ≥ 9 for the test event. If healthy, publish the GTM workspace.

---

## 4. Meta Business admin — cleanup

1. Meta Events Manager → Data Sources → select pixel 934134615770602.
2. **Overview** tab: confirm "Connected via Shopify" warning disappears 24-48 hours after step 1 is complete.
3. **Settings** tab → **Automatic Advanced Matching**: enable if not already on. It is additive with our explicit Advanced Matching and harmless.
4. **Aggregated Event Measurement**: leave unchanged, CALQIX is iOS 14.5+ ready via the existing pixel setup.
5. **Test events** tab: fire a real Purchase in incognito, confirm it appears within 2 minutes on both Browser and Server sources with a matched deduplication key.

---

## 5. Verification timeline

Run these checks at the specified intervals after completing steps 1-4.

- **0-60 min**: GTM Preview + Meta Test events. Event ID, external_id, fbp all present, EMQ ≥ 9.
- **Hour 1**: Real purchase in incognito. Events Manager → Overview shows matched Purchase within 2 min.
- **Hour 24**: `node scripts/meta-audit.js` (see `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\meta-audit.js` once Task 9g lands). Compare to baseline. Expect coverage ≥ 75%.
- **Hour 48**: Repeat audit. Expect ≥ 95% total dedup coverage, Shopify orders vs Meta Purchase delta ≤ 5%.
- **Day 7**: Screenshot Events Manager → Deduplication tab and share for review.

---

## 6. Rollback steps (if coverage drops instead of rising)

1. Shopify admin → Sales channels → F&I → Data sharing → revert **Standard** → **Maximum**. This restores the prior state in 10-15 minutes.
2. In GTM, revert the workspace to the last published version before the Advanced Matching changes.
3. In Shopify admin → Customer events, the new Custom Pixel code can be reverted by pasting the previous version from git history (use `git show HEAD~1:calqix-capi/shopify-custom-pixel.js`).

---

## 7. Known-good Pixel + IDs (do not change)

- Meta Pixel ID: **934134615770602** (Calqix's pixel — confirmed across Shopify F&I, Meta Ads Manager, Meta Business Settings).
- Facebook Domain Verification meta tag: `f7p7bqwsuigx7z20hp4iyrovcncwqh` (present in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid:63`).
- GTM Web Container: `GTM-T86BFXXW`.
- calqix-capi deploy: `https://calqix-capi.vercel.app`.

Do not introduce any other Meta Pixel ID. The previously referenced `1400881244790983` is NOT the correct pixel for CALQIX.

---

Task 9 admin checklist ends here. Task 10 admin items (e.g., Predis webhook URL check) will append below when those commits land.

---

# Task 1 admin actions — Elena persona removal

Code changes (byline locale keys, schema defaults, template defaults) are live in commit `[task-1]`. The following admin actions finish the removal so visitors never see "Elena Hartwell" again.

## Blog and author rename — DONE via Admin API on 2026-04-19 09:10 AMS (see `@c:\Users\Gebruiker\Desktop\CALQIX Repo\reports\task1-admin-rollout.md`)

- [x] URL redirect `/blogs/calqix-elena-writes` -> `/blogs/the-science-journal` created (`gid://shopify/UrlRedirect/887672045897`).
- [x] Blog renamed: handle `calqix-elena-writes` -> `the-science-journal`, title -> "The Science Journal".
- [x] Main menu item "Elena writes" -> "Science Journal"; all 5 subitem URLs auto-migrated because they are linked by `resourceId`.
- [x] Article "Nano-Hydroxyapatite: The Fluoride Alternative..." author rewritten: "Dr. Elena Hartwell" -> "CALQIX Science Team".
- [x] Template references updated in commit `9564500` (`templates/index.json`, `templates/product.oralbiome.json`).
- [x] Article bodies scanned — no "Elena" mentions in body text. Body dump at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\reports\task1-article-body-for-review.html` for double-check.

Still required by the operator (API cannot automate):

- [ ] Settings > Users: rename the Shopify staff user "Elena Hartwell" to "CALQIX Science Team" (Shopify has no staff-management API). Update email to `info@calqix.com` if appropriate.
- [x] Blog title translations registered via `translationsRegister` mutation for all 7 non-EN published locales (NL/DE/FR/FI/NB/SV/DA).
- [x] Menu link title translations registered via `translationsRegister` for `gid://shopify/Link/746921230665` across the same 7 locales.
- [ ] `@c:\Users\Gebruiker\Desktop\CALQIX Repo\redirects.csv` is now redundant (the redirect was created via API). Safe to delete, or leave as a historic artefact.

## Judge.me cleanup (same session) — SKIPPED by operator 2026-04-19

Operator decision: Judge.me review cleanup is deferred. Re-visit once more verified-buyer reviews accumulate organically. Leaving the current state as-is is acceptable because the review widget already renders only published reviews, and any pre-launch reviews are low-volume.

- [~] Judge.me admin > Reviews: filter to "Verified purchase only" — skipped.
- [~] Hide or delete pre-launch reviews — skipped.
- [~] Require "Verified purchase" badge in widget — skipped.

---

# Task 7 admin actions — Microsoft Clarity setup

Code: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\microsoft-clarity.liquid` rendered from `@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid:29`. The snippet no-ops until a project ID is configured.

- [ ] Create a Clarity account at https://clarity.microsoft.com using the CALQIX Google account.
- [ ] Create a new project named "CALQIX" with site URL `https://calqix.com`.
- [ ] Open the project > Settings > Setup > copy the project ID (format: 10-char lowercase alphanumeric, e.g. `abc1234xyz`).
- [ ] Shopify admin > Online Store > Themes > Customize (live theme) > Theme settings > Analytics & tracking > paste the Clarity project ID into "Clarity project ID". Save.
- [ ] Wait 5-10 minutes, then open Clarity dashboard. Verify "Recordings" count is > 0. If 0 after 30 minutes, check browser devtools for a Clarity script load and for a `c.clarity.ms/collect` network request on a live page.
- [ ] Optional: enable Clarity's GA4 integration for cross-linking between heatmaps and GA4 session traces.

---

# Task 4 admin actions — Product comparison section

Code: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\product-comparison.liquid` with preset (6 default rows) is now available in Theme Editor. Nothing renders until it is placed on a page.

- [ ] Shopify admin > Online Store > Themes > Customize > pick the FlowCore product template (product.flowcore or main product template). Click "Add section" > "Product comparison". Drag below the main product description.
- [ ] Confirm preset blocks (6 rows) are present. Adjust competitor names if needed (default: Boka, David's, Colgate).
- [ ] Add a footnote referencing the clinical references section: "See references below for source of claims."
- [ ] Repeat for OralBiome, Lumicore product templates if you want the comparison on those too.
- [ ] Translate each block's `feature_label` via the Translate & Adapt app (Shopify admin > Languages > Translate). The column headers (brand names) and yes/no icons pull from locale keys automatically.

---

# Task 2 admin actions — Subscription messaging

Code now live on the FlowCore homepage banner (`@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\flowcore-banner.liquid:486-487`) and on all product cards that expose a selling plan group (`@c:\Users\Gebruiker\Desktop\CALQIX Repo\snippets\card.liquid:455-466`).

Copy flows from `locales/*.json` under the new `hero.*` + `product.subscribe_save_badge` keys (deviation note: v2 prompt specified `homepage.hero.*` but `homepage` is already a reserved top-level string for breadcrumbs; keys were promoted to `hero.*` to avoid the collision, content unchanged).

- [ ] Verify the homepage hero on desktop + mobile after deploy. The order below the CTA should now be: launch-offer gold badge → subscription trust line → existing trust line. Copy flips to NL/DE/FR/FI/NB/SV/DA automatically when the storefront locale changes.
- [ ] Confirm the subscribe-save badge appears on collection pages for any FlowCore or OralBiome product with a Recharge subscription plan. It auto-detects `product.selling_plan_groups`.
- [ ] If Recharge is not yet connected to a product, the badge simply does not render. Add it via Recharge admin > Products > assign selling plan group.

---

# Task 3 admin actions — Clinical claim references

Code now live in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-proof-strip.liquid`. Each stat number (81%, 34%, 6mm) carries a superscript `1/2/3` linking to a new References block below the stats.

Deviation note: v2 prompt specified `homepage.clinical.*` but `homepage` is already a reserved top-level string key (breadcrumbs label). Keys were flattened to `clinical.references_title`, `clinical.ref_1`, `clinical.ref_2`, `clinical.ref_3`. Content unchanged from v2 placeholders.

Citations pushed (v2 placeholders, operator acknowledged risk and approved use as-is):

1. **Amaechi BT, et al.** Remineralization effects of hydroxyapatite toothpaste. *Journal of Clinical Periodontology*, 2019.
2. **Kensche A, et al.** Plaque reduction through hydroxyapatite particles. *International Journal of Dental Hygiene*, 2017.
3. Based on clinical measurement standards for subgingival access. Verified in independent testing against ISO 16408.

- [ ] Operator: verify the three citations actually substantiate the 81% gum bleeding / 34% plaque / 6mm subgingival claims. If any citation is wrong, update the value in `locales/*.json` under `clinical.ref_*` and redeploy. No code change needed — this is copy only.
- [ ] Provide PDF or DOI links to the source studies in the CALQIX internal drive for EU Omnibus compliance recordkeeping.
- [ ] If a stat is not substantiated by any available study, remove the number from `sections/calqix-proof-strip.liquid` schema defaults in a follow-up commit and rephrase the heading to be source-agnostic.

---

# Task 11 admin actions — Klaviyo setup

Code scaffold live at:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\klaviyo.js` — REST client (revision 2024-10-15).
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\klaviyo-setup.js` — idempotent list + template seeder.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\docs\klaviyo-setup.md` — full operator guide + flow blueprints.

Nothing calls Klaviyo yet — the webhook wiring is deliberately deferred until the key is in env and lists exist.

- [ ] Klaviyo admin → Account → Settings → **API Keys** → Create Private API Key. Scopes: Profiles (Full), Lists (Full), Events (Full), Templates (Full), Metrics (Read), Flows (Read), Campaigns (Read), Accounts (Read). Copy the `pk_*` key.
- [ ] Operator: send the `pk_*` key to Cascade via secure channel (not committed to git). Cascade will add via `vercel env add KLAVIYO_PRIVATE_API_KEY production`.
- [ ] Set `KLAVIYO_ENABLED=true` in Vercel env (production).
- [ ] After env is live, operator triggers `npm run klaviyo:setup` (Cascade will add to `calqix-capi/package.json` in the wiring PR) or runs `node scripts/klaviyo-setup.js all` directly — creates the 5 master lists (Master / NL / EN / DE / FR) and 6 baseline templates (Welcome NL/EN/DE/FR, Abandoned Cart EN, Post-Purchase EN).
- [ ] In Klaviyo UI, enable **double opt-in** on all 5 master lists (per-list settings → subscription method).
- [ ] In Klaviyo UI, build the 4 flows defined in `docs/klaviyo-setup.md` §6 (Welcome per locale, Abandoned Cart, Post-Purchase, Winback). Flow graphs cannot be API-created — this step is manual once and re-used.
- [ ] In Shopify Admin → Online Store → Themes → Customize → section **CALQIX Email Signup** → set the Klaviyo form shortcode to the onsite embed form id that maps to the correct per-locale master list. Current code reads `section.settings.klaviyo_form_shortcode` in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-email-signup.liquid:502`.
- [ ] Verify `GET https://calqix-capi.vercel.app/api/diagnostics?key={DIAGNOSTICS_KEY}` reports `klaviyo: { ok: true }` (will be added in the wiring commit once env var is live).
- [ ] After lists + flows are live: give green light for Cascade to wire `api/webhook/orders-paid.js`, `checkouts-create.js`, `customers-create.js`, and `api/checkout-event.js` to emit Klaviyo events (planned as a separate `[task-11b]` commit per `docs/klaviyo-setup.md` §5).

Rollback: set `KLAVIYO_ENABLED=false` in Vercel env. All Klaviyo calls short-circuit with `skipped: true` and no exceptions thrown. Shopify webhooks keep returning HTTP 200 unchanged.

---

# Task 12 admin actions — AddToCart dedup cleanup (Option A)

Reference: ATC tracking audit, 2026-04-19. Root cause confirmed: **independent AddToCart event pipelines** (bridge, Shopify F&I Enhanced, GTM web Meta tag) each fire with their own event_id format. Meta can only dedup WITHIN one stack, so event_id coverage sits at ~50%.

Decision: keep our `calqix-capi` bridge as sole source. Disable all others.

Verification code already in repo:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\check-pixel-sources.js` — reads Redis diag summaries + recent per-event match_keys. Run with `npm run check:atc` from `calqix-capi/`.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\add-to-cart.js:116-121` — now wires `capi-diagnostics.recordCoverage` so daily summaries populate going forward.

## Operator steps (execute in order)

- [ ] **A1 — Shopify F&I Data sharing → Conservative**. Shopify Admin → Sales channels → Facebook & Instagram → Settings → "Manage Facebook & Instagram data sharing preference" (image 3) → click "Change" under the current **Enhanced** box → select **Conservative** → Save. This stops Shopify from loading Meta Pixel and sending its own CAPI events. Confirmed per Shopify docs: Conservative = shop-linking only, no customer activity data.
- [x] **A2 — TAGGRS SST Pixel**. Not active. TAGGRS was evaluated but never activated; its archived container JSONs and migration folder have been removed from the repo. If the Shopify Admin → Settings → Customer events list still shows any TAGGRS-labelled Custom Pixel entry, disconnect it once for housekeeping.
- [ ] **A3 — Pause Meta Pixel AddToCart tag in GTM**. Open GTM workspace `GTM-T86BFXXW` → Tags → filter by "Meta" or "Facebook" or "Pixel" → any tag of type "Facebook Pixel" or "Meta Pixel" with an `AddToCart` / `add_to_cart` trigger → set status to **Paused** → submit + publish the container. Keep GA4/Ads/Consent tags active. Our bridge handles AddToCart; GTM should not fire a second browser event.
- [x] **A4 — Update the CALQIX Windsurf Integration app for Markets** — DONE 2026-04-19. App re-installed in Shopify with expanded scopes (incl. `write_markets`, `write_markets_home`, `write_marketing_events`, `customer_read_markets`). New Admin API access token minted via OAuth `client_credentials` grant against `https://calqix.myshopify.com/admin/oauth/access_token` using `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET`. Token rotated in Vercel env (production + development). Local `calqix-capi/.env` and `.env.local` updated. Production redeployed via commit `e09c40c`. `npm run check:shopify` = ALL CHECKS PASSED (6 markets, 8 locales, 8 required scopes granted). Preview env intentionally skipped (not used by runtime). Unblocks `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\markets-setup.js` and `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\register-store-translations.js`.

## Verification (after the 4 admin steps are done)

Wait 30-60 minutes for caches and then trigger 2-3 ATCs yourself (incognito) on `calqix.com`. Then:

```powershell
cd calqix-capi
npm run check:atc
```

Expected healthy output:

- `fbp coverage ≥95%` — bridge's `_fbp` fallback generator is populating `userData.fbp`.
- `external_id coverage ≥90%` — `_cq_anon_id` cookie is being set and read.
- `source=browser_bridge` on every recent event row — no other pipeline feeds our server.

After 24 hours, open Meta Events Manager → Manage events → AddToCart → **Deduplicatie van gebeurtenis** tab. Confirm:

- Event ID coverage ≥ **95%** (was 50%).
- Browser vs server volume ratio → **~1:1** (was 20:7).
- Total event coverage ≥ **75%** (was 50%). Meta reports this on the Gebeurtenisdekking tab (image 2).
- Kwaliteit van gebeurtenismatches ≥ **8/10** (was 6.5/10).

## If the numbers do not improve within 48h

Run `npm run check:atc --events=100` and paste the output. The `source=` field per row reveals whether non-bridge events are still reaching our CAPI (unlikely — only the bridge calls `/api/add-to-cart`), OR whether Meta is still seeing events from a pipeline we missed. If the CALQIX Meta CAPI Custom Pixel (which does NOT handle ATC) somehow starts logging ATC events, the source field will flag it.

Rollback: there is nothing to roll back on our side — the cleanup is 100% admin-side. To restore F&I Enhanced, re-enable in Shopify Admin.
