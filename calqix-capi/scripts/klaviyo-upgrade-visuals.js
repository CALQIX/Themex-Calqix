#!/usr/bin/env node
/**
 * Phase 1: Generate 6 DALL-E hero visuals + upload to Klaviyo image host.
 *
 * - Generates via OpenAI Images API (dall-e-3, 1792x1024, standard, natural)
 * - Downloads PNGs locally to scripts/tmp/hero-visuals/
 * - Uploads to Klaviyo via POST /api/images/ with import_from_url
 *   (DALL-E returned URL is valid ~1h, Klaviyo fetches server-side immediately)
 * - Persists the Klaviyo image URLs in scripts/tmp/hero-urls.json so the
 *   patch-templates step can consume them deterministically.
 * - Verifies via GET /api/images/?filter=contains(name,"CALQIX")
 *
 * No dry-run mode. All writes real. Re-running is idempotent on Klaviyo side:
 * if an image with the same name exists, Klaviyo creates a dupe (we filter on
 * name during the final verification and only keep the latest per slug).
 *
 * Usage:
 *   node scripts/klaviyo-upgrade-visuals.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_API_KEY;
const REVISION = '2024-10-15';

if (!OPENAI_KEY) {
  console.error('FATAL: OPENAI_API_KEY missing');
  process.exit(1);
}
if (!KLAVIYO_KEY) {
  console.error('FATAL: KLAVIYO_PRIVATE_API_KEY missing');
  process.exit(1);
}

const TMP_DIR = path.join(__dirname, 'tmp', 'hero-visuals');
const URLS_OUT = path.join(__dirname, 'tmp', 'hero-urls.json');
fs.mkdirSync(TMP_DIR, { recursive: true });

const VISUALS = [
  {
    slug: 'welcome-01',
    klaviyoName: 'CALQIX Hero Welcome 01',
    prompt:
      'Minimalist editorial illustration for a premium oral care brand. A single abstract gold wordmark letter forming in mid-air on a cream ivory background. Clinical pharmaceutical aesthetic, no photography, no faces, no products visible. Soft natural lighting. Composition suitable as wide hero banner. Gold color #C9A84C, navy #1A3B5C accents, cream #FAF7EF background. 16:9 aspect ratio.'
  },
  {
    slug: 'welcome-02',
    klaviyoName: 'CALQIX Hero Welcome 02 Science',
    prompt:
      'Scientific microscopy-style illustration of hexagonal hydroxyapatite crystal lattice structure, stylized and editorial. Gold colored crystals (#C9A84C) on deep navy background (#1A3B5C) with subtle glow. Pharmaceutical journal aesthetic. Abstract, not photorealistic. Reference: Nature magazine scientific illustrations. 16:9 aspect ratio.'
  },
  {
    slug: 'welcome-03',
    klaviyoName: 'CALQIX Hero Welcome 03 Offer',
    prompt:
      'Minimalist still life of a folded cream paper with a gold embossed seal, viewed from above. Cream background #FAF7EF, gold accent #C9A84C, soft clinical lighting. Editorial magazine style. No text visible on the paper. 16:9 aspect ratio.'
  },
  {
    slug: 'cart-02',
    klaviyoName: 'CALQIX Hero Abandoned Cart 2h',
    prompt:
      'Abstract geometric illustration of two circular objects in a clean pharmaceutical composition, resting on a cream surface. One circle navy #1A3B5C, one circle gold #C9A84C. Top-down view. Soft shadows. Clinical editorial style, no product photography, no text. 16:9 ratio.'
  },
  {
    slug: 'pp-day-00',
    klaviyoName: 'CALQIX Hero Post-Purchase Day 0',
    prompt:
      'Editorial illustration of an open cream colored envelope revealing a soft gold glow from within. Viewed from slight angle. Cream background #FAF7EF, gold #C9A84C accent. Minimalist, clinical, pharmaceutical aesthetic. No faces, no products. 16:9 aspect ratio.'
  },
  {
    slug: 'pp-day-28',
    klaviyoName: 'CALQIX Hero Post-Purchase Day 28 Review',
    prompt:
      'Minimalist illustration of a single gold pen resting on folded cream paper, top-down view. Gold #C9A84C, cream #FAF7EF, navy #1A3B5C subtle shadows. Editorial clinical aesthetic. No text visible, no hands, no faces. 16:9 aspect ratio.'
  }
];

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ─────────── OpenAI DALL-E 3 generation ─────────── */

async function generateImage(slug, prompt) {
  console.log('[gen] ' + slug + ' ...');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      style: 'natural',
      response_format: 'url'
    })
  });
  const j = await res.json();
  if (!res.ok) {
    console.error('[gen] FAIL ' + slug + ' ' + res.status + ' ' + JSON.stringify(j).slice(0, 500));
    throw new Error('dall-e generation failed: ' + slug);
  }
  const url = j.data && j.data[0] && j.data[0].url;
  if (!url) throw new Error('no url returned for ' + slug);
  console.log('[gen] ok ' + slug + ' url=' + url.slice(0, 80) + '...');
  return url;
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = await res.buffer();
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/* ─────────── Klaviyo image upload (import_from_url) ─────────── */

async function klaviyoUploadFromUrl(name, url) {
  const res = await fetch('https://a.klaviyo.com/api/images/', {
    method: 'POST',
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json',
      'content-type': 'application/vnd.api+json'
    },
    body: JSON.stringify({
      data: {
        type: 'image',
        attributes: {
          name,
          import_from_url: url,
          hidden: false
        }
      }
    })
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json: j };
}

/* ─────────── Multipart upload fallback (image-upload endpoint) ─────────── */

async function klaviyoUploadMultipart(name, filePath) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('name', name);
  form.append('hidden', 'false');
  form.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath), contentType: 'image/png' });

  const res = await fetch('https://a.klaviyo.com/api/image-upload/', {
    method: 'POST',
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json',
      ...form.getHeaders()
    },
    body: form
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (_) { j = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json: j };
}

/* ─────────── Main ─────────── */

async function main() {
  console.log('=== Phase 1: Hero visuals generation + upload ===');
  console.log('tmp dir: ' + TMP_DIR);

  // Count before (for evidence). Filter on "CALQIX Hero" so probe+unrelated uploads aren't counted.
  const beforeRes = await fetch('https://a.klaviyo.com/api/images/?filter=' + encodeURIComponent('contains(name,"CALQIX Hero")'), {
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json'
    }
  });
  const beforeJson = await beforeRes.json().catch(() => ({}));
  const beforeCount = (beforeJson.data || []).length;
  console.log('CALQIX images in Klaviyo before: ' + beforeCount);

  const results = [];

  for (const v of VISUALS) {
    try {
      const localPath = path.join(TMP_DIR, v.slug + '.png');

      // 1. Generate
      const dalleUrl = await generateImage(v.slug, v.prompt);

      // 2. Download locally (so we have a fallback + receipts)
      const bytes = await downloadToFile(dalleUrl, localPath);
      console.log('[dl] ' + v.slug + ' -> ' + localPath + ' (' + Math.round(bytes / 1024) + 'kb)');

      // 3. Upload to Klaviyo. Multipart via /api/image-upload/ is the only
      //    reliable path; import_from_url rejects many public URLs.
      let up = await klaviyoUploadMultipart(v.klaviyoName, localPath);

      if (!up.ok) {
        console.warn('[klaviyo] multipart failed ' + up.status + ' -> trying import_from_url as last resort');
        console.warn('  ' + JSON.stringify(up.json).slice(0, 400));
        up = await klaviyoUploadFromUrl(v.klaviyoName, dalleUrl);
      }

      if (!up.ok) {
        console.error('[klaviyo] FAIL ' + v.slug + ' ' + up.status + ' ' + JSON.stringify(up.json).slice(0, 500));
        results.push({ slug: v.slug, name: v.klaviyoName, klaviyo: null, error: up });
        continue;
      }

      const imgData = up.json && up.json.data;
      const klaviyoId = imgData && imgData.id;
      const klaviyoUrl = imgData && imgData.attributes && (imgData.attributes.image_url || imgData.attributes.url);
      console.log('[klaviyo] uploaded ' + v.klaviyoName + ' -> id=' + klaviyoId + ' url=' + klaviyoUrl);

      results.push({ slug: v.slug, name: v.klaviyoName, klaviyoId, klaviyoUrl, localPath });

      await sleep(300); // be kind to rate limits
    } catch (err) {
      console.error('[fatal] ' + v.slug, err.message);
      results.push({ slug: v.slug, name: v.klaviyoName, error: err.message });
    }
  }

  // Persist URLs for phase 2
  fs.writeFileSync(URLS_OUT, JSON.stringify(results, null, 2));
  console.log('saved -> ' + URLS_OUT);

  // Verify
  const afterRes = await fetch('https://a.klaviyo.com/api/images/?filter=' + encodeURIComponent('contains(name,"CALQIX Hero")'), {
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json'
    }
  });
  const afterJson = await afterRes.json().catch(() => ({}));
  const afterCount = (afterJson.data || []).length;
  console.log('');
  console.log('=== Phase 1 verification ===');
  console.log('  CALQIX images in Klaviyo before: ' + beforeCount);
  console.log('  CALQIX images in Klaviyo after:  ' + afterCount);
  console.log('  Generated+uploaded successfully: ' + results.filter((r) => r.klaviyoUrl).length + ' / 6');

  if (results.filter((r) => r.klaviyoUrl).length < 6) {
    console.error('FAIL: less than 6 images uploaded. See errors above.');
    process.exit(2);
  }

  if (afterCount < 6) {
    console.error('FAIL: Klaviyo filter returns < 6 CALQIX images. Dumping filter response:');
    console.error(JSON.stringify(afterJson).slice(0, 1500));
    process.exit(3);
  }

  console.log('v Phase 1 complete.');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
