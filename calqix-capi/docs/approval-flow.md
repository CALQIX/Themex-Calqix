# CALQIX Approval Flow — Operator Console & Queue

## Overview

All non-trivial actions (content publishing, ad pauses, budget changes) flow through an approval queue. Operators review and approve/reject via Telegram links or direct API calls.

## State Machine

```
PENDING → APPROVED → EXECUTING → EXECUTED
   ↓         ↓                      ↓
REJECTED   (timeout)             FAILED
```

## API Endpoints

### Approve
```
GET /api/approval/approve?id={itemId}&secret={CRON_SECRET}
GET /api/approval/approve?id={itemId}&secret={CRON_SECRET}&execute=true
POST /api/approval/approve
  Body: { "id": "...", "execute": true }
```

### Reject
```
GET /api/approval/reject?id={itemId}&secret={CRON_SECRET}&reason={reason}
POST /api/approval/reject
  Body: { "id": "...", "reason": "..." }
```

### Status
```
GET /api/approval/status?secret={CRON_SECRET}
GET /api/approval/status?id={itemId}&secret={CRON_SECRET}
GET /api/approval/status?date=2025-01-15&secret={CRON_SECRET}
```

## Approval Types

| Type | Source | Auto-executable |
|------|--------|-----------------|
| `content_publish` | Publisher agent | Yes (after approval) |
| `pause_ad` | Rules engine | Yes (after approval) |
| `scale_adset` | Rules engine | Yes (after approval) |

## When Approvals Are Created

### Content
- `APPROVAL_REQUIRED` mode: all content queued before publish
- `AUTO_PUBLISH` mode: only low-confidence content (below threshold)

### Ad Optimization
- `SUGGEST` mode: all proposals queued
- `AUTO_EXECUTE` mode: only `APPROVAL_REQUIRED` safety level actions
- `MONITOR_ONLY` mode: no queue items created

## Execution Flow

1. Cron job evaluates rules / generates content
2. Actions that need approval → `createItem()` → state: `PENDING`
3. Telegram notification sent with approve/reject links
4. Operator clicks approve → state: `APPROVED`
5. Next cron run (or immediate if `execute=true`) → `markExecuting()` → state: `EXECUTING`
6. Meta API call or publish action → `markExecuted()` → state: `EXECUTED`
7. If error → `markFailed()` → state: `FAILED`

## Execution Windows

Approved actions are executed during:
- **Content**: Next content-publish cron (08:30 or 18:30)
- **Ad actions**: Next ad-midday-check (15:00) or manually via `?execute=true`

## Redis Key Patterns

| Pattern | TTL | Description |
|---------|-----|-------------|
| `aq:item:{id}` | 7d | Individual queue item |
| `aq:pending:{date}` | 7d | List of pending item IDs |
| `aq:approved:{date}` | 7d | List of approved item IDs |
| `aq:summary:{date}` | 7d | Daily queue summary |

## Telegram Integration

Approval notifications include clickable links:
```
Approve: https://calqix-capi.vercel.app/api/approval/approve?id=aq_abc123&secret=YOUR_SECRET
Reject:  https://calqix-capi.vercel.app/api/approval/reject?id=aq_abc123&secret=YOUR_SECRET&reason=not_ready
```

## Security

- All approval endpoints require `CRON_SECRET` authentication
- Queue items expire after 7 days (TTL)
- State transitions are validated (can't approve an already-executed item)
- All state changes logged with timestamps and operator identity
