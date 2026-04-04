# CALQIX Marketing Automation — Agent Architecture

## Overview

Multi-agent marketing automation system built on Vercel serverless functions, Upstash Redis, QStash scheduling, Meta Marketing API, Predis.ai, and Telegram.

## Agents

### 1. Strategy Agent (`content-planner.js`)
- Generates daily content plans (2 posts + 1 reserve)
- Selects angles, pillars, products based on scoring
- Incorporates Meta performance signals when available
- Avoids angle fatigue via rotation and memory

### 2. Research Agent (`content-performance-loop.js`)
- Analyzes Meta ad performance data
- Detects top/weak angles by CTR and ROAS
- Identifies spend-starved and fatigued creatives
- Stores signals in Redis for planner consumption

### 3. Brand & Compliance Agent (`brand-guardrails.js`, `compliance-checker.js`)
- Enforces CALQIX brand voice: English, scientific, accessible, clinical, premium
- Blocks spammy phrases, unsubstantiated health claims
- Checks caps ratio, emoji count, exclamation marks
- Validates against historically blocked claims
- Platform-specific checks (Instagram caption length, Facebook image text)

### 4. Copy Agent (`caption-writer.js`)
- Template-based hook, caption, CTA, header, badge, value claim generation
- Angle-aware and pillar-aware copy selection
- Deterministic rotation using date-seeded hashing
- Product-specific body copy for all 3 products

### 5. Creative Brief Agent (`creative-brief-builder.js`)
- Transforms strategy + copy into production-ready briefs
- Selects format (single image, carousel) and aspect ratio
- Generates ad concept descriptions and special instructions
- Outputs Predis-compatible fields

### 6. Predis Execution Agent (`predis-client.js`, `predis-payload-builder.js`, `predis-job-store.js`)
- Provider abstraction (Predis.ai primary, extensible)
- Draft-only mode when `CONTENT_ENABLE_PREDIS !== 'true'`
- Job submission, polling, asset extraction
- Redis-backed job tracking with daily summaries

### 7. Publisher & QA Agent (`publisher.js`)
- Three publishing modes: `DRAFT_ONLY`, `APPROVAL_REQUIRED`, `AUTO_PUBLISH`
- Compliance gate before any publish
- Deduplication per slot per day
- Confidence threshold for auto-publish
- Records all publishes in content memory

### 8. Ad Optimization Agent (`ad-rules-engine.js`, `ad-action-executor.js`)
- Rules engine with pause, scale, fatigue, and spend-starved detection
- Three execution modes: `MONITOR_ONLY`, `SUGGEST`, `AUTO_EXECUTE`
- Approval gating for non-safe actions
- Budget protection (MAX_ADSET_BUDGET, MAX_DAILY_SPEND)
- Idempotent execution with daily dedup keys

### 9. Approval Orchestrator (`approval-queue.js`, Telegram review, API endpoints)
- Redis-backed queue with state machine (pending → approved → executing → executed)
- Telegram notifications with inline approve/reject links
- REST API for approve, reject, status
- Supports both content and ad action approvals

## Content Memory (`content-memory.js`)
- Tracks posted topics, hooks, CTAs
- Angle fatigue and winning scores
- Blocked claims registry
- Product rotation balance
- Approval/rejection history
- Predis generation outcomes
- Daily plans and content jobs

## Scoring System (`content-scorer.js`)
- **Angle scoring**: fatigue penalty, winning bonus, recency bonus, Meta CTR signals, under-tested bonus
- **Pillar scoring**: distribution balance (targets 1/6 per pillar)
- **Product scoring**: rotation balance with recency weighting
- **Confidence score**: composite of angle score, Meta backing, pillar freshness (0-100)

## Data Flow

```
Meta Insights → Performance Loop → Content Planner → Creative Brief Builder
                                                           ↓
                                          Caption Writer → Predis Payload → Predis Client
                                                                                ↓
                                                              Compliance Check → Publisher
                                                                                ↓
                                                              Telegram Review ← Approval Queue
```

## Environment Variables

### Content Automation
| Variable | Default | Description |
|----------|---------|-------------|
| `CONTENT_AUTOMATION_MODE` | `DRAFT_ONLY` | DRAFT_ONLY, APPROVAL_REQUIRED, AUTO_PUBLISH |
| `CONTENT_ENABLE_PREDIS` | `false` | Enable Predis.ai API calls |
| `CONTENT_ENABLE_TELEGRAM_REVIEW` | `true` | Send Telegram content previews |
| `CONTENT_AUTO_PUBLISH_CONFIDENCE_THRESHOLD` | `75` | Min confidence for auto-publish |
| `ENABLE_CONTENT_PUBLISH` | `false` | Enable actual publishing |
| `PREDIS_API_KEY` | — | Predis.ai API key |
| `PREDIS_BASE_URL` | `https://api.predis.ai` | Predis API base URL |

### Ad Optimization
| Variable | Default | Description |
|----------|---------|-------------|
| `ADS_OPTIMIZATION_MODE` | `MONITOR_ONLY` | MONITOR_ONLY, SUGGEST, AUTO_EXECUTE |
| `TARGET_CPA` | `15` | Target cost per acquisition (EUR) |
| `MAX_ADSET_BUDGET` | `50` | Max adset daily budget (EUR) |
| `MAX_DAILY_SPEND` | `100` | Max total daily account spend (EUR) |
| `AUTO_SCALE_ENABLED` | `false` | Allow auto budget scaling |
| `ADS_OPTIMIZATION_LOOKBACK_DAYS` | `3` | Days of data for optimization |
