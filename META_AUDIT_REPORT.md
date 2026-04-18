# META_AUDIT_REPORT

Seed report. This file is overwritten by `node scripts/meta-audit.js` once env vars (`META_SYSTEM_USER_TOKEN`, `SHOPIFY_ADMIN_API_TOKEN`) are configured. Until then, baseline metrics and success criteria below serve as the tracking doc.

Meta Pixel ID: 934134615770602
Shopify store: calqix.myshopify.com

## Baseline (captured 18 April 2026, Meta Events Manager > Deduplicatie)

| Dedup key | Browser events | Server events | Coverage |
| --- | ---: | ---: | ---: |
| Event ID (preferred) | 16 (100%) | 18 (100%) | 58.79% |
| External ID (fallback) | 0 (0%) | 18 (100%) | 0% |
| FBP (fallback) | 16 (99.5%) | 0 (0%) | 0% |
| Total coverage | | | 58.79% |

Interpretation:

- Both sides emit event_id at 100%, but only 58.79% match. Server event_ids are deterministic (`ic_{token}`, `purchase_{token}`, `cart_{id}`), browser event_ids from Shopify F&I native pixel are random. No overlap possible. After admin step 1 in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\NOTES_ADMIN_TODO.md` (disable F&I automatic events), the mismatched browser source disappears and the AddToCart + ViewContent flows we control are already matched via `calqix-meta-bridge.js`.
- Server sends 18, browser 16. Two events are server-only (Purchase/InitiateCheckout via `calqix-capi` webhooks without paired browser fbq calls — acceptable per Meta "different events from browser and server" pattern).
- External ID 0% on browser: no fallback path if event_id misses. Closed by `@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid:37-55` + `@c:\Users\Gebruiker\Desktop\CALQIX Repo\assets\calqix-meta-bridge.js:503-527` + GTM Meta Pixel Advanced Matching configuration (see admin todo section 3).
- FBP 0% on server: the Shopify F&I CAPI tag does not forward `_fbp`. `calqix-capi` webhook handlers DO read `_meta_fbp` cart attribute and the Custom Pixel forwards cookie fbp as enrichment. Once F&I is disabled, the 0% likely reflects that F&I CAPI was the dominant server source, not `calqix-capi`. After the fix, server fbp should jump toward >95%.

## Expected state after Task 9 admin steps complete

| Dedup key | Browser events | Server events | Coverage target |
| --- | ---: | ---: | ---: |
| Event ID | AddToCart/ViewContent matched | AddToCart/ViewContent matched | >=95% for browser+server overlapping events |
| External ID | >=90% (logged-in) | 100% | >=90% |
| FBP | >=95% | >=95% | >=95% |
| Total coverage | | | >=95% |

Purchase and InitiateCheckout are expected to be predominantly server-only (via `calqix-capi`), which is an accepted Meta pattern and does not require dedup.

## Success criteria (verify 48 hours after admin steps)

- [ ] Event ID coverage >= 95% for overlapping events (AddToCart, ViewContent)
- [ ] External ID coverage >= 90% for logged-in sessions (browser)
- [ ] FBP coverage >= 95% on server
- [ ] Total dedup coverage >= 95% (Meta minimum is 75%)
- [ ] Shopify orders vs Meta Purchase delta <= 5%
- [ ] EMQ >= 9 for Purchase, InitiateCheckout, AddToCart
- [ ] Events Manager > Overview: exactly one Browser source and one Server source per event
- [ ] No diagnostic warnings about duplicate events or mismatched event_ids

## Verification procedure

Run the audit script and review output:

```powershell
$env:META_SYSTEM_USER_TOKEN = "<meta_token>"
$env:SHOPIFY_ADMIN_API_TOKEN = "<shopify_token>"
node scripts/meta-audit.js
```

The script rewrites this file with live metrics. Commit the result as `[audit] meta dedup $(Get-Date -Format yyyy-MM-dd)` for historical tracking.

## Manual checks (cannot be automated)

1. Meta Events Manager > Data Sources > Pixel 934134615770602 > **Deduplicatie** tab
2. Meta Events Manager > Overview > per-event source breakdown
3. Meta Events Manager > Diagnostics > active warnings
4. Meta Events Manager > Test events with a fresh incognito session firing Purchase

Screenshot the Deduplicatie tab at day 7 and attach to the follow-up thread for review.
