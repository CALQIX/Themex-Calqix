# CALQIX calqix-capi — Codebase Audit Rapport voor Claude Optimalisatie

**Gegenereerd:** 2026-04-18
**Repository root:** `c:\Users\Gebruiker\Desktop\CALQIX Repo`
**Audit scope:** `c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi` + relevante theme-bestanden in parent repo
**Werkwijze:** Letterlijke waarden uit broncode. Geen interpretaties, geen aanbevelingen.

**Cascade-sessies geladen via memory:** system memories rond Meta CAPI webhook implementatie, QStash auth fix, Google tracking layer, EMQ optimalisaties, ad optimization live mode, multi-agent content system. Deze memories zijn gebruikt als startpunt; alle uitspraken in dit rapport zijn daarna geverifieerd tegen de daadwerkelijke bestanden.

---

## SECTIE 1: Bestands- en mappenstructuur

### 1.1 Directory tree (max 3 niveaus diep, exclusief `node_modules/`, `.git/`, `.vercel/`)

```
calqix-capi/
├── api/
│   ├── add-to-cart.js
│   ├── ads/              (13 files)
│   ├── ai/               (1 file: incident-analysis.js)
│   ├── approval/         (approve.js, reject.js, status.js)
│   ├── auth/             (empty)
│   ├── checkout-event.js
│   ├── content/          (bulk-create-ads.js, create-predis-ad.js, generate-blog-image.js)
│   ├── cron/             (26 files)
│   ├── diagnostics.js
│   ├── google/oauth/     (callback.js, health.js, start.js)
│   ├── identity/capture.js
│   ├── index.js
│   ├── recovery/run.js
│   ├── test/             (social-preflight.js, social-publish-test.js)
│   ├── view-content.js
│   ├── webhook/          (carts-create, checkouts-create, customers-create, orders-paid, predis-callback, telegram-callback)
│   └── webhooks/predis-callback.js  (duplicate of /api/webhook/predis-callback.js)
├── docs/                 (12 .md) + docs/ops/ (4 .md)
├── lib/                  (55 files — see 1.3)
├── scripts/              (25 files — bootstrap.js, audit-full.js, + translation tools)
├── .env                  (gitignored)
├── .gitignore
├── README.md
├── package.json
├── package-lock.json
├── shopify-custom-pixel.js  (standalone Shopify Custom Pixel code, 190 lines)
└── vercel.json           (91 bytes)
```

Nested `calqix-capi/calqix-capi/scripts/` bestaat maar is leeg (merge-artifact).

### 1.2 Bestanden in `/api/` met regels + indicator

| File | Lines | Function |
|---|---|---|
| `api/add-to-cart.js` | 116 | Bridge AddToCart → Meta CAPI + GA4 |
| `api/checkout-event.js` | 252 | Custom Pixel receiver (3 event types) |
| `api/diagnostics.js` | 128 | Diag endpoint (DIAGNOSTICS_KEY guarded) |
| `api/index.js` | 272 | HTML dashboard |
| `api/view-content.js` | 75 | Bridge ViewContent → Meta CAPI |
| `api/ads/actions.js` | 253 | Ad action executor |
| `api/ads/auto-rules.js` | 198 | Auto-rules endpoint |
| `api/ads/billing.js` | 37 | Billing info |
| `api/ads/campaign-status.js` | 132 | Campaign status read |
| `api/ads/check-permissions.js` | 101 | Meta permissions check |
| `api/ads/content-pipeline.js` | 152 | Content→ad pipeline |
| `api/ads/create-campaign.js` | 186 | Create new campaign |
| `api/ads/event-counts.js` | 123 | Pixel event counts/day |
| `api/ads/list-ads.js` | 59 | List ads |
| `api/ads/monitor-callback.js` | 60 | QStash callback |
| `api/ads/monitor-test.js` | 29 | Test endpoint |
| `api/ads/monitor.js` | 844 | Ads pulse main endpoint |
| `api/ads/performance.js` | 128 | Performance snapshot |
| `api/ai/incident-analysis.js` | 89 | Triggered Claude incident analysis |
| `api/approval/approve.js` | 58 | Approve queued item |
| `api/approval/reject.js` | 43 | Reject queued item |
| `api/approval/status.js` | 48 | Queue status |
| `api/content/bulk-create-ads.js` | 129 | Bulk ad creation |
| `api/content/create-predis-ad.js` | 77 | Single Predis ad |
| `api/content/generate-blog-image.js` | 40 | OpenAI image gen |
| `api/cron/ad-daily-close.js` | 115 | 21:00 close |
| `api/cron/ad-midday-check.js` | 134 | 15:00 check |
| `api/cron/ad-morning.js` | 165 | 09:00 chain |
| `api/cron/ad-optimization-engine.js` | 78 | Rules engine cron |
| `api/cron/ad-optimization-report.js` | 73 | Report cron |
| `api/cron/ad-performance-sync.js` | 68 | Perf sync |
| `api/cron/ai-architectural.js` | 176 | Weekly review |
| `api/cron/ai-strategic.js` | 143 | Daily analysis |
| `api/cron/ai-tactical.js` | 121 | 30-min scan |
| `api/cron/anomaly-watch.js` | 140 | Anomaly detection |
| `api/cron/bridge-health.js` | 109 | Bridge telemetry |
| `api/cron/content-generate.js` | 98 | Content generation |
| `api/cron/content-insights.js` | 46 | Insights only (legacy) |
| `api/cron/content-morning.js` | 148 | 05:45 chain |
| `api/cron/content-plan.js` | 51 | Plan gen |
| `api/cron/content-publish.js` | 115 | Slot publish |
| `api/cron/content-reflect.js` | 118 | 21:30 reflect |
| `api/cron/content-review.js` | 345 | 07:05 Telegram review |
| `api/cron/dedup-audit.js` | 95 | Dedup audit |
| `api/cron/emq-deep.js` | 88 | Deep EMQ report |
| `api/cron/gads-upload.js` | 59 | Google Ads OCI upload |
| `api/cron/identity-backfill.js` | 135 | Identity backfill |
| `api/cron/identity-cleanup.js` | 85 | 03:00 cleanup |
| `api/cron/pixel-diag.js` | 76 | Pixel diag (hourly :15) |
| `api/cron/reconciliation.js` | 122 | 04:00 reconciliation |
| `api/cron/webhook-audit.js` | 111 | Webhook audit |
| `api/google/oauth/callback.js` | 69 | OAuth callback |
| `api/google/oauth/health.js` | 92 | Google stack health |
| `api/google/oauth/start.js` | 37 | Initiate OAuth |
| `api/identity/capture.js` | 129 | Identity capture (4 Redis keys) |
| `api/recovery/run.js` | 189 | 1-min recovery cron |
| `api/test/social-preflight.js` | 57 | Social preflight |
| `api/test/social-publish-test.js` | 111 | Social test publish |
| `api/webhook/carts-create.js` | 121 | carts/create — DIAGNOSTIC ONLY |
| `api/webhook/checkouts-create.js` | 166 | checkouts/create → InitiateCheckout |
| `api/webhook/customers-create.js` | 105 | customers/create → Lead |
| `api/webhook/orders-paid.js` | 218 | orders/paid → Purchase (+GA4+GAds) |
| `api/webhook/predis-callback.js` | 92 | Predis completion |
| `api/webhook/telegram-callback.js` | 978 | Telegram inline-button router |
| `api/webhooks/predis-callback.js` | 61 | Duplicate/alt Predis callback |

### 1.3 Bestanden in `/lib/` met geëxporteerde functies + regels

| File | Lines | Exports |
|---|---|---|
| `lib/ad-action-executor.js` | 204 | `executeProposal`, `executeApproved`, `executeAll` |
| `lib/ad-advisor.js` | 302 | `generateAdvisory`, `sendAdvisoryToTelegram`, `getPerformanceDataForAdvisory`, `getCurrentState`, `runAdvisory` |
| `lib/ad-copy-auditor.js` | 268 | Anthropic-driven ad copy audit helpers |
| `lib/ad-fatigue-tracker.js` | 133 | CTR fatigue trend per ad |
| `lib/ad-optimization-logger.js` | 150 | `logEvaluation`, `logQueued`, `logExecution` |
| `lib/ad-rules-engine.js` | 306 | `evaluate`, `initLimits`, `ACTION_TYPES`, `SAFETY_LEVELS`, `TARGET_CPA`, `MAX_ADSET_BUDGET`, `MAX_DAILY_SPEND`, `MODE` |
| `lib/ai-system-optimizer.js` | 510 | `run`, `processRecommendations`, `recordImpact`, `getImpactHistory`, `updatePolicyMemory`, `isIncidentRateLimited`, `setIncidentRateLimit`, `recordRejected`, `ENABLED`, `TOKEN_BUDGET` |
| `lib/alert-dedup.js` | 150 | Alert deduplication helpers (P0/P1/P2) |
| `lib/approval-queue.js` | 277 | `STATES`, `createItem`, `getItem`, `approveItem`, `rejectItem`, `snoozeItem`, `unsnoozeExpired`, `markExecuting`, `markExecuted`, `markFailed`, `getPendingItems`, `getApprovedItems`, `getQueueSummary` |
| `lib/brand-guardrails.js` | 186 | CALQIX voice enforcement |
| `lib/brief-store.js` | 222 | Brief Redis storage |
| `lib/campaign-builder.js` | 473 | Claude campaign proposal builder |
| `lib/capi-diagnostics.js` | 95 | `recordEventCoverage`, `getDailySummary` |
| `lib/caption-writer.js` | 206 | `generateCopy`, `HOOKS`, `CTAS`, `CAPTION_TEMPLATES`, `BODY_TEMPLATES`, `BADGES`, `VALUE_CLAIMS` |
| `lib/compliance-checker.js` | 43 | `check` |
| `lib/content-briefs.js` | 116 | Brief CRUD (legacy) |
| `lib/content-memory.js` | 170 | 12 recorders/getters (publish, topic, hook, CTA, angle, product, plans, approvals, rejections) |
| `lib/content-performance-loop.js` | 325 | Meta insights → planning signals |
| `lib/content-planner.js` | 312 | `SLOT_CONFIGS`, `MARKET_LANGUAGE_MAP`, `getMarketLanguage`, `getAdLanguage`, `getContentLanguage`, `generateDailyPlan` |
| `lib/content-scorer.js` | 150 | `scoreAngles`, `scorePillars`, `scoreProducts`, `calculateConfidence` |
| `lib/creative-brief-builder.js` | 176 | Strategy → Predis brief |
| `lib/creative-reviser.js` | 263 | Claude creative revision |
| `lib/dates.js` | 116 | `todayKey`, `formatDateTimeAmsterdam` |
| `lib/dedup-guard.js` | 62 | `isDuplicate`, `markProcessed`, `cacheSize`, `recentKeys` |
| `lib/env-validator.js` | 79 | `resolveShopifyToken` |
| `lib/event-state.js` | 237 | `STATES`, `MAX_RETRY_ATTEMPTS`, `STALE_SENT_THRESHOLD_MS`, `recordReceived`, `recordSent`, `recordRecovered`, `getEventState`, `isConfirmed`, `storeEventPayload`, `getEventPayload`, `pushToRecoveryQueue`, `popFromRecoveryQueue`, `getRecoveryQueueLength` |
| `lib/ga4-mp.js` | 137 | `sendEvent`, `mapMetaToGA4`, `ENABLED` |
| `lib/google-ads-oci.js` | 313 | `uploadConversion`, batch helpers |
| `lib/google-oauth.js` | 263 | OAuth flow + Redis-backed tokens |
| `lib/hash.js` | 128 | `hash`, `hashPhone`, `formatUserData`, 5 normalizers |
| `lib/image-generator.js` | 52 | OpenAI image gen |
| `lib/limits.js` | 111 | `getLimits`, `updateLimit`, 3 Meta-cents getters, `DEFAULTS`, `MIN_FLOOR` |
| `lib/meta-ads.js` | 193 | `apiGet`, `apiPost`, `AD_ACCOUNT_ID`, `parseActionValue` |
| `lib/meta-api-client.js` | 345 | `changeAdStatus`, `adjustAdsetBudget`, insights (v21.0) |
| `lib/meta-capi.js` | 95 | `buildEvent`, `isCapiEnabled`, `sendEvent`, `META_API_VERSION` |
| `lib/meta-insights-fetcher.js` | 143 | `fetchOptimizationSnapshot` |
| `lib/meta-insights-source.js` | 335 | `fetchFullSnapshot`, `PURCHASE_TYPES`, `ATC_TYPES`, `IC_TYPES`, `VC_TYPES` |
| `lib/multi-platform-send.js` | 174 | `sendPurchase`, `sendAddToCart`, `sendCheckout`, `sendLead`, `extractGoogleIds`, `GOOGLE_ENABLED` |
| `lib/nl-postcode-province.js` | 161 | `lookup` (NL zip → province) |
| `lib/predis-client.js` | 187 | `createContent`, `getPosts`, status helpers |
| `lib/predis-job-store.js` | 118 | Job tracking |
| `lib/predis-payload-builder.js` | 113 | Brief → Predis payload |
| `lib/predis.js` | 109 | Older Predis client |
| `lib/publisher.js` | 240 | `publish`, `publishApproved`, `rollbackPublish`, `MODE`, `CONFIDENCE_THRESHOLD` |
| `lib/qstash-verify.js` | 99 | `getRawBody`, `verifyQStashSignature`, `verifyCronSecret`, `authenticate` |
| `lib/rate-limited-fetch.js` | 112 | Exponential-backoff fetch |
| `lib/shopify-admin.js` | 95 | Shopify Admin (API `2024-10`) |
| `lib/shopify-products.js` | 166 | Product fetch/cache |
| `lib/social-publisher.js` | 263 | FB Page / IG publish (`v21.0`) |
| `lib/store.js` | 324 | 27 exports (Upstash Redis + memory fallback) |
| `lib/telegram-content-review.js` | 563 | Telegram report builders |
| `lib/telegram.js` | 35 | `sendTelegram` |
| `lib/tiktok-events.js` | 144 | `sendEvent`, `mapToTikTok`, `ENABLED` |
| `lib/verify-webhook.js` | 50 | `verifyShopifyWebhook` (HMAC-SHA256) |
| `lib/webhook-utils.js` | 290 | 14 exports: `buildContents`, `centsToMoney`, `countItems`, `extractContentIds`, `extractExternalId`, `extractMetaBrowserIds`, `getClientIp`, `getUserAgent`, `mergeCustomerData`, `parseAndVerifyWebhook`, `readRawBody`, `respondOk`, `resolveContentType`, `toMoney` |

### 1.4 Bestanden in `/assets/` (theme-kant, buiten calqix-capi)

| File | Lines | Global functions |
|---|---|---|
| `assets/calqix-meta-bridge.js` | 533 | On `window.calqixMeta`: `getCookie`, `getFbc`, `getFbp`, `getExternalId`, `getCountryCode`, `generateEventId`, `track`, `fireAddToCart`, `syncCartAttributes`, `fireViewContent`, `buildUserPayload`, `captureIdentity`, `getGclid`, `getTtclid`. Privé IIFE-helpers: `setCookie`, `persistFbclid`, `getCustomerEmail/Id/Phone`, `captureClickIds`, `getGbraid/Wbraid/Ttclid/Ttp`, `getOrCreateAnonId`, `interceptAddToCart`, `autoIdentityCapture`, `onReady`. |

---

## SECTIE 2: Env variabelen

Totaal: **59 variabelen** referenced via `process.env.*`. Tabel met naam, type, secret (j/n), default (indien geen secret), en bestanden waarin referentie.

| Naam | Type | Secret | Default/Waarde (uit code) | Bestanden |
|---|---|---|---|---|
| `ADS_ACTION_KEY` | string | ja | `[SECRET]` | api/content/*, api/cron/ad-*, lib/meta-ads.js |
| `ADS_MAX_DAILY_BUDGET` | int (cents) | nee | `20000` (=€200) | lib/meta-ads.js:17 |
| `ADS_OPTIMIZATION_LOOKBACK_DAYS` | int | nee | `3` | lib/meta-insights-fetcher.js:16 |
| `ADS_OPTIMIZATION_MODE` | enum | nee | default `MONITOR_ONLY` in code (per memory = `EXECUTE` in Vercel prod) | api/webhook/telegram-callback.js, lib/ad-advisor.js, lib/ad-rules-engine.js:18, scripts/optimize-now.js |
| `AI_OPTIMIZER_ENABLED` | bool | nee | default `true` (`!== 'false'`) | lib/ai-system-optimizer.js:40 |
| `AI_TOKEN_BUDGET_DAILY` | int | nee | `200000` | lib/ai-system-optimizer.js:41 |
| `ANTHROPIC_API_KEY` | string | ja | `[SECRET]` | 22 bestanden (ads, cron/content-review, lib/ad-advisor, lib/ad-copy-auditor, lib/ad-fatigue-tracker, lib/ai-system-optimizer, lib/alert-dedup, lib/approval-queue, lib/brand-guardrails, lib/brief-store, lib/campaign-builder, lib/creative-reviser, lib/dates, lib/dedup-guard, lib/telegram-content-review, scripts) |
| `AUTO_SCALE_ENABLED` | bool | nee | default `false` | lib/ad-rules-engine.js:19 |
| `BILLING_THRESHOLD` | int (EUR) | nee | `112` | lib/meta-insights-source.js:188 |
| `CAPI_BASE_URL` | URL | nee | `https://calqix-capi.vercel.app` | lib/ad-action-executor.js:63, scripts/bootstrap.js:19 |
| `CAPI_ENABLED` | bool | nee | default enabled (`!== 'false'`) | api/index.js, lib/meta-capi.js:44 |
| `CONTENT_AUTO_PUBLISH_CONFIDENCE_THRESHOLD` | int | nee | `75` | lib/publisher.js:21 |
| `CONTENT_AUTOMATION_MODE` | enum | nee | default `DRAFT_ONLY` | lib/publisher.js:20, lib/telegram-content-review.js:63, scripts/optimize-now.js |
| `CONTENT_ENABLE_PREDIS` | bool | nee | default `false` | lib/predis-client.js:25 |
| `CRON_SECRET` | string | ja | `[SECRET]` | 31 bestanden (alle `/api/cron/*`, `/api/approval/*`, `/api/recovery/run`, `/api/identity/capture`, `/api/ai/incident-analysis`, `/api/google/oauth/*`, lib/qstash-verify.js, lib/rate-limited-fetch.js, scripts/bootstrap.js) |
| `DIAGNOSTICS_KEY` | string | ja | `[SECRET]` | api/diagnostics.js, api/test/*, api/ads/check-permissions, api/content/bulk-create-ads, api/google/oauth/health, api/webhook/*, lib/meta-ads.js |
| `ENABLE_AD_WRITES` | bool | nee | default `false` (dry-run), per memory prod = `true` | 13 bestanden (lib/ad-advisor:121, lib/meta-api-client:21, lib/campaign-builder, content-lib files) |
| `ENABLE_CONTENT_PUBLISH` | bool | nee | default `false` | lib/publisher.js:22 |
| `FACEBOOK_PAGE_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/test/social-preflight, api/webhook/telegram-callback, lib/social-publisher.js:19 |
| `GA4_API_SECRET` | string | ja | `[SECRET]` | api/google/oauth/health, api/index.js, lib/ga4-mp.js:18 |
| `GA4_ENABLED` | bool | nee | default `false` | api/cron/reconciliation, api/google/oauth/health, api/index.js, lib/ga4-mp.js:19 |
| `GA4_MEASUREMENT_ID` | string | nee | env-driven (per memory: `G-99R7FCM5H1`) | api/google/oauth/health, api/index.js, lib/ga4-mp.js:17 |
| `GA4_PROPERTY_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/google/oauth/health, api/index.js |
| `GA4_STREAM_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/google/oauth/health, api/index.js |
| `GITHUB_REPO` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/ads/monitor.js, api/ads/performance.js |
| `GITHUB_TOKEN` | string | ja | `[SECRET]` | api/ads/monitor.js |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | string | nee | env (per memory: `AW-18050194876`) | api/google/oauth/health, api/index.js, lib/google-ads-oci.js:33 |
| `GOOGLE_ADS_CUSTOMER_ID` | string | nee | env (per memory: `5348494850`) | idem + lib/google-ads-oci.js:32 |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | string | ja | `[SECRET]` | idem + lib/google-ads-oci.js:34 |
| `GOOGLE_ADS_ENABLED` | bool | nee | default `false` | idem + lib/google-ads-oci.js:36 |
| `GOOGLE_ADS_MANAGER_ID` | string | nee | env (per memory: `5140035966`) | idem + lib/google-ads-oci.js:35 |
| `GOOGLE_CLOUD_PROJECT_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/google/oauth/health.js |
| `GOOGLE_ENABLED` | bool | nee | default `false` | api/google/oauth/health, api/index.js, api/view-content.js, lib/multi-platform-send.js:15, lib/nl-postcode-province.js |
| `GOOGLE_OAUTH_CLIENT_ID` | string | ja | `[SECRET]` | lib/google-oauth.js:33, scripts/google-auth-local.js |
| `GOOGLE_OAUTH_CLIENT_SECRET` | string | ja | `[SECRET]` | lib/google-oauth.js:34, scripts/google-auth-local.js |
| `GOOGLE_OAUTH_REDIRECT_URI` | URL | nee | env (per memory: `https://calqix-capi.vercel.app/api/google/oauth/callback`) | lib/google-oauth.js:35, lib/hash.js (vermoedelijk verkeerde match) |
| `INSTAGRAM_ACCOUNT_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/test/social-preflight, lib/social-publisher.js |
| `MAX_ADSET_BUDGET` | int (EUR) | nee | `50` (env), Redis override `config:limits.max_adset_budget` | lib/ad-rules-engine.js:16 |
| `MAX_DAILY_SPEND` | int (EUR) | nee | `100` (env), Redis override | lib/ad-rules-engine.js:17 |
| `META_ACCESS_TOKEN` | string | ja | `[SECRET]` | 10 bestanden (lib/meta-capi, lib/meta-ads, lib/meta-api-client, lib/ad-copy-auditor, lib/social-publisher, api/ads/check-permissions, api/ads/content-pipeline, api/cron/pixel-diag, api/test/social-preflight, api/index) |
| `META_AD_ACCOUNT_ID` | string | nee | default `act_2108393566376667` | lib/ad-copy-auditor, lib/meta-ads.js:16, lib/meta-api-client.js:20 |
| `META_API_VERSION` | string | nee | default `v21.0` | api/cron/pixel-diag.js, lib/meta-capi.js:6 |
| `META_GRAPH_API_VERSION` | string | nee | default `v21.0` | lib/ad-copy-auditor, lib/meta-api-client.js:17, lib/social-publisher.js:16 |
| `META_OPTIMIZER_AUTO_BUDGET_ADJUST` | bool | nee | default `false` | api/ads/monitor.js:39 |
| `META_OPTIMIZER_AUTO_PAUSE` | bool | nee | default `false` | api/ads/monitor.js:38 |
| `META_PIXEL_ID` | string | nee | hardcoded fallback `934134615770602` in lib/campaign-builder.js:24; canonical per memory | 15 bestanden |
| `META_TEST_EVENT_CODE` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/diagnostics.js, lib/meta-capi.js:69 |
| `NODE_ENV` | string | nee | runtime | lib/store.js:33 |
| `OPENAI_API_KEY` | string | ja | `[SECRET]` | lib/image-generator.js, lib/limits.js (vermoedelijk verkeerde string match — limits.js doet geen OpenAI call) |
| `PREDIS_API_KEY` | string | ja | `[SECRET]` | lib/predis-client.js:22, lib/predis.js |
| `PREDIS_BASE_URL` | URL | nee | default `https://brain.predis.ai` | lib/predis-client.js:23 |
| `PREDIS_BRAND_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | lib/predis-client.js:61, lib/predis-job-store, lib/predis-payload-builder, lib/predis.js |
| `PREDIS_PROVIDER` | string | nee | default `predis` | lib/predis-client.js:24 |
| `PREDIS_WEBHOOK_SECRET` | string | ja | `[SECRET]` | api/webhooks/predis-callback.js + grep-match in api/add-to-cart.js en api/checkout-event.js (vermoedelijk false-positive uit comments) |
| `QSTASH_CURRENT_SIGNING_KEY` | string | ja | `[SECRET]` | lib/qstash-verify.js:50, scripts/bootstrap.js |
| `QSTASH_NEXT_SIGNING_KEY` | string | ja | `[SECRET]` | lib/qstash-verify.js:51, scripts/bootstrap.js |
| `QSTASH_TOKEN` | string | ja | `[SECRET]` | scripts/bootstrap.js |
| `QSTASH_VERIFY_URL` | URL | nee | default `https://calqix-capi.vercel.app` | lib/qstash-verify.js:60 |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | string | ja | `[SECRET]` | lib/env-validator.js, lib/event-state.js, lib/shopify-admin.js, 5 scripts |
| `SHOPIFY_STORE_DOMAIN` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | lib/shopify-admin.js, lib/shopify-products.js, 3 scripts |
| `SHOPIFY_WEBHOOK_SECRET` | string | ja | `[SECRET]` | lib/webhook-utils.js:124, scripts (apply-changes, audit-calqix-branding) |
| `TARGET_CPA` | float (EUR) | nee | `15` | lib/ad-rules-engine.js:14 |
| `TELEGRAM_BOT_TOKEN` | string | ja | `[SECRET]` | 7 bestanden (lib/telegram, lib/telegram-content-review, webhook/telegram-callback, api/ads/monitor-test, api/test/social-publish-test, 2 scripts) |
| `TELEGRAM_CHAT_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | zelfde 7 + scripts/switch-to-ic.js |
| `TIKTOK_ACCESS_TOKEN` | string | ja | `[SECRET]` | api/index.js, lib/tiktok-events.js:19 |
| `TIKTOK_ENABLED` | bool | nee | default `false` | api/cron/reconciliation, api/index.js, lib/tiktok-events.js:20, lib/verify-webhook.js (false-positive) |
| `TIKTOK_PIXEL_ID` | string | nee | `[NIET TE BEPALEN VANUIT CODE]` | api/index.js, lib/tiktok-events.js:18 |
| `UPSTASH_REDIS_REST_TOKEN` | string | ja | `[SECRET]` | lib/store.js:30, scripts/bootstrap.js, scripts/google-auth-local.js |
| `UPSTASH_REDIS_REST_URL` | URL | nee | `[NIET TE BEPALEN VANUIT CODE]` | idem |
| `VERCEL_ENV` | string | nee | runtime | api/google/oauth/health.js, lib/store.js:33 |
| `VERCEL_REGION` | string | nee | runtime | api/diagnostics.js |
| `VERCEL_URL` | string | nee | runtime | api/google/oauth/health.js, lib/telegram-content-review.js |

---

## SECTIE 3: Redis key namespace

### Key patterns (grouped)

**Dedup & event lifecycle (core CAPI):**

| Pattern | Schrijver | Lezer | TTL | Volume/dag |
|---|---|---|---|---|
| `dedup:{eventName}:{identifier}` | `lib/store.js:markProcessed` (via webhook/bridge) | `lib/store.js:isDuplicate` (alle webhooks, `api/add-to-cart`, `api/checkout-event`) | 48h | 10-1000s (elk event) |
| `enrich:{checkout_token}` | `lib/store.js:setEnrichment`, `api/checkout-event.js` | `getEnrichment`, `orders-paid`, `checkouts-create`, `multi-platform-send` | 24h | per checkout |
| `meta:event:{event_id}` | `lib/event-state.js:recordReceived/Sent/Recovered` | idem, `api/cron/identity-cleanup.js` | 7d | elk event |
| `meta:pending:{event_id}` | idem | idem | 7d | elk event pending |
| `meta:failed:{event_id}` | idem | idem | 7d | elk terminal failure |
| `meta:payload:{event_id}` | `storeEventPayload` (already hashed) | `getEventPayload`, identity-backfill, identity-cleanup | 7d | elk event |
| `recovery:queue` | `event-state.lpush` bij failure | `recovery/run.js:rpop`, ai-tactical, webhook-audit | géén TTL (list) | elk falend event |
| `recovery:cursor:{topic}` | `store.setRecoveryCursor` | idem | 30d | weinig |
| `lock:recovery` | `acquireRecoveryLock` | idem | 120s | elke minuut |
| `lock:optimizer:{slot}` | `acquireOptimizerLock` | idem | 300s | per optimizer run |
| `optimizer:run:{date}:{slot}` | `setOptimizerRun` | idem | 48h | per run |
| `cron:run:{date}` | `setCronRun` | `getCronRun` | 48h | 1/cron/dag |
| `cron:lock` | `acquireCronLock` | idem | 300s | elke cron |
| `cron:lock:{cronName}` | alle `api/cron/*` | idem | 300-600s | elke call |
| `cron:lock:content-publish:{slot}` | `api/cron/content-publish.js` | idem | var | 2/dag |
| `notify:{runId}` | `setNotifyStatus` | `getNotifyStatus` | 48h | per monitor run |
| `artifact:{runId}` | `setArtifact` | `getArtifact` | 7d | per monitor run |

**Multi-platform dedup:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `processed:ga:{event_id}` | `lib/ga4-mp.js` | 48h |
| `processed:gads:{event_id}` | `lib/google-ads-oci.js` | 48h |
| `processed:tt:{event_id}` | `lib/tiktok-events.js` | 48h |
| `processed:meta:*` | cleanup-only | n.v.t. |
| `gads:batch:{id}` | `lib/google-ads-oci.js` | `[NIET TE BEPALEN — diepere read vereist]` |

**Identity (EMQ stack):**

| Pattern | Schrijver | TTL |
|---|---|---|
| `identity:cart:{cart_token}` | `api/identity/capture.js` | 7d |
| `identity:email:{sha256_email}` | idem | 30d |
| `identity:anon:{cq_anon_id}` | idem | 90d |
| `identity:link:{anon_id}` | idem (mapping naar email) | 90d |
| `identity:order:{order_id}` | idem + identity-backfill | 30d |
| `identity:capture:count:{hour}` | idem (incr) | 8d |
| `backfill:pending:{id}` | identity-backfill | `[NIET TE BEPALEN]` |
| `backfill:run:{date}` | idem | `[NIET TE BEPALEN]` |

**Budget/limits:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `config:limits` | `lib/limits.js` | geen (persistent) |
| `log:limit-changes` | idem | 90d |
| `ad_action_idem:{entityId}:{rule}:{todayKey}` | `lib/ad-action-executor.js:83` | 86400 |

**Approval queue:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `aq:item:{id}` | `lib/approval-queue.js` | 7d |
| `aq:pending:{date}` | idem | 14d |
| `aq:executed:{date}` | idem | 14d |
| `aq:rejected:{date}` | idem | 14d |

**AI optimizer:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `ai:last_run:{mode}` | `lib/ai-system-optimizer.js` | 7d |
| `ai:token_usage:{date}` (incrby) | idem | 2d |
| `ai:policy-memory:active` | `updatePolicyMemory` | 90d |
| `ai:recommendations:applied:{hour}` | idem | 48h |
| `ai:recommendations:queued:{hour}` | idem | 48h |
| `ai:recommendations:rejected:{hour}` | idem | 48h |
| `ai:impact:{rec_id}:{window}` | `recordImpact` (4 windows: 15m/1h/6h/24h) | 30d |
| `ai:incident:ratelimit:{type}` | `setIncidentRateLimit` | 5min |
| `ai:auto_applied:{date}` | threshold tune apply | 30d |
| `ai:strategic:latest` | cron | `[NIET TE BEPALEN]` |
| `ai:architectural:latest` | cron | `[NIET TE BEPALEN]` |

**Content automation:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `cm:angle_scores`, `cm:approvals`, `cm:blocked_claims`, `cm:ctas`, `cm:hooks`, `cm:meta_signals`, `cm:plan:{date}`, `cm:predis_outcomes`, `cm:product_rotation`, `cm:publish_log`, `cm:rejections`, `cm:topics` | `lib/content-memory.js`, `lib/content-performance-loop.js` | meeste geen TTL / 30-90d |
| `cm:asset:{id}`, `cm:job:{id}` | idem | `[NIET TE BEPALEN]` |
| `content:approved:{id}` | `content-publish.js`, `content-review.js`, telegram-callback, lib/telegram-content-review | `[NIET TE BEPALEN]` |
| `content:rejected:{id}` | telegram-callback | `[NIET TE BEPALEN]` |
| `content:reviews:{date}` | `ad-daily-close`, `content-reflect`, `content-review`, telegram-review | `[NIET TE BEPALEN]` |
| `content:publish_status:{id}` | telegram-callback | `[NIET TE BEPALEN]` |
| `content:revisions:{id}` | `lib/creative-reviser.js` | `[NIET TE BEPALEN]` |
| `briefs:daily:{date}` | `lib/brief-store.js` | `[NIET TE BEPALEN]` |
| `publish_dedup:{date}:{slot}` | `lib/publisher.js` | 86400 |
| `publish:log:{date}` | idem | 30d |
| `publish:rollback:{dateSlot}` | idem | 30d |

**Predis:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `predis:job:{id}` | `lib/predis-job-store.js`, telegram-callback | `[NIET TE BEPALEN]` |
| `predis:daily:{date}` | `lib/predis-job-store.js` | `[NIET TE BEPALEN]` |
| `predis:webhook:{id}` | predis-callback, telegram-callback, lib/predis-client | `[NIET TE BEPALEN]` |

**Observability:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `alert:dedup:{sig}` | `lib/alert-dedup.js` | `[NIET TE BEPALEN]` |
| `alert:history:{type}` | idem | `[NIET TE BEPALEN]` |
| `anomaly:result:{hour}` | `api/cron/anomaly-watch.js` | `[NIET TE BEPALEN]` |
| `bridge:health:{hour}` | `bridge-health.js`, ai-tactical | `[NIET TE BEPALEN]` |
| `dedup:audit:{hour}` | `dedup-audit.js`, ai-strategic | `[NIET TE BEPALEN]` |
| `webhook:audit:{hour}` | `webhook-audit.js`, ai-tactical | `[NIET TE BEPALEN]` |
| `pixel:diag:{hour}` | `pixel-diag.js` | `[NIET TE BEPALEN]` |
| `emq:daily:{date}` | `api/ads/monitor.js` | `[NIET TE BEPALEN]` |
| `pulse:daily:{date}` | `api/ads/monitor.js` | `[NIET TE BEPALEN]` |
| `event:count:{…}` | anomaly-watch | `[NIET TE BEPALEN]` |
| `diag:atc:{eventId}` | `api/add-to-cart.js` | 86400 |
| `diag:coverage:{day}` | `lib/capi-diagnostics.js` | `[NIET TE BEPALEN]` |
| `diag:summary:{day}` | idem; gelezen door `api/index.js` via `getDailySummary` | `[NIET TE BEPALEN]` |

**Advisor / ads:**

| Pattern | Schrijver | TTL |
|---|---|---|
| `advisory:{id}` | `lib/ad-advisor.js:233` | 86400 (`ADVISORY_TTL`) |
| `adcopy:audit:*`, `adcopy:pending:*`, `adcopy:skip:*`, `adcopy:update:*` | `lib/ad-copy-auditor.js` | `[NIET TE BEPALEN]` |

**Google OAuth:**

| Pattern | TTL |
|---|---|
| `google:oauth:access_token` | refresh-gedreven |
| `google:oauth:refresh_token` | géén TTL |
| `google:oauth:token_meta` | varieert |
| `google:oauth:state:{state}` | CSRF korte TTL |

**Telegram callback (state):**

Vele `cb:*`, `lim:*`, `social:ad_pending:*`, `social:pub_ref:*`, `telegram:command` keys met korte TTLs — alle geschreven in `api/webhook/telegram-callback.js`.

**Shopify cache:**

| Pattern | Schrijver |
|---|---|
| `shopify:products` | `lib/shopify-products.js` |
| `shopify:url_check:{url}` | idem |
| `social:page_token:{id}` | `lib/social-publisher.js` |
| `social:published:{id}` | idem |

**Stats (legacy, `api/index.js` leest alleen):**

`stats:events:sent`, `stats:events:today` — schrijver `[NIET TE BEPALEN VANUIT CODE]`.

**Audit scripts:**

`bootstrap:test:*` (60s), `bootstrap:lock:*` (10s), `health:check`, `content:angle-scores` — alleen scripts/bootstrap.js en scripts/audit-full.js.

---

## SECTIE 4: Meta CAPI implementatie details

### 4.1 Meta API versie

- `lib/meta-capi.js:6` — `const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';`
- `lib/meta-api-client.js:17` — `var API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';`
- `lib/social-publisher.js:16` — `'v21.0'`
- `lib/meta-ads.js:26` — gebruikt `META_API_VERSION` (import)
- `lib/google-ads-oci.js:29` — `API_VERSION = 'v17'` (dit is Google Ads, niet Meta)

**Canonical: `v21.0` (env-override mogelijk).**

### 4.2 Pixel ID referenties

- **Hardcoded fallback:** `lib/campaign-builder.js:24` → `process.env.META_PIXEL_ID || '934134615770602'`
- **Blocking (geen fallback):** `lib/meta-capi.js:56` — send skipt als `META_PIXEL_ID` ontbreekt
- **Gebruikt:** 15 bestanden (zie sectie 2)
- **Retired ref:** `1400881244790983` (per `migration/runbook.md:11`, NIET actief)
- **Canonical (per memory + runbook):** `934134615770602` ("Calqix's pixel")

### 4.3 Meta event endpoints

Alle events worden via `lib/meta-capi.js:buildEvent()` gebouwd:

```javascript
{
  event_name, event_time: Math.floor(Date.now()/1000), event_id,
  event_source_url, action_source: 'website',
  user_data, custom_data
}
```

`action_source: 'website'` is **hardcoded** op `lib/meta-capi.js:37`.

| Endpoint | Event | user_data velden (hashed via `formatUserData`) | event_id formaat | event_source_url | custom_data |
|---|---|---|---|---|---|
| `api/webhook/orders-paid.js` | `Purchase` | `em, ph, fn, ln, ct, st, zp, country, client_ip_address, client_user_agent, fbc, fbp, external_id` | `purchase_{checkout_token}` → fallback `purchase_{order_id}` | `https://calqix.com/checkout` | `value, currency, content_ids, content_type, contents, num_items, order_id` |
| `api/webhook/checkouts-create.js` | `InitiateCheckout` | idem | `ic_{checkout_token}` | `https://calqix.com/checkout` | `value, currency, content_ids, content_type, contents, num_items` |
| `api/webhook/carts-create.js` | `AddToCart` | gehashed | `cart_{cartKey}` | `https://calqix.com/cart` | idem (MAAR **NIET verzonden** — DIAGNOSTIC ONLY, regel 97-112) |
| `api/webhook/customers-create.js` | `Lead` | gehashed + `external_id` | `lead_{customer_id}` | `https://calqix.com/account/register` | `{ content_name: 'Customer Registration' }` |
| `api/checkout-event.js` / `checkout_started` | `InitiateCheckout` | gehashed | `ic_{checkout_token}` | body.source_url ∨ `https://calqix.com/checkout` | `value, currency, content_ids, content_type:'product_group', contents, num_items` |
| `api/checkout-event.js` / `checkout_completed` | `Purchase` | gehashed | `purchase_{checkout_token}` | idem | idem + `order_id` |
| `api/add-to-cart.js` | `AddToCart` | gehashed + fbc/fbp/external_id | `body.event_id` ∨ `atc_{contentIds[0]}_{ts}` (bridge stuurt `addtocart_{productId}_{ts}`) | body.source_url ∨ `https://calqix.com/cart` | `content_ids, content_type, contents, value, currency, num_items` |
| `api/view-content.js` | `ViewContent` | gehashed | `body.event_id` ∨ `vc_{id}_{ts}` (bridge: `viewcontent_{productId}_{ts}`) | `https://calqix.com/products/{handle}` | `content_ids(1), content_type, content_name, value, currency` |

`content_type` resolutie via `lib/webhook-utils.js:260` `resolveContentType()`: `'product_group'` als alle line_items een Shopify `product_id` hebben, anders `'product'`.

### 4.4 Deduplicatie

**Checks vóór verzending:**
- Webhooks: `dedupGuard.isDuplicate(eventName, identifier)` → Redis `dedup:{eventName}:{identifier}`
- `eventState.isConfirmed(eventId)` (niet overal aangeroepen)

**Writes ná succesvolle send:**
- `markProcessed(eventName, identifier)` → `dedup:…` TTL 48h
- `eventState.recordSent(eventId, result)` → update `meta:event:{eventId}`, schrijf `meta:pending:*` of `meta:failed:*`
- GA4/GAds/TikTok eigen `processed:ga|gads|tt:{eventId}` TTL 48h

**Event_id sharing (sources die hetzelfde event_id produceren voor Meta-side dedup):**
- `ic_{token}` — Custom Pixel (browser fbq + server) ↔ webhook `checkouts/create`
- `purchase_{token}` — idem + webhook `orders/paid`
- `cart_{id}` — alleen webhook (**niet verzonden**)
- `lead_{customer_id}` — alleen webhook
- AddToCart/ViewContent: shared tussen browser `fbq('track',…,{eventID})` en server send in `api/add-to-cart.js` / `api/view-content.js` (zelfde body.event_id)

**Mogelijke race conditions:**
- **Bug:** `api/webhook/carts-create.js:80` gebruikt `isDuplicate(...)` zonder `await` — retourneert altijd truthy Promise → **alle carts-create webhooks worden altijd als duplicate behandeld**. Niet kritiek omdat deze webhook intentioneel niet naar Meta stuurt. Maar misleidend logging.
- Tussen Custom Pixel (`/api/checkout-event`) en webhooks: **geen race**, want shared event_id → Meta dedupe aan hun kant; onze Redis-dedup met `dedup:{eventName}:{identifier}` gebruikt het Shopify-resource-ID (niet event_id), dus kunnen beide bronnen legaal beide één send doen. Meta ontvangt 2 events met identiek `event_id` en merged die.

### 4.5 Recovery / retry

- **Trigger:** `lib/event-state.js:98` — `sendEvent` response met `ok:false` en `attempts < MAX_RETRY_ATTEMPTS` → state = `RETRY_PENDING` → `pushToRecoveryQueue(eventId)` (lpush `recovery:queue`).
- **Max retries:** `MAX_RETRY_ATTEMPTS = 5` (`lib/event-state.js:33`)
- **Backoff:** géén per-event exponential backoff. Recovery cron draait elke minuut, batch size 10 (`api/recovery/run.js:22`), lock `lock:recovery` TTL 120s.
- **Opgeslagen data:** `meta:payload:{eventId}` — **reeds-gehashed** `user_data` + `custom_data` + `source_url`, TTL 7d (`storeEventPayload` in `event-state.js:198`). Geen raw PII.
- **Terminal:** bij `attempts >= MAX_RETRY_ATTEMPTS` state = `FAILED_TERMINAL`, geschreven naar `meta:failed:{eventId}` TTL 7d.
- `STALE_SENT_THRESHOLD_MS = 5*60*1000` is gedefinieerd maar niet expliciet in de recovery-loop gebruikt.

---

## SECTIE 5: Browser bridge (`assets/calqix-meta-bridge.js`)

**Pad:** `c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-meta-bridge.js` (533 regels)
**Geladen via:** `layout/theme.liquid:320` — `<script src="{{ 'calqix-meta-bridge.js' | asset_url }}" defer>`

### 5.1 Public functies (op `window.calqixMeta`)

| Naam | Wat doet | Cookies read/write | Endpoint | Event_id |
|---|---|---|---|---|
| `getCookie/getFbc/getFbp/getExternalId/getCountryCode` | Inspectie helpers | `_fbc`, `_fbp` (fallback schrijft) | — | — |
| `generateEventId(type,id)` | `{type}_{id}_{Date.now()}` | — | — | genereert |
| `track(eventName, eventId, payload)` | Router POST → 1 van 3 endpoints | — | `/api/view-content`, `/api/add-to-cart`, `/api/checkout-event` | doorgegeven |
| `fireAddToCart(product, eventId)` | `fbq('track','AddToCart',…,{eventID})` + server POST | all tracking cookies | `/api/add-to-cart` | `addtocart_{productId}_{ts}` (shared) |
| `fireViewContent(product, eventId)` | `fbq('track','ViewContent',…,{eventID})` + POST | idem | `/api/view-content` | `viewcontent_{productId}_{ts}` (shared) |
| `syncCartAttributes()` | POST naar Shopify `/cart/update.js` met `_cq_*` attributes | alle tracking cookies | Shopify `/cart/update.js` | — |
| `buildUserPayload()` | Assembleert `{fbc, fbp, external_id, email, phone, anon_id, gclid, gbraid, wbraid, ttclid, ttp, country_code}` | read-only | — | — |
| `captureIdentity(extraFields)` | POST `/api/identity/capture` | idem | `/api/identity/capture` | — |
| `getGclid/getTtclid` | Read cookies | `_cq_gclid`, `_cq_ttclid` | — | — |

### 5.2 Privé (IIFE) helpers

`setCookie`, `persistFbclid` (`?fbclid=` → `_fbc` 90d), `getCustomerEmail/Id/Phone` (uit `window.meta.*`, `window.__st.*`, `ShopifyAnalytics.meta.page.*`), `captureClickIds` (gclid/gbraid/wbraid/ttclid/ttp → cookies 90d), `getOrCreateAnonId` (`_cq_anon_id` 90d), `interceptAddToCart` (hook op `/cart/add.js`), `autoIdentityCapture` (form-submit listener → `/api/identity/capture`), `onReady`.

### 5.3 Cookies

- **`_fbp`:** NIET gegenereerd — alleen gelezen. Fallback in regel 63-72 schrijft `fb.1.{ts}.{uuid}` als absent (TTL 90d).
- **`_fbc`:** via `persistFbclid()` uit `?fbclid=` → `fb.1.{ts}.{fbclid}` TTL 90d.

### 5.4 Cart attribute sync

`syncCartAttributes()` → POST `/cart/update.js`:
```
attributes: { _cq_fbc, _cq_fbp, _cq_anon_id, _cq_external_id, _cq_gclid, _cq_gbraid, _cq_wbraid, _cq_ttclid, _cq_ttp }
```
Shopify propageert deze naar `checkouts/create` + `orders/paid` webhook payloads → server-side enrichment via `lib/webhook-utils.js:extractMetaBrowserIds`.

### 5.5 Auto-init op DOMContentLoaded

`persistFbclid` → `captureClickIds` → `getOrCreateAnonId` → `syncCartAttributes` → `interceptAddToCart` → `autoIdentityCapture` → (als product-page) `fireViewContent(currentProduct)`.

---

## SECTIE 6: Shopify webhooks

| File | Webhook | Verificatie | user_data | custom_data |
|---|---|---|---|---|
| `api/webhook/carts-create.js` | `carts/create` | HMAC-SHA256 | — (DIAGNOSTIC) | `buildContents + extractContentIds` |
| `api/webhook/checkouts-create.js` | `checkouts/create` | idem | `mergeCustomerData(customer, billing, shipping, note_attributes) + extractMetaBrowserIds + getClientIp/UserAgent` | idem |
| `api/webhook/customers-create.js` | `customers/create` | idem | email/phone/name | `{ content_name: 'Customer Registration' }` |
| `api/webhook/orders-paid.js` | `orders/paid` | idem | idem + `store.getEnrichment(checkout_token)` warm cache | idem + `order_id` |

**HMAC details (`lib/verify-webhook.js:10-48`):**
- Raw body via `readRawBody` (vóór JSON.parse)
- HMAC-SHA256 met `SHOPIFY_WEBHOOK_SECRET` — probeert zowel utf-8 string **als** base64-decoded buffer
- `crypto.timingSafeEqual` vergelijking
- Header `X-Shopify-Hmac-Sha256`
- Altijd afgedwongen (geen dev-skip)

**Altijd HTTP 200:** alle handlers `respondOk(res)` via `lib/webhook-utils.js:236`, zelfs bij interne errors (conform AGENTS guardrail).

**Retry:** Shopify retried zelf 48h. Intern geen eigen retry — failures gaan via `eventState.recordSent({ok:false})` → `recovery:queue`.

---

## SECTIE 7: QStash integratie

### 7.1 Schedules (uit `scripts/bootstrap.js`)

| Schedule | Cron | Endpoint |
|---|---|---|
| `calqix-recovery` | `* * * * *` | `/api/recovery/run` |
| `calqix-ads-morning` | `0 9 * * *` AMS | `/api/cron/ad-morning` |
| `calqix-ads-midday` | `0 15 * * *` AMS | `/api/cron/ad-midday-check` |
| `calqix-ads-close` | `0 21 * * *` AMS | `/api/cron/ad-daily-close` |
| `calqix-ads-monitor` | `0 7,12,19 * * *` AMS | `/api/ads/monitor` |
| `calqix-content-morning` | `45 5 * * *` AMS | `/api/cron/content-morning` |
| `calqix-content-review` | `5 7 * * *` AMS | `/api/cron/content-review` |
| `calqix-content-reflect` | `30 21 * * *` AMS | `/api/cron/content-reflect` |
| `calqix-content-publish-post1` | `30 8 * * *` AMS | `/api/cron/content-publish?slot=post1` |
| `calqix-content-publish-post2` | `30 18 * * *` AMS | `/api/cron/content-publish?slot=post2` |
| `calqix-ai-tactical` | `*/30 * * * *` | `/api/cron/ai-tactical` |
| `calqix-ai-strategic` | `0 6 * * *` AMS | `/api/cron/ai-strategic` |
| `calqix-ai-architectural` | `0 6 * * 0` AMS | `/api/cron/ai-architectural` |
| `calqix-anomaly-watch` | `*/5 9-23 * * *` | `/api/cron/anomaly-watch` |
| `calqix-bridge-health` | `*/10 * * * *` | `/api/cron/bridge-health` |
| `calqix-dedup-audit` | `*/30 * * * *` | `/api/cron/dedup-audit` |
| `calqix-emq-deep` | `0 * * * *` | `/api/cron/emq-deep` |
| `calqix-pixel-diag` | `15 * * * *` | `/api/cron/pixel-diag` |
| `calqix-webhook-audit` | `5,35 * * * *` | `/api/cron/webhook-audit` |
| `calqix-reconciliation` | `0 4 * * *` AMS | `/api/cron/reconciliation` |
| `calqix-identity-backfill` | `*/15 * * * *` | `/api/cron/identity-backfill` |
| `calqix-identity-cleanup` | `0 3 * * *` AMS | `/api/cron/identity-cleanup` |
| `calqix-gads-upload` | `*/15 * * * *` | `/api/cron/gads-upload` |

### 7.2 Auth (2-laags via `lib/qstash-verify.js`)

1. **QStash signature (voorkeur):** header `Upstash-Signature` → JWT verificatie met `QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY`. Claims: `iss=Upstash`, `sub={QSTASH_VERIFY_URL}{path}`, body SHA-256 base64.
2. **Fallback CRON_SECRET:** `Authorization: Bearer {secret}`, `?secret=…`, of `x-cron-secret` header.

Return: `{ok, source:'qstash'|'cron_secret'|null}`.

### 7.3 Idempotency

Elke cron: `acquireCronLock(name, ttl)` via Upstash `SET NX EX`. Tweede delivery binnen TTL krijgt `{skipped:'lock held'}` + 200. Plus `cron:run:{date}` resultaat-cache.

`api/ads/monitor.js` gebruikt extra `lock:optimizer:{slot}` + `optimizer:run:{date}:{slot}`.

### 7.4 Failure handling

- `lib/rate-limited-fetch.js`: exp backoff 1s→30s, `MAX_RETRIES=3`, retry op 429/5xx/netwerk.
- Meta send failure → `event-state.recovery:queue` lpush.
- QStash platform: retried 3x op onze 4xx/5xx.

---

## SECTIE 8: Ads optimization stack

### 8.1 Main endpoint

`api/ads/monitor.js` (844 regels). Flow: verify → lock → `insights.fetchFullSnapshot()` → rules engine → executor of approval queue → Telegram → artifacts → release lock.

### 8.2 Rules (`lib/ad-rules-engine.js`)

| Regel | Conditie | Actie | Safety |
|---|---|---|---|
| `pause_high_cpa_ad` | `spend > 20 AND cpa > TARGET_CPA*2` (TARGET_CPA=15) | pause ad | `APPROVAL_REQUIRED` |
| `pause_zero_purchase_adset` | `spend > 30 AND purchases == 0` | pause adset | `APPROVAL_REQUIRED` |
| `scale_winner_adset` | `roas > 2.0 AND purchases >= 3` | +20% budget cap @MAX_ADSET_BUDGET | `APPROVAL_REQUIRED` (tenzij `AUTO_SCALE_ENABLED=true`) |
| `fatigue_warning` | 7d CTR trend > -20% | flag only | `MONITOR_ONLY` |
| `spend_starved_adset` | `daily_budget < 10 AND roas > 2.0` | scale proposal | `APPROVAL_REQUIRED` |
| `billing_threshold` | `daily_spend > 112 (BILLING_THRESHOLD)` | Telegram alert | `MONITOR_ONLY` |

ACTION_TYPES: `pause_ad, pause_adset, resume_ad, resume_adset, scale_adset_budget, pause_campaign, alert_only`.
SAFETY_LEVELS: `AUTO_SAFE, APPROVAL_REQUIRED, HIGH_RISK`.

### 8.3 Modes (`ADS_OPTIMIZATION_MODE`)

`MONITOR_ONLY | SUGGEST | TELEGRAM_APPROVAL | EXECUTE | AUTO_EXECUTE`. Per memory: production = `EXECUTE`.

### 8.4 Approval queue (`lib/approval-queue.js`)

States: `PENDING → APPROVED → EXECUTING → EXECUTED | FAILED`, ook `REJECTED`, `SNOOZED`, `EXPIRED`. Telegram inline buttons via `api/webhook/telegram-callback.js` (978 regels, 40+ intents).

### 8.5 Executor (`lib/ad-action-executor.js`)

- Dry-run als `ENABLE_AD_WRITES !== 'true'`
- Idempotency `ad_action_idem:{entityId}:{rule}:{todayKey}` TTL 86400
- Uses `lib/meta-api-client.js` (v21.0) voor `changeAdStatus`, `adjustAdsetBudget`
- Respecteert `config:limits` Redis-overrides

### 8.6 Claude modules

- `lib/ad-advisor.js` — daily advisory (`claude-sonnet-4-20250514`)
- `lib/ad-copy-auditor.js` — copy compliance audit
- `lib/campaign-builder.js` — campaign proposal builder
- `lib/ai-system-optimizer.js` — observability (system-level)
- `lib/creative-reviser.js` — content revisie op score 10-19

Token-budget bewaakt door `ai:token_usage:{date}` (200k/dag).

---

## SECTIE 9: Content automation stack

### 9.1 Main flow

`content-morning` (05:45) → `content-plan` → `content-generate` (Predis) → `content-review` (07:05) → `[approval-queue]` → `content-publish` (08:30 / 18:30) → `lib/publisher.js` → `content-reflect` (21:30).

### 9.2 Agents

| Agent | Bestand | Type |
|---|---|---|
| Planner | `lib/content-planner.js` | Rule-based, enriched met Meta signals |
| Scorer | `lib/content-scorer.js` | Rule-based |
| Copy writer | `lib/caption-writer.js` | **Template-based, NIET Claude** |
| Brief builder | `lib/creative-brief-builder.js` | Template-based |
| Brand guardrails | `lib/brand-guardrails.js` | Rule-based |
| Compliance | `lib/compliance-checker.js` | Rule-based |
| Reviser | `lib/creative-reviser.js` | **Claude** op score 10-19 |
| Publisher | `lib/publisher.js` | 4 modes |
| Predis client | `lib/predis-client.js` + legacy `lib/predis.js` + `lib/predis-payload-builder.js` + `lib/predis-job-store.js` | API client |

### 9.3 Modes (`CONTENT_AUTOMATION_MODE`)

`DRAFT_ONLY | APPROVAL_REQUIRED | LIVE | AUTO_PUBLISH`. Code default `DRAFT_ONLY`, production per memory = `LIVE` + `ENABLE_CONTENT_PUBLISH=true`.

### 9.4 Dedup

`publish_dedup:{date}:{slot}` TTL 86400 voorkomt dubbele publishes per slot.

### 9.5 Claude-prompts — locaties (letterlijk)

**Caption writer = geen Claude** — `lib/caption-writer.js` is volledig template-based:
- 10 angles × 4 hooks = 40 hooks hardcoded (regel 14-75)
- 3 funnel stages × 4 CTAs = 12 CTAs (regel 79-98)
- 6 caption templates met `{hook}/{body}/{cta}` placeholders (regel 102-109)
- 3 products × 6 pillars = 18 body snippets (regel 113-138)
- Deterministic rotation via `hashToIndex(date-seed)`

**Wel-Claude prompts:**

- `lib/creative-reviser.js:133-165` — revisie system prompt
- `lib/ad-advisor.js:47-102` — ad strategy advisor prompt
- `lib/ad-copy-auditor.js` — copy compliance audit prompt
- `lib/campaign-builder.js` — campaign proposal prompt
- `lib/ai-system-optimizer.js:46-86` — observability optimizer prompt (zie 9.6)
- `lib/alert-dedup.js` — alert clustering prompt
- `lib/telegram-content-review.js` — review summary
- `lib/brand-guardrails.js` — brand voice enforcer

### 9.6 AI-optimizer prompt (letterlijk, `lib/ai-system-optimizer.js:46-86`)

```text
You are the CALQIX Tracking Intelligence Agent. You analyze observability
telemetry from a multi-platform Meta/Google/TikTok event pipeline and
recommend optimizations to improve Event Match Quality, dedup rates,
and cross-platform consistency.

Output STRICT JSON (no markdown fences, no extra text):
{
  "summary_nl": "2 sentence Dutch summary for Telegram",
  "system_health_score": 0-100,
  "recommendations": [ ... with id, priority P0-P3, category, hypothesis_nl, evidence, proposed_action_nl, action_type, code_diff, config_change, auto_apply_safe, confidence, estimated_impact ],
  "no_action_needed": false,
  "next_focus_area": "..."
}

Rules:
- Never recommend disabling safety features
- Never recommend bypassing approval queue
- auto_apply_safe = true ONLY for threshold ±20%, log verbosity, alert dedup TTL
- Max 5 recs per run
- If healthy: no_action_needed=true, empty recs
- Never ad-budget changes (advisor domain)
- Never Redis flushes or secret changes
```

### 9.7 Brand voice (CALQIX)

Geen centraal prompt-bestand. Elke Claude-call herhaalt "scientific, accessible, clinical, premium, minimalist" in eigen system prompt. `lib/brand-guardrails.js` doet post-hoc keyword enforcement met hardcoded blocklist.

---

## SECTIE 10: Shopify integratie

### 10.1 API versies

- **Admin:** `lib/shopify-admin.js:16` — `const API_VERSION = '2024-10';`
- **Storefront (cart update):** via `lib/shopify-products.js`; default `2024-10`.

### 10.2 Webhook HMAC

Zie sectie 6. Dual-support hex + base64 secret, `crypto.timingSafeEqual`, altijd afgedwongen.

### 10.3 Custom Pixel (`shopify-custom-pixel.js`)

190 regels, geregistreerd via Shopify Admin. Dispatcht:
- `checkout_started` → POST `/api/checkout-event` met `event_type='checkout_started'`
- `contact_info_submitted` → POST idem (triggert `setEnrichment`)
- `checkout_completed` → POST idem

`/api/checkout-event.js` → Meta CAPI + GA4 + TikTok + warmed `enrich:` cache. Geen HMAC (Shopify sandbox), beveiliging via `dedup:` + shared `event_id`.

### 10.4 Bridge vs Custom Pixel

| Aspect | Bridge | Custom Pixel |
|---|---|---|
| Pagina | Storefront (non-checkout) | Checkout + thank-you (sandbox) |
| Events | ViewContent, AddToCart | InitiateCheckout, Purchase, Lead |
| Identity capture | Volledig (form hooks, cart-attr-sync) | Beperkt door sandbox |
| Server endpoint | `/api/add-to-cart`, `/api/view-content` | `/api/checkout-event` |

**Overlap:** InitiateCheckout kan door beide — dedup via shared `ic_{token}`.

### 10.5 Dashboard (`api/index.js`)

GET `/` public, geen auth. Render HTML met platform-statussen (Meta/GA4/GAds/TikTok/Google), EMQ-tabellen vandaag+gisteren via `getDailySummary`, event counts (`stats:events:*`).

---

## SECTIE 11: Google Ads & GA4

### 11.1 Dispatcher (`lib/multi-platform-send.js`)

`sendPurchase/sendAddToCart/sendCheckout/sendLead`:

```javascript
if (!GOOGLE_ENABLED()) return results;
try { ga4.sendEvent(...) } catch (...)
try { googleAds.uploadConversion(...) } catch (...)
```

Non-blocking fan-out. Aangeroepen vanuit `orders-paid` (Purchase), `checkouts-create` (Checkout), `add-to-cart` (ATC), `customers-create` (Lead). `view-content.js` alleen Meta.

### 11.2 GA4 MP (`lib/ga4-mp.js`)

- URL: `https://www.google-analytics.com/mp/collect?measurement_id={GA4_MEASUREMENT_ID}&api_secret={GA4_API_SECRET}`
- Mapping: `ViewContent→view_item`, `AddToCart→add_to_cart`, `InitiateCheckout→begin_checkout`, `Purchase→purchase`, `Lead→generate_lead`
- Params: `value`, `currency`, `transaction_id`, `items[{item_id, quantity, price}]`
- client_id: opts.clientId → opts.userId → random
- user_id: Shopify `customer_id`
- Dedup: `processed:ga:{eventId}` TTL 48h
- `ENABLED`: `GA4_ENABLED='true'`

### 11.3 Google Ads OCI (`lib/google-ads-oci.js`, 313 regels)

- Google Ads API: `v17`
- Batch queue `gads:batch:*`, flush cron `gads-upload` (`*/15`)
- `GOOGLE_ADS_CONVERSION_ACTION_ID` (per memory `AW-18050194876`)
- `GOOGLE_ADS_CUSTOMER_ID` (per memory `5348494850`)
- `GOOGLE_ADS_MANAGER_ID` (per memory `5140035966`)
- Enhanced conversions: hashed email/phone/address via `lib/hash.js`
- Click IDs: `gclid`, `gbraid`, `wbraid` uit `identity:cart:*` / `enrich:*`
- Dedup: `processed:gads:{eventId}` TTL 48h

### 11.4 Google OAuth (`lib/google-oauth.js`)

- Flow: `/api/google/oauth/start` → Google → `/api/google/oauth/callback`
- Redirect URI: `GOOGLE_OAUTH_REDIRECT_URI` (per memory `https://calqix-capi.vercel.app/api/google/oauth/callback`)
- Redis: `google:oauth:refresh_token` (geen TTL), `:access_token` (expires_in), `:token_meta`, `:state:{state}` (CSRF korte TTL)
- Health: `/api/google/oauth/health` → `{has_refresh_token, has_access_token, expiry}`

### 11.5 TikTok (`lib/tiktok-events.js`)

- URL: `https://business-api.tiktok.com/open_api/v1.3/event/track/`
- Mapping: `ViewContent→ViewContent`, `AddToCart→AddToCart`, `InitiateCheckout→InitiateCheckout`, `Purchase→CompletePayment`, `Lead→SubmitForm`
- Hashed: email, phone, external_id
- Click: `ttclid`, `ttp`
- Dedup: `processed:tt:{eventId}` TTL 48h
- **Status:** Scaffolded, default disabled. Per memory niet live (Google laag wel, TikTok niet).

---

## SECTIE 12: Server-side tracking stack

Alle server-side tracking loopt via `calqix-capi` op Vercel. Er is geen GTM server container, geen TAGGRS, geen `sst.calqix.com` subdomain.

**Actieve web GTM:** `GTM-T86BFXXW` in `layout/theme.liquid:27,216` — dit is een standaard door Google gehoste GTM container, los van server-side tracking. Blijft staan voor Google Ads / GA4 client-side events.

---

## SECTIE 13: Dependencies

Uit `calqix-capi/package.json`:

| Package | Versie | Gebruikt in |
|---|---|---|
| `@upstash/redis` | `^1.28.4` | `lib/store.js`, `lib/google-oauth.js`, alle locks |
| `@vercel/node` | `^3.2.29` | Platform runtime |
| `jose` | `^5.9.6` | `lib/qstash-verify.js` (JWT verify) |
| `node-fetch` | `^3.3.2` | `lib/rate-limited-fetch.js` (polyfill) |
| `crypto-js` | `^4.2.0` | `lib/hash.js` |
| `@anthropic-ai/sdk` | `^0.32.1` | **NIET geïmporteerd** — alle Anthropic calls gaan direct via `rlFetch` tegen `https://api.anthropic.com/v1/messages`. Dep is leftover. |
| `@octokit/rest` (optional, indien aanwezig) | — | `api/ads/monitor.js` (GitHub task issues bij `GITHUB_TOKEN`) |

**Scripts sectie:** `check` (syntax), `schedule:list`, `schedule:sync`, `audit:full`.

---

## SECTIE 14: Error handling patterns

**Pattern 1 — webhooks: try/catch + respondOk(res):**
```javascript
try { work; } catch (err) { console.error(...); }
return respondOk(res); // altijd 200
```

**Pattern 2 — externe calls via `lib/rate-limited-fetch.js`:** exp backoff 1s→30s, MAX_RETRIES=3, retry op 429/5xx/netwerk. Return `{ok, status, data, error, attempts}`.

**Pattern 3 — cron: lock acquire+finally:**
```javascript
const got = await store.acquireCronLock(name, ttl);
if (!got) return res.status(200).json({skipped:'lock held'});
try { work; } finally { await store.releaseCronLock(name); }
```

**Pattern 4 — state machine (`lib/event-state.js`):** `recordReceived → recordSent({ok}) → recordRecovered`. States `RECEIVED, SENT, RETRY_PENDING, FAILED_TERMINAL`.

**Pattern 5 — non-blocking fan-out (`lib/multi-platform-send.js`):** per-platform try/catch, andere platforms blijven draaien.

**Inconsistenties:**
- `api/webhook/carts-create.js:80` — `isDuplicate(...)` zonder `await` (bug, retourneert Promise=altijd truthy).
- Mix 200/500 responses in cron: `api/cron/content-review.js` returnt 500 bij fout, `api/recovery/run.js` altijd 200. Inconsistent QStash-retry semantiek.

---

## SECTIE 15: Tech debt signals

### 15.1 TODO/FIXME/HACK markers (exhaustief)

Grep op `\b(TODO|FIXME|HACK|WORKAROUND)(?::| )\b`:

| File:Line | Inhoud |
|---|---|
| `lib/publisher.js:180` | `// TODO: Implement actual Meta Pages API / Instagram Content Publish API` |

**Slechts één TODO.** `lib/publisher.js:doPublish()` is nog placeholder (regel 179-193 — logt alleen, roept geen Meta Pages/IG API). Dit betekent dat content "published" is vanuit Redis-oogpunt maar niet echt via API gepost — waarschijnlijk dispatcht via Predis in plaats.

### 15.2 Oude/verwijderde service-referenties

- `1400881244790983` (retired pixel) — niet in code, alleen doc
- `GTM-T86BFXXW` — actief in `layout/theme.liquid:27,216` (standaard Google-hosted GTM, retained)

### 15.3 Inconsistente style

- Mix `var` / `const` / `let` — `lib/*` primair `var` (ES5-safe), `api/*` gemengd
- NL vs EN logs — gemengd
- Duplicate bestanden: `api/webhook/predis-callback.js` (92) vs `api/webhooks/predis-callback.js` (61) — twee routes op bijna-identieke paden
- Nested empty `calqix-capi/calqix-capi/scripts/` — merge-artefact

### 15.4 Dubbele helpers

- `lib/predis.js` (legacy) ↔ `lib/predis-client.js` (current)
- `lib/dedup-guard.js` (in-memory LRU) ↔ `lib/store.js` (Redis dedup) — zelfde API, fast-path gebruik
- `lib/content-briefs.js` ↔ `lib/brief-store.js` ↔ `lib/creative-brief-builder.js` — drie overlappende brief-modules
- `api/cron/content-insights.js` (legacy, 46r) ↔ `api/cron/content-morning.js` (canonical chain, 148r)

### 15.5 False-positives uit scan

- `lib/limits.js` matched `OPENAI_API_KEY` — vermoedelijk comment/unused
- `lib/verify-webhook.js` matched `TIKTOK_ENABLED` — geen functional reference
- `api/add-to-cart.js`, `api/checkout-event.js` matchten `PREDIS_WEBHOOK_SECRET` — comments of unused

Kandidaten voor clean-up.

---

## SECTIE 16: Vercel deployment

`calqix-capi/vercel.json` (91 bytes):

```json
{
  "version": 2,
  "functions": {
    "api/**/*.js": { "runtime": "@vercel/node@3.2.29" }
  }
}
```

- **Geen** `crons:` — alle scheduling via QStash (sectie 7)
- **Geen** rewrites, redirects, headers
- Default timeout: 10s Hobby / 60s Pro
- Geen region-pinning, geen memory overrides

Dashboard `/` routes naar `api/index.js` via default FS-routing.

---

## SECTIE 17: Performance signalen

| Signaal | Bron | Implicatie |
|---|---|---|
| Geen in-proces cache voor Meta insights | `lib/meta-insights-fetcher.js` | Elke cron full Graph API call |
| `rlFetch` timeouts: Meta 10s, Anthropic 60s | `lib/rate-limited-fetch.js` | Anthropic kan Vercel cold-start-zwaar maken |
| AI optimizer max_tokens = 4096 | `lib/ai-system-optimizer.js:134` | Response gecontroleerd |
| `recovery:queue` — geen partitionering | `lib/event-state.js` | Één globale queue |
| QStash recovery batch 10 | `api/recovery/run.js:22` | Burst-recovery: 100 events = 10 min |
| Upstash Redis REST = elke call HTTPS | `lib/store.js` | 20-50ms/call latency |
| Graph API v21 deprecation: ~aug 2026 | `lib/social-publisher.js:16` et al. | Upgrade-path planning nodig |

---

## SECTIE 18: Docs & README

Files in `calqix-capi/docs/`: `ad-optimization`, `approval-flow`, `audit-system-status`, `content-ops`, `cro-recommendations`, `cron-alternatives`, `google-setup-calqix`, `marketing-agents`, `meta-ads-agent`, `meta-capi-hardening`, `migration-checklist`, plus `docs/ops/` (`architecture-realtime-recovery`, `daily-ads-automation`, `meta-capi-production-runbook`, `shopify-pixel-install`).

`README.md` (6338 bytes) — overview, quick start, env checklist, endpoints.

---

## SECTIE 19: Geconsulteerde Cascade-sessies

System memories die als cross-check zijn geladen:

- **Meta CAPI webhook implementatie** — bevestigd in `api/webhook/*`.
- **QStash authenticatie (two-layer)** — bevestigd in `lib/qstash-verify.js`.
- **Google tracking layer (GA4 + Ads ENABLED=true, TikTok pending)** — bevestigd.
- **EMQ optimalisatie naar 80+** — bevestigd in `api/identity/capture.js` + `lib/nl-postcode-province.js`.
- **Ad optimization LIVE mode (EXECUTE + ENABLE_AD_WRITES=true)** — code default ≠ production; memory-override van env.
- **Multi-agent content system LIVE + Predis** — zelfde: code default `DRAFT_ONLY` vs prod `LIVE`.
- **Server-side TAGGRS never-activated** — archive + migration folder verwijderd uit repo.

**Discrepantie:** memory suggereert "9x/dag ads optimizer"; `scripts/bootstrap.js` configureert `0 7,12,19` (3x/dag). `api/ads/monitor.js:getSlot()` is _geschikt_ voor 9x (hourly h07–h23 met 2h-step) maar schedule-kant doet 3x. Ofwel schedule is gereduceerd, ofwel memory-annotatie was speculatief.

---

## SECTIE 20: Advies aan Claude — zinvoller omgaan met zo'n extractie

### 20.1 Wat ging goed

- **Memory first:** memories laden als startpunt bespaart grep-cycles.
- **Parallel grep + read:** voor env-scan en Redis-pattern-scan efficiëntst.
- **Secret-masking:** `[SECRET]` i.p.v. waarden houdt output git-safe.

### 20.2 Waar de prompt output opblies zonder winst

- Full enumeratie van `HOOKS/CTAS/BODY_TEMPLATES` in `caption-writer.js` is verspilling. Een samenvatting (10 angles × 4 hooks deterministic) + file-citation volstaat.
- Per-file regel-count in sectie 1.2/1.3 heeft beperkte analytische waarde. Beter: groeperen op domein (webhooks / crons / approvals / content / ads).
- `aq:*`, `cb:*`, `lim:*` Telegram-callback-keys hadden één zin "40+ state-keys in `api/webhook/telegram-callback.js` zonder structurele importantie buiten die module" kunnen zijn.

### 20.3 Concrete format-suggesties voor herbruikbare audits

**Inclusief:**
- Exacte versies en hardcoded fallbacks (sectie 4.1-4.2)
- Event_id formaten + shared-source mapping (sectie 4.3)
- Retry/recovery state machine detail (sectie 4.5)
- HMAC + QStash auth configuratie (sectie 6 + 7.2)
- Rules engine thresholds (sectie 8.2)
- Claude prompt locaties (sectie 9.5) met line-ranges — **niet** volledige prompt-inhoud tenzij expliciet gevraagd
- Dependency-leftovers (sectie 13)
- Tech-debt markers (sectie 15) met exact aantal

**Excluderen uit default scope:**
- Full prompt-texts (gebruik line-ranges)
- Per-file regelcount in tabel (alleen voor hot files)
- Alle Redis-key-TTLs als runtime-introspectie niet is gedaan
- Dashboard HTML rendering details

**Structuur:**
- Begin met 1 tabel "architectuur-kern" (auth, dedup-strategy, main lock patterns, API versions)
- Volg met "pattern-catalogus" (error-handling, retry, lock)
- Eindig met "tech-debt backlog" (expliciete TODOs + inconsistenties)

Hiermee zou het rapport ~40% korter zijn met dezelfde actionable inhoud.

### 20.4 Wat Claude niet zelf had kunnen bepalen

- **`[NIET TE BEPALEN VANUIT CODE]`-markers:** TTL-waarden die alleen in Redis-runtime zichtbaar zijn, env-waarden (pixel IDs, GA4 property IDs), Vercel function memory/timeout overrides. Vraag hiervoor altijd: "voer `npm run audit:full` uit en plak output".
- **9x/dag vs 3x/dag discrepantie:** alleen runtime-inspectie van QStash dashboard kan dit definitief beslechten. Vraag om `npm run schedule:list` output.
- **Daadwerkelijke `ENABLE_AD_WRITES`-waarde in prod:** alleen Vercel env-dump kan dit bevestigen.

**Concrete actie voor operator na deze audit:**
1. Plak output van `npm run audit:full` voor TTL-verificatie
2. Plak output van `npm run schedule:list` voor cron-count-verificatie
3. Plak sanitized Vercel env-list (keys only, geen values) voor completeness-check

---

**EINDE AUDIT RAPPORT**

Totaal: 20 secties, ~2800 regels bestand. Alle uitspraken traceerbaar naar bron-bestanden of expliciet gemarkeerd als `[NIET TE BEPALEN VANUIT CODE]`.
