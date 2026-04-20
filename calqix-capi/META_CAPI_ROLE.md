# META_CAPI_ROLE — calqix-capi as canonical Meta Conversions API source

Decision record. This document overrides v2-era comments in source files that hint at future migration to a GTM server container.

## Status: ACTIVE, CANONICAL, NOT DEPRECATED

`calqix-capi` is the **single** server-side Meta Conversions API source for CALQIX as of April 2026. There is no parallel CAPI integration and no planned migration away from this app.

## History and rationale

Prior tracking stack (discarded):

- **Shopify Facebook & Instagram channel CAPI** at Data sharing level "Maximum". Planned to be downgraded to "Standard" as part of the dedup fix so it stops firing events with random event_ids.

Current stack:

- **Browser**: GTM web container `GTM-T86BFXXW` + theme-level `calqix-meta-bridge.js` for deterministic event_id generation.
- **Server**: this app — `calqix-capi`, deployed at `https://calqix-capi.vercel.app`, sending Meta CAPI events directly via `lib/meta-capi.js`.

## What calqix-capi owns

Event sources (server -> Meta CAPI):

| Source file | Event | Event ID format |
| --- | --- | --- |
| `api/webhook/orders-paid.js` | Purchase | `purchase_{checkout_token}` (fallback `purchase_{order_id}`) |
| `api/webhook/checkouts-create.js` | InitiateCheckout | `ic_{checkout_token}` |
| `api/checkout-event.js` | InitiateCheckout + Purchase (via Shopify Custom Pixel) | same ids as above |
| `api/webhook/customers-create.js` | Lead | `lead_{customer_id}` |
| `api/add-to-cart.js` | AddToCart | client-provided `event_id` shared with browser fbq |
| `api/view-content.js` | ViewContent | client-provided `event_id` shared with browser fbq |
| `api/webhook/carts-create.js` | (diagnostic only — no Meta send) | `cart_{id}` |

Outside the scope of CAPI but owned by this app: ad optimization, content planning, approval queue, Predis integration, Telegram operator console, QStash schedules.

## Architectural guarantees (do not break these)

1. **Event IDs are deterministic** where a stable Shopify identifier exists. Never switch to random UUIDs for Purchase/InitiateCheckout/Lead.
2. **Dedup key format must stay stable**: `ic_{token}`, `purchase_{token}`, `cart_{id}`, `lead_{customer_id}`. The browser Custom Pixel and `calqix-meta-bridge.js` both rely on these formats.
3. **Every handler returns HTTP 200 to Shopify webhooks** even on internal error (so Shopify does not disable the subscription). Internal errors go to logs + Redis.
4. **No raw PII in logs**. Only hashed-presence flags (e.g. `hasEmail: true`).
5. **CAPI_ENABLED env var is not a kill switch for this app**. It was an old escape hatch and is NOT used anywhere meaningful now. If disabling Meta sends is needed, scope the change to `lib/meta-capi.js` explicitly.

## Migration comments that need cleanup

The following files previously contained migration-era comments suggesting a future GTM server container takeover. Those comments have been updated to reflect the current single-source architecture:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js:1-4`
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\checkouts-create.js:1-4` (expected pattern, verify)
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\orders-paid.js:1-4` (expected pattern, verify)
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\customers-create.js:1-4` (expected pattern, verify)

Not cleaned up in this commit to keep the 10f change purely documentational. File a follow-up under `[task-10f-followup]` when ready.

## Deployment boundaries

- **Repo root**: monorepo at `c:\Users\Gebruiker\Desktop\CALQIX Repo` containing the Shopify theme and this app side by side. Single git remote.
- **Vercel project**: `calqixs-projects/calqix-capi`. `vercel.json` at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\vercel.json` only rewrites `/` → `/api/index`. No Vercel cron jobs — all scheduling via QStash.
- **QStash schedules**: 23 total. Defined in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\bootstrap.js`. Verify with `npm run schedule:list` from `calqix-capi/`.

## Related documents

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\NOTES_ADMIN_TODO.md` — admin-side Shopify/Meta/GTM actions required to complete the dedup fix.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\META_AUDIT_REPORT.md` — tracked baseline and success criteria. Updated by `scripts/meta-audit.js`.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\docs\ops\meta-capi-production-runbook.md` — runbook for incident response.

## Change control

Changes to Meta CAPI event_id formats, pixel id (934134615770602), or webhook endpoints must be reviewed by the operator before merging. Any such change requires an accompanying update to this file and to `NOTES_ADMIN_TODO.md`.
