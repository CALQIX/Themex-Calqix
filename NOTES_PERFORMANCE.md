# Task 8 — Performance audit

Read-only audit of theme performance hygiene against v2 Task 8 checklist. No code edits in this commit — findings drive targeted follow-up commits after operator review.

## Summary

| Check | Status | Notes |
| --- | --- | --- |
| Hero image uses `loading="eager"` | ✅ | FlowCore banner: `sections/flowcore-banner.liquid:443, 509`. OralBiome hero: `sections/oralbiome-hero.liquid:543, 567`. |
| Below-the-fold images use `loading="lazy"` | ✅ | Variant/secondary images in both heroes use `loading="lazy"` correctly. |
| `width` + `height` on every `<img>` | ⚠ | FlowCore banner has 9 `<img>` tags missing `width`/`height`. OralBiome hero has them. |
| Non-critical 3rd-party scripts `defer`/`async` | ✅ | GTM uses `async`. Clarity snippet uses Microsoft's async loader. Meta bridge uses `defer`. All theme scripts in `layout/theme.liquid` use `defer="defer"`. |
| `content_for_header` weight | not measured | Requires rendered page HTML; run via `curl https://calqix.com -o page.html; wc -c page.html` in production. |

## Findings — actions required

### F1. FlowCore banner CLS risk (high priority)

9 `<img>` tags without `width`/`height` in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\flowcore-banner.liquid`. Lines flagged by theme-check:

- `438, 447, 457, 467` — mobile variant product images
- `483, 489, 494, 500, 506` — desktop packaging + device variants

These also use the deprecated `img_url` filter. Recommended refactor in a single `[task-8-followup-1]` commit:

```liquid
{%- assign device_width = 1080 -%}
{%- assign device_height = 1080 -%}

<img class="device-img cq-variant active" data-index="0"
  src="{{ section.settings.img_v1 | image_url: width: device_width }}"
  srcset="{{ section.settings.img_v1 | image_url: width: 540 }} 540w,
          {{ section.settings.img_v1 | image_url: width: 1080 }} 1080w,
          {{ section.settings.img_v1 | image_url: width: 1620 }} 1620w"
  sizes="(min-width: 860px) 50vw, 100vw"
  width="{{ device_width }}"
  height="{{ device_height }}"
  alt="{{ section.settings.label_v1 }}"
  loading="eager"
  fetchpriority="high">
```

Apply the same pattern to each `<img>` instance. Use the actual product image aspect ratio (likely 1:1 for FlowCore device shots) to pick `height`.

### F2. Deprecated `img_url` filter (medium priority)

Every `<img>` in `flowcore-banner.liquid` uses `| img_url: '1080x'`. Shopify deprecated this filter. The replacement is `| image_url: width: 1080`. Same refactor commit as F1.

### F3. Preload vs stylesheet_tag (low priority)

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid:98-105` uses the manual preload+noscript fallback pattern for `main.css`. Shopify recommends `| stylesheet_tag: preload: true` now. Low urgency — the current pattern is functionally correct and already non-blocking. File under `[task-8-followup-2]` if doing a wider cleanup.

### F4. `fetchpriority="high"` on LCP image (medium priority)

Neither FlowCore banner nor OralBiome hero sets `fetchpriority="high"` on the first-paint image. Adding it moves the image into the high-priority fetch queue and typically improves LCP by 100-300ms. Safe single-line change for the first `<img>` in each hero.

### F5. Theme scripts already well-deferred ✅

`@c:\Users\Gebruiker\Desktop\CALQIX Repo\layout\theme.liquid` defers 13 theme scripts and the Meta bridge. GTM uses async. No action needed.

## Measurement (operator should run)

```powershell
# 1. TTFB + HTML weight
curl -o calqix-home.html https://calqix.com
(Get-Item calqix-home.html).Length / 1KB

# 2. Run Lighthouse on the live homepage
# https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fcalqix.com

# 3. Record baseline LCP / CLS / TBT to compare against after [task-8-followup-1] lands
```

## Recommended follow-up commits

| Commit | Scope | Risk |
| --- | --- | --- |
| `[task-8-followup-1]` | Replace `img_url` with `image_url` + add width/height/srcset on the 9 FlowCore banner `<img>` tags. | Medium. Requires verifying intrinsic ratios after deploy. |
| `[task-8-followup-2]` | Add `fetchpriority="high"` on first hero image in FlowCore banner + OralBiome hero. | Low. |
| `[task-8-followup-3]` | Migrate `main.css` preload to `stylesheet_tag: preload: true` syntax. | Low. |

All three are candidates for bundling into a single `[task-8]` follow-up commit after operator signs off on the CLS refactor approach.
