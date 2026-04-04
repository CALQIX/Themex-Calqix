# CALQIX Ad Optimization — Rules Engine & Automation

## Overview

Automated ad optimization system that evaluates Meta ad performance against configurable rules, proposes actions, and executes them based on safety level and operator approval.

## Daily Ad Optimization Schedule (Europe/Amsterdam)

| Time | Cron ID | Endpoint | Action |
|------|---------|----------|--------|
| 07:00 | `calqix-optimizer-morning` | `/api/ads/monitor` | Existing 3x daily monitor |
| 09:00 | `calqix-ad-perf-sync` | `/api/cron/ad-performance-sync` | Fetch + cache ad/adset/campaign data, update fatigue tracker |
| 09:15 | `calqix-ad-opt-engine` | `/api/cron/ad-optimization-engine` | Run rules engine, execute/queue proposals |
| 09:20 | `calqix-ad-opt-report` | `/api/cron/ad-optimization-report` | Send Telegram optimization summary |
| 12:00 | `calqix-optimizer-afternoon` | `/api/ads/monitor` | Existing monitor |
| 15:00 | `calqix-ad-midday` | `/api/cron/ad-midday-check` | Midday spend pacing, execute approved actions |
| 19:00 | `calqix-optimizer-evening` | `/api/ads/monitor` | Existing monitor |
| 21:00 | `calqix-ad-daily-close` | `/api/cron/ad-daily-close` | Daily close summary, archive state |

## Optimization Modes

| Mode | Behavior |
|------|----------|
| `MONITOR_ONLY` | Evaluate rules, log findings, take no action. Default. |
| `SUGGEST` | Evaluate rules, queue all proposals for approval |
| `AUTO_EXECUTE` | Execute `AUTO_SAFE` actions, queue `APPROVAL_REQUIRED` actions |

## Rules Engine

### Pause Rules (Ad Level)

| Rule | Trigger | Safety |
|------|---------|--------|
| `P1_LOW_CTR` | CTR < 0.8% with > 500 impressions | AUTO_SAFE (in AUTO_EXECUTE) |
| `P2_NO_CONVERSIONS` | Spent > €20 with 0 purchases and 0 ATC | AUTO_SAFE |
| `P3_EXCEED_CPA_THRESHOLD` | Spent > 3× target CPA with 0 purchases | AUTO_SAFE |
| `P4_HIGH_FREQUENCY` | Frequency > 3.5 | APPROVAL_REQUIRED |

### Scale Rules (Adset Level)

| Rule | Trigger | Safety |
|------|---------|--------|
| `S1_STRONG_ROAS` | ROAS > 2.0× with > €15 spend → +20% budget | APPROVAL_REQUIRED (AUTO_SAFE if AUTO_SCALE_ENABLED) |
| `S2_LOW_CPA` | Cost/purchase < 70% of target CPA → +20% budget | APPROVAL_REQUIRED |

### Detection Rules

| Rule | Trigger | Action |
|------|---------|--------|
| `SS1_SPEND_STARVED` | < 5% of adset spend, < 100 impressions | Flag for review |
| `F1_CTR_DECLINE` | CTR dropped > 30% from peak (>1000 impressions) | Flag for creative refresh |

## Safety Protections

- **MAX_ADSET_BUDGET**: €50 per adset (configurable)
- **MAX_DAILY_SPEND**: €100 total account (configurable, never exceeds €200)
- **Budget scale cooldown**: Max 1 increase per 48h per adset
- **Idempotency**: Each action deduped per entity + rule + date
- **Dry-run**: All writes logged before execution when `ENABLE_AD_WRITES !== 'true'`
- **Account-level guard**: Scale blocked if total daily spend would exceed MAX_DAILY_SPEND

## Fatigue Tracker (`ad-fatigue-tracker.js`)

- Tracks 7-day CTR history per ad
- Detects fatigue when CTR drops > 30% from peak with > 1000 impressions
- Updated daily during ad-performance-sync
- Feeds into rules engine for `F1_CTR_DECLINE` detection

## Example Telegram Ad Report

```
📈 CALQIX Ad Optimization Report

⚙️ Mode: SUGGEST

⏳ AWAITING APPROVAL:
• pause_ad: NL_Angle_3_Routine_V2
  Reason: CTR 0.65% with 1200 impressions
  Approve: /api/approval/approve?id=aq_abc123

⚠️ FLAGGED FOR REVIEW:
• F1_CTR_DECLINE: NL_Angle_1_Microbioom_V1 — CTR dropped 35% from peak
• SS1_SPEND_STARVED: NL_Angle_5_Test — Only 3% of adset spend (45 impressions)

🏆 TOP 3 ADS:
• NL_Angle_2_Enamel | €12.50 | CTR 2.3% | ROAS 3.10x
• NL_Angle_4_Flosser | €8.20 | CTR 1.8% | ROAS 2.50x
• DE_Angle_1_Science | €6.10 | CTR 1.5% | ROAS 1.90x

💰 Today spend: €45.80

📫 Queue: 2 pending, 1 approved, 3 executed
```

## Redis Key Patterns

| Pattern | TTL | Description |
|---------|-----|-------------|
| `ad_performance:{date}:{level}` | 24h | Cached insights by level |
| `ad_fatigue:{ad_id}` | 14d | CTR history + fatigue state |
| `ad_actions_log:{date}` | 30d | Daily action log |
| `ad_optimization_state:{date}` | 14d | Daily optimization snapshot |
| `ad_budget_changes:{adset_id}` | 30d | Budget change history |
| `ad_action_idem:{entity}:{rule}:{date}` | 24h | Idempotency guard |
| `ad_perf_sync:{date}` | 24h | Sync metadata |
