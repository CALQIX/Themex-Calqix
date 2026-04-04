# CALQIX Content Operations — Daily Schedule & Workflow

## Daily Content Schedule (Europe/Amsterdam)

| Time | Cron ID | Endpoint | Action |
|------|---------|----------|--------|
| 05:45 | `calqix-content-insights` | `/api/cron/content-insights` | Fetch Meta ad performance, extract angle signals |
| 06:00 | `calqix-content-plan` | `/api/cron/content-plan` | Generate daily plan (2 posts + 1 reserve) |
| 06:20 | `calqix-content-generate` | `/api/cron/content-generate` | Build briefs, run compliance, submit Predis jobs |
| 07:05 | `calqix-content-review` | `/api/cron/content-review` | Poll Predis, send Telegram preview |
| 08:30 | `calqix-content-publish-am` | `/api/cron/content-publish?slot=post1` | Publish morning post (awareness) |
| 18:30 | `calqix-content-publish-pm` | `/api/cron/content-publish?slot=post2` | Publish evening post (conversion) |
| 21:30 | `calqix-content-reflect` | `/api/cron/content-reflect` | Update angle scores, decay fatigue, archive state |

## Content Slots

### Post 1 — Morning Awareness (08:30)
- **Purpose**: Education, trust, oral microbiome
- **Funnel stage**: Top of funnel
- **Preferred pillars**: education, lifestyle_premium, product_mechanism

### Post 2 — Evening Conversion (18:30)
- **Purpose**: Product-led, problem-solution, CTA
- **Funnel stage**: Bottom of funnel
- **Preferred pillars**: conversion, pain_agitation, objection_handling

### Reserve Post
- **Purpose**: Backup if main assets fail QA
- **Funnel stage**: Mid funnel
- **Preferred pillars**: education, product_mechanism, lifestyle_premium

## Content Angles (10)

| Angle | Description |
|-------|-------------|
| `enamel` | Enamel remineralization, n-HAp science |
| `gumline` | Gum health, interdental cleaning |
| `breath_confidence` | Fresh breath, oral microbiome balance |
| `premium_daily_routine` | Daily ritual, premium lifestyle |
| `convenience` | Portable, cordless, travel-ready |
| `oral_microbiome` | Microbiome science, bacterial balance |
| `objection_handling` | Fluoride-free reassurance, myth busting |
| `comparison_framing` | vs traditional, compliance stats |
| `authority` | Research-backed, clinical evidence |
| `science_driven_reassurance` | Biocompatible, formulation transparency |

## Content Pillars (6)

| Pillar | Description |
|--------|-------------|
| `education` | Teach something about oral health |
| `pain_agitation` | Highlight the problem, create urgency |
| `product_mechanism` | How the product works |
| `objection_handling` | Address skepticism |
| `lifestyle_premium` | Aspirational, premium positioning |
| `conversion` | Direct CTA, product-led |

## Products (3)

| ID | Name | Key Attributes |
|----|------|----------------|
| `toothpaste_tablets` | Nano-hydroxyapatite toothpaste tablets | fluoride-free, vegan, n-HAp |
| `water_flosser` | White cordless water flosser | 3 modes, 300ml, IPX7, USB-C |
| `oralbiome_pro` | OralBiome Pro | complete system, microbiome |

## Publishing Modes

| Mode | Behavior |
|------|----------|
| `DRAFT_ONLY` | Generate content, do not publish. Default. |
| `APPROVAL_REQUIRED` | Queue content for Telegram approval before publish |
| `AUTO_PUBLISH` | Auto-publish if confidence ≥ threshold (default 75) |

## Example Telegram Content Review

```
🎨 CALQIX Daily Content Review — 2025-01-15

🟢 POST 1 (08:30 — Awareness)
• Product: toothpaste_tablets
• Angle: oral_microbiome
• Pillar: education
• Confidence: 72/100
• Hook: Your mouth hosts 700+ bacterial species. Balance is everything.
• CTA: Discover the science →
• Format: single_image 1:1

🟠 POST 2 (18:30 — Conversion)
• Product: water_flosser
• Angle: gumline
• Pillar: conversion
• Confidence: 65/100 ⭐ Meta-backed
• Hook: The space between your teeth is where disease begins.
• CTA: Shop now — free shipping on orders over €50
• Format: single_image 4:5

📊 Meta-informed: Yes — angles based on ad performance data

🔧 Generation: 2 completed, 0 failed, 1 draft-only

⚙️ Mode: APPROVAL_REQUIRED
```

## Redis Key Patterns

| Pattern | TTL | Description |
|---------|-----|-------------|
| `cm:topics` | 90d | Posted topics list |
| `cm:hooks` | 90d | Posted hooks list |
| `cm:ctas` | 90d | Posted CTAs list |
| `cm:angles` | 90d | Angle scores and fatigue |
| `cm:products` | 90d | Product rotation |
| `cm:blocked_claims` | 180d | Blocked health claims |
| `cm:plan:{date}` | 30d | Daily content plan |
| `cm:job:{id}` | 14d | Content generation job |
| `cm:meta_signals` | 24h | Cached Meta performance signals |
| `predis:job:{id}` | 14d | Predis generation job |
| `predis:daily:{date}` | 14d | Daily Predis job list |
| `publish_dedup:{date}:{slot}` | 24h | Publish dedup guard |
