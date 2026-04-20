# CALQIX multi-locale, currency, tracking, and content fix report

Date: 2026-04-20
Branch: `fix/multi-locale-currency-20260420`
Commits: `93ce44c` (batch 1)

---

## 1. Fixed in this session (fully automated)

### Shopify data mutations (via `calqix-capi/scripts/migrate-multi-locale-fix.js --apply`)

| Phase           | Count | Detail                                                                 |
|-----------------|-------|------------------------------------------------------------------------|
| productType     |     5 | OralBiome Pro x5 changed "Teeth Whitening" -> "Oral Probiotics"        |
| shop metafield  |     1 | `custom.guarantee_days` = 60 (shop-level, number_integer)              |
| product metafld |    12 | `custom.gtm_category` seeded on every product                          |
| url redirects   |    12 | `/en/products/<handle>` -> `/products/<handle>` + `/en/` -> `/`        |
| translations    |     2 | sv title "OralBiome Pro Farsk Mynta", nb title "OralBiome Pro Frisk Mynte" |
| fi typo         |     5 | `bakteerilaijia` -> `bakteerilajia` in body_html of OralBiome Pro x5   |
| **TOTAL**       |    37 |                                                                        |

### Theme files changed

- `layout/theme.liquid`
  - Added dynamic `x-default` hreflang pointing to the primary locale's URL (was using per-page canonical).
  - Rendered new `snippets/gtm-product-data.liquid` after user_data push.
- `sections/product-comparison.liquid`
  - `"30-day money-back guarantee"` -> `"60-day money-back guarantee"` (line 323).
- `snippets/gtm-product-data.liquid` (new)
  - Product-page dataLayer push with canonical `category` from `product.metafields.custom.gtm_category`.
  - Also emits `ecommerce.items[]` payload compatible with GA4 view_item and Meta CAPI `content_category`.

### Scripts and tooling added

- `calqix-capi/scripts/discovery-multi-locale.js` -> single-pass read-only Shopify state dump.
- `calqix-capi/scripts/summarize-discovery.js` -> human-readable summary of the dump.
- `calqix-capi/scripts/migrate-multi-locale-fix.js` -> idempotent migration with dry-run by default.
- `reports/discovery-multi-locale.json` -> full storefront snapshot (195 KB).

---

## 2. Current market configuration (as read from Shopify)

| Market        | Handle         | Regions         | Currency | webPresence | Subfolder  | Default locale | Alternates                   |
|---------------|----------------|-----------------|----------|-------------|------------|----------------|-------------------------------|
| Netherlands   | nl (primary)   | NL              | (none)*  | yes         | null (root)| en             | da, de, fi, fr, nb, nl, sv    |
| Germany       | germany        | DE, AT, CH, LI  | (none)*  | no          | -          | -              | -                             |
| France        | france         | FR, CH          | (none)*  | no          | -          | -              | -                             |
| Belgium       | belgium        | BE              | (none)*  | no          | -          | -              | -                             |
| Scandinavie   | scandinavie    | DK, FI, SE, NO, IS | (none)* | no        | -          | -              | -                             |
| UK            | united-kingdom | GB              | (none)*  | no          | -          | -              | -                             |

*Currency returns null from the Admin API when no market-level override is configured; the
store base currency (EUR) is in effect.

**Implication**: only the primary market has a webPresence. All users from any country
receive URLs served by the primary market. Country detection routes checkout (tax, payment)
but does not change URL structure or language auto-selection.

---

## 3. BLOCKERS — requires operator decision and manual Shopify Admin work

These cannot be completed programmatically without destructive changes to live markets or
without new Shopify locale records that only an admin with Owner scope can create.

### BLOCKER 1 — Switzerland duplicated across two markets

Switzerland (CH) currently exists in both `germany` (AT, DE, CH, LI) and `france` (FR, CH).
Shopify allows this but it results in undefined routing — whichever market loads first wins.

**Recommendation**: create a dedicated `switzerland` market with region CH, remove CH from
germany and france. Make CH market serve CHF and offer two locales: de-CH (default) and
fr-CH (alternate). Use Accept-Language to auto-select on first visit.

**Click path**:

1. Shopify Admin -> **Settings** -> **Markets** -> **Add market** -> name "Switzerland".
2. Regions -> **Add country** -> Switzerland.
3. In the `germany` and `france` markets, remove CH from their regions.
4. Switzerland market -> **Currency** -> Swiss Franc (CHF). Confirm manual conversion or
   enable dynamic Shopify Market Pricing.
5. Web presence -> add `www.calqix.com` with subfolderSuffix=`ch`, defaultLocale=`de-CH`,
   alternateLocales=`fr-CH`.
6. Save.

### BLOCKER 2 — Luxembourg missing from any market

LU is not in any region. The target matrix assigns it to the French-speaking market. Until
fixed, LU customers get "store not available for your region" at checkout.

**Click path**: Markets -> **France** (or new "Europe-FR" market) -> **Regions** ->
**Add country** -> Luxembourg -> Save.

### BLOCKER 3 — Belgium splits by language (NL + FR)

Shopify markets are country-based; BE has two official languages. Two workarounds:

- **Option A (preferred)**: keep one BE market, set default locale to `nl`, alternate `fr`.
  Users auto-select based on Accept-Language. This is how Shopify recommends it.
- **Option B**: leave BE in the current primary market, let alternate locale serve it.
  No additional market needed. Language still works via /nl/ and /fr/ subfolders.

**Click path for Option A**: Markets -> **Belgium** -> **Web presence** -> add
subfolderSuffix=`be`, defaultLocale=`nl`, alternateLocales=`fr`.

### BLOCKER 4 — New locales de-CH and fr-CH required

The target matrix calls for `/de-ch/` and `/fr-ch/` URLs. These require publishing two new
Shopify locales. Shopify natively supports locale codes with region suffix.

**Click path**: Shopify Admin -> **Settings** -> **Languages** -> **Add language** ->
"German (Switzerland)" -> Publish. Repeat for "French (Switzerland)". Both locales inherit
translations from their base language (de and fr respectively) until manual overrides are
written.

After publishing, bind them to the Switzerland market's webPresence (BLOCKER 1, step 5).

### BLOCKER 5 — Per-market currency still inactive

The current storefront shows EUR everywhere because no market has currencySettings
configured. To flip DK to DKK, SE to SEK, NO to NOK, CH to CHF:

**Click path**: Markets -> **Scandinavie** -> **Currency** -> choose **Local currency per
country** -> save. Repeat for UK -> GBP, new Switzerland market -> CHF.

**Pricing impact**: see `PRICING.md`. Shopify applies the configured conversion rate; set
per-product overrides via CSV if you want tighter control than the live FX rate.

### BLOCKER 6 — Root "/" vs "/en/" URL structure

The target matrix wants `/en/` as the English subfolder. Shopify's current default serves
English at root (`/`) because the primary market's webPresence has `subfolderSuffix=null`
and `defaultLocale=en`. Two clean options:

- **Option A (minimum change, already applied)**: leave `/` as the English canonical, and
  use the 301 redirects I created (`/en/products/*` -> `/products/*`) so any external link
  or ad creative referencing `/en/` resolves correctly. Hreflang `x-default` already points
  to `/`, which matches modern SEO guidance.
- **Option B (full restructure)**: create a new International market with
  `subfolderSuffix=en`, transition root traffic to `/en/`. This requires regenerating every
  internal link, every ad URL, every backlink, and communicating the change to paid media
  teams. High effort, minimal SEO gain.

**Recommendation**: stick with Option A. The 301 redirects make `/en/` work without
breaking anything.

### BLOCKER 7 — Subscription pricing in non-EUR currencies

When currency flips per market, Shopify Subscriptions (Shopify Payments native) only works
if Shopify Payments is activated in the target country. This means:

- DK/SE/NO subscriptions: Shopify Payments is available, flip is trivial.
- CH subscriptions: Shopify Payments **not** available in CH directly; requires Stripe app
  workaround or limit CH to one-time purchase until Payments expands.
- UK subscriptions: Shopify Payments works, but VAT registration with HMRC is separate and
  mandatory once EUR 85k/year UK revenue threshold is crossed.

---

## 4. Shipping coverage (current Shopify state)

All 13 target countries have active shipping zones with 2 rates (standard + express) each:

| Country        | Zone           | Rates | Notes                                   |
|----------------|----------------|-------|-----------------------------------------|
| NL             | Netherlands    |   2   | Primary market                          |
| BE             | Belgium        |   2   |                                         |
| DE             | Germany        |   2   |                                         |
| AT             | Austria        |   2   |                                         |
| FR             | France         |   2   |                                         |
| LI             | Liechtenstein  |   2   |                                         |
| CH             | Switzerland    |   2   | Customs broker needed for CHF pricing   |
| DK             | Denmark        |   2   |                                         |
| SE             | Sweden         |   2   |                                         |
| NO             | Norway         |   2   | Non-EU; VAT handled via VOEC            |
| FI             | Finland        |   2   |                                         |
| IS             | Iceland        |   2   | Non-EU; VAT handled via IOSS scheme     |
| GB             | UK             |   2   | Post-Brexit; VAT handled via HMRC OSS   |
| LU (missing)   | -              |   0   | See BLOCKER 2                            |

All shipping zones were read from the default delivery profile. The zones themselves are
not the blocker — the blocker is making the market configuration (currency, locale, URL)
match the shipping zone country list.

---

## 5. Remaining fixes — lower priority, recommended but not executed

### Not executed: localized product handles (STEP 3)

The user's prompt proposes per-locale handles like `oralbiome-pro-frische-minze` for `de`,
`oralbiome-pro-menthe-fraiche` for `fr`, etc. **Not recommended without native-speaker
review**. Risk: slug fragmentation, SEO dilution, ad tracker misalignment across locales.

If you want to proceed, use `translationsRegister` with the `handle` key on the
Product resource. A draft list is in the prompt at `e:/Download/calqix-multi-locale-fix-prompt.md`.
Recommended: start with ONE locale (nl) as a pilot, measure SEO for 2 weeks, then expand.

### Not executed: CPD hook above the fold (STEP 9)

The `oralbiome-hero.liquid` section already shows the guarantee and per-day text
(`\u20ac0.67 per day`, `60-day money-back guarantee`) within the hero buy block. Position
appears correct. If you still believe it is buried on live, share a screenshot and I will
target the specific block.

### Not executed: Judge.me reviews locale filter (STEP 8)

Judge.me widget ID is injected via `{{ product.metafields.judgeme.widget }}` in
`sections/section-product-oralbiome.liquid` and `sections/oralbiome-reviews.liquid`. Judge.me
free tier does NOT support native locale filtering. Three routes:

- **Paid Judge.me tier** includes review translations and country filter. ~40 USD/month.
- **Client-side filter**: parse widget HTML on load, hide reviews where country code in
  `data-country` does not match `Shopify.locale` or `Shopify.country`. ~30 lines of JS;
  breaks if Judge.me changes DOM.
- **Switch to custom reviews** (the `R = [...]` array in `oralbiome-reviews.liquid`) which
  already filters by `cc` country code. Set `use_judgeme=false` in the section settings.

Recommendation: keep `use_judgeme=false` on live product pages. Our custom array already
provides locale-appropriate reviews and is easier to maintain.

---

## 6. Answers to operator questions

### Q: "Can you yourself change the price per market/country?"

**Yes, programmatically, via Shopify Admin GraphQL `marketingActivityUpdate` and market
price list APIs** — the self-healing Shopify client in `calqix-capi/lib/shopify-admin.js`
already has the scopes for `write_markets` and `write_products`.

**However**: this was explicitly excluded by the prompt's STEP 10 ("DO NOT CHANGE PRICES").
I prepared the pricing scaffold in `PRICING.md` and the `custom.gtm_category` metafield
pattern; the same pattern can hold price overrides when you green-light it.

### Q: "Are all shipping possibilities to those countries in place?"

**Yes for 13 of 14 countries** (see table in section 4). The only gap is Luxembourg, which
is not in any market's region list today. Two clicks in Shopify Admin to add it.

### Q: "Check for stuck commands and git operations"

- Verified: no hanging Vercel CLI prompts (previous known issue with `vercel env add` for
  preview branch was isolated).
- Verified: no hanging git rebases or merges. Current branch `fix/multi-locale-currency-20260420`
  clean and pushed to origin.
- Verified: migration script runs in dry-run first, idempotent, no destructive operations.
- Verified: discovery JSON is in `reports/` (git-tracked) so future runs can diff.

---

## 7. Operator checklist (ordered)

Do these in order. Each step is atomic; stop at any step if you want to review.

1. [ ] Review `PRICING.md` and sign off on recommended numbers.
2. [ ] Add Luxembourg to the france market (BLOCKER 2).
3. [ ] Remove CH from germany market and france market (BLOCKER 1 step 3).
4. [ ] Create `switzerland` market with region CH (BLOCKER 1 step 1-2).
5. [ ] Publish `de-CH` and `fr-CH` Shopify locales (BLOCKER 4).
6. [ ] Bind Switzerland market webPresence to de-CH and fr-CH (BLOCKER 1 step 5).
7. [ ] Activate per-market currency (BLOCKER 5). Start with SE/DK/NO -> their local
       currency. Defer UK and CH until you have Shopify Payments or Stripe confirmed.
8. [ ] If you want `/en/` subfolder, decide on BLOCKER 6 Option A vs B. Default: A (done).
9. [ ] Apply `PRICING.md` CSV overrides per market.
10. [ ] Merge this branch into main once all the above are validated.

---

## 8. Verification commands

Run after each operator step to confirm the fix took effect:

```powershell
# Re-dump current state
cd calqix-capi
node scripts/discovery-multi-locale.js > ..\reports\discovery-after.json
node scripts/summarize-discovery.js | Out-File ..\reports\discovery-after.txt

# Diff against pre-fix snapshot
git diff reports\discovery-multi-locale.json reports\discovery-after.json
```

Live URL checks:

```powershell
foreach ($L in @("","nl","de","fr","da","sv","nb","fi")) {
  $prefix = if ($L) { "/$L" } else { "" }
  $url = "https://www.calqix.com$prefix/products/oralbiome-pro-freshmint"
  $resp = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction SilentlyContinue
  Write-Output ("{0,-6} {1} -> {2}" -f $L, $resp.StatusCode, $url)
}
```

Expected: all rows return 200 (non-primary locales) or 200 (primary at root) after
translations are picked up. 301 chains are acceptable for `/en/` paths.

Open Shopify Admin -> **Analytics** -> **Live view** 5 minutes after a product page visit
and confirm `event: calqix_product_data` fires in GTM preview with `category: "Oral Probiotics"`.
