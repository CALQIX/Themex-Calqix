# CALQIX Unified Tracking Pipeline

Multi-platform server-side event pipeline for CALQIX Shopify store.
Platforms: **Meta CAPI** + **Google (GA4 MP / Ads OCI)** + **TikTok Events API**.
Runtime: Node.js 24.x on Vercel Serverless Functions.

## Architecture

```
Browser Bridge (calqix-meta-bridge.js)
  ├── fbclid → _fbc, gclid/gbraid/wbraid/ttclid capture
  ├── _fbp fallback generation, _cq_anon_id (365d)
  ├── identity capture → POST /api/identity/capture
  └── ViewContent / AddToCart → POST /api/view-content, /api/add-to-cart

Shopify Webhooks (HMAC verified)
  └── orders/paid, checkouts/create, carts/create, customers/create
      ├── Meta CAPI (lib/meta-capi.js)
      ├── GA4 MP (lib/ga4-mp.js)
      ├── Google Ads OCI (lib/google-ads-oci.js)
      └── TikTok Events (lib/tiktok-events.js)

Observability (9 QStash crons)
  └── identity-backfill, bridge-health, dedup-audit, anomaly-watch,
      emq-deep, pixel-diag, webhook-audit, reconciliation, identity-cleanup

AI System Optimizer (3 QStash crons + incident endpoint)
  └── tactical (30m), strategic (daily), architectural (weekly)
      + POST /api/ai/incident-analysis (triggered by P0/P1)

Content Automation (5 QStash crons)
  └── morning chain, review, publish-am, publish-pm, reflect

Ad Optimization (3 QStash crons)
  └── ad-morning, ad-midday, ad-daily-close
```

## Tracking decisions

| Decision | Value | Notes |
|---|---|---|
| **Meta Pixel ID** | `934134615770602` | "Calqix's pixel" — canonical, confirmed |
| **Retired pixel ref** | `1400881244790983` | Incorrectly referenced in old session |
| **GTM Web** | `GTM-T86BFXXW` | Active in `theme.liquid`, standard Google-hosted |
| **No server-side GTM** | Policy | All server-side via calqix-capi |

## Endpoints

### Shopify webhook handlers (HMAC verified)

| Endpoint | Event | Shopify topic |
|---|---|---|
| `POST /api/webhook/orders-paid` | Purchase | `orders/paid` |
| `POST /api/webhook/checkouts-create` | InitiateCheckout | `checkouts/create` |
| `POST /api/webhook/carts-create` | AddToCart | `carts/create` |
| `POST /api/webhook/customers-create` | Lead | `customers/create` |

### Custom endpoints

| Endpoint | Description |
|---|---|
| `POST /api/view-content` | ViewContent — from bridge JS |
| `POST /api/add-to-cart` | AddToCart — from bridge JS |
| `POST /api/identity/capture` | Identity enrichment from checkout fields |
| `POST /api/ai/incident-analysis` | AI incident analysis (P0/P1 triggered) |
| `GET /api/diagnostics` | Health check and env status |

### Observability crons (QStash scheduled)

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/identity-backfill` | */15 min | Re-enrich low-EMQ events |
| `/api/cron/bridge-health` | */10 min | Detect capture volume drops |
| `/api/cron/dedup-audit` | */30 min | Cross-platform dedup check |
| `/api/cron/anomaly-watch` | */5 min 09-23 | Z-score event anomaly detection |
| `/api/cron/emq-deep` | Hourly | Per-field EMQ breakdown |
| `/api/cron/pixel-diag` | Hourly :15 | Pull platform diagnostics |
| `/api/cron/webhook-audit` | */30 min :05,:35 | Stale event detection |
| `/api/cron/reconciliation` | Daily 04:00 | Cross-platform order matching |
| `/api/cron/identity-cleanup` | Daily 03:00 | Redis key hygiene |

### AI optimizer crons

| Endpoint | Schedule | Tokens | Purpose |
|---|---|---|---|
| `/api/cron/ai-tactical` | */30 min 06-23 | ~5K | Quick health scan |
| `/api/cron/ai-strategic` | Daily 06:00 | ~30K | Deep 24h analysis |
| `/api/cron/ai-architectural` | Weekly Sun 06:00 | ~60K | Structural review |

## Environment variables

### Required
```env
META_PIXEL_ID=934134615770602
META_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
CRON_SECRET=
ANTHROPIC_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Platform — Google (optional, disabled by default)
```env
GA4_MEASUREMENT_ID=
GA4_API_SECRET=
GA4_ENABLED=false
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_CONVERSION_ACTION_ID=
GOOGLE_ADS_ENABLED=false
```

### Platform — TikTok (optional, disabled by default)
```env
TIKTOK_PIXEL_ID=
TIKTOK_ACCESS_TOKEN=
TIKTOK_ENABLED=false
```

### Automation modes
```env
CONTENT_AUTOMATION_MODE=LIVE           # DRAFT_ONLY | APPROVAL_REQUIRED | LIVE | AUTO_PUBLISH
CONTENT_ENABLE_PREDIS=true             # Enable Predis in content pipeline
ADS_OPTIMIZATION_MODE=TELEGRAM_APPROVAL # MONITOR_ONLY | SUGGEST | TELEGRAM_APPROVAL | EXECUTE | AUTO_EXECUTE
ENABLE_AD_WRITES=true                  # Meta API writes gate
AI_OPTIMIZER_ENABLED=true              # Kill switch for AI crons
AI_TOKEN_BUDGET_DAILY=200000           # Max input tokens per day
```

### Optional
```env
META_API_VERSION=v21.0
META_TEST_EVENT_CODE=
DIAGNOSTICS_KEY=
GITHUB_TOKEN=                          # For AI optimizer PR creation
CAPI_BASE_URL=https://calqix-capi.vercel.app
```

## Theme integration

The browser bridge (`assets/calqix-meta-bridge.js`) handles:

1. `fbclid` → `_fbc` cookie persistence
2. `_fbp` fallback generation if Meta Pixel hasn't set it
3. `gclid`, `gbraid`, `wbraid`, `ttclid` capture to cookies
4. `_cq_anon_id` stable anonymous ID (localStorage + cookie, 365d)
5. Cart attribute sync (`_meta_fbc`, `_meta_fbp`)
6. Auto ViewContent on product pages, AddToCart interception
7. Identity capture on Shopify checkout fields → `/api/identity/capture`
8. Public API: `window.calqixMeta.*`

## QStash schedules (22 total)

Run `node scripts/bootstrap.js create-all-schedules` to create.
Run `node scripts/bootstrap.js list-schedules` to verify.

## Development

```bash
npm install
npm run check           # Syntax validation of all files
npm run bootstrap       # Full verification suite
npm run schedule:list   # List QStash schedules
npm run schedule:create # Create all schedules
```

## Security

- Secrets only in `.env` or Vercel env vars
- Never hardcode tokens in source
- Validate every Shopify webhook with HMAC
- Never log raw PII (only hashed presence flags)
- Always return HTTP 200 to Shopify webhooks
- AI optimizer: no auto-apply beyond ±20% threshold tunes
- Max ad budget: €200/day hard cap
- Telegram approval required for non-safe ad actions
