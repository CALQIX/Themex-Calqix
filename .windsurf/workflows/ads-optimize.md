---
description: Daily ads optimization — execute actions from the monitor cron job
---

# Daily Ads Optimization Workflow

This workflow is triggered when the CALQIX Ads Monitor cron job creates a task file in `.windsurf/tasks/ads-YYYY-MM-DD.md`.

## Steps

1. Read today's task file from `.windsurf/tasks/` to understand which triggers fired.

2. For each **URGENT** action:
   - **AD_KILLER**: Pause the ad via Meta Marketing API (`POST /{ad_id}` with `status: PAUSED`). Use the endpoint at `calqix-capi/api/ads/update-status.js` if available, or execute directly.
   - **CREATIVE_FATIGUE**: Note the fatigued ad. Create a new creative suggestion using Predis.ai via `calqix-capi/api/content/create-predis-ad.js`.
   - **SPENDING_SPIKE**: Review the ad set spend. If budget is exceeded, pause the ad set or lower the daily budget.
   - **BILLING_THRESHOLD**: Notify the user to top up their credit card. No automated action possible.

3. For each **WARNING** action:
   - **BUDGET_UNDERUTILIZED**: Check audience size and bid strategy. Suggest broadening targeting.
   - **LEARNING_LIMITED**: Suggest switching to a higher-funnel optimization event (e.g., AddToCart instead of Purchase).
   - **CHECKOUT_DROPOFF / CART_ABANDONMENT / LOW_PRODUCT_CONVERSION**: These are website optimization suggestions. Log them but do not change ads.

4. After executing actions, update the task file: mark completed items with `[x]`.

5. Send a summary of what was done via Telegram using the existing `lib/telegram.js` module or by calling the monitor endpoint.

## Important Notes

- Never increase daily budget beyond €200 (MAX_DAILY_BUDGET in env).
- Never pause campaigns without explicit trigger data.
- Always log which actions were taken.
- Meta Ad Account ID: `act_2108393566376667`
- Pixel ID: `934134615770602`
