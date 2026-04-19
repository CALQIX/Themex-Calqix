# Task 5 — Hardcoded string scan report

Starter locale keys added to all 8 locales under:

- `general.buttons.add_to_cart`
- `general.buttons.read_more`
- `general.buttons.learn_more`
- `general.buttons.shop_now`
- `general.trust.free_shipping_over`
- `general.trust.money_back_30`
- `general.trust.clinically_tested`
- `general.trust.verified_purchase`

Keys are available for future liquid refactors. This commit does NOT replace existing liquid strings because most of the risky candidates are in section schemas, which are operator-editable via Shopify Translate & Adapt already.

## Findings from the storefront-visible scan

Targeted grep for `>Add to cart<`, `>Read more<`, `>Learn more<`, `>Shop now<`, `>Clinically tested<`, `>Free shipping<`, `>Verified purchase<`, `>30-day money-back<` across `sections/` + `snippets/`. Results:

### 1. FlowCore blog CTA

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-blog-article.liquid:1267` — `Try OralBiome Pro` (product-specific, leave as-is or move to schema setting)
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-blog-article.liquid:1269` — `Shop Now` (safe to swap to `{{ 'general.buttons.shop_now' | t }}`)

### 2. Lumicore hero

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\product-lumicore-hero.liquid:330` — `PAP+<br>Clinically Tested` (mix of product code + localizable phrase; future refactor should split: PAP+ retained + `{{ 'general.trust.clinically_tested' | t }}`)

### 3. Product accordion schema defaults

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-product-accordions.liquid:870` — multiple English phrases inside a rich-text schema default (`Free shipping on all orders over €80`, `30-day satisfaction guarantee`, `2-year warranty against manufacturing defects`). These are admin-editable so preferred route is Shopify Translate & Adapt per locale.

## Recommended follow-up commits (not in this push)

- `[task-5-followup-1]` Swap hardcoded `Shop Now` on `calqix-blog-article.liquid:1269` to the locale key.
- `[task-5-followup-2]` Refactor `product-lumicore-hero.liquid:330` to compose product code + localized phrase.
- `[task-5-followup-3]` Operator task in Shopify admin: translate section schemas with hardcoded English defaults via Languages > Translate.

## Out of scope for this pass

- Sections inside `oralbiome-*`, `flowcore-banner` and marketing pages have their defaults either in schema (admin-translatable) or already localized. Full audit requires a follow-up review.
- Third-party app blocks (Judge.me, Recharge, Klaviyo) emit English by default; those require app-side language settings, not theme locales.
