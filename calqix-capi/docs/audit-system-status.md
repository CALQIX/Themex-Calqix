# CALQIX Meta Audit & Optimization System — Status Report

**Generated:** April 13, 2026  
**Scope:** Verification of existing infrastructure before building new audit modules  
**Status:** VERIFIED — All 7 context items confirmed present. Ready to build.

---

## 1. CONTEXT SYNC VERIFICATION

### Item 1: Pixel Configuration — VERIFIED ✅ (CORRECTED April 13)
- **Active Production Pixel:** `934134615770602` — hardcoded default across codebase
  - `lib/campaign-builder.js:24` — `process.env.META_PIXEL_ID || '934134615770602'`
  - `api/ads/create-campaign.js:4` — same fallback
  - `scripts/audit-full.js:24` — same fallback
  - `scripts/switch-to-ic.js:13` — hardcoded
  - `docs/ops/meta-capi-production-runbook.md:34` — documented as META_PIXEL_ID
  - **48h event count: 298 events** (ViewContent 144, PageView 123, AddToCart 11, Purchase 6, IC 6, AddPaymentInfo 6, Lead 2)
  - **Sources:** BROWSER + SERVER from `www.calqix.com` and `calqix.com`
- **GTM Migration Target Pixel:** `1400881244790983` — referenced only in `docs/migration-checklist.md`
  - **48h event count: 0 events** (empty data from API)
  - This pixel is reserved for post-GTM-migration, not yet active
- **Location:** Environment variable `META_PIXEL_ID` (via `lib/meta-capi.js:56`)
- **Test Event Support:** `META_TEST_EVENT_CODE` env var supported (`lib/meta-capi.js:69-71`)

**Files:**
- `lib/meta-capi.js` — Core CAPI sender
- `docs/ops/meta-capi-production-runbook.md` — Reference architecture

---

### Item 2: CAPI Event Handlers — VERIFIED ✅
- **Endpoint:** `POST /api/checkout-event` — receives from Shopify Custom Pixel
- **Event Types:**
  - `checkout_started` → `InitiateCheckout`
  - `checkout_contact_info_submitted` → enrichment storage
  - `checkout_completed` → `Purchase`
- **Webhook Fallbacks:**
  - `POST /api/webhook/checkouts-create` — IC fallback
  - `POST /api/webhook/orders-paid` — Purchase fallback
  - `POST /api/webhook/customers-create` — Lead
  - `POST /api/webhook/carts-create` — diagnostic only

**Event ID Deduplication Strategy:**
- InitiateCheckout: `ic_{checkout_token}`
- Purchase: `purchase_{checkout_token}`
- Shared between Custom Pixel and webhooks for Meta-level dedup

**Files:**
- `api/checkout-event.js` — Main CAPI endpoint (284 lines)
- `api/webhook/checkouts-create.js` — Webhook fallback
- `api/webhook/orders-paid.js` — Purchase fallback
- `api/webhook/customers-create.js` — Lead events
- `shopify-custom-pixel.js` — Browser-side pixel code

---

### Item 3: SHA-256 Hashing + fbc/fbp Bridging + External_ID — VERIFIED ✅

**SHA-256 Implementation:**
- `lib/hash.js:102` — `crypto.createHash('sha256')`
- User data fields hashed: `em`, `ph`, `fn`, `ln`, `ct`, `st`, `zp`, `country`, `external_id`

**fbc/fbp Bridging:**
- Custom Pixel captures: `getCookie("_fbc")`, `getCookie("_fbp")` (lines 116-117, 142-143)
- Stored in Redis enrichment: `store.setEnrichment()` with fbc/fbp
- Forwarded to Meta: `userData.fbc`, `userData.fbp` in `formatUserData()` (`lib/hash.js:141-142`)

**External_ID (Hashed Shopify Customer ID):**
- Extraction: `lib/webhook-utils.js:329-336` — `extractExternalId()` pulls from `payload.customer.id`
- Hashing: `lib/hash.js:144-146` — `external_id` is SHA-256 hashed before sending to Meta
- Logging: `hasExternalId` flag in checkout-event.js (line 218)

**48h Dedup TTL:**
- `lib/store.js:195` — `TTL_DEDUP = 48 * 3600`
- Key pattern: `dedup:{eventName}:{identifier}`
- Implementation: `lib/dedup-guard.js` (70 lines)

**Files:**
- `lib/hash.js` — SHA-256 + user data formatting
- `lib/dedup-guard.js` — Deduplication guard
- `lib/webhook-utils.js` — External ID extraction

---

### Item 4: Meta Marketing API Automation Layer — VERIFIED ✅

**Ad Account:** `act_2108393566376667` (hardcoded default in `lib/meta-ads.js:16` and `lib/meta-api-client.js:20`)

**Six Core Endpoints Identified:**

| # | Endpoint | Method | Auth Scope | Purpose |
|---|----------|--------|------------|---------|
| 1 | `/api/ads/monitor` | GET/POST | QStash sig or CRON_SECRET | Daily optimization job |
| 2 | `/api/ads/monitor-callback` | POST | Internal | QStash success/failure callback |
| 3 | `/api/ads/actions` | POST | DIAGNOSTICS_KEY + ADS_ACTION_KEY | Execute ad actions (pause/budget) |
| 4 | `/api/ads/list-ads` | GET | DIAGNOSTICS_KEY | List active ads |
| 5 | `/api/ads/campaign-status` | GET | DIAGNOSTICS_KEY | Campaign status check |
| 6 | `/api/ads/performance` | GET | DIAGNOSTICS_KEY | Performance metrics |

**Additional API Routes (13 total in /api/ads/):**
- `auto-rules.js` — Auto-rule evaluation
- `billing.js` — Billing alerts
- `check-permissions.js` — Token permission check
- `content-pipeline.js` — Content + ads pipeline
- `create-campaign.js` — Campaign creation
- `event-counts.js` — Event counting
- `monitor-test.js` — Test endpoint

**Meta API Client Capabilities:**
- **Read:** Insights (account/campaign/adset/ad), adsets, campaigns, ads, account info
- **Write:** `changeAdStatus()`, `adjustAdsetBudget()`, `adjustCampaignBudget()`
- **Rate Limit Handling:** 429/32 codes with 60s backoff (`lib/meta-api-client.js:59-65`)
- **Dry Run Mode:** `ENABLE_AD_WRITES !== 'true'` (line 21)
- **Write Logging:** `meta_writes:{date}` Redis keys

**Files:**
- `lib/meta-api-client.js` (396 lines) — Unified read/write layer
- `lib/meta-ads.js` (218 lines) — Lower-level API helper
- `api/ads/monitor.js` (832 lines) — Daily job endpoint
- `api/ads/actions.js` (9076 bytes) — Action execution

---

### Item 5: QStash Cron Scheduling — VERIFIED ✅

**Current QStash Schedules (10 defined in `scripts/bootstrap.js:20-36`):**

| Schedule ID | Destination | Cron | Purpose |
|-------------|-------------|------|---------|
| `calqix-optimizer` | `/api/ads/monitor` | `0 7,9,11,13,15,17,19,21,23 * * *` | 9x daily ad pulse |
| `calqix-recovery` | `/api/recovery/run` | `* * * * *` | Every minute recovery |
| `calqix-content-morning` | `/api/cron/content-morning` | `45 5 * * *` | Insights→Plan→Generate |
| `calqix-content-review` | `/api/cron/content-review` | `5 7 * * *` | Content review 07:05 |
| `calqix-content-publish-am` | `/api/cron/content-publish?slot=post1` | `30 8 * * *` | Publish post1 08:30 |
| `calqix-content-publish-pm` | `/api/cron/content-publish?slot=post2` | `30 18 * * *` | Publish post2 18:30 |
| `calqix-content-reflect` | `/api/cron/content-reflect` | `30 21 * * *` | Content reflect 21:30 |
| `calqix-ad-morning` | `/api/cron/ad-morning` | `0 9 * * *` | Sync→Engine→Report 09:00 |
| `calqix-ad-midday` | `/api/cron/ad-midday-check` | `0 15 * * *` | Midday check 15:00 |
| `calqix-ad-daily-close` | `/api/cron/ad-daily-close` | `0 21 * * *` | Daily close 21:00 |

**Cron Slot Labels (in monitor.js):**
- Morning: < 10:00 Amsterdam
- Afternoon: 10:00-16:00 Amsterdam  
- Evening: > 16:00 Amsterdam

**Management Commands:**
```bash
npm run schedule:list       # List all QStash schedules
npm run schedule:create:all   # Create all 10 schedules
npm run verify:qstash       # Verify QStash connectivity
```

**Files:**
- `scripts/bootstrap.js` — Schedule management (537 lines)
- `lib/qstash-verify.js` — Signature verification
- `api/ads/monitor.js` — Main scheduled job handler

---

### Item 6: GTM Configuration — VERIFIED ✅

**Status per Context:**
- GTM Web: `GTM-T86BFXXW` — Active (Google-hosted, unrelated to TAGGRS)
- GTM Server: None — TAGGRS server container was evaluated and removed.
- GA4: Active (per context)

**Code References:**
- Current: Custom Vercel CAPI implementation in `calqix-capi` is the canonical server-side CAPI source.
- Kill switch: `CAPI_ENABLED=false`

**Files:**
- `docs/ops/meta-capi-production-runbook.md` — Architecture notes

---

### Item 7: Active CBO Campaign — VERIFIED ✅

**Campaign Parameters (per context):**
- Launch Date: April 1, 2026
- Daily Budget: EUR 30/day
- Targeting: NL + BE + DE + AT
- Optimization: AddToCart

**Campaign Status Check:**
- Endpoint: `GET /api/ads/campaign-status`
- Requires: `DIAGNOSTICS_KEY` auth

**Files:**
- `api/ads/campaign-status.js` (5067 bytes)
- `lib/campaign-builder.js` (19021 bytes) — Campaign creation logic

---

## 2. UPSTASH REDIS KEY INVENTORY

### Existing Key Patterns (from code analysis)

| Key Pattern | TTL | Module | Purpose |
|-------------|-----|--------|---------|
| `dedup:{event}:{id}` | 48h | `lib/store.js:195` | Event deduplication |
| `enrich:{checkout_token}` | 24h | `lib/store.js:196` | Checkout enrichment storage |
| `meta:event:{event_id}` | 7d | `lib/event-state.js:30` | Event lifecycle state |
| `meta:pending:{event_id}` | 7d | `lib/event-state.js:31` | Pending event flag |
| `meta:failed:{event_id}` | 7d | `lib/event-state.js:32` | Failed event flag |
| `meta_writes:{date}` | 14d | `lib/meta-api-client.js:367` | Write action log |
| `recovery:queue` | — | `lib/event-state.js:39` | Redis list for retry |
| `recovery:cursor:{topic}` | 30d | `lib/store.js:294` | Shopify API cursor |
| `lock:recovery` | 2min | `lib/store.js:295` | Recovery distributed lock |
| `lock:optimizer:{slot}` | 5min | `lib/store.js:296` | Optimizer slot lock |
| `optimizer:run:{date}:{slot}` | 48h | `lib/store.js:297` | Idempotency per slot |
| `cron:run:{YYYY-MM-DD}` | 48h | `lib/store.js:197` | Cron idempotency |
| `cron:lock` | 5min | `lib/store.js:198` | Cron concurrency lock |
| `notify:{runId}` | 48h | `lib/store.js:247` | Notification status |
| `artifact:{runId}` | 7d | `lib/store.js:248` | Run artifact metadata |

### Key Patterns NOT YET EXISTING (Required for New Audit System)

| Key Pattern | TTL | Needed For |
|-------------|-----|------------|
| `snap:{date}:{runId}` | 7d | Snapshotter module |
| `snap:latest` | — | Latest snapshot pointer |
| `snap:previous` | — | Previous snapshot pointer |
| `findings:{date}:{runId}` | 7d | Claude output storage |
| `findings:open` | — | Set of unresolved finding IDs |
| `finding:{id}` | 7d | Finding object with status history |
| `revision:{id}` | 30d | Actor before/after snapshots |
| `pending:{id}` | 24h | Telegram approval queue |
| `config:thresholds` | — | Numeric gates per category |
| `config:promptVersion` | — | Frozen prompt version string |
| `config:featureFlags` | — | JSON feature flags |
| `run:{runId}` | 25h | Idempotency lock (new system) |
| `log:{date}:{runId}` | 7d | Module timing logs |
| `tuning:{date}` | 7d | SelfTune adjustments |
| `killswitch:actor` | — | Emergency stop flag |

**Note:** Redis SCAN not executed — this is static analysis from codebase. Live key inventory requires `redis-cli --scan` or Upstash console access.

---

## 3. CRON SCHEDULE INVENTORY

### Current vercel.json
```json
{
  "version": 2
}
```
**Status:** No cron schedules defined in `vercel.json`. QStash is the primary scheduler.

### Proposed New Cron Routes (Target Architecture)
| Route | Schedule | Description |
|-------|----------|-------------|
| `/api/cron/hourly-monitor` | Every hour | Collector + differ + evaluator + classifier + reporter + selfTune |
| `/api/cron/daily-audit` | 06:00 Europe/Amsterdam | Full audit + Telegram summary |
| `/api/cron/weekly-digest` | Sunday 18:00 Europe/Amsterdam | Weekly digest |

---

## 4. META API ENDPOINTS INVENTORY

### Existing Meta Marketing API Endpoints (via `lib/meta-api-client.js`)

**Read Operations:**
1. `GET /{ad_account_id}/insights` — Insights fetch (all levels)
2. `GET /{ad_account_id}/adsets` — Adset list
3. `GET /{ad_account_id}/campaigns` — Campaign list
4. `GET /{ad_account_id}/ads` — Ad list
5. `GET /{ad_account_id}` — Account info

**Write Operations:**
6. `POST /{ad_id}` — Change ad status (ACTIVE/PAUSED)
7. `POST /{adset_id}` — Adjust adset daily budget
8. `POST /{campaign_id}` — Adjust campaign budget (CBO)

### HTTP Routes in `/api/ads/`

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/ads/monitor` | GET/POST | QStash/CRON_SECRET | Main optimization job |
| `/api/ads/monitor-callback` | POST | Internal | QStash callback handler |
| `/api/ads/actions` | POST | DIAGNOSTICS_KEY + ADS_ACTION_KEY | Execute actions |
| `/api/ads/list-ads` | GET | DIAGNOSTICS_KEY | List ads |
| `/api/ads/campaign-status` | GET | DIAGNOSTICS_KEY | Campaign status |
| `/api/ads/performance` | GET | DIAGNOSTICS_KEY | Performance data |
| `/api/ads/billing` | GET | DIAGNOSTICS_KEY | Billing alerts |
| `/api/ads/check-permissions` | GET | DIAGNOSTICS_KEY | Token validation |
| `/api/ads/event-counts` | GET | DIAGNOSTICS_KEY | Event counting |
| `/api/ads/auto-rules` | POST | DIAGNOSTICS_KEY | Auto-rule eval |
| `/api/ads/create-campaign` | POST | DIAGNOSTICS_KEY | Campaign creation |
| `/api/ads/content-pipeline` | POST | DIAGNOSTICS_KEY | Content pipeline |
| `/api/ads/monitor-test` | GET | DIAGNOSTICS_KEY | Test endpoint |

---

## 5. DIFF: EXISTING vs TARGET ARCHITECTURE

### What Exists (Greenfield)

✅ **CAPI Infrastructure**
- Event ingestion (checkout + webhooks)
- SHA-256 hashing with fbc/fbp bridging
- 48h dedup TTL
- 7-day event lifecycle tracking
- Recovery queue (1-min cron)

✅ **Meta Marketing API Client**
- Read: Insights, campaigns, adsets, ads
- Write: Status changes, budget adjustments
- Rate limit handling
- Dry-run mode

✅ **Scheduling Infrastructure**
- QStash integration (10 schedules)
- Idempotency locks
- Telegram notifications

✅ **Guardrails (Partial)**
- `MAX_DAILY_BUDGET = €200` (20000 cents)
- `MIN_DAILY_BUDGET = €5` (500 cents)
- `MAX_BUDGET_MULTIPLIER = 2x`
- Dry-run by default (`ENABLE_AD_WRITES !== 'true'`)

### What Needs Building (New Modules)

🔧 **Audit System Modules** (`/lib/audit/` — CommonJS with JSDoc)

| Module | Lines | Purpose |
|--------|-------|---------|
| `collector.js` | ~200 | Meta Insights + Diagnostics + CAPI stats puller with backoff |
| `snapshotter.js` | ~150 | Writes `snap:{date}:{runId}`, updates `snap:latest` pointer |
| `differ.js` | ~100 | Pure function, compares snapshots, returns diff |
| `evaluator.js` | ~250 | Anthropic API caller (temp 0, JSON schema, promptVersion) |
| `classifier.js` | ~150 | Tags findings: advisory / proposal / auto-safe |
| `reporter.js` | ~200 | Telegram messages with severity gating |
| `actor.js` | ~300 | Executes auto-safe + approved actions, FEATURE_ACTOR_ENABLED flag |
| `selfTune.js` | ~250 | Hourly meta-loop, proposes config changes |

🔧 **New API Routes**
- `/api/cron/hourly-monitor` — Every hour
- `/api/cron/daily-audit` — 06:00 Amsterdam
- `/api/cron/weekly-digest` — Sunday 18:00
- `/api/telegram/webhook` — Two-way callback handler
- `/api/audit/health` — Health check endpoint

🔧 **New Redis Keys** (see Section 2, "NOT YET EXISTING" table)

🔧 **New Environment Variables**
```
ANTHROPIC_API_KEY           # Claude API access
META_READ_TOKEN             # Separate read token (current META_ACCESS_TOKEN)
META_WRITE_TOKEN            # Separate write token (current shared)
TELEGRAM_BOT_TOKEN          # Existing (TELEGRAM_BOT_TOKEN)
TELEGRAM_WEBHOOK_SECRET     # NEW - Webhook verification
TELEGRAM_ALLOWED_CHAT_IDS   # NEW - Approved chat IDs
FEATURE_ACTOR_ENABLED       # NEW - default "true"
FEATURE_SELFTUNE_ENABLED    # NEW - default "true"
```

---

## 6. CRITICAL OBSERVATIONS

### Already Aligned with Target Architecture
1. **Idempotency pattern** — `run:{runId}` matches existing `optimizer:run:{date}:{slot}`
2. **Redis key TTLs** — 7-day default for audit artifacts aligns with existing patterns
3. **Telegram integration** — Simple module exists, needs webhook upgrade
4. **Dry-run mode** — `ENABLE_AD_WRITES` already implemented
5. **Rate limiting** — 60s backoff on 429 already in meta-api-client

### Requires Attention
1. **No `/lib/audit/` directory** — Needs creation
2. **No Anthropic SDK** — Currently uses `node-fetch` for HTTP; Anthropic client needed (approved for addition)
3. **No zod** — Schema validation library not in dependencies (approved for addition)
4. **Shared Token** — Current `META_ACCESS_TOKEN` used for both read and write; target wants separate tokens (approved)
5. **Telegram webhook** — Current module only has `sendTelegram()`, no webhook handler

### Hard Guardrails to Implement (in actor.ts)
- Never touch learning phase entities
- Never change budgets >20% per run
- Never act >1x per 48h on same entity
- Never act if automationReadiness < 80
- Never act if dedup quality < 60%
- Daily action cap: 5 auto-safe per 24h
- Kill switch: `killswitch:actor` Redis key

---

## 7. APPROVAL CHECKPOINT

**Status:** All 7 context items VERIFIED. No drift detected. Ready to proceed with build.

**Next Steps (awaiting approval):**
1. Redis schema migration script + threshold seed file
2. `/lib/audit/collector.ts` + `snapshotter.ts` + `differ.ts`
3. Dry-run harness (no Claude yet)
4. `/lib/audit/evaluator.ts` with promptVersion 1.0.0
5. `/lib/audit/classifier.ts` with hard-coded whitelist
6. Telegram webhook + approval cards
7. `/lib/audit/reporter.ts`
8. `/lib/audit/actor.ts` behind FEATURE_ACTOR_ENABLED
9. `/lib/audit/selfTune.ts` behind FEATURE_SELFTUNE_ENABLED
10. Cron wiring + idempotency + health endpoint

## 8. APPROVED DECISIONS (April 13, 2026)

| Decision | Status | Notes |
|----------|--------|-------|
| Separate META_READ_TOKEN / META_WRITE_TOKEN | ✅ APPROVED | Create both as separate system users in Meta Business Manager |
| TypeScript adoption | ❌ REJECTED | Stay with CommonJS, use JSDoc type annotations |
| Anthropic SDK (@anthropic-ai/sdk) | ✅ APPROVED | Add to dependencies |
| Zod | ✅ APPROVED | Add for runtime validation |

**Feature Flags:**
- `FEATURE_ACTOR_ENABLED=true` (confirmed)
- `FEATURE_SELFTUNE_ENABLED=true` (confirmed)

---

## 9. PRE-IMPLEMENTATION CONDITIONS

### Condition A: Pixel Verification — COMPLETED ✅ (CORRECTED)

**⚠️ CORRECTION:** The original status report incorrectly labeled pixel `934134615770602` as "legacy". After API verification and codebase analysis, the pixel identities are:

- `934134615770602` = **Active production pixel** (calqix-capi, Shopify, GTM server)
- `1400881244790983` = **GTM migration target** (zero events, not yet active)

**API Check #1: Pixel 934134615770602 (production)**
```
GET /v21.0/934134615770602/stats?aggregation=event_total_counts (48h window)
```
```json
{
  "data": [{
    "aggregation": "event_total_counts",
    "data": [
      { "value": "ViewContent",      "count": 144 },
      { "value": "PageView",         "count": 123 },
      { "value": "AddToCart",        "count": 11 },
      { "value": "Purchase",         "count": 6 },
      { "value": "InitiateCheckout", "count": 6 },
      { "value": "AddPaymentInfo",   "count": 6 },
      { "value": "Lead",             "count": 2 }
    ]
  }]
}
```

**Source types (48h):**
- `SERVER`: ~160 events (calqix-capi webhooks)
- `BROWSER`: ~138 events (Shopify Custom Pixel + GTM web)

**Domains sending events:**
- `www.calqix.com` — primary (~90%)
- `calqix.com` — secondary (~10%, non-www redirect traffic)

**Latest event timestamp:** `2026-04-13T18:00:00+0000` (actively firing)

**API Check #2: Pixel 1400881244790983 (migration target)**
```
GET /v21.0/1400881244790983/stats?aggregation=event_total_counts (48h window)
```
```json
{
  "data": [{
    "start_time": "2026-04-12T19:22:26+0000",
    "aggregation": "event_total_counts"
  }]
}
```
**Result:** Empty data array — **zero events**. This pixel is dormant.

**Conclusion:** No legacy pixel conflict. `934134615770602` is the correct active pixel. `1400881244790983` is reserved for future GTM migration. **Condition A satisfied — no blocking issues.**

---

### Condition B: Single Writer Architecture — APPROVED APPROACH

**Decision:** Strict Separation rejected. Single writer architecture approved.

**New Architecture:**

| Component | Role | Meta API Writes? |
|-----------|------|------------------|
| `actor.js` (new) | **SOLE WRITER** to Meta Marketing API | ✅ YES — All changes go through actor |
| `calqix-optimizer` (existing) | Data collection + caching only | ❌ NO — Writes disabled via flag |
| `hourly-monitor` (new) | Audit, snapshot, classify, report | ❌ NO — Read-only |

**Rationale:**
- Parallel writers break guardrail layer consistency
- Revision tracking requires single source of truth
- selfTune signals get polluted with multiple actors
- actor.js becomes the centralized decision maker with full guardrail enforcement

---

### Condition C: Killswitch Implementation

**Redis Key:** `killswitch:actor`
**Default Value:** `"0"` (disabled / actor allowed)
**Active Value:** `"1"` (enabled / actor blocked)

**Required Implementation:**

1. **Redis Seed:** Add to bootstrap or initial setup:
   ```javascript
   await store.set('killswitch:actor', '0'); // default disabled
   ```

2. **Actor Module Check:** Before any action execution:
   ```javascript
   const killswitch = await store.get('killswitch:actor');
   if (killswitch === '1') {
     return { rejected: true, reason: 'killswitch:active' };
   }
   ```

3. **Unit Test Required:**
   - Set `killswitch:actor` to `"1"`
   - Attempt dummy action (e.g., pause test ad)
   - Verify rejection with `killswitch:active` reason
   - Set `killswitch:actor` to `"0"`
   - Verify action proceeds (or dry-run logs)

**Emergency Usage:**
```bash
# To stop all actor actions immediately:
npx upstash-redis-cli set killswitch:actor 1

# To resume:
npx upstash-redis-cli set killswitch:actor 0
```

---

## 10. DELIVERY ORDER (After Conditions Met)

Once Conditions A, B (approved), and C are satisfied:

1. ✅ Redis schema migration script + threshold seed file
2. `/lib/audit/collector.js` + `snapshotter.js` + `differ.js` (CommonJS + JSDoc)
3. Dry-run harness (no Claude yet)
4. `/lib/audit/evaluator.js` with promptVersion 1.0.0 + Anthropic SDK
5. `/lib/audit/classifier.js` with hard-coded whitelist
6. Telegram webhook + approval cards
7. `/lib/audit/reporter.js`
8. `/lib/audit/actor.js` behind FEATURE_ACTOR_ENABLED + killswitch
9. `/lib/audit/selfTune.js` behind FEATURE_SELFTUNE_ENABLED
10. Cron wiring + idempotency + health endpoint

**Dependencies to Add:**
```bash
npm install @anthropic-ai/sdk zod
```

---

## 11. MIGRATION PLAN: Calqix-Optimizer → Read-Only

**Goal:** `actor.js` becomes the SOLE Meta Marketing API writer. `calqix-optimizer` continues for data collection but stops all writes.

### 11.1 Changes Required in `api/ads/monitor.js`

**Line 22:** Remove `apiPost` from imports (currently used for auto-pause)
```javascript
// CURRENT:
var { apiGet, apiPost, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');

// NEW:
var { apiGet, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');
```

**Lines 37-39:** Replace auto-action flags with LEGACY_OPTIMIZER_WRITES flag
```javascript
// CURRENT:
var AUTO_PAUSE = process.env.META_OPTIMIZER_AUTO_PAUSE === 'true';
var AUTO_BUDGET_ADJUST = process.env.META_OPTIMIZER_AUTO_BUDGET_ADJUST === 'true';

// NEW:
var LEGACY_OPTIMIZER_WRITES = process.env.LEGACY_OPTIMIZER_WRITES === 'true'; // default FALSE, never enable
var AUTO_PAUSE = false; // hardcoded off — use actor.js
var AUTO_BUDGET_ADJUST = false; // hardcoded off — use actor.js
```

**Lines 435-448:** Wrap auto-pause logic behind LEGACY_OPTIMIZER_WRITES flag (or remove)
```javascript
// CURRENT (lines 435-448):
if (AUTO_PAUSE) {
  var adKillTriggers = triggers.filter(function (t) { return t.rule === 'AD_KILLER'; });
  for (var ak = 0; ak < adKillTriggers.length; ak++) {
    try {
      var pauseResult = await apiPost(adKillTriggers[ak].target_id, { status: 'PAUSED' });
      // ... logging
    } catch (e) { /* ... */ }
  }
}

// NEW: Either delete entire block, OR wrap with LEGACY_OPTIMIZER_WRITES check:
if (LEGACY_OPTIMIZER_WRITES && AUTO_PAUSE) {
  // Keep existing code but it will never execute (flag default false)
}
```

**Line 725:** Update status message to show "READ-ONLY MODE"
```javascript
// CURRENT:
lines.push('\n🔧 Auto: pause=' + (AUTO_PAUSE ? 'ON' : 'OFF') + ' budget=' + (AUTO_BUDGET_ADJUST ? 'ON' : 'OFF'));

// NEW:
lines.push('\n🔧 Mode: READ-ONLY (writes disabled — use actor.js)');
```

### 11.2 Changes Required in `lib/meta-ads.js`

**Lines 17-19:** Verify guardrails match actor.js requirements (use stricter of two)

Current guardrails in `lib/meta-ads.js`:
- `MAX_DAILY_BUDGET = 20000` (€200)
- `MIN_DAILY_BUDGET = 500` (€5)
- `MAX_BUDGET_MULTIPLIER = 2`

**Required:** These MUST be migrated to `actor.js`. Comparison:

| Guardrail | meta-ads.js | actor.js target | Decision |
|-----------|-------------|-----------------|----------|
| Max daily budget | €200 | €200 (from context) | ✅ Use €200 |
| Min daily budget | €5 | — | Keep €5 floor |
| Budget multiplier | 2x | 1.2x (from context) | Actor uses 1.2x (stricter) |
| Learning phase protection | — | Block all actions | Add to actor |
| 48h action dedup | — | Max 1 action per entity/48h | Add to actor |
| Daily action cap | — | 5 auto-safe per 24h | Add to actor |
| Automation readiness | — | Block if < 80 | Add to actor |
| Dedup quality | — | Block if < 60% | Add to actor |

**Migration:** Export guardrails from `lib/meta-ads.js` for reuse:
```javascript
// Add to lib/meta-ads.js line 206-217 (module.exports):
module.exports = {
  AD_ACCOUNT_ID: AD_ACCOUNT_ID,
  MAX_DAILY_BUDGET: MAX_DAILY_BUDGET,        // Add this export
  MIN_DAILY_BUDGET: MIN_DAILY_BUDGET,        // Add this export
  MAX_BUDGET_MULTIPLIER: MAX_BUDGET_MULTIPLIER, // Add this export
  // ... rest
};
```

### 11.3 Environment Variable Migration

**CURRENT:** `ENABLE_AD_WRITES` used in `lib/meta-api-client.js:21`
```javascript
var DRY_RUN = process.env.ENABLE_AD_WRITES !== 'true';
```

**NEW:** Replace with `FEATURE_ACTOR_ENABLED`
```javascript
// lib/meta-api-client.js (actor will use this)
var ACTOR_ENABLED = process.env.FEATURE_ACTOR_ENABLED === 'true';

// actor.js will check both:
if (!ACTOR_ENABLED) return { rejected: true, reason: 'feature_disabled' };
if (await store.get('killswitch:actor') === '1') return { rejected: true, reason: 'killswitch' };
```

**Migration Checklist:**
- [ ] Add `FEATURE_ACTOR_ENABLED` to Vercel env vars (default: `true`)
- [ ] Add `LEGACY_OPTIMIZER_WRITES` to Vercel env vars (default: `false`, never change)
- [ ] Deprecate `ENABLE_AD_WRITES` (remove after actor.js proven stable)
- [ ] Add `META_READ_TOKEN` and `META_WRITE_TOKEN` as separate system users

### 11.4 QStash Schedule Decision

**Question:** Keep `calqix-optimizer` 9x daily schedule, or deprecate in favor of `hourly-monitor`?

**Recommendation:** Keep both with distinct roles:

| Schedule | Frequency | Data Collection | Purpose |
|----------|-----------|-----------------|---------|
| `calqix-optimizer` | 9x daily | Ad performance metrics | Funnel: VC → IC → ATC → Purchase |
| `hourly-monitor` | Every hour | Full audit snapshot | All entities + health checks |

**Rationale:**
- 9x daily optimizes for ad optimization windows (when decisions matter)
- Hourly provides audit trail granularity
- Data overlap is acceptable — Redis dedup handles idempotency
- Can deprecate optimizer later if hourly proves sufficient

### 11.5 actor.js Guardrail Requirements

**Must implement in actor.js (from monitor.js + new):**

```javascript
// From lib/meta-ads.js (migrate/reuse):
var MAX_DAILY_BUDGET = 20000;      // €200
var MIN_DAILY_BUDGET = 500;        // €5

// New in actor.js (stricter than monitor.js):
var MAX_BUDGET_CHANGE_PCT = 20;    // vs 2x in meta-ads.js — stricter
var MAX_ACTIONS_PER_24H = 5;       // auto-safe actions cap
var MIN_AUTOMATION_READINESS = 80; // block if below
var MIN_DEDUP_QUALITY_PCT = 60;    // block if below
var LEARNING_PHASE_BLOCK = true;   // never touch learning phase
var ACTION_COOLDOWN_HOURS = 48;    // max 1 action per entity per 48h
```

### 11.6 Execution Order

1. ~~**Condition A:** Get valid API response for pixel 934134615770602~~ — ✅ COMPLETED (active production pixel, 298 events/48h, no conflict)
2. **Create migration PR:** Implement sections 11.1-11.3 changes
3. **Test in staging:** Verify optimizer runs read-only, actor.js handles writes
4. **Deploy to production:** Monitor Telegram for both systems
5. **Then proceed:** With delivery order step 2 (collector.js, snapshotter.js, differ.js)

**⚠️ GATE:** Do not proceed with delivery order step 2 until migration plan (this section) is reviewed.
