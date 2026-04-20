# CALQIX Pricing Strategy

## Current base prices (EUR, single purchase)

| Product                          | EUR    | Notes                                    |
|----------------------------------|--------|------------------------------------------|
| FlowCore (waterflosser)          | 39.95  | Core hardware; subscription not active   |
| FlowCore Travel Pouch            |  9.95  | Accessory                                |
| OralBiome Pro (all 5 flavours)   | 19.95  | Subscription saves 20% -> 15.96/mo       |
| Priority Support                 | 19.95  | Digital add-on                           |
| Lumicore PAP Whitening Kit       | DRAFT  | Not yet active                           |

## Recommended per-market pricing (set via Market price overrides, not variant prices)

Strategy: **relative parity to local purchasing power**, keep psychological price points
(.95 for EUR/GBP markets, .00 for Nordic markets with higher nominal amounts, .95 for CHF
for premium signal). Subscription discount stays at 20%.

| Market | Currency | OralBiome Pro | FlowCore | Rationale                                                   |
|--------|----------|---------------|----------|-------------------------------------------------------------|
| EU (NL/BE/DE/AT/FR/LU/FI/IE) | EUR | 19.95 | 39.95 | Base (already live)                                         |
| DK     | DKK      | 149          | 299       | 149 DKK ~ 19.95 EUR; round to .00 for Scandinavia standard  |
| SE     | SEK      | 219          | 449       | Slightly above EUR parity to offset SEK weakness vs EUR     |
| NO     | NOK      | 229          | 469       | Norway premium market; NOK commonly lands on .00 price tags |
| CH     | CHF      | 22.95        | 44.95     | 15% uplift (CH premium tolerance) with psychological .95    |
| GB     | GBP      | 17.95        | 35.95     | ~10% EUR-GBP conversion; .95 rounding                       |

### Why these numbers, short version

- **Nordic countries (DK/SE/NO)** tolerate higher nominal amounts; rounding to whole units
  matches retail conventions and avoids awkward decimals in checkout.
- **Switzerland (CHF)** historically accepts 10-20% premium over EU on consumer goods.
  22.95 CHF keeps the sub subscription math clean: monthly ~18.36 CHF (still below 20 CHF
  threshold consumers find psychologically heavy).
- **UK (GBP)** needs careful handling post-Brexit: VAT is 20% and included in display price;
  GBP is weaker than EUR as of 2026, so 17.95 maintains margin parity.

## Shipping cost allocation (pair with price override)

Current zones all have 2 rates configured (standard + express). Recommended adjustments per
market are **admin-only** (Shopify does not expose shipping rate mutations via client apps
without fulfillment manager scopes and has ongoing deprecations for Carrier Service API):

- Consider free shipping threshold at **EUR 50** equivalent in all EUR markets (today it
  varies).
- Nordic markets should mirror EU thresholds in local currency, rounded (DKK 399, SEK 499,
  NOK 499).
- CH should have a hard postal threshold at CHF 55 to absorb typical cross-border surcharge.

## How to apply (operator steps, 5 minutes per market)

1. Shopify Admin -> **Settings** -> **Markets** -> pick the market.
2. **Pricing** tab -> **Adjust prices for all products**.
3. Either apply a percentage uplift (e.g. +5% for CH) or upload a CSV of per-variant
   overrides.
4. Toggle **Include or exclude tax based on country** according to display preference.
5. Save. Changes propagate in < 60 seconds.

### CSV template for per-variant overrides

```csv
Product handle,Variant SKU,Price
oralbiome-pro-freshmint,OBP-FRESHMINT,22.95
calqix-flowcore,FC-BASE,44.95
```

Upload under Markets -> <market> -> Pricing -> Update prices from CSV.

## Do NOT change prices yet

This document is pricing **infrastructure**. Applying overrides is a separate approved task:

- Needs marketing sign-off on the final numbers per country.
- Needs coordination with active ad campaigns (URL parameters and landing pages reference
  EUR prices today).
- Needs customer communication for existing subscribers if their effective price changes.

## Related infrastructure

- Product metafield `custom.price_override_by_market` (JSON) is **reserved** for product-level
  multi-market overrides where a single CSV is not sufficient. This was not seeded during
  the multi-locale fix migration; create the definition in Shopify Admin ->
  **Settings** -> **Custom data** -> **Products** when needed.
- Subscription price is driven by Shopify's native subscription app (Selling Plan Groups),
  which inherits the market override. No separate per-market subscription price is needed
  unless you want different discount percentages per market.
