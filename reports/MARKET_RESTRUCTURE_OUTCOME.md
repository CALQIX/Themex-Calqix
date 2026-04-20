# Market restructure — applied via Admin API

Date: 2026-04-20
Script: `calqix-capi/scripts/apply-market-restructure.js`
API: Shopify Admin GraphQL 2025-01 (self-healing OAuth token)

## Result matrix

| Blocker                                  | Before          | After                       | Status                        |
|------------------------------------------|-----------------|-----------------------------|-------------------------------|
| 1. CH duplicated across 2 markets        | germany+france  | switzerland only            | DONE via API                  |
| 2. LU missing                            | no market       | france[FR,LU]               | DONE via API                  |
| 3. Belgium dual-language                 | BE in primary   | no change needed            | DOCUMENTED — works via primary |
| 4. de-CH / fr-CH locales                 | not available   | `/de-ch/` + `/fr-ch/` URLs  | DONE differently — see below  |
| 5. Per-market currency (DKK/SEK/NOK/CHF/GBP) | all EUR     | blocked by payment gateway  | ADMIN ACTION required         |
| 6. /en/ subfolder                        | /en/ 404        | /en/ 301 -> /               | DONE via redirects batch 1    |
| 7. CH subscription payment               | same as shop    | same as shop                | ADMIN ACTION when CH Payments |

## Final market state

| Market        | Regions        | WebPresence subfolder | URLs                         |
|---------------|----------------|-----------------------|------------------------------|
| nl (primary)  | NL             | (root)                | `/`, `/nl/`, `/de/`, `/fr/`, `/da/`, `/sv/`, `/nb/`, `/fi/` |
| germany       | DE, LI, AT     | (none, uses primary)  | inherits from primary        |
| france        | FR, LU         | (none, uses primary)  | inherits from primary        |
| belgium       | BE             | (none, uses primary)  | inherits from primary        |
| scandinavie   | DK, FI, SE, NO, IS | (none)            | inherits from primary        |
| united-kingdom| GB             | (none)                | inherits from primary        |
| switzerland   | CH             | `ch`                  | `/de-ch/`, `/fr-ch/`         |

**Live verification** (curl head request, 2026-04-20):

```
/de-ch/                                     200 OK
/fr-ch/                                     200 OK
/de-ch/products/oralbiome-pro-freshmint     301 -> /de-ch/products/oralbiome-pro-frischeminze
/fr-ch/products/oralbiome-pro-freshmint     301 -> /fr-ch/products/oralbiome-pro-menthefraiche
```

Localized product handles (de, fr) are automatically inherited by the Swiss webPresence
without extra work.

## Why de-CH / fr-CH locales were NOT created

Shopify's Admin API rejects `shopLocaleEnable(locale: "de-CH")` with
`"Locale is invalid"`. The `availableLocales` query returns zero CH-specific entries.
Region-suffixed locales (de-CH, fr-CH) are not offered on the current Shopify plan.

**What we did instead**: the new Swiss market's webPresence uses `subfolderSuffix: 'ch'`
with `defaultLocale: 'de'` and `alternateLocales: ['fr']`. Shopify's URL formatter
automatically merges these into `/de-ch/` and `/fr-ch/` — which is EXACTLY what the
target matrix asks for. The URLs look identical to what a dedicated Swiss locale would
produce.

**Swiss-specific copy** (if needed in the future — e.g. "ß" vs "ss" for German Swiss):
use `marketLocalizationsRegister` (already present in the schema) to override specific
translation keys for the switzerland market only. No new locale required.

## What admin must still do (manual, UI-only)

### 1. Enable multi-currency on Shopify Payments (blocks currency per market)

API attempt returned:
```
"The shop's payment gateway does not support enabling more than one currency."
```

**Click path**:
1. Shopify Admin -> **Settings** -> **Payments** -> **Shopify Payments** -> **Manage**.
2. Scroll to **Currencies accepted at checkout** (or similar panel).
3. Add: DKK, SEK, NOK, CHF, GBP (DKK/SEK/NOK/GBP are supported; **CHF only if
   Shopify Payments is active in CH** — usually not available outside SP-supported
   countries; use Stripe as Additional Payment Method for CHF if needed).
4. Save.

After this, re-run:
```
cd calqix-capi
node scripts/apply-market-restructure.js --apply --phase=6
```

This will flip `scandinavie` to `EUR + localCurrencies=true` (DK/SE/NO/IS auto-convert
from EUR) and `united-kingdom` to `GBP + localCurrencies=true`.

For switzerland market specifically: once CHF is supported, run:
```powershell
node -e "require('dotenv').config(); require('./lib/shopify-admin').graphql('mutation{marketUpdate(id:\"gid://shopify/Market/106899308873\",input:{currencySettings:{baseCurrency:CHF,localCurrencies:true}}){market{id currencySettings{baseCurrency{currencyCode}}} userErrors{field message}}}').then(r=>console.log(JSON.stringify(r,null,2)))"
```

### 2. Swiss payments and subscriptions

If you want Swiss customers to check out in CHF with subscription support:

**Click path**:
1. Shopify Admin -> **Apps** -> **Shopify App Store** -> install **Stripe**.
2. In Settings -> Payments -> Alternative payment methods -> **Stripe**.
3. Connect Stripe account; set CHF as supported currency.
4. In Settings -> Markets -> Switzerland -> Pricing -> enable CHF as display currency.

Shopify Subscriptions (native app) will work as long as Stripe is the processor for
CHF. Selling Plan Groups already exist on products and inherit automatically.

### 3. Optional: Swiss-specific copy overrides

If marketing wants distinct wording for Swiss visitors (e.g. address format, shipping
cost wording, CHF pricing tone), register overrides:

```javascript
// Example: override product title for Swiss market only
var m = `mutation($resourceId: ID!, $marketId: ID!, $localizations: [MarketLocalizationRegisterInput!]!) {
  marketLocalizationsRegister(resourceId: $resourceId, marketLocalizations: $localizations) {
    marketLocalizations { key value locale market { handle } }
    userErrors { field message }
  }
}`;
// Call with resourceId = product GID, marketId = switzerland market GID,
// localizations = [{ locale: 'de', key: 'title', value: 'OralBiome Pro Schweiz Edition', marketId: <switzerlandId> }]
```

Reserve this for genuine CH-market-only copy. Day-to-day shop-level `de` + `fr`
translations automatically apply to Swiss visitors.

## Commits

- `93ce44c` — batch 1: productType, metafields, redirects, translations (shop-level)
- `31de930` — batch 2: dataLayer snippet + PRICING.md + blockers report
- (this commit) — batch 3: market restructure script + outcome report

## Roll-back plan

If the Swiss market causes issues, disable it (does NOT delete orders or data):

```javascript
var m = 'mutation{ marketUpdate(id:"gid://shopify/Market/106899308873", input:{ status: INACTIVE }){ market{status} userErrors{field message}}}';
```

This preserves the market config but stops serving Swiss URLs; visitors fall back to
primary market routing. To restore: set `status: ACTIVE` again.
