---
description: Daily ads optimization — execute actions from the monitor cron job
---

# Daily Ads Optimization Workflow

**Invocation:** Manual only — run `/ads-optimize` in Windsurf when prompted by a Telegram notification.

**This workflow is NOT automatically executed.** The daily cron job at 05:00 UTC creates a task file and sends a Telegram notification. A human operator must then decide to invoke this workflow.

## Prerequisites

- A task file exists at `.windsurf/tasks/ads-YYYY-MM-DD.md` (created by the cron job)
- You received a Telegram notification with action items

## Steps

1. Read today's task file:
   ```
   .windsurf/tasks/ads-YYYY-MM-DD.md
   ```
   Identify which triggers fired and their severity.

2. For each **URGENT** action:
   - **AD_KILLER**: Pause the ad via `POST /{ad_id}` with `status: PAUSED` using `calqix-capi/api/ads/actions.js`. Confirm the ad ID from the task file.
   - **CREATIVE_FATIGUE**: Note the fatigued ad. Suggest a new creative via `calqix-capi/api/content/create-predis-ad.js`.
   - **SPENDING_SPIKE**: Review spend vs budget. If overspent, pause the ad set or lower daily budget.
   - **BILLING_THRESHOLD**: Report to user — no automated action possible.

3. For each **WARNING** action:
   - **BUDGET_UNDERUTILIZED**: Suggest broadening targeting or reviewing bid strategy.
   - **LEARNING_LIMITED**: Suggest switching to higher-funnel optimization (e.g., AddToCart).
   - **CHECKOUT_DROPOFF / CART_ABANDONMENT / LOW_PRODUCT_CONVERSION**: Website optimization suggestions only — do not change ads.

4. After executing, update the task file: mark completed items with `[x]`.

5. Summarize what was done. Optionally notify via Telegram.

## Safety Rules

- Never increase daily budget beyond €200 (`MAX_DAILY_BUDGET`).
- Never pause campaigns without explicit trigger data from the task file.
- Always log which actions were taken and why.
- Never fabricate ad IDs or assume IDs not in the task file.

## Reference

- Meta Ad Account ID: `act_2108393566376667`
- Pixel ID: `934134615770602`
- Cron schedule: `0 5 * * *` (05:00 UTC = 07:00 CEST / 06:00 CET)
