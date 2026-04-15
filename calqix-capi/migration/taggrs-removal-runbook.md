# TAGGRS Removal Runbook

## Context
TAGGRS server-side GTM (`GTM-K4LPNF8L`) was installed on `sst.calqix.com` but never activated in production. All event tracking runs via `calqix-capi` on Vercel. This runbook documents the removal process.

## Pre-removal verification (completed 15-04-2026)
- [x] `sst.calqix.com` is NOT referenced in `layout/theme.liquid`
- [x] `GTM-T86BFXXW` (active web GTM) does NOT fire tags to `sst.calqix.com`
- [x] Server container `GTM-PFPBDML6` exported to `/Taggrs/GTM-PFPBDML6_server.json`
- [x] Web container `GTM-TQGPKZ6S` exported to `/Taggrs/GTM-TQGPKZ6S_web.json`
- [x] Archive created at `/migration/taggrs-server-container-archive.json`

## Removal steps

### Step 1: DNS record removal
- **Action:** Delete A record for `sst.calqix.com` → `85.10.147.212` at Namecheap
- **Owner:** Operator (manual)
- **Status:** Pending

### Step 2: SSL certificate
- **Action:** Revoke/delete SSL certificate for `sst.calqix.com`
- **Owner:** Operator (manual, via TAGGRS dashboard or Namecheap)
- **Status:** Pending

### Step 3: TAGGRS subscription cancellation
- **Action:** Cancel TAGGRS subscription
- **When:** 7 days after DNS removal (cutover + 7d = 22-04-2026)
- **Product ID:** `0jkxabi7cq`
- **Owner:** Operator (manual)
- **Status:** Pending

### Step 4: GTM container cleanup (optional)
- **Action:** Delete or archive `GTM-K4LPNF8L` server container in GTM
- **Action:** Delete or archive `GTM-TQGPKZ6S` TAGGRS web container in GTM
- **Note:** `GTM-T86BFXXW` is the active web container and must NOT be touched
- **Owner:** Operator (manual)
- **Status:** Optional

## Verification after removal
1. Confirm `sst.calqix.com` returns NXDOMAIN: `nslookup sst.calqix.com`
2. Confirm no tracking regression: check Meta Events Manager for event volume stability over 48h
3. Confirm bridge health monitor shows no anomalies

## Rollback
No rollback needed — TAGGRS was never active. If DNS removal causes unexpected issues (unlikely), re-add A record at Namecheap.
