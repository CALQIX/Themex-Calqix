# Meta CAPI diagnosis & fixes — 2026-04-23

Full root-cause analysis and remediation for two production-critical issues:

1. **Missing Purchase events** (0 received by Meta in the last 24h despite orders in Shopify)
2. **Catalog attribution failure** (`pixel_has_low_event_source_match_rate = failed` in `/{pixel}/da_checks`)

## TL;DR

Two independent bugs, both now fixed code-side. Vercel serverless is fine; no platform
migration needed.

| Bug | Root cause | Fix | Status |
|---|---|---|---|
| Purchase = 0 | Shopify had **zero** webhook subscriptions pointing at `calqix-capi.vercel.app` | Registered 4 webhooks via GraphQL | ✅ Live |
| da_checks FAILED | `content_ids` shipped Shopify parent `product_id`; Meta Commerce catalog uses `variant_id` + SKU as `retailer_id` | Emit `variant_id + sku` with `content_type=product`, keep `product_id` only as fallback | ✅ Committed (server) / ⚠️ Pending deploy (bridge + custom pixel) |

## Evidence collected

### Pixel / token (Graph API)
- `GET /{pixel}` is forbidden (`#200 Ad account owner has NOT grant ads_management`)
  — known quirk, does not block CAPI
- `GET /{ad_account}/adspixels` confirms pixel `934134615770602` ("Calqix's pixel") is
  linked to `act_2108393566376667` with `last_fired_time: 2026-04-22T23:51:12+0000`
- Token (System User on app `1913511909393587`) is valid with all required scopes

### Events actually received last 24h (`/stats?aggregation=event`)
```
ViewContent       ~237
AddToCart          ~21
InitiateCheckout    ~5
AddPaymentInfo       2
Lead                 1
Purchase             0   ← the bleeding wound
PageView             0   ← false alarm (see below)
```

### da_checks (`GET /{pixel}/da_checks`)
- ❌ `pixel_has_low_event_source_match_rate = failed`
- ✅ `pixel_has_low_product_match_rate = passed`
- ✅ `pixel_missing_param_in_events = passed`
- ✅ `pixel_decline = passed`

### Catalog format (`GET /{catalog_id}/products`)
Catalog `1549301396145400` contains 21 products with mixed retailer_ids:
- half are Shopify variant_ids (e.g. `54065091346761`)
- half are manual SKUs (e.g. `CALQIX-OBP-30-CM`)

None are Shopify parent product_ids.

### Shopify orders vs. Redis Purchase events (last 7 days)
5 paid orders, only 4 tracked:
- `#QIX1026 €28.78` on 2026-04-22T11:04:04Z → **missed**, source=`web`
- `#QIX1025 €51.87` tracked via `custom_pixel`
- `#QIX1024 €49.68` tracked via `custom_pixel`
- `#QIX1023 €24.90` tracked via `custom_pixel`
- `#QIX1022 €24.90` tracked via `custom_pixel`

**20% revenue-attribution loss** with single-layer (Custom Pixel only) coverage.

### Shopify webhook subscriptions
```
GraphQL webhookSubscriptions → 0 results
REST /admin/api/2024-10/webhooks.json → 401 (scope), but GraphQL empty confirms
```
The architecture intended a second delivery layer via `orders/paid`, but it was
never registered.

### Live browser check (Playwright on calqix.com)
- `fbq` v2.9.303 loads and flushes queue
- PageView beacon succeeds: `POST https://www.facebook.com/tr/ → 200` with
  `eid=pv_...` plus full Advanced Matching (`ud[em]`, `ud[external_id]`,
  `ud[fn]`, `ud[ln]`, `ud[ph]`, `ud[ct]`, `ud[zp]`, `ud[country]`)
- Manual probe via `fbq('track', 'PageView', {}, { eventID: 'probe_pv_1' })`
  also 200

**Conclusion**: PageView is fine. The "Niet-actief - Gebeurtenis nooit ontvangen"
in Events Manager sits on the *Parameters* panel, not the event itself.

## Fix 1 — Register Shopify webhooks

New script: `scripts/register-shopify-webhooks.js` (idempotent, dry-run by default).

```
ORDERS_PAID        → https://calqix-capi.vercel.app/api/webhook/orders-paid
CHECKOUTS_CREATE   → https://calqix-capi.vercel.app/api/webhook/checkouts-create
CUSTOMERS_CREATE   → https://calqix-capi.vercel.app/api/webhook/customers-create
CARTS_CREATE       → https://calqix-capi.vercel.app/api/webhook/carts-create
```

**Executed 2026-04-23**. Verified via re-run: all 4 now show up. `SHOPIFY_API_SECRET`
equals `SHOPIFY_WEBHOOK_SECRET` (both `shpss_…` 38 chars), so HMAC verification in
`lib/webhook-utils.js::parseAndVerifyWebhook` will succeed.

Dedup remains safe: webhooks use `purchase_{checkout_token}` (same as Custom Pixel),
so Meta deduplicates via `eventID` and `dedup:Purchase:{checkout_token}` in Redis
(48h TTL) prevents a double-send from the server.

## Fix 2 — Catalog-aligned content_ids

### Files changed

| File | Deploy mechanism | State |
|---|---|---|
| `lib/webhook-utils.js` | Vercel (git push → auto deploy) | ✅ Committed |
| `api/view-content.js` | Vercel | ✅ Committed |
| `api/checkout-event.js` | Vercel | ✅ Committed |
| `assets/calqix-meta-bridge.js` | Shopify theme push | ✅ Committed / ⚠️ Needs theme deploy |
| `shopify-custom-pixel.js` + `scripts/shopify-custom-pixel.for-admin.js` | Copy-paste in Shopify Admin > Settings > Customer events > Custom Pixel | ✅ Committed / ⚠️ Needs manual paste |

### New behaviour (all files)

For every line item we now build `content_ids` in this priority order:
1. `variant_id` → catalog retailer_id for ~half of items (numeric Shopify variant ids)
2. `sku` → catalog retailer_id for the other half (`CALQIX-OBP-30-*`)
3. `product_id` → last-resort fallback only when both are missing

`content_type` is `'product'` whenever ANY line item has variant-level data
(the CALQIX catalog stores items at variant level). Falls back to
`'product_group'` only if no variant_id / sku exists anywhere.

### Example (real order)

Before:
```json
{
  "content_ids": ["7890123456"],
  "content_type": "product_group"
}
```

After:
```json
{
  "content_ids": ["54065091346761", "CALQIX-OBP-30-CM"],
  "content_type": "product"
}
```

Expected outcome: `da_checks` should flip to `passed` within 24-48h once Meta
re-runs its attribution analysis.

## What to watch in the next 24h

### 1. Webhook deliveries are hitting the endpoint
```powershell
# After next order
cd calqix-capi
node -e "var r=require('@upstash/redis').Redis;var d=require('dotenv').config();var c=new r({url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN});(async()=>{var k=[];var cur=0;do{var x=await c.scan(cur,{match:'meta:event:purchase_*',count:200});cur=Number(x[0]);k.push(...x[1]);}while(cur!==0);for(var i=0;i<k.length;i++){var v=await c.get(k[i]);console.log(k[i],JSON.parse(v).source,JSON.parse(v).state);}})()"
```
Expected: after the next order, at least one `source=webhook` entry alongside
the existing `source=custom_pixel`. Both should be `state=confirmed`.

### 2. Graph API da_checks match rate
```bash
curl "https://graph.facebook.com/v21.0/934134615770602/da_checks?access_token=$META_ACCESS_TOKEN"
```
Expected: `pixel_has_low_event_source_match_rate` should change from
`"result": "failed"` to `"result": "passed"` within 24-48h (Meta's analysis
window).

### 3. Events Manager → EMQ for ViewContent
Should stay at 6.0+ (no regression). ATC / Purchase EMQ should actually improve
because content_type=product is a closer match to catalog items.

### 4. Ads Manager → "Per aankoop" column
Should populate once real orders flow through the new webhook + updated catalog
matching.

## Fix 3 — Browser bridge deployed (2026-04-23 17:23 CEST)

`assets/calqix-meta-bridge.js` uploaded to MAIN theme `Themex-Calqix/main`
(id 182756999497) via the new `calqix-capi/scripts/deploy-theme-asset.js`
(REST `PUT /themes/{id}/assets.json`, auto-token from `lib/shopify-admin.js`).

Live verification on `https://calqix.com/products/oralbiome-pro-cool-mint`
via Playwright (sendBeacon hook) confirmed the new payloads:

```jsonc
// AddToCart  →  /api/add-to-cart
{
  "content_ids": ["54065072177481", "CALQIX-OBP-30-CM"],   // variant_id + SKU
  "content_type": "product",
  "contents": [{ "id": "54065072177481", "quantity": 1, "item_price": 19.95 }],
  "fbp": "fb.1.…",
  "email": "<remembered from newsletter>",
  "external_id": "9729821278537",
  "country_code": "NL"
}

// ViewContent  →  /api/view-content
{
  "variant_id": "54065072177481",
  "sku": "CALQIX-OBP-30-CM",
  "email": "<remembered from newsletter>",
  "external_id": "9729821278537"
}
```

## Fix 4 — EMQ boost via persistent email (live, same deploy)

When a visitor submits the newsletter / lead form OR fills the checkout email
field, `assets/calqix-meta-bridge.js::rememberEmail()` writes a normalized
copy to `localStorage["_cq_known_email"]` plus a 365-day cookie of the same
name.

`getCustomerEmail()` falls back to that cache when neither
`window.meta.customer.email` nor `ShopifyAnalytics.meta.page.customerEmail` is
present, so every subsequent ViewContent / AddToCart from anonymous browsers
includes `em` in the user_data sent to Meta CAPI.

Expected effect: EMQ for non-logged-in ViewContent 6.0 → ~7.5-8.0 once Meta's
EMQ window catches up.

## Known limits / deferred work

- **Fix #2 (order-event reconciliation)** — add `_meta_purchase_event_id` as order
  note_attribute so audit scripts can match orders ↔ CAPI events directly.
  Not critical because dedup already works via `checkout_token`.
- **Custom Pixel manual paste** — `scripts/shopify-custom-pixel.for-admin.js`
  must be pasted into Shopify Admin > Settings > Customer events > "CALQIX
  Meta CAPI" Custom Pixel > Save. Shopify exposes app-installed Web Pixels
  via the Admin API (`webPixel` query, `webPixelUpdate` mutation), but
  merchant-created Custom Pixels in Customer Events are NOT programmatically
  editable — confirmed via failed queries to `webPixel` (RESOURCE_NOT_FOUND)
  and the absence of any `pixels.json` REST endpoint. This is the only
  remaining manual step.

## Related files

- `@calqix-capi/scripts/register-shopify-webhooks.js` — new, idempotent
- `@calqix-capi/lib/webhook-utils.js` — `getCatalogItemReferences`, `resolveContentType`, `buildContents`, `extractContentIds`
- `@calqix-capi/api/view-content.js` — `catalogIds` + `contentType`
- `@calqix-capi/api/checkout-event.js` — `extractCatalogIds`, `buildCustomDataFromLineItems`
- `@assets/calqix-meta-bridge.js` — `fireViewContent`, `fireAddToCart`
- `@calqix-capi/shopify-custom-pixel.js` — `buildLineItems`, `contentIdsFromItems`, `contentTypeFromItems`
