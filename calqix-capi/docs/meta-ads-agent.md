# Meta Ads Monitoring Agent — Architecture

## Overview

The CALQIX Ads Monitor is a Windsurf-run automation agent that:
1. Fetches Meta Ads Insights 3x daily (07:00, 12:00, 19:00 Amsterdam)
2. Evaluates 12 trigger rules across ads, funnel, and billing
3. Sends structured Telegram reports with funnel metrics, ad-level performance, and billing
4. Generates Windsurf task files for manual or automated execution
5. Optionally auto-executes safe actions (pause underperforming ads)

## Trigger Rules

| # | Rule | Severity | Condition | Auto-action |
|---|---|---|---|---|
| 1 | AD_KILLER | URGENT | ≥1000 impressions, CTR < 0.8% | Pause (if AUTO_PAUSE=true) |
| 2 | CREATIVE_FATIGUE | URGENT | Frequency > 3.0 | — |
| 3 | BUDGET_UNDERUTILIZED | WARNING | <50% of expected 3d spend | — |
| 4 | LEARNING_LIMITED | WARNING | effective_status = LEARNING_LIMITED | — |
| 5 | WINNER | INFO | ≥500 imp, CTR > 3%, Cost/ATC < €10 | — |
| 6 | SPENDING_SPIKE | URGENT | Today spend > 1.5x daily budget | — |
| 7 | SPEND_STARVED | WARNING | Ad gets <5% of adset spend, <100 imp | — |
| 8 | CHECKOUT_DROPOFF | WARNING | IC→Purchase < 25% (7d) | — |
| 9 | CART_ABANDONMENT | WARNING | ATC→IC < 30% (7d) | — |
| 10 | LOW_PRODUCT_CONVERSION | WARNING | VC→ATC < 5% (7d) | — |
| 11 | HIGH_CPC | INFO | Average CPC > €2.00 (7d) | — |
| 12 | BILLING_THRESHOLD | URGENT | Balance ≥ 90% of threshold | — |

## Auto-Action Framework

All auto-actions are **disabled by default**. Enable via environment variables:

- `META_OPTIMIZER_AUTO_PAUSE=true` — Pause ads that trigger AD_KILLER
- `META_OPTIMIZER_AUTO_BUDGET_ADJUST=true` — Reserved for future budget scaling

Safety constraints:
- Daily budget NEVER exceeds €200 (`MAX_DAILY_BUDGET`)
- Budget can only increase by max 2x per adjustment
- Pause actions are logged and reported in Telegram
- All actions create audit trail in Redis artifacts

## Telegram Report Format

```
📊 CALQIX Ads Monitor - DD-MM-YYYY

🔴 ACTIE NODIG:
- [urgent triggers]

⚠️ ADS - LET OP:
- [ad warnings]

🌐 WEBSITE OPTIMALISATIE:
- [funnel warnings]

🏆 WINNERS:
- [winning ads]

🤖 AUTO-ACTIES:
- ✅/❌ PAUSE_AD: [ad name]

⚡ VANDAAG (Meta-attributed):
- Spend: €X.XX
- VC→ATC→IC→Purchase: X→X→X→X
- Revenue: €X.XX | ROAS: X.XXx
- Cost/ATC: €X.XX | Cost/Purchase: €X.XX

📈 7-DAG FUNNEL (Meta-attributed):
- [same format]

🎯 TOP ADS (3d):
• Ad Name | €spend | CTR X.X% | ATC X | Purch X

💳 ACCOUNT & BILLING:
- Openstaand: €X.XX
- Totaal uitgegeven: €X.XX
- Drempel: €112 (env_config_manual)

🔧 Auto: pause=OFF budget=OFF
```

## Data Sources

All purchase/revenue metrics are **Meta-attributed** from the Marketing API Insights endpoint.
This is the canonical source of truth — NOT Shopify order counts or internal CAPI event counts.

Billing threshold is NOT available via the public Meta Marketing API.
It must be configured manually via `BILLING_THRESHOLD` env var (default: €112).

Readable billing fields (official API):
- `balance` — Outstanding payable balance
- `amount_spent` — Total lifetime spend
- `spend_cap` — Account-level spend cap (readable + writable)
- `currency` — Account currency
- `account_status` — Active/disabled/etc.

## File Architecture

```
lib/meta-insights-source.js  — Canonical Meta Insights fetcher
lib/meta-ads.js              — Meta Marketing API client (GET/POST)
lib/capi-diagnostics.js      — Parameter coverage tracking
api/ads/monitor.js           — Main monitor endpoint (3x daily via QStash)
api/ads/actions.js           — Manual action execution endpoint
.windsurf/tasks/ads-*.md     — Auto-generated task files
.windsurf/workflows/ads-optimize.md — Windsurf workflow
```

## Windsurf Workflow

Execute `/ads-optimize` in Windsurf to process today's task file.
The workflow reads the task file, fetches current ad data, and applies recommended actions.
