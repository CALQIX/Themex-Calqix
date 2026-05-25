# CALQIX Ad Optimization - Meta Rules Engine

## Overview

CALQIX uses a guarded Meta optimization layer:

1. Read Meta Marketing API insights.
2. Evaluate CALQIX rules locally.
3. Create proposals and review flags.
4. Send non-trivial actions to the approval queue.
5. Execute Meta API writes only after operator approval, unless a separately enabled Codex automation is explicitly handling a scoped ABO budget-regulation task.

Native Meta automated rules should not be used for unattended pause or broad budget actions, because they can bypass CALQIX approval, Redis idempotency and budget caps.

## Monitoring Schedule

Backend QStash ad-performance monitoring runs on fixed Europe/Amsterdam slots:

| Time | Cron ID | Endpoint | Purpose |
| --- | --- | --- | --- |
| 07:00, 12:00, 19:00 | `calqix-optimizer` | `/api/ads/monitor` | Fetch Meta data, evaluate triggers, send Telegram pulse/trigger reports |
| 07:00 | `calqix-ad-morning` | `/api/cron/ad-morning` | Fetch Meta data, evaluate rules, queue approval-first proposals, send Telegram advice |
| 12:00 | `calqix-ad-midday` | `/api/cron/ad-midday-check` | Intraday pacing, approved-action execution, Telegram advice |
| 19:00 | `calqix-ad-daily-close` | `/api/cron/ad-daily-close` | Day close, queue recap, fatigue/top/worst summary, Telegram advice |

The Codex desktop automation `CALQIX Meta 15m Monitor` handles the every-15-minute operator loop in this Codex thread. Backend QStash remains fixed-slot unless explicitly changed.

## Live Campaign Scope

Current monitoring is scoped around the live FlowCore ABO campaign:

- Campaign ID: `120250886895070715`
- Campaign name: `ABO - FlowCore | 80 Static Ads LIVE | Purchase | 2026-05-18 V3`
- Budget: EUR 40/day ABO
- Structure: standard single-image ads, not dynamic creative
- Intended shape: 8 active adsets and 80 live static ads

The AI advisor may recommend keep-running, less-budget, more-budget and possible-off buckets, but it must not create campaigns, adsets, ads, creatives, or dynamic creative delivery. Adcopy generation remains a separate workflow when new statics/images are supplied.

If a Codex automation regulates budget, it may move budget between adsets only when the campaign is detected as ABO and only within caps/cooldowns/data thresholds. If the campaign is CBO or mixed/unclear, it sends suggestions only and performs no adset-budget write.

## Research Baseline

Before changing rule thresholds or adding native Meta rules, check:

- [Meta Marketing API official docs](https://developers.facebook.com/docs/marketing-api/)
- [Meta Marketing API official Postman workspace](https://www.postman.com/meta/facebook-marketing-api/overview)
- [Meta Marketing API authentication docs](https://developers.facebook.com/docs/marketing-apis/overview/authentication)
- [Ad Account Insights reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/)

The active rule planner (`rulePlan`) also reminds operators to compare proposed changes against the last 3, 7 and 14 days of CALQIX account data before introducing new rules.

## Optimization Modes

| Mode | Behavior |
| --- | --- |
| `MONITOR_ONLY` | Evaluate rules, log and return findings, take no action. Default. |
| `SUGGEST` | Queue proposals instead of executing writes. |
| `TELEGRAM_APPROVAL` | Queue all proposals and notify Telegram with approve/reject buttons. |
| `EXECUTE` / `AUTO_EXECUTE` | Still queues destructive pause and budget actions, because the rules engine marks them `APPROVAL_REQUIRED`. |

Monitor-only flags are logged for reporting and are not added to the approval queue. Review/fatigue/spend-starved queue items can be acknowledged safely; acknowledgement performs no Meta write.

The optional ABO regulator is intentionally narrower than the rules engine. It never pauses ads and never changes campaign budgets. Backend use requires `META_OPTIMIZER_AUTO_BUDGET_ADJUST=true` and `ENABLE_AD_WRITES=true`; by default, backend budget regulation is off.

## Active Ad-Level Rules

| Rule | Trigger | Action | Safety |
| --- | --- | --- | --- |
| `P2_NO_FUNNEL_SIGNAL` | Spend >= max(EUR 20, 1.25x target CPA), 0 purchases, 0 initiate checkouts, 0 add-to-carts | Queue pause proposal | Approval required |
| `P3_EXCEED_CPA_NO_PURCHASE` | Spend >= 2.5x target CPA, 0 purchases, no funnel signal | Queue pause proposal | Approval required |
| `F2_FUNNEL_LEAK_NO_PURCHASE` | Spend >= 2.5x target CPA, 0 purchases, but ATC/IC exists | Flag funnel review | Approval required |
| `P1_LOW_CTR_NO_FUNNEL` | >= 1,000 impressions, CTR < 0.7%, no funnel signal, spend >= 0.75x target CPA | Queue pause proposal | Approval required |
| `P5_HIGH_CPA_SINGLE_PURCHASE` | 1 purchase and spend > 2x target CPA | Queue pause proposal | Approval required |
| `P4_HIGH_FREQUENCY` | Frequency > 3.5 with >= 1,000 impressions | Flag fatigue review | Approval required |
| `F3_LANDING_PAGE_LEAK` | >= 30 clicks, CTR >= 1.0%, spend >= target CPA, no ATC/IC/purchase | Flag landing-page/CRO review | Approval required |
| `F4_CHECKOUT_LEAK` | >= 2 initiate checkouts, 0 purchases, spend >= target CPA | Flag checkout review | Approval required |
| `W1_WINNER_REFRESH` | >= 2 purchases, CPA <= target CPA, CTR >= 1.0% | Flag duplicate/fresh creative plan | Approval required |

## Active Adset-Level Rules

| Rule | Trigger | Action | Safety |
| --- | --- | --- | --- |
| `S1_STRONG_ROAS_QUALITY` | Purchases >= `MIN_PURCHASES_TO_SCALE`, ROAS >= 2.0x, CPA <= 1.1x target CPA, cooldown passed | Queue +15% adset budget proposal | Approval required |
| `S2_LOW_CPA_QUALITY` | Purchases >= `MIN_PURCHASES_TO_SCALE`, CPA <= 75% target CPA, cooldown passed | Queue +15% adset budget proposal | Approval required |
| `S3_CONSISTENT_PERFORMER` | >= 3 purchases, CPA <= target CPA, spend >= 1.5x target CPA, cooldown passed | Queue +10% adset budget proposal | Approval required |
| `S4_UNDERPERFORMING_ADSET` | Spend >= max(EUR 25, 1.5x target CPA), 0 purchases | Flag reallocation review | Approval required |
| `S5_TODAY_PACING_NO_PURCHASE` | Today spend >= 65% of daily budget and 0 purchases | Intraday pacing flag | Monitor only |

Scale proposals are blocked when the new budget would exceed `MAX_ADSET_BUDGET`, or when total daily budget would exceed `MAX_DAILY_SPEND`.

## Detection And Guard Rules

| Rule | Trigger | Action |
| --- | --- | --- |
| `DQ1_DATA_QUALITY_HOLD` | Meta snapshot has critical ad/adset/config/account API errors | Hold pause/scale rules and flag data quality |
| `SS1_SPEND_STARVED` | Ad gets <5% of adset spend and <100 impressions while siblings spend | Flag insufficient data |
| `F1_CTR_DECLINE` | Fatigue tracker says CTR declined from peak | Flag creative refresh or approval-gated pause |

## Rule Planning Output

Every rules evaluation now returns a `rulePlan` array. This is saved in the optimization state by `ad-optimization-engine` and `ad-morning`.

| Plan ID | Meaning |
| --- | --- |
| `RP0_RESEARCH_BEFORE_CHANGES` | Always research current Meta docs and recent CALQIX data before changing rules. |
| `RP1_DATA_QUALITY_FIRST` | Fix Meta API data issues before allowing write proposals. |
| `RP2_FUNNEL_DIAGNOSTICS` | Funnel leak detected; review product page, offer, checkout and shipping friction. |
| `RP3_WINNER_EXPANSION` | Winner detected; prepare fresh copy/static variants before fatigue. |
| `RP4_SPEND_STARVED_REVIEW` | Spend-starved ads detected; simplify adset or creative structure. |
| `RP5_APPROVAL_QUEUE` | Pause proposals exist; verify trigger data before executing. |
| `RP6_NO_ACTION` | No rule fired; keep learning active and avoid stricter rules. |

## Safety Protections

- `MAX_ADSET_BUDGET`: EUR 50 per adset by default.
- `MAX_DAILY_SPEND`: EUR 100 total account budget cap by default.
- `ADS_AUTO_ABO_MAX_TOTAL_BUDGET_EUR`: optional tighter cap for the 15-minute ABO regulator. Defaults to `ADS_MONITOR_DAILY_BUDGET_EUR` (EUR 40 for the current FlowCore campaign), never above `MAX_DAILY_SPEND`.
- `ADS_AUTO_ABO_MAX_CHANGE_PCT`: max adset change per run, default 15%.
- `ADS_AUTO_ABO_BUDGET_COOLDOWN_MINUTES`: per-adset cooldown, default 240 minutes.
- `ADS_AUTO_ABO_MAX_CHANGES_PER_RUN`: default 2 adset budget writes per 15-minute run.
- Campaign-level budget writes remain capped at EUR 200 in the executor.
- Budget scale cooldown: max 1 increase per 48 hours per adset.
- Pause proposals and CBO/campaign-level changes remain approval-gated or suggestion-only.
- ABO adset-budget redistribution can auto-execute within the regulator caps when explicitly enabled by environment.
- Idempotency key: `ad_action_idem:{entity}:{rule}:{date}` with 24h TTL.
- Dry-run remains active unless `ENABLE_AD_WRITES=true`.
- Data quality hold blocks write proposals when critical Meta API data is incomplete.

## Redis Key Patterns

No Redis key patterns changed in this rules update.

| Pattern | TTL | Description |
| --- | --- | --- |
| `ad_performance:{date}:{level}` | 24h | Cached insights by level |
| `ad_fatigue:{ad_id}` | 14d | CTR history and fatigue state |
| `ad_actions_log:{date}` | 30d | Daily action log |
| `ad_optimization_state:{date}` | 14d | Daily optimization snapshot, now including `rulePlan` |
| `ad_budget_changes:{adset_id}` | 30d | Budget change history |
| `ad_action_idem:{entity}:{rule}:{date}` | 24h | Idempotency guard |
| `ad_perf_sync:{date}` | 24h | Sync metadata |
| `lock:abo_budget_regulator:{campaign_id}` | 10min | Distributed lock for 15-minute ABO budget regulator |
| `ads:auto_budget:last_change:{adset_id}` | cooldown TTL | Per-adset budget-change cooldown |
| `ads:auto_budget:idem:{date}:{adset_id}:{budget}` | 24h | Prevents repeated same-day budget attempts |

## Operating Notes

- Do not pause campaigns or ads without trigger data and approval.
- Do not scale budget above CALQIX caps.
- Do not use fake or synthetic Meta events to satisfy rules.
- Do not treat spend-starved ads as losers.
- Do not scale from ROAS alone; require purchases and CPA quality.
- Research current Meta docs and recent account data before adding or tightening rules.
