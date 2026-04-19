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

## 2. Shopify Custom Pixel — reinstall with updated code

We just committed enhancements to `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\shopify-custom-pixel.js`:

- `external_id` extracted from `checkout.order.customer.id` / `checkout.customer.id`
- Shipping address fields added to the server payload (fn, ln, ct, zp, country)

Steps to deploy:

1. Shopify admin → Settings → **Customer events** → **Add custom pixel** (or open the existing CALQIX Meta CAPI pixel).
2. Replace the pixel code with the latest contents of `calqix-capi/shopify-custom-pixel.js`.
3. Save, then **Connect** (or re-connect after save).
4. Customer privacy: set to **Customer Privacy API** if available so GDPR consent is respected.
5. Verify in Meta Events Manager → Test events by opening a fresh incognito checkout flow and confirming Purchase + InitiateCheckout arrive with `external_id` and `fbp` populated.

---

## 3. GTM web container (`GTM-T86BFXXW`) — Meta Pixel tag config

The theme now pushes customer identity to dataLayer via `calqix_user_data` event. GTM needs variables + Meta Pixel tag config to forward them.

### 3a. Create dataLayer variables

In `tagmanager.google.com` → workspace for `GTM-T86BFXXW` → Variables → User-Defined Variables → New → Data Layer Variable. Create each:

| Variable name | Data Layer Variable Name | Version |
|---|---|---|
| `DLV - user_data.external_id` | `user_data.external_id` | 2 |
| `DLV - user_data.em` | `user_data.em` | 2 |
| `DLV - user_data.ph` | `user_data.ph` | 2 |
| `DLV - user_data.fn` | `user_data.fn` | 2 |
| `DLV - user_data.ln` | `user_data.ln` | 2 |
| `DLV - user_data.ct` | `user_data.ct` | 2 |
| `DLV - user_data.st` | `user_data.st` | 2 |
| `DLV - user_data.zp` | `user_data.zp` | 2 |
| `DLV - user_data.country` | `user_data.country` | 2 |

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

## Blog and author rename

- [ ] Settings > Users: find the user "Elena Hartwell". Rename to "CALQIX Science Team". Update email to `info@calqix.com` if applicable. After the rename, Shopify auto-updates `article.author` on the 5 existing Elena articles, but our code no longer reads `article.author` on article pages/cards (the new `blogs.article.byline` locale key is used). The rename is still needed for admin hygiene and metafield compatibility.
- [ ] Content > Blog posts: open each of the 5 "Elena writes" articles, remove any in-body mentions of "Elena" or "Dr. Elena" and replace with "the CALQIX team" or delete the phrase.
- [ ] Content > Blogs: open the blog "Elena writes" and change:
  - Title per language:
    - EN: "The Science Journal"
    - NL: "Wetenschapsjournaal"
    - DE: "Wissenschaftsjournal"
    - FR: "Journal scientifique"
    - FI: "Tiedejulkaisu"
    - NB: "Vitenskapsjournalen"
    - SV: "Vetenskapsjournalen"
    - DA: "Videnskabsjournalen"
  - Handle: change from `calqix-elena-writes` to `the-science-journal`.
- [ ] Shopify auto-creates a redirect for the blog handle change. Verify in Online Store > Navigation > URL Redirects.
- [ ] Online Store > Navigation > URL Redirects > Import CSV: upload `@c:\Users\Gebruiker\Desktop\CALQIX Repo\redirects.csv` as a safety net (it adds the same `/blogs/calqix-elena-writes` to `/blogs/the-science-journal` redirect in case Shopify's auto-redirect is missing).
- [ ] Online Store > Navigation > Main menu: rename the "Elena writes" link.
  - EN: "Science Journal"
  - NL: "Wetenschap"
  - DE: "Wissenschaft"
  - FR: "Science"
  - FI: "Tiede"
  - NB: "Vitenskap"
  - SV: "Vetenskap"
  - DA: "Videnskab"
- [ ] **Important follow-up commit**: after you rename the blog handle in admin, ping Windsurf to run a `[task-1-followup]` commit updating the remaining template references from `calqix-elena-writes` to `the-science-journal`:
  - `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\index.json:377`
  - `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\product.oralbiome.json:310`
  - Helper scripts under `@c:\Users\Gebruiker\Desktop\CALQIX Repo\scripts\`
  These still point to the old handle. Shopify URL redirects do not cover `blogs['handle']` Liquid lookups, so these files must be updated AFTER the admin handle change, not before.

## Judge.me cleanup (same session)

- [ ] Judge.me admin > Reviews: filter to "Verified purchase only".
- [ ] Hide or delete any reviews dated before CALQIX store actually went live.
- [ ] Set Judge.me widget to require "Verified purchase" badge for display.

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
