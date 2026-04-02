# Meta CAPI Hardening — Summary

## Audit Findings (Before)

| Event | Browser→Server | Shared event_id | em | fbp | fbc | external_id | Dedup |
|---|---|---|---|---|---|---|---|
| PageView | Meta Pixel only | ❌ | ❌ | auto | auto | ❌ | N/A |
| ViewContent | Bridge + /api/view-content | ✅ | ~10% | ~10% | ~10% | ~2% | ✅ |
| AddToCart | Bridge + /api/add-to-cart | ✅ | ~6% | ~6% | ~6% | ~2% | ❌ (no guard) |
| InitiateCheckout | Custom Pixel + webhook | ✅ ic_{token} | ✅ | ✅ | ✅ | ✅ | ✅ |
| Purchase | Custom Pixel + webhook | ✅ purchase_{token} | ✅ | ✅ | ✅ | ✅ | ✅ |

**Key gap**: AddToCart match quality was 3.5/10 — mostly anonymous users with no external_id or fbp.

## Changes Made

### 1. Stable Anonymous external_id (Bridge)
- New `_cq_anon_id` persisted in localStorage + cookie (365 days)
- Every user gets a consistent external_id, even anonymous
- Logged-in users use Shopify customer ID; anonymous users use `cq_{timestamp}_{random}`
- Expected impact: external_id coverage **2% → ~100%**

### 2. Phone Number Extraction (Bridge)
- Added `getCustomerPhone()` that reads `window.meta.customer.phone`
- Passed to all server endpoints as `phone` field
- `formatUserData` already handles phone normalization and hashing

### 3. Improved fbp Persistence (Bridge)
- Added 3-second retry after page load to catch _fbp cookie set by Meta Pixel
- Meta Pixel may load after bridge; retry ensures fbp is synced to cart attributes

### 4. AddToCart Endpoint Hardening
- Added `dedup-guard` — prevents duplicate sends from rapid clicks
- Added `event-state` tracking — full lifecycle in Redis
- Added parameter diagnostics stored in Redis (TTL 24h)
- Added phone support in user_data

### 5. Parameter Coverage Diagnostics
- New `lib/capi-diagnostics.js` module
- Records per-event parameter coverage in Redis
- Daily summary aggregation (em%, ph%, fbp%, fbc%, external_id%)
- Available via diagnostics endpoint

### 6. Meta Insights Source of Truth
- New `lib/meta-insights-source.js` module
- Canonical data fetcher for all Meta Marketing API insights
- Parallel fetching: today, 3d, 7d account-level + ad-level + adset-level
- Account billing: balance, amount_spent, spend_cap (read-only)
- billing_threshold NOT available via API — uses env config

## Redis Key Patterns (New)

| Pattern | TTL | Purpose |
|---|---|---|
| `diag:atc:{eventId}` | 24h | AddToCart parameter diagnostics |
| `diag:coverage:{event}:{id}` | 24h | Per-event coverage record |
| `diag:summary:{YYYY-MM-DD}` | 7d | Daily aggregated coverage summary |

## Environment Variables (New)

| Variable | Default | Purpose |
|---|---|---|
| `META_OPTIMIZER_AUTO_PAUSE` | `false` | Enable auto-pause of underperforming ads |
| `META_OPTIMIZER_AUTO_BUDGET_ADJUST` | `false` | Enable auto-budget adjustment |
| `BILLING_THRESHOLD` | `112` | Manual billing threshold in EUR (not available via API) |
