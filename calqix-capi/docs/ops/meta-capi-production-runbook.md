# CALQIX Meta CAPI — Production Runbook

## Architecture Overview

```
Browser (calqix-meta-bridge.js)
  ├── ViewContent → POST /api/view-content → Meta CAPI
  ├── AddToCart   → POST /api/add-to-cart   → Meta CAPI
  └── (pixel fbq calls for dedup)

Shopify Custom Pixel (checkout sandbox)
  ├── checkout_started              → POST /api/checkout-event → Meta CAPI (InitiateCheckout)
  ├── checkout_contact_info_submitted → POST /api/checkout-event → Redis enrichment store
  └── checkout_completed            → POST /api/checkout-event → Meta CAPI (Purchase)

Shopify Webhooks (server-to-server)
  ├── carts/create      → /api/webhook/carts-create      → diagnostic only (no Meta send)
  ├── checkouts/create  → /api/webhook/checkouts-create  → Meta CAPI (IC fallback, shared event_id)
  ├── orders/paid       → /api/webhook/orders-paid       → Meta CAPI (Purchase fallback, shared event_id)
  └── customers/create  → /api/webhook/customers-create  → Meta CAPI (Lead)

QStash Schedule (daily 07:00 Amsterdam)
  └── POST /api/ads/monitor → Redis lock+idem → Meta Ads API → Telegram → GitHub task
      ├── callback:         POST /api/ads/monitor-callback?type=success
      └── failureCallback:  POST /api/ads/monitor-callback?type=failure
```

## Required Environment Variables

Set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Source | Purpose |
|----------|----------|--------|---------|
| `META_PIXEL_ID` | Yes | Meta Business Settings | `934134615770602` |
| `META_ACCESS_TOKEN` | Yes | Meta Events Manager | CAPI access token |
| `SHOPIFY_WEBHOOK_SECRET` | Yes | Shopify Admin | HMAC webhook verification |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Console | Durable state store |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Console | Durable state store |
| `QSTASH_TOKEN` | Yes | Upstash Console | QStash scheduling API |
| `QSTASH_CURRENT_SIGNING_KEY` | Yes | Upstash Console | QStash signature verification |
| `QSTASH_NEXT_SIGNING_KEY` | Yes | Upstash Console | QStash signature rotation |
| `CRON_SECRET` | Yes | Self-generated | Manual test auth + Vercel Cron fallback |
| `TELEGRAM_BOT_TOKEN` | Yes | @BotFather | Notification delivery |
| `TELEGRAM_CHAT_ID` | Yes | Telegram | Notification destination |
| `GITHUB_TOKEN` | Optional | GitHub Settings | Windsurf task file creation |
| `GITHUB_REPO` | Optional | — | Default: `CALQIX/Themex-Calqix` |
| `CAPI_ENABLED` | Optional | — | Set to `false` to disable Meta sends |
| `META_TEST_EVENT_CODE` | Optional | Meta Events Manager | Test event code for validation |
| `BILLING_THRESHOLD` | Optional | — | Default: `74` (EUR) |

## Setup Order

### One-time setup (do once)

1. **Create Upstash Redis database**
   - Go to https://console.upstash.com → Create Database
   - Region: `eu-west-1` (closest to NL)
   - Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

2. **Create Upstash QStash**
   - Go to https://console.upstash.com → QStash tab
   - Copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`

3. **Add all env vars to Vercel**
   - Vercel Dashboard → calqix-capi → Settings → Environment Variables
   - Add each variable for Production environment

4. **Deploy**
   ```
   vercel --prod --yes
   ```

5. **Verify Redis + QStash connectivity**
   ```
   cd calqix-capi
   node scripts/bootstrap.js verify-redis
   node scripts/bootstrap.js verify-qstash
   ```

6. **Create QStash schedule**
   ```
   node scripts/bootstrap.js create-schedule
   ```

7. **Verify schedule exists**
   ```
   node scripts/bootstrap.js list-schedules
   ```

8. **Install Shopify Custom Pixel** (one manual step)
   - Shopify Admin → Settings → Customer events
   - Click "Add custom pixel"
   - Name: `CALQIX Meta CAPI`
   - Paste contents of `calqix-capi/shopify-custom-pixel.js`
   - Click Save → Connect

9. **Run full verification**
   ```
   node scripts/bootstrap.js verify-all
   ```

10. **Optional: Remove Vercel Cron**
    - Once QStash is confirmed working, remove the `crons` from `vercel.json`
    - The monitor endpoint still accepts both QStash and CRON_SECRET auth

## Redis Key Reference

| Key Pattern | TTL | Purpose |
|------------|-----|---------|
| `dedup:{event}:{id}` | 48h | Prevents duplicate Meta event sends |
| `enrich:{checkout_token}` | 24h | Stores email/phone/fbc/fbp from checkout contact info |
| `meta:event:{event_id}` | 7d | Event lifecycle state (JSON) |
| `meta:pending:{event_id}` | 7d | Flag: event not yet confirmed |
| `meta:failed:{event_id}` | 7d | Flag: event failed at least once |
| `recovery:queue` | — | Redis list of event_ids to retry |
| `recovery:cursor:{topic}` | 30d | Shopify API polling cursor |
| `lock:recovery` | 2min | Distributed lock for recovery job |
| `lock:optimizer:{slot}` | 5min | Distributed lock for optimizer (morning/evening) |
| `optimizer:run:{date}:{slot}` | 48h | Idempotency — prevents duplicate optimizer runs per slot |
| `notify:{runId}` | 48h | Notification delivery status |
| `artifact:{runId}` | 7d | Run artifact metadata |

## Operations

The system runs automatically on three schedules:

### Twice-daily optimizer (07:00 + 19:00 Amsterdam)
1. QStash triggers `POST /api/ads/monitor`
2. Monitor determines slot (morning/evening), acquires slot lock, checks slot idempotency
3. Fetches Meta Ads API data, evaluates 11 trigger rules
4. Sends Telegram notification (always)
5. Creates GitHub task file if actions needed
6. Persists run metadata to Redis

### Recovery job (every minute)
1. QStash triggers `POST /api/recovery/run`
2. Acquires recovery lock (TTL 120s)
3. Pops up to 10 items from `recovery:queue`
4. Retries failed Meta CAPI sends (max 5 attempts per event)
5. Updates event lifecycle state in Redis

**You receive Telegram messages twice daily:**
- If triggers fired: message includes action items + task file location
- If all clear: message shows funnel summary

## Verification Commands

```bash
# Full verification
node scripts/bootstrap.js verify-all

# Individual checks
node scripts/bootstrap.js verify-redis
node scripts/bootstrap.js verify-qstash
node scripts/bootstrap.js list-schedules

# Manual smoke test (force bypasses idempotency)
node scripts/bootstrap.js smoke-test

# Test specific endpoints
curl -X POST https://calqix-capi.vercel.app/api/checkout-event \
  -H "Content-Type: application/json" \
  -d '{"event_type":"checkout_started","checkout_token":"test123","value":29.95,"currency":"EUR"}'
```

## If Something Breaks

### Monitor didn't run this morning
1. Check Upstash QStash dashboard for delivery status
2. Check Vercel function logs for errors
3. Run manually: `node scripts/bootstrap.js smoke-test`
4. If Redis is down, the monitor still runs but without idempotency

### Duplicate events in Meta
1. Check Redis is connected: `node scripts/bootstrap.js verify-redis`
2. Check dedup keys exist: look for `dedup:*` keys in Upstash console
3. If Redis was down, dedup falls back to in-memory (not durable across cold starts)

### Custom Pixel not firing
1. Shopify Admin → Settings → Customer events → Check pixel status is "Connected"
2. Use browser DevTools Network tab during checkout — look for POST to `checkout-event`
3. Check Vercel function logs for `[CheckoutEvent]` entries

### QStash schedule lost
```bash
node scripts/bootstrap.js create-schedule
node scripts/bootstrap.js list-schedules
```

### Need to disable the system temporarily
- Set `CAPI_ENABLED=false` in Vercel env vars → redeploy
- Or delete QStash schedule: `node scripts/bootstrap.js delete-schedule`
