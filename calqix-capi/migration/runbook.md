# CALQIX Tracking Unification — Migration Runbook

## Overview
Migration from single-platform Meta-only tracking to unified multi-platform pipeline (Meta + Google + TikTok) with real-time observability and AI-driven optimization.

## Architecture decision: No server-side GTM
TAGGRS server-side GTM was evaluated and rejected. All server-side tracking runs via `calqix-capi` on Vercel for full control, lower latency, and simpler debugging.

## Pixel architecture decision
- **Canonical Meta Pixel:** `934134615770602` ("Calqix's pixel")
- **Retired reference:** `1400881244790983` was incorrectly referenced in earlier planning sessions — this is NOT the active pixel
- **Source of truth:** `META_PIXEL_ID` env var in Vercel production
- **Shopify FB/IG sales channel:** Verify if sending to same pixel; if different, disconnect or reconfigure

## Phase 1: Foundation (Week 1)
1. TAGGRS decommission (see `taggrs-removal-runbook.md`)
2. Pixel ID verification and documentation
3. `lib/rate-limited-fetch.js` — shared fetch with exponential backoff
4. `lib/alert-dedup.js` — P0/P1/P2 alert prioritization

## Phase 2: EMQ Optimization (Week 2-3)
1. `/api/identity/capture` endpoint
2. `lib/nl-postcode-province.js` — NL postcode → province mapping
3. Bridge updates for identity field capture
4. Webhook handler enrichment improvements
5. Browse event warm identity lookup

## Phase 3: Multi-Platform (Week 4-5)
1. `lib/ga4-mp.js` — GA4 Measurement Protocol
2. `lib/google-ads-oci.js` — Offline Conversion Import
3. `lib/tiktok-events.js` — TikTok Events API
4. Bridge updates for gclid/ttclid/gbraid/wbraid capture
5. Recovery queue multi-platform extension

## Phase 4: Observability (Week 6-7)
9 new cron endpoints under `/api/cron/`:
- `identity-backfill.js` (*/15 min)
- `bridge-health.js` (*/10 min)
- `dedup-audit.js` (*/30 min)
- `anomaly-watch.js` (*/5 min, 09-23)
- `emq-deep.js` (hourly)
- `pixel-diag.js` (hourly, :15)
- `webhook-audit.js` (*/30 min, :05,:35)
- `reconciliation.js` (daily 04:00)
- `identity-cleanup.js` (daily 03:00)

## Phase 5: AI System Optimizer (Week 8-9)
1. `lib/ai-system-optimizer.js` — Claude Sonnet 4 integration
2. AI crons: tactical (*/30 min), strategic (daily 06:00), architectural (weekly Sun 06:00)
3. `/api/ai/incident-analysis` — triggered by P0/P1 alerts
4. Approval queue extension for `ai_recommendation` items
5. Self-improvement loop with 15m/1h/6h/24h impact windows

## Phase 6: Automation States (Week 8, parallel with Phase 5)
1. Content automation: `DRAFT_ONLY` → `LIVE`
2. Predis: `false` → `true`
3. Ad optimization: add `TELEGRAM_APPROVAL` mode

## Env vars (new/changed)
| Variable | Default | Description |
|---|---|---|
| `AI_OPTIMIZER_ENABLED` | `true` | Kill switch for AI optimizer crons |
| `AI_TOKEN_BUDGET_DAILY` | `200000` | Max input tokens per day |
| `CONTENT_AUTOMATION_MODE` | `LIVE` | DRAFT_ONLY / APPROVAL_REQUIRED / AUTO_PUBLISH / LIVE |
| `CONTENT_ENABLE_PREDIS` | `true` | Enable Predis in content pipeline |
| `ADS_OPTIMIZATION_MODE` | `TELEGRAM_APPROVAL` | MONITOR_ONLY / SUGGEST / TELEGRAM_APPROVAL / EXECUTE / AUTO_EXECUTE |
| `GA4_MEASUREMENT_ID` | — | GA4 property measurement ID |
| `GA4_API_SECRET` | — | GA4 Measurement Protocol secret |
| `GOOGLE_ADS_CUSTOMER_ID` | — | Google Ads customer ID |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | — | Conversion action for OCI |
| `TIKTOK_PIXEL_ID` | — | TikTok pixel ID |
| `TIKTOK_ACCESS_TOKEN` | — | TikTok Events API token |
| `GITHUB_TOKEN` | — | Optional: for AI optimizer PR creation |

## Parallel run protocol
- New platforms: 48h logging-only before activation
- TAGGRS removal: 7d verification window
- Anomaly watch: 7d baseline collection before alerting
- AI optimizer: live in guarded mode from day 1
- Degradation > 10%: rollback via feature flag
