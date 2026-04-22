#!/usr/bin/env node
/**
 * CALQIX theme image generator powered by Gemini (Nano Banana Pro + Flash 3.1).
 *
 * Usage:
 *   npm install                       # first time only
 *   cp .env.example .env.local        # add GEMINI_API_KEY
 *   npm run gen                       # generate everything in prompts.json
 *   npm run gen:dry                   # preview prompts + cost, no API calls
 *   npm run gen:only -- hero,steps    # filter by category
 *
 * Requires: GEMINI_API_KEY in env (or .env.local).
 *
 * Output:
 *   ../../assets/generated/<name>.png          (raw, full resolution)
 *   ../../assets/generated/<name>.webp         (optimised, same dims)
 *
 * Notes:
 *   - Writes to the theme's /assets/ folder so images are accessible via
 *     {{ '<name>.png' | asset_url }} in Liquid after theme push.
 *   - For Shopify Files (shopify://shop_images/...) uploads you must still
 *     upload the generated PNG manually in Shopify Admin > Settings > Files,
 *     or use the Admin API separately.
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'assets', 'generated');

// --- Pricing heuristics (USD, approximate, update when Google changes rates) ---
const PRICE_PER_IMAGE = {
  'gemini-3-pro-image-preview': 0.06,
  'gemini-3.1-flash-image-preview': 0.02,
  'gemini-2.5-flash-image': 0.01,
};

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIdx = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
let onlyCategories = null;
if (onlyIdx !== -1) {
  const inline = args[onlyIdx].includes('=') ? args[onlyIdx].split('=')[1] : args[onlyIdx + 1];
  if (inline) onlyCategories = inline.split(',').map((s) => s.trim()).filter(Boolean);
}

// --- Load manifest ---
async function loadManifest() {
  const raw = await fs.readFile(path.join(__dirname, 'prompts.json'), 'utf8');
  return JSON.parse(raw);
}

// --- Filter by category and enabled flag ---
function selectAssets(manifest) {
  return manifest.assets.filter((a) => {
    if (a.enabled === false) return false;
    if (onlyCategories && !onlyCategories.includes(a.category)) return false;
    return true;
  });
}

// --- Cost estimator ---
function estimateCost(assets) {
  return assets.reduce((sum, a) => sum + (PRICE_PER_IMAGE[a.model] || 0.03), 0);
}

// --- Generate a single asset ---
async function generateOne(ai, asset) {
  const cfg = {
    responseModalities: ['Image'],
  };
  // Pro + Flash 3.1 support image_size; 2.5 flash doesn't.
  if (asset.model !== 'gemini-2.5-flash-image') {
    cfg.imageConfig = {
      aspectRatio: asset.aspect_ratio || '1:1',
      imageSize: asset.image_size || '1K',
    };
  } else {
    cfg.imageConfig = { aspectRatio: asset.aspect_ratio || '1:1' };
  }

  const res = await ai.models.generateContent({
    model: asset.model,
    contents: asset.prompt,
    config: cfg,
  });

  const parts = res?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error(`No image returned for "${asset.name}". Text response: ${parts.find((p) => p.text)?.text || '(none)'}`);
  }

  const buf = Buffer.from(imagePart.inlineData.data, 'base64');
  return buf;
}

// --- Post-process: save PNG + WebP ---
async function savePngAndWebp(buffer, name) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const pngPath = path.join(OUT_DIR, `${name}.png`);
  const webpPath = path.join(OUT_DIR, `${name}.webp`);
  await fs.writeFile(pngPath, buffer);
  await sharp(buffer).webp({ quality: 88, effort: 6 }).toFile(webpPath);
  const pngKb = (buffer.length / 1024).toFixed(1);
  const webpStat = await fs.stat(webpPath);
  const webpKb = (webpStat.size / 1024).toFixed(1);
  return { pngPath, webpPath, pngKb, webpKb };
}

// --- Main ---
async function main() {
  const manifest = await loadManifest();
  const assets = selectAssets(manifest);

  if (assets.length === 0) {
    console.log('No assets matched your filter. Nothing to do.');
    process.exit(0);
  }

  const cost = estimateCost(assets);
  console.log(`\nCALQIX image generator`);
  console.log(`  assets    : ${assets.length}`);
  console.log(`  categories: ${[...new Set(assets.map((a) => a.category))].join(', ')}`);
  console.log(`  est. cost : ~$${cost.toFixed(2)} USD`);
  console.log(`  output    : ${OUT_DIR}`);
  console.log(`  dry-run   : ${dryRun ? 'YES' : 'no'}\n`);

  if (dryRun) {
    for (const a of assets) {
      console.log(`  [${a.category}] ${a.name} (${a.model}, ${a.aspect_ratio}, ${a.image_size || 'default'})`);
    }
    console.log('\nDry run complete. No API calls made.');
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set. Put it in .env.local or export it.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let done = 0;
  let failed = 0;
  for (const asset of assets) {
    const label = `[${done + failed + 1}/${assets.length}] ${asset.name}`;
    try {
      console.log(`${label} ... generating (${asset.model})`);
      const t0 = Date.now();
      const buf = await generateOne(ai, asset);
      const saved = await savePngAndWebp(buf, asset.name);
      const ms = Date.now() - t0;
      console.log(`${label} ✔ saved ${saved.pngKb}KB PNG + ${saved.webpKb}KB WebP in ${ms}ms`);
      done++;
    } catch (err) {
      console.error(`${label} ✘ ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${done} generated, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
