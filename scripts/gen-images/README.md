# CALQIX Image Generator

Generates theme imagery using Google's **Gemini** image models:

- **Nano Banana Pro** (`gemini-3-pro-image-preview`) — hero, packshot, steps, video cover. Supports "thinking", Google-Search grounding, tekst-rendering, up to 4K.
- **Nano Banana 2** (`gemini-3.1-flash-image-preview`) — ingredients and icons. Best cost-quality balance.

## 1. One-time setup

```bash
cd scripts/gen-images
npm install
```

Then create a local env file — **do this yourself in your terminal**, not via the IDE, because `.env*` files are gitignored and protected by `.codeiumignore`:

```bash
# Windows PowerShell
Set-Content .env.local "GEMINI_API_KEY=your-key-here"

# macOS/Linux
echo 'GEMINI_API_KEY=your-key-here' > .env.local
```

Get a free API key at <https://aistudio.google.com/apikey>.

## 2. Usage

```bash
# Preview selection + cost, no API calls
npm run gen:dry

# Generate everything that has enabled=true in prompts.json
npm run gen

# Generate only specific categories
npm run gen:only -- hero
npm run gen:only -- ingredients
npm run gen:only -- steps,hero,video-cover
```

Output:

```
assets/generated/
  ob-hero-packshot.png   + .webp
  ob-step-01-brush-floss.png + .webp
  ob-ingredient-l-reuteri.png + .webp
  ...
```

The `.webp` variants are auto-optimised via `sharp` (quality 88, effort 6).

## 3. Categories and cost

Default manifest (all 12 high-impact assets enabled, 11 icons disabled):

| Category | Count | Default | Model | Cost/img | Subtotal |
|---|---|---|---|---|---|
| `hero` | 1 | yes | Pro | ~$0.06 | $0.06 |
| `packshot` | 1 | yes | Pro | ~$0.06 | $0.06 |
| `steps` | 3 | yes | Pro | ~$0.06 | $0.18 |
| `ingredients` | 6 | yes | Flash 3.1 | ~$0.02 | $0.12 |
| `video-cover` | 1 | yes | Pro | ~$0.06 | $0.06 |
| `icon-benefit` | 6 | **no** | Flash 3.1 | ~$0.02 | $0.12 |
| `icon-proof` | 5 | **no** | Flash 3.1 | ~$0.02 | $0.10 |

**Default run total: ~$0.48 USD.**

Enable the icon sets by setting `"enabled": true` in `prompts.json` — though SVG is usually better for icons (crisp at all sizes, <1KB each). Only flip them on if you have a specific reason (e.g. bespoke brand illustration you can't do in SVG).

## 4. Using generated images in the theme

### As theme assets (PNG in `/assets/`)

```liquid
<img src="{{ 'ob-hero-packshot.png' | asset_url }}" alt="" loading="lazy">
```

### With WebP + PNG fallback (recommended)

```liquid
<picture>
  <source type="image/webp" srcset="{{ 'ob-hero-packshot.webp' | asset_url }}">
  <img src="{{ 'ob-hero-packshot.png' | asset_url }}"
       alt="OralBiome Pro" loading="lazy" width="1920" height="1080">
</picture>
```

### As Shopify Files (for `shopify://shop_images/...` references)

Theme templates like `templates/product.oralbiome.json` reference Shopify-uploaded files:
`"image": "shopify://shop_images/Step_01_Brush_Floss.png"`.

To replace these:
1. Upload the generated PNG from `assets/generated/` to **Shopify Admin → Settings → Files**.
2. Copy the Shopify Files URL and update the template JSON reference.
3. Commit the template change with a clear note ("swap Step 01 image with Gemini-generated v2").

## 5. Iterating on a prompt

1. Edit the `prompt` field in `prompts.json` for a single asset.
2. Run `npm run gen:only -- <that-asset's-category>`.
3. Inspect the output in `assets/generated/`.
4. Repeat until happy. Commit the final `.png` + `.webp` + `prompts.json` together.

Keep prompts in the repo — they are the "source of truth" for any regeneration and make brand-consistent updates reproducible.

## 6. Guardrails

- `GEMINI_API_KEY` is only read from env / `.env.local`. **Never hardcoded.**
- `.env.local` is in `.gitignore` and auto-ignored by `.codeiumignore`.
- Cost estimate is printed before any API call — you can cancel with Ctrl+C.
- Output is always in `assets/generated/` for easy cleanup.
- Scripts never upload to Shopify Files directly; that remains a manual / separately-scripted step.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `GEMINI_API_KEY not set` | Create `.env.local` (see Setup). |
| `No image returned for "<name>"` | Model returned only text (likely a safety/content block). Check the error log for the text response; adjust prompt. |
| `429 rate limit` | Wait, or split with `--only` into smaller batches. |
| Consistency drift across ingredient set | Use `referenceImages` (Gemini 3 supports up to 14 refs). Add `"reference_images": ["path/to/ob-ingredient-l-reuteri.png"]` to later entries — requires extending `run.js` (not yet implemented). |
| Output looks "AI-ish" / plasticky | Tighten the prompt: specify lens, lighting, reference existing CALQIX assets. Avoid adjectives like "amazing"/"beautiful". |

## 8. Roadmap (optional, not implemented yet)

- Reference-image support for set consistency (Gemini 3 supports up to 14 refs per call).
- Automated Shopify Files upload via Admin API (using an existing app token).
- `--review` mode that opens the output folder after generation.
- GitHub Action to regenerate on `prompts.json` changes and open a PR with the new PNGs.
