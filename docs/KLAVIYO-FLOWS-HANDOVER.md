# CALQIX Klaviyo Flows — Handover (Phase 3)

**Date:** 2026-04-21
**Source:** Empirical probe from `calqix-capi/scripts/klaviyo-build-flows.js`
**Probe log:** `calqix-capi/scripts/tmp/phase3-probe.json`

## API capability verdict

| Operation | Result |
|---|---|
| `GET /api/flows/{id}/?include=flow-actions` | v 200 — read full graph |
| `PATCH /api/flows/{id}/` (status only) | v 200 — can toggle draft/manual/live |
| `POST /api/flow-actions/` | x **405 Method Not Allowed** |
| `PATCH /api/flow-actions/{id}/` settings | Not attempted (POST already blocked) |

**Conclusion:** The 2024-10-15 Klaviyo REST API does **not** expose flow-action CRUD.
Flow graphs (action sequencing, template wiring, conditional splits, time delays)
**must** be built in the Klaviyo UI. Only the flow container status is patchable.

No flow was touched. XnTXAH (Abandoned Checkout) remains **live** with its
pre-existing Klaviyo-default copy. Pause it in the UI before rewriting.

---

## Current flow inventory (from probe)

| ID | Name | Status | Trigger | Existing actions |
|---|---|---|---|---|
| `XnTXAH` | Abandoned Checkout Reminder (Email) | **live** | Metric | 2x SEND_EMAIL + 2x TIME_DELAY (3h, 48h) |
| `U9KJ43` | Welcome Series | draft | Added to List | 3x SEND_EMAIL + 2x TIME_DELAY (3d, 4d) — templates not wired |
| `VJhNs3` | Browse Abandonment | draft | Metric | 1x SEND_EMAIL + 1x TIME_DELAY (20 min) |
| `Skh5Y4` | Added to Cart Reminder | live | Metric | not inspected, Klaviyo defaults |
| `SmjQxy` / `WRGFqc` | Essential Flow Recommendation_ | draft | Unconfigured | empty placeholders, safe to archive |

---

## Flow 1 — Abandoned Cart rewrite (`XnTXAH`)

**Status after API build:** 0% — API cannot rewrite graph.
**Estimated UI time:** 25-35 minutes.

- [ ] Open `Flows` > `Abandoned Checkout Reminder (Email)`
- [ ] Top-right status toggle: **Live -> Manual** (pauses immediate sends)
- [ ] Delete the 2 existing SEND_EMAIL actions and their TIME_DELAYs (clean slate)
- [ ] Build graph:
  - [ ] Trigger: `Checkout Started` (Shopify-native, already set)
  - [ ] Trigger Filter: `Placed Order zero times since flow started`
  - [ ] Time Delay: **2 hours**
  - [ ] Conditional Split #1: profile property `$locale` equals `nl`
    - [ ] YES branch -> Email block, template **`WtUqVh`** (AC T+2h NL)
    - [ ] NO branch -> Conditional Split #2: `$locale` equals `de`
      - [ ] YES -> Email template **`VQTniE`** (AC T+2h DE)
      - [ ] NO -> Email template **`ST4DUj`** (AC T+2h EN)
  - [ ] Time Delay: **22 hours** (total T+24h)
  - [ ] Flow Filter re-check: `Placed Order zero times since flow started`
  - [ ] Conditional Split for locale -> T+24h template:
    - [ ] NL -> **`SNrpyV`**, DE -> **`WphazT`**, EN -> **`VdSjG3`**
  - [ ] Time Delay: **48 hours** (total T+72h)
  - [ ] Flow Filter re-check
  - [ ] Conditional Split for locale -> T+72h template:
    - [ ] NL -> **`WVEWR8`**, DE -> **`WiDUev`**, EN -> **`SbqkWi`**
- [ ] Each Email block settings:
  - [ ] From name: `CALQIX`
  - [ ] From email: `info@calqix.com`
  - [ ] Reply-to: `info@calqix.com`
  - [ ] Subject + preheader: leave as set in template
  - [ ] Tag: `flow:abandoned_cart`
- [ ] Flow settings:
  - [ ] Smart Sending: **ON** (16h window)
  - [ ] Send-Time Optimization: **OFF** (AC must fire immediately)
  - [ ] Exit criteria: `Placed Order since flow started`
  - [ ] Conversion metric: `Placed Order` (Shopify)
- [ ] Preview -> Send Preview to own email and QA render on Gmail + iOS Mail
- [ ] Manual -> **Live**

---

## Flow 2 — Welcome Series activation (`U9KJ43`)

**Status after API build:** 10% — container + some action skeletons exist but none wired to templates. All wiring is UI-only.
**Estimated UI time:** 20-30 minutes.

- [ ] Open `Flows` > `Welcome Series`
- [ ] Trigger: confirm `Added to list: Email List` (list `UeRAty`)
- [ ] Delete existing SEND_EMAIL action skeletons (they have empty settings)
- [ ] Build graph:
  - [ ] Time Delay: **0 hours** (immediate)
  - [ ] Conditional Split for `$locale` -> Welcome #1:
    - [ ] NL -> **`WbqpGe`**, DE -> **`RXxA4D`**, EN -> **`UnYwbK`**
  - [ ] Time Delay: **2 days**
  - [ ] Flow Filter: `Placed Order zero times since flow started`
  - [ ] Conditional Split for locale -> Welcome #2:
    - [ ] NL -> **`RSUjHf`**, DE -> **`UQK47A`**, EN -> **`UVnisY`**
  - [ ] Time Delay: **2 days** (total +4d)
  - [ ] Flow Filter re-check
  - [ ] Conditional Split for locale -> Welcome #3:
    - [ ] NL -> **`Vp8QnP`**, DE -> **`U96K9z`**, EN -> **`XNzLvV`**
  - [ ] Time Delay: **3 days** (total +7d)
  - [ ] Flow Filter re-check
  - [ ] Conditional Split for locale -> Welcome #4:
    - [ ] NL -> **`Tw5GwW`**, DE -> **`VivA3r`**, EN -> **`XHWwax`**
- [ ] Each Email block: same From/Reply-to/tag as flow 1 (tag: `flow:welcome`)
- [ ] Flow settings:
  - [ ] Smart Sending: **ON**
  - [ ] Send-Time Optimization: **ON** (AI-optimal send time)
  - [ ] Exit criteria: `Placed Order since flow started`
  - [ ] Conversion metric: `Placed Order`
- [ ] Pre-requisite: Shopify Discount code `WELCOME10` active (10% off, single-use per customer, no expiry OR 7-day rolling)
- [ ] Preview -> Send Preview
- [ ] Manual -> **Live**

---

## Flow 3 — Post-Purchase Education (new flow)

**Status after API build:** 0% — flow does not exist.
**Estimated UI time:** 15-20 minutes.

- [ ] `Create Flow` -> `From scratch`
- [ ] Name: `CALQIX Post-Purchase Education`
- [ ] Trigger: **Metric** `Placed Order` (Shopify-native)
- [ ] Trigger filter: (optional, leave empty or `Placed Order count since start of flow > 0`)
- [ ] Build graph:
  - [ ] Time Delay: **0 hours**
  - [ ] Conditional Split for `$locale` -> PP Day 0:
    - [ ] NL -> **`Rp8MCT`**, DE -> **`SyxCwK`**, EN -> **`RtL3Yh`**
  - [ ] Time Delay: **7 days**
  - [ ] Email template **`UkXw3e`** (PP Day 7, EN-only — Flow notes should mention "Day 7+ content is EN-only: brand default")
  - [ ] Time Delay: **21 days** (total +28d)
  - [ ] Email template **`Rivxhv`** (PP Day 28, EN-only)
- [ ] Each Email block: From/Reply-to as flow 1, tag: `flow:post_purchase`
- [ ] Flow settings:
  - [ ] Smart Sending: **ON**
  - [ ] Send-Time Optimization: **ON**
  - [ ] Exit criteria: **NONE** (do not exit on Placed Order — we still want Day 28 for repeat orders)
  - [ ] Conversion metric: `Placed Order`
- [ ] Manual -> **Live**

---

## Flow 4 — Browse Abandonment (`VJhNs3`)

**Status after API build:** 5% — container exists, 1 send-email + 1 time-delay skeleton present.
**Estimated UI time:** 15-20 minutes.

- [ ] Open `Flows` > `Browse Abandonment`
- [ ] Trigger: confirm `Viewed Product` (integration=API, our CAPI is the only source)
- [ ] Trigger filter: `Viewed Product zero times in last 1 day EXCLUDING THIS ONE` (anti-spam)
- [ ] Flow filter: `Added to Cart zero times since flow started` AND `Placed Order zero times since flow started`
- [ ] Build graph:
  - [ ] Time Delay: **4 hours** (replace the 20 minute skeleton)
  - [ ] Flow filter re-check
  - [ ] Conditional Split: `event.ProductID is set` (YES branch only)
  - [ ] Email block: use Klaviyo's built-in **Recently Viewed Products** dynamic block (no template seeded for this — build copy in UI directly; suggestion below)
- [ ] Suggested copy for the inline block:
  - Subject: `Thinking it over?`
  - Preheader: `A small nudge from CALQIX.`
  - Heading: `Still curious about {{ event.Title|default:"what you were browsing" }}?`
  - Body: short para + a Recently Viewed Products block pinned to `event.ProductID`.
- [ ] From/Reply-to: same, tag: `flow:browse_abandonment`
- [ ] Flow settings:
  - [ ] Smart Sending: **ON**
  - [ ] Send-Time Optimization: **OFF** (keep close to viewing time)
  - [ ] Exit criteria: `Added to Cart OR Placed Order since flow started`
- [ ] Preview -> Send Preview
- [ ] Manual -> **Live** (only after email capture coverage is sufficient — see §7 of `calqix-capi/docs/klaviyo-flow-setup.md`)

---

## Preconditions that still need manual attention

- [ ] Shopify discount `WELCOME10` exists and is active (required for Welcome #1, #4 and AC T+72h)
- [ ] Klaviyo sender domain `calqix.com` fully authenticated (SPF + DKIM + DMARC)
- [ ] Profile property `$locale` is populated (Klaviyo Shopify app already writes it; our CAPI may need patch — see `calqix-capi/docs/klaviyo-flow-setup.md` §7.1)
- [ ] Archive the two `Essential Flow Recommendation_` placeholders (`SmjQxy`, `WRGFqc`) if you want a clean Flow list

---

## Execution order (recommended)

1. Abandoned Cart (highest revenue impact — already live, replace copy)
2. Welcome Series (highest conversion lift on list growth)
3. Post-Purchase (customer retention, review collection)
4. Browse Abandonment (defer until email capture rate is sufficient)

## Estimated total UI time

| Flow | Time |
|---|---|
| Abandoned Cart | 25-35 min |
| Welcome Series | 20-30 min |
| Post-Purchase | 15-20 min |
| Browse Abandonment | 15-20 min |
| **Total** | **75-105 min** (approx. 1.5 hours hands-on) |
