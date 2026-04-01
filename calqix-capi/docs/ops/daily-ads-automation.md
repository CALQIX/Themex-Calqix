# Daily Ads Automation — Operations Guide

## How It Works

1. **QStash** sends a POST request to `/api/ads/monitor` at **07:00 Amsterdam time** daily
2. The monitor endpoint:
   - Verifies QStash signature
   - Acquires a Redis distributed lock (prevents concurrent runs)
   - Checks Redis idempotency key (prevents duplicate daily runs)
   - Fetches Meta Ads API data (ad insights, adset status, billing)
   - Evaluates 11 trigger rules
   - Sends Telegram notification (always — success or failure)
   - Creates GitHub task file if actionable triggers fired
   - Persists run metadata to Redis
   - Releases lock

## Trigger Rules

| # | Rule | Severity | Condition |
|---|------|----------|-----------|
| 1 | AD_KILLER | URGENT | ≥1000 impressions, CTR < 0.8% |
| 2 | CREATIVE_FATIGUE | URGENT | Frequency > 3.0 |
| 3 | BUDGET_UNDERUTILIZED | WARNING | < 50% of budget spent in 3 days |
| 4 | LEARNING_LIMITED | WARNING | Ad set stuck in Learning Limited |
| 5 | WINNER | INFO | ≥500 impressions, CTR > 3%, cost/ATC < €10 |
| 6 | SPENDING_SPIKE | URGENT | Today's spend > 150% of daily budget |
| 7 | CHECKOUT_DROPOFF | WARNING | IC→Purchase rate < 25% |
| 8 | CART_ABANDONMENT | WARNING | ATC→IC rate < 30% |
| 9 | LOW_PRODUCT_CONVERSION | WARNING | VC→ATC rate < 5% |
| 10 | HIGH_CPC | INFO | Average CPC > €2.00 |
| 11 | BILLING_THRESHOLD | URGENT | Balance ≥ 95% of threshold |

## What You Receive

### Every morning (Telegram)
- Funnel summary (7-day: VC → ATC → IC → Purchase)
- Spend summary
- Any triggered actions with severity
- Link to task file if actions needed

### When actions are needed
- A task file is created at `.windsurf/tasks/ads-YYYY-MM-DD.md`
- Telegram message includes exact instructions:
  1. Open Windsurf
  2. Run `/ads-optimize`
  3. Or handle manually in Meta Ads Manager

## Manual Operations

### Force a run (bypass idempotency)
```bash
# Via bootstrap script
node scripts/bootstrap.js smoke-test

# Via direct URL
curl "https://calqix-capi.vercel.app/api/ads/monitor?secret=YOUR_CRON_SECRET&force=1"
```

### Check if today's run completed
Look in Upstash Redis console for key: `cron:run:YYYY-MM-DD`

### Schedule management
```bash
# View current schedule
node scripts/bootstrap.js list-schedules

# Recreate/update schedule
node scripts/bootstrap.js create-schedule

# Delete schedule (disables daily runs)
node scripts/bootstrap.js delete-schedule
```

## Failure Handling

| Failure Type | What Happens |
|-------------|-------------|
| Monitor crashes | Telegram failure notification sent, error persisted to Redis |
| Telegram down | Structured error logged to Vercel stdout (check logs) |
| Redis down | Monitor runs but without idempotency/lock protection |
| QStash delivery fails | Retries 3x, then calls failure callback which sends Telegram alert |
| Meta API rate limit | Individual API calls isolated — partial data still reported |
| GitHub API fails | Task file not created, but Telegram notification still sent |

## Recovery Procedures

### Monitor didn't run
1. Check QStash dashboard: https://console.upstash.com/qstash
2. Check Vercel logs for the monitor function
3. Force a manual run: `node scripts/bootstrap.js smoke-test`

### Schedule disappeared
```bash
node scripts/bootstrap.js create-schedule
```

### Redis lock stuck (rare)
The lock has a 5-minute TTL and auto-expires. If stuck:
- Wait 5 minutes, or
- Delete key `cron:lock` in Upstash console
