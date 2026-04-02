# Shopify Theme Guardrails

## Golden rules
- NEVER change section schema setting `id`s once they exist.
- NEVER rename locale keys. Only edit locale VALUES.
- When editing Liquid, keep existing blocks/sections structure unless explicitly requested.
- Return changes as a minimal diff. Prefer editing 1-3 files max.

## Before editing
- First list the exact files you will change.
- If a schema change could break Theme Editor settings, stop and ask 1 question.

## Formatting
- Keep JSON valid.
- Do not introduce trailing commas in JSON.

---

# Meta CAPI & Ads Automation Guardrails

## Architecture
- Two-layer event delivery: **real-time** (browser bridge + Custom Pixel + Shopify webhooks) and **recovery** (QStash 1-min schedule retries only genuinely failed events).
- Three-daily ad optimizer at 07:00, 12:00, and 19:00 Amsterdam time via QStash → Telegram + GitHub task file.
- All durable state in Upstash Redis. Event lifecycle tracked in `meta:event:{id}` keys.

## Golden rules
- NEVER send fake or redundant events to Meta. Only retry events in `retry_pending` state.
- NEVER log raw PII (email, phone, name). Log only hashed presence flags (e.g. `hasEmail: true`).
- NEVER hardcode API keys. All secrets live in Vercel env vars or `.env`.
- NEVER increase ad daily budget beyond €200 (`MAX_DAILY_BUDGET`).
- NEVER pause campaigns without trigger data from a task file.
- Always return HTTP 200 to Shopify webhooks, even on internal errors.
- Deduplication keys use shared `event_id` format: `ic_{token}`, `purchase_{token}`.

## Before editing calqix-capi/
- Run `npm run check` to validate syntax of all critical files.
- If changing Redis key patterns or TTLs, update `docs/ops/meta-capi-production-runbook.md`.
- If changing QStash schedules, run `npm run schedule:list` to verify current state.

## Key files
- `lib/event-state.js` — event lifecycle state machine
- `lib/store.js` — Upstash Redis abstraction (dedup, enrichment, locks, cursors)
- `api/recovery/run.js` — 1-minute recovery job
- `api/ads/monitor.js` — twice-daily optimizer
- `scripts/bootstrap.js` — schedule management and verification