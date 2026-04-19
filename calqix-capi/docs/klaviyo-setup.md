# Klaviyo setup — CALQIX

Operator + code reference for the Klaviyo integration in `calqix-capi`. All code is in:

- Client: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\klaviyo.js`
- Setup script: `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\klaviyo-setup.js`

---

## 1. Status

Scaffolded, NOT active in production webhooks yet. The client is a thin wrapper around Klaviyo REST API revision `2024-10-15`. No calls are made until:

1. `KLAVIYO_PRIVATE_API_KEY` is set in Vercel env.
2. Lists + templates are created via `ensure-lists` / `ensure-templates`.
3. Webhook handlers are wired up to emit events (see section 5 — deliberately deferred until key + lists exist).

## 2. Required env vars

| Var | Required | Description |
| --- | --- | --- |
| `KLAVIYO_PRIVATE_API_KEY` | yes | Private API key (prefix `pk_*`). Scopes: profiles:read/write, lists:read/write, events:read/write, templates:read/write, flows:read. |
| `KLAVIYO_PUBLIC_API_KEY` | optional | 6-char public key used by the Klaviyo onsite embed form in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-email-signup.liquid`. Already injected by the Klaviyo Shopify app. |
| `KLAVIYO_REVISION` | optional | Defaults to `2024-10-15`. Bump only after verifying compatibility. |
| `KLAVIYO_ENABLED` | optional | Set `false` to short-circuit all Klaviyo calls without throwing. Use during incident response. |

Add to Vercel:

```powershell
vercel env add KLAVIYO_PRIVATE_API_KEY production
# paste pk_xxxxxxxxxxxxxxxxxxxx when prompted
vercel env add KLAVIYO_ENABLED production
# value: true
```

## 3. Where to generate the private key

Klaviyo admin → Account → Settings → **API Keys** → Create Private API Key.

Recommended scopes (least-privilege for this app):

- Profiles: Full
- Lists: Full
- Events: Full
- Metrics: Read-Only
- Templates: Full
- Flows: Read-Only
- Campaigns: Read-Only
- Accounts: Read-Only

Do **not** grant Data Sources or Images unless a later feature needs them.

## 4. First-run commands

Run from `calqix-capi/`:

```powershell
npm install          # node-fetch already declared
node scripts/klaviyo-setup.js ping
node scripts/klaviyo-setup.js ensure-lists
node scripts/klaviyo-setup.js ensure-templates
node scripts/klaviyo-setup.js all    # idempotent; runs all three
```

All commands are safe to re-run. They look up existing entities by name before creating.

## 5. Planned webhook wiring (NOT YET LIVE)

When the operator is ready to go live, add these emits from the existing CAPI webhook handlers. Each one mirrors the Meta CAPI event for consistency:

| Shopify event | Meta CAPI name | Klaviyo metric | File |
| --- | --- | --- | --- |
| `orders/paid` | `Purchase` | `Placed Order` | `api/webhook/orders-paid.js` |
| `checkouts/create` | `InitiateCheckout` | `Started Checkout` | `api/webhook/checkouts-create.js` |
| `carts/create` (diag) | — | `Added to Cart` | `api/webhook/carts-create.js` |
| `customers/create` | `Lead` | `New Subscriber` | `api/webhook/customers-create.js` |
| Custom Pixel `checkout_completed` | `Purchase` | `Placed Order` (dedup via `unique_id = order_{id}`) | `api/checkout-event.js` |

Event payload shape (for `Placed Order`):

```js
await klaviyo.trackEvent(
  'Placed Order',
  { email, phone_number, external_id, first_name, last_name,
    properties: { locale, country, customer_type } },
  { order_id, total, currency, items: [{ product_id, sku, name, quantity, price }] },
  { value: total, value_currency: currency, unique_id: `order_${order_id}` }
);
```

Dedup: Klaviyo uses `unique_id` to suppress repeated events per profile. Align with Meta CAPI event IDs (`purchase_{token}`, `ic_{token}`) so we have one mental model across channels.

## 6. Flow blueprint (to be built in Klaviyo UI)

Templates are seeded via `ensure-templates`. Flow *graphs* (trigger → delay → filter → send) are NOT creatable via API — build these in Klaviyo UI per blueprint below. Each flow is locale-scoped via the corresponding language-specific master list.

### 6.1 Welcome Series (per locale)

- **Trigger**: profile added to `CALQIX Newsletter – {NL|EN|DE|FR}`.
- **Step 1 (0h)**: `Welcome #1 ({locale})` — brand intro + 10% WELCOME10 code.
- **Step 2 (+2d)**: `Welcome #2 ({locale})` — hydroxyapatite science (to seed; empty template, populate before activating).
- **Step 3 (+4d)**: `Welcome #3 ({locale})` — OralBiome Pro formula explainer.
- **Step 4 (+7d)**: `Welcome #4 ({locale})` — last-chance discount reminder + unsubscribe copy.

Filter on each step: `Placed Order zero times since flow started` so buyers exit early.

### 6.2 Abandoned Cart (multi-locale, single flow)

- **Trigger**: `Started Checkout` event (server-sent from `api/webhook/checkouts-create.js`).
- **Delay 1**: 2h — `Abandoned Cart (EN)` template, select by `locale` profile property.
- **Delay 2**: 24h — reminder + social proof.
- **Delay 3**: 72h — 10% off recovery code (code must be operator-approved, not auto-generated).
- **Exit**: `Placed Order` since flow start.

### 6.3 Post-Purchase Thank You + Education

- **Trigger**: `Placed Order`.
- **Step 1 (+0h)**: Thank-you + science journal link.
- **Step 2 (+7d)**: Routine check-in (how to use hydroxyapatite for maximum effect).
- **Step 3 (+28d)**: Refill reminder (conditional on product type: toothpaste/subscription eligible).
- **Step 4 (+45d)**: Review request (Judge.me hook via dynamic variable).

### 6.4 Winback (90-day lapsed)

- **Trigger**: `Placed Order` at least 1 time, none in last 90 days.
- **Step 1**: Educational re-engagement (new research / product update).
- **Step 2 (+7d)**: 15% winback code.
- **Step 3 (+14d)**: Last chance + sunset to "Unengaged" segment.

## 7. Consent & GDPR

- All signup lists must use **double opt-in** unless the operator explicitly disables per-list. CALQIX default is double opt-in.
- `subscribeToList()` in `lib/klaviyo.js` sets `consent: 'SUBSCRIBED'` which Klaviyo treats per the list's consent configuration. Configure double opt-in at list level in Klaviyo UI.
- Custom source field on subscribe: `calqix-capi` or `shopify-onsite-form` — used for reporting.
- Unsubscribe link is `{% unsubscribe %}` in templates (standard Klaviyo tag).

## 8. Brand voice guardrails

All Klaviyo templates must follow `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\brand-guardrails.js`:

- Scientific, clinical, premium, minimalist.
- No unsubstantiated health claims (cross-reference `clinical.ref_1..3` keys in locales).
- No spammy superlatives ("best ever", "miracle").
- English copy for EN locale only; NL/DE/FR templates must be native, not translated literally.

When I create or update templates programmatically, I run the HTML through `brand-guardrails.check()` before calling `updateTemplate()`. Operator can add the same check to manual edits via the Claude-powered reviser in `lib/creative-reviser.js`.

## 9. Operator checklist

See `@c:\Users\Gebruiker\Desktop\CALQIX Repo\NOTES_ADMIN_TODO.md` → "Task 11 admin actions — Klaviyo setup".
