# CALQIX Meta CAPI — Real-Time + Recovery Architecture

## Overview

Two-layer event delivery ensures every Meta conversion event is tracked:

1. **Real-time layer** — Browser bridge, Custom Pixel, and Shopify webhooks fire events immediately
2. **Recovery layer** — QStash 1-minute schedule retries only genuinely failed events from a Redis queue

## Event Flow Diagram

```
Browser (calqix-meta-bridge.js)
  ├── ViewContent → POST /api/view-content → Meta CAPI
  ├── AddToCart   → POST /api/add-to-cart   → Meta CAPI
  └── (browser fbq() calls with shared event_id for dedup)

Shopify Custom Pixel (checkout sandbox)
  ├── checkout_started              → POST /api/checkout-event → Meta CAPI (IC)
  ├── checkout_contact_info_submitted → POST /api/checkout-event → Redis enrichment
  └── checkout_completed            → POST /api/checkout-event → Meta CAPI (Purchase)

Shopify Webhooks (server-to-server, HMAC verified)
  ├── checkouts/create  → /api/webhook/checkouts-create  → Meta CAPI (IC fallback)
  ├── orders/paid       → /api/webhook/orders-paid       → Meta CAPI (Purchase fallback)
  ├── customers/create  → /api/webhook/customers-create  → Meta CAPI (Lead)
  └── carts/create      → /api/webhook/carts-create      → diagnostic only

Recovery (QStash every minute)
  └── POST /api/recovery/run → Redis queue → retry failed Meta sends
```

## Event Lifecycle State Machine

Each event tracked in Redis key `meta:event:{event_id}`:

```
received → prepared → sent → confirmed ✓
                          └→ retry_pending → sent (retry) → confirmed ✓
                                                         └→ retry_pending (again, up to 5x)
                                                         └→ failed_terminal ✗
                          └→ recovered ✓ (via recovery job)
```

States:
- **received** — Event arrived from source (webhook, pixel, recovery)
- **prepared** — User data formatted, ready to send
- **sent** — Meta CAPI call made
- **confirmed** — Meta returned success (HTTP 200 + ok)
- **retry_pending** — Meta failed, queued for retry (attempts < 5)
- **failed_terminal** — Max retries exceeded, event abandoned
- **recovered** — Recovery job successfully resent the event

## Deduplication Strategy

| Event | Source | event_id format | Dedup key |
|-------|--------|----------------|-----------|
| InitiateCheckout | Pixel + Webhook | `ic_{checkout_token}` | `dedup:InitiateCheckout:{token}` |
| Purchase | Pixel + Webhook | `purchase_{checkout_token}` | `dedup:Purchase:{token}` |
| Lead | Webhook | `lead_{customer_id}` | `dedup:Lead:{customer_id}` |
| ViewContent | Browser | `viewcontent_{product_id}_{ts}` | None (no server dedup) |
| AddToCart | Browser | `addtocart_{product_id}_{ts}` | None (no server dedup) |

Browser events use shared `event_id` between `fbq()` call and server POST for Meta-side dedup.

## Redis Key Reference

| Key Pattern | TTL | Purpose |
|------------|-----|---------|
| `dedup:{event}:{id}` | 48h | Prevents duplicate Meta event sends |
| `enrich:{checkout_token}` | 24h | Stores email/phone/fbc/fbp from checkout |
| `meta:event:{event_id}` | 7d | Event lifecycle state (JSON) |
| `meta:pending:{event_id}` | 7d | Flag: event not yet confirmed |
| `meta:failed:{event_id}` | 7d | Flag: event failed at least once |
| `recovery:queue` | — | Redis list of event_ids to retry |
| `recovery:cursor:{topic}` | 30d | Shopify API polling cursor |
| `lock:recovery` | 2min | Distributed lock for recovery job |
| `lock:optimizer:{slot}` | 5min | Distributed lock for optimizer (morning/evening) |
| `optimizer:run:{date}:{slot}` | 48h | Idempotency: prevents duplicate optimizer runs |
| `notify:{runId}` | 48h | Notification delivery status |
| `artifact:{runId}` | 7d | Run artifact metadata |

## Recovery Job Details

**Endpoint:** `POST /api/recovery/run`
**Schedule:** QStash every minute (`* * * * *` Amsterdam time)
**Auth:** QStash signature or CRON_SECRET

### Logic:
1. Acquire `lock:recovery` (TTL 120s)
2. Pop up to 10 items from `recovery:queue`
3. For each event_id:
   - Load event state from `meta:event:{id}`
   - Skip if already confirmed/recovered/terminal
   - Skip if max retries (5) exceeded → mark terminal
   - Retry Meta CAPI send
   - Update state accordingly
4. Release lock

### What it does NOT do:
- Does NOT scan Redis keys (no SCAN operations)
- Does NOT blindly resend events
- Does NOT create fake events
- Does NOT poll Shopify API (that's a future enhancement)

## Twice-Daily Optimizer

**Endpoint:** `POST /api/ads/monitor`
**Schedule:** QStash at 07:00 and 19:00 Amsterdam time
**Auth:** QStash signature or CRON_SECRET

### Slot-based idempotency:
- Morning slot (00:00–12:59 Amsterdam): key `optimizer:run:{date}:morning`
- Evening slot (13:00–23:59 Amsterdam): key `optimizer:run:{date}:evening`
- Each slot runs independently with its own lock and idempotency key

### Trigger rules (11 total):
| # | Rule | Severity |
|---|------|----------|
| 1 | AD_KILLER | URGENT |
| 2 | CREATIVE_FATIGUE | URGENT |
| 3 | BUDGET_UNDERUTILIZED | WARNING |
| 4 | LEARNING_LIMITED | WARNING |
| 5 | WINNER | INFO |
| 6 | SPENDING_SPIKE | URGENT |
| 7 | CHECKOUT_DROPOFF | WARNING |
| 8 | CART_ABANDONMENT | WARNING |
| 9 | LOW_PRODUCT_CONVERSION | WARNING |
| 10 | HIGH_CPC | INFO |
| 11 | BILLING_THRESHOLD | URGENT |

## QStash Schedules

| ID | Endpoint | Cron | Retries |
|----|----------|------|---------|
| `calqix-optimizer-morning` | `/api/ads/monitor` | `0 7 * * *` Amsterdam | 3 |
| `calqix-optimizer-evening` | `/api/ads/monitor` | `0 19 * * *` Amsterdam | 3 |
| `calqix-recovery` | `/api/recovery/run` | `* * * * *` Amsterdam | 1 |

Manage via:
```bash
npm run schedule:create:all   # Create optimizer + recovery schedules
npm run schedule:list          # List all schedules
npm run schedule:delete        # Delete all CALQIX schedules
```
