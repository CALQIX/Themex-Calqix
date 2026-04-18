# PREFLIGHT REPORT — calqix-capi (Vercel CAPI app)

Read-only audit. No files changed. Companion: `../PREFLIGHT_REPORT.md` (theme).

Date: 2026-04-18
Deploy target: `https://calqix-capi.vercel.app` (project `calqixs-projects/calqix-capi`)
Git: subdirectory of theme monorepo, branch `main`, clean tree.

---

## 1. Routes inventory

### `api/webhook/` (Shopify webhook handlers, HMAC verified)

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\orders-paid.js` — Purchase, event_id = `purchase_{checkout_token}` (falls back to `purchase_{order_id}`). Sends Meta CAPI + GA4 + Google Ads.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\checkouts-create.js` — InitiateCheckout (not read in preflight, assumed parallel to orders-paid).
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js` — AddToCart, event_id = `cart_{id}`. **DIAGNOSTIC ONLY, does not send to Meta** (explicit comment at lines 97-101).
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\customers-create.js` — Lead.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\predis-callback.js` — Predis completion callback.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\telegram-callback.js` — Telegram approval flow.

### `api/webhooks/` (plural — duplicate route)

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhooks\predis-callback.js` — second copy. **Duplicate route confirmed** (finding #4).

### `api/` (non-webhook endpoints)

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\checkout-event.js` — receives Shopify Custom Pixel events from `shopify-custom-pixel.js`, sends InitiateCheckout + Purchase to Meta CAPI with `ic_{token}` / `purchase_{token}` event_ids. Stores enrichment (fbc/fbp/email) keyed by checkout_token for Purchase enrichment.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\add-to-cart.js` — receives browser bridge AddToCart.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\view-content.js` — receives browser bridge ViewContent.
- `api/ads/`, `api/ai/`, `api/approval/`, `api/cron/`, `api/google/oauth/`, `api/identity/`, `api/recovery/` — internal automation surfaces.

## 2. Meta Graph / CAPI callers

`grep -rn "graph.facebook.com"` (excluding `.vercel/output/` build artifacts):

| File | Purpose |
|---|---|
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\meta-capi.js:74` | **Canonical CAPI sender**, POSTs to `graph.facebook.com/{version}/{pixelId}/events` |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\meta-ads.js` | Meta Marketing API (insights, account) |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\meta-api-client.js` | Meta Marketing API (adset/ad writes, dry-run gated) |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\rate-limited-fetch.js` | Generic rate-limited fetch wrapper |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\ad-copy-auditor.js` | Ad copy audit against Meta |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\social-publisher.js` | Social publish path |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\ads\check-permissions.js` | Marketing API permission probe |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\cron\pixel-diag.js` | Pixel health diagnostics |
| `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\audit-full.js` | Admin audit tooling |

**Only `lib/meta-capi.js` is the CAPI events sender.** Everything else is Marketing API or diagnostics. No parallel/duplicate CAPI client.

## 3. Event ID strategy

All server-side CAPI event_ids are **deterministic** and keyed on Shopify identifiers:

| Event | Format | Source | Paired Custom Pixel |
|---|---|---|---|
| Purchase | `purchase_{checkout_token}` (fallback `purchase_{order_id}`) | `api/webhook/orders-paid.js:141` | `api/checkout-event.js:182` |
| InitiateCheckout | `ic_{checkout_token}` | `api/webhook/checkouts-create.js` (assumed) | `api/checkout-event.js:104` |
| AddToCart | `cart_{cart_id_or_token}` | `api/webhook/carts-create.js:86` — **not sent to Meta**, browser bridge is canonical | browser bridge via `/api/add-to-cart` |
| Lead | `lead_{customer_id}` | `api/webhook/customers-create.js` (per prior memory) | n/a |

Custom Pixel (`@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\shopify-custom-pixel.js`) subscribes to `checkout_started`, `checkout_contact_info_submitted`, `checkout_completed`. It sends to `/api/checkout-event`; the endpoint generates `ic_{token}` / `purchase_{token}` and forwards to Meta CAPI.

**Critical gap**: `shopify-custom-pixel.js` does NOT call `fbq('track', ...)` with a matching `eventID`. Browser Purchase/InitiateCheckout pixel events come from somewhere else (Meta Pixel via GTM web or Shopify F&I integration) and those use random event_ids. This is the primary dedup failure for the 58.79% coverage gap.

## 4. Five Windsurf findings — status

| # | Finding | Status |
|---|---|---|
| 1 | `api/webhook/carts-create.js:80` missing `await` on `isDuplicate()` | ✅ **CONFIRMED** at line 80. Note: endpoint is diagnostic-only (lines 97-101 comment), so missing `await` makes the Promise always truthy and the endpoint returns `duplicate` 100% of the time. Endpoint is effectively dead. Low severity but worth fixing. |
| 2 | `lib/publisher.js:180` TODO on `doPublish()` | ✅ **CONFIRMED** at lines 179-193. Returns mock `{ ok: true }` without calling any API. **It IS called** at line 154, meaning `publishApproved()` reports success for content that was never actually published. Real bug. |
| 3 | `@anthropic-ai/sdk` in package.json but unused | ❌ **STALE** — not present in `package.json` dependencies (only `@upstash/qstash`, `@upstash/redis`, `dotenv`, `express`, `form-data`, `node-fetch`). Mentioned only in docs. Nothing to remove. |
| 4 | Duplicate route `api/webhook/predis-callback.js` vs `api/webhooks/predis-callback.js` | ✅ **CONFIRMED** both files exist. |
| 5 | Schedule discrepancy: memory 9x/day vs code 3x/day | ❌ **REVERSED** — code says **9x/day** via `bootstrap.js:192` cron `0 7,9,11,13,15,17,19,21,23 * * *`. Memory agrees. No reconciliation needed. |

## 5. Schedule inventory (from `scripts/bootstrap.js`)

23 total QStash schedules, all with `CRON_TZ=Europe/Amsterdam`:

### Ops (10)

| Schedule ID | Cron | Path |
|---|---|---|
| `calqix-optimizer` | `0 7,9,11,13,15,17,19,21,23 * * *` (9x/day) | `/api/ads/monitor` |
| `calqix-recovery` | `* * * * *` (every minute) | `/api/recovery/run` |
| `calqix-content-morning` | `45 5 * * *` | `/api/cron/content-morning` |
| `calqix-content-review` | `5 7 * * *` | `/api/cron/content-review` |
| `calqix-content-publish-am` | `30 8 * * *` | `/api/cron/content-publish?slot=post1` |
| `calqix-content-publish-pm` | `30 18 * * *` | `/api/cron/content-publish?slot=post2` |
| `calqix-content-reflect` | `30 21 * * *` | `/api/cron/content-reflect` |
| `calqix-ad-morning` | `0 9 * * *` | `/api/cron/ad-morning` |
| `calqix-ad-midday` | `0 15 * * *` | `/api/cron/ad-midday-check` |
| `calqix-ad-daily-close` | `0 21 * * *` | `/api/cron/ad-daily-close` |

### Observability (9)

`calqix-identity-backfill` `*/15`, `calqix-bridge-health` `*/10`, `calqix-dedup-audit` `*/30`, `calqix-anomaly-watch` `*/5 9-23`, `calqix-emq-deep` `0 *`, `calqix-pixel-diag` `15 *`, `calqix-webhook-audit` `5,35 *`, `calqix-reconciliation` `0 4`, `calqix-identity-cleanup` `0 3`.

### AI (3)

`calqix-ai-tactical` `2,32 6-23 * * *`, `calqix-ai-strategic` `0 6 * * *`, `calqix-ai-architectural` `0 6 * * 0`.

### Ads pipeline (1)

`calqix-gads-upload` (every 15 min).

Legacy schedules to clean: `calqix-daily-monitor`, `calqix-optimizer-morning`, `calqix-optimizer-afternoon`, `calqix-optimizer-evening`, `calqix-content-insights`, `calqix-content-plan`, `calqix-content-generate`, `calqix-ad-perf-sync`, `calqix-ad-opt-engine`, `calqix-ad-opt-report` (handled via `LEGACY_IDS` array at `bootstrap.js:48-52`).

## 6. `vercel.json`

Only contains a rewrite `/` → `/api/index`. **No Vercel-native cron jobs.** All scheduling is via QStash.

## 7. `npm run schedule:list`

Not executed in preflight (requires valid QStash token in env). Recommend running before implementation to cross-check live state vs `bootstrap.js` definitions. Command:

```powershell
npm run schedule:list
```

Run from `c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi`.

---

## Summary of actionable findings for Task 10

- **10a**: 1-line fix (add `await`). Low risk.
- **10b**: decide stub vs implement vs hard-fail. Recommend hard-fail to prevent false success reports:
  ```javascript
  throw new Error('doPublish not implemented; approved content must route through Predis');
  ```
  And also audit callers to ensure the Predis path is used for real publishes.
- **10c**: skip, already clean.
- **10d**: pick `api/webhooks/predis-callback.js` as canonical (plural matches Shopify convention), convert singular to a 301 redirect stub. Operator must verify Predis.ai webhook URL points to the plural path.
- **10e**: skip (code matches memory at 9x/day).
- **10f**: `META_CAPI_ROLE.md` will state: `calqix-capi` is the canonical server-side Meta CAPI source. Not deprecated. No kill switch required. Migration comments at the top of webhook handlers should be updated to remove the "will be replaced by GTM server container" note.

---

## Admin-side verifications required before Task 9 build

1. Shopify admin > Settings > Customer events > App pixels: is the Custom Pixel from `shopify-custom-pixel.js` installed? Name, status, and any other pixels present.
2. Shopify admin > Sales channels > Facebook & Instagram > Settings > Data sharing level (Standard/Enhanced/Maximum) and whether the Conversions API toggle is on.
3. Meta Events Manager > Data Sources > Overview: does it show "Verbonden met Shopify" and if so, which pixel, and is it firing events today?
4. Current `.env` / Vercel env vars for `calqix-capi`: `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `CAPI_ENABLED` (if set). Do not paste values; just confirm presence.

---

Waiting for confirmation before any file edits.
