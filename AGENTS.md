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
- `api/ads/monitor.js` — three-daily optimizer
- `scripts/bootstrap.js` — schedule management and verification

---

# Marketing Automation Guardrails

## Architecture
- Multi-agent content automation: planner → scorer → copy → brief → Predis → compliance → publisher.
- Ad optimization rules engine: sync → rules → execute/queue → report → close.
- Approval queue for all non-trivial actions (content publish, ad pause, budget scale).
- Telegram operator console for review, approve, reject.
- Three publishing modes: DRAFT_ONLY (default), APPROVAL_REQUIRED, AUTO_PUBLISH.

## Golden rules
- NEVER auto-publish content without compliance check passing.
- NEVER exceed MAX_ADSET_BUDGET (€50) or MAX_DAILY_SPEND (€100) for ad scaling.
- NEVER skip the approval queue for APPROVAL_REQUIRED safety-level actions.
- NEVER use spammy language, unsubstantiated health claims, or non-English copy.
- All content must follow CALQIX brand voice: scientific, accessible, clinical, premium, minimalist.
- Feature flags gate all automation: CONTENT_AUTOMATION_MODE, ADS_OPTIMIZATION_MODE.
- All cron jobs are idempotent with Redis lock keys (5-10 min TTL).

## Before editing marketing automation files
- Run `npm run check` to validate all 45+ files.
- If changing Redis key patterns, update `docs/content-ops.md` and `docs/ad-optimization.md`.
- If changing cron schedules, update `scripts/bootstrap.js` and run `npm run schedule:list`.

## Key files (content)
- `lib/content-memory.js` — Redis-backed topic/hook/CTA/angle memory
- `lib/content-planner.js` — daily plan generation (2 posts + 1 reserve)
- `lib/content-scorer.js` — angle/pillar/product scoring with Meta signals
- `lib/caption-writer.js` — template-based copy generation
- `lib/creative-brief-builder.js` — strategy → Predis-ready briefs
- `lib/brand-guardrails.js` — CALQIX voice enforcement
- `lib/compliance-checker.js` — brand + platform + claim compliance
- `lib/publisher.js` — mode-gated content publishing

## Key files (Predis)
- `lib/predis-client.js` — provider-abstracted generation client
- `lib/predis-payload-builder.js` — brief → Predis payload mapping
- `lib/predis-job-store.js` — Redis-backed job tracking

## Key files (ad optimization)
- `lib/ad-rules-engine.js` — pause/scale/fatigue/spend-starved rules
- `lib/ad-action-executor.js` — safe execution with approval gating
- `lib/ad-optimization-logger.js` — structured action logging
- `lib/ad-fatigue-tracker.js` — 7-day CTR trend per ad
- `lib/meta-insights-fetcher.js` — cached Meta insights with normalization
- `lib/meta-api-client.js` — Meta Marketing API read/write with dry-run

## Key files (approval & review)
- `lib/approval-queue.js` — state machine: pending → approved → executing → executed
- `lib/telegram-content-review.js` — Telegram content/ad reports
- `api/approval/approve.js` — approve endpoint
- `api/approval/reject.js` — reject endpoint
- `api/approval/status.js` — queue status endpoint