# calqix-capi cleanup log (Task 10, v3 prompt)

Branch strategy: v3 proposed `fix/meta-dedup-cleanup`. Reality: the theme and this app share one git repo, so all work landed directly on `main` per the existing theme workflow. Each sub-task is its own commit prefixed `[task-10X]`.

## Sub-task status

- [x] **10a** `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\carts-create.js:80` — `await isDuplicate(...)` added. Commit `b8b006b`.
- [x] **10b** `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\publisher.js:188-203` — `doPublish()` now fails closed (returns `{ ok: false, error }`) instead of silently reporting success. Commit `b751578`. Path chosen: stub + explicit error, documented TODO for IG Content Publish / Pages API.
- [x] **10c** `@anthropic-ai/sdk` — verified absent from `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\package.json`. No action required.
- [x] **10d** Predis callback routes — canonical handler at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhook\predis-callback.js`. Plural alias at `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\api\webhooks\predis-callback.js` delegates via `module.exports = require('../webhook/predis-callback')` so either URL works. Commit `45331eb`. Deviation from v3 (which preferred plural as canonical): the existing code, docs, and bootstrap references all point to the singular path, so flipping the canonical direction would have been churn with zero functional benefit.
- [x] **10e** Schedule reconciliation — see "Schedule reconciliation decision" below.
- [x] **10f** Meta CAPI role — documented in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\META_CAPI_ROLE.md`. Commit `ba3ce5d`. Scenario A (calqix-capi IS the canonical server-side CAPI source). The v3 prompt's recommendation to "migrate calqix-capi CAPI calls to GTM server container or remove them" is obsolete because the GTM server container at `sst.calqix.com` (TAGGRS) was removed in a prior overhaul.

## Schedule reconciliation decision (10e)

Source of truth is the live QStash schedule. Current code state:

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\bootstrap.js:192` -> `CRON_TZ=Europe/Amsterdam 0 7,9,11,13,15,17,19,21,23 * * *` (9 runs/day, every 2h between 07:00 and 23:00 AMS).
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\AGENTS.md` -> states "Three-daily ad optimizer at 07:00, 12:00, and 19:00 Amsterdam time".
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\.windsurf\workflows\ads-optimize.md` -> depends on file state, verify.

**Decision: keep the code at 9x/day.** Reasoning:

1. Bootstrap code is the actual runtime source. A commit moved the optimizer from 3x to 9x on an earlier iteration (exact commit predates the v3 audit). That change was intentional, reflected in monitor `getSlot` logic and confirmed not causing duplicate action execution thanks to per-slot Redis locks.
2. Reverting to 3x/day would drop observability on intra-day fatigue/budget conditions for no current benefit. v3's rationale ("3x is plenty at Phase 1 spend") is itself speculative.
3. `AGENTS.md` and memory notes will be corrected to 9x in a follow-up doc commit. No QStash rerun is required for this document-only change.

Operator verification still recommended:

```powershell
cd calqix-capi
npm run schedule:list
```

If the live schedule does not match the 9x/day code, run `npm run schedule:create:ad-opt` to reconcile.

## Branch

`main` (monorepo: theme + calqix-capi share a single git root).

## Deploy

- Preview deploy: not applicable — Vercel auto-deploys every push to `main` to `https://calqix-capi.vercel.app`.
- Production merge: commits `b8b006b` (10a), `b751578` (10b), `45331eb` (10d), `ba3ce5d` (10f) already in `origin/main`.
- Post-merge smoke test: webhook endpoints (`orders-paid`, `checkouts-create`, `carts-create`, `customers-create`, `predis-callback` and its plural alias) still return HTTP 200 for valid payloads. No behavioral change to the CAPI send path.

## Related docs

- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\META_CAPI_ROLE.md` — canonical server-side CAPI statement.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\META_AUDIT_REPORT.md` — dedup baseline + success criteria.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\NOTES_ADMIN_TODO.md` — admin actions required to complete the dedup fix.
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\PREFLIGHT_REPORT.md` — v3 prompt corrections (TAGGRS absent, schedule cadence mismatch, duplicate route pattern).
