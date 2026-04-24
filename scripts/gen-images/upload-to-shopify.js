/**
 * Upload generated OralBiome Pro assets (WebP) to Shopify Files.
 *
 * Prereqs:
 *   - Node 18+ (native fetch + Blob + FormData)
 *   - Env vars (in ../../calqix-capi/.env.local or exported):
 *       SHOPIFY_STORE_DOMAIN       e.g. calqix.myshopify.com
 *       SHOPIFY_API_KEY            OAuth client_id
 *       SHOPIFY_API_SECRET         OAuth client_secret
 *
 * Usage:
 *   node upload-to-shopify.js                    # upload everything in MANIFEST
 *   node upload-to-shopify.js --dry-run          # list what would upload
 *   node upload-to-shopify.js --only ingredients # filter by category
 *
 * Output:
 *   Writes upload-result.json with { assetName: { cdnUrl, fileId, alt } } next
 *   to this script. Use that mapping to wire images into Theme Editor settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env from calqix-capi/.env.local if present (Vercel pull), then fallback to .env at repo root.
(function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'calqix-capi', '.env.local'),
    path.resolve(__dirname, '..', '..', '.env.local'),
    path.resolve(__dirname, '..', '..', '.env')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
})();

const STORE = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_API_KEY || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_API_SECRET || '').trim();
const PREMINTED = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const API_VERSION = '2025-01';

if (!STORE) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN not set.');
  process.exit(1);
}
if (!PREMINTED && (!CLIENT_ID || !CLIENT_SECRET)) {
  console.error('ERROR: Need either SHOPIFY_ADMIN_ACCESS_TOKEN, or SHOPIFY_API_KEY + SHOPIFY_API_SECRET.');
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..', '..', 'assets', 'generated');

// --- Manifest: 12 WebP assets with alt text and category ---
const MANIFEST = [
  // Packshots — can be used as product media or general brand imagery
  { name: 'ob-hero-packshot',               category: 'hero',        alt: 'OralBiome Pro jar on navy background with floating probiotic lozenge' },
  { name: 'ob-packshot-angled',             category: 'packshot',    alt: 'OralBiome Pro jar on marble surface with single lozenge' },
  // How-to-use steps
  { name: 'ob-step-01-brush-floss',         category: 'steps',       alt: 'Step 1 — brush and floss your teeth as normal' },
  { name: 'ob-step-02-dissolve-lozenge',    category: 'steps',       alt: 'Step 2 — dissolve one OralBiome Pro lozenge on your tongue' },
  { name: 'ob-step-03-colonise',            category: 'steps',       alt: 'Step 3 — let probiotics colonise the oral cavity' },
  // Ingredients
  { name: 'ob-ingredient-l-reuteri',        category: 'ingredients', alt: 'Lactobacillus reuteri rod-shaped probiotic bacteria illustration' },
  { name: 'ob-ingredient-l-paracasei',      category: 'ingredients', alt: 'Lactobacillus paracasei rod-shaped probiotic bacteria illustration' },
  { name: 'ob-ingredient-s-salivarius-k12', category: 'ingredients', alt: 'Streptococcus salivarius K12 cocci bacteria in chains illustration' },
  { name: 'ob-ingredient-s-salivarius-m18', category: 'ingredients', alt: 'Streptococcus salivarius M18 cocci bacteria in clusters illustration' },
  { name: 'ob-ingredient-xylitol',          category: 'ingredients', alt: 'Xylitol sugar crystals illustration in navy and gold' },
  { name: 'ob-ingredient-peppermint',       category: 'ingredients', alt: 'Single peppermint leaf illustration in navy with gold vein accents' },
  // Video cover
  { name: 'ob-video-cover',                 category: 'video-cover', alt: 'How OralBiome Pro works — probiotic bacteria streaming into jar' }
];

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIdx = args.findIndex(a => a === '--only' || a.startsWith('--only='));
let onlyCategories = null;
if (onlyIdx !== -1) {
  const inline = args[onlyIdx].includes('=') ? args[onlyIdx].split('=')[1] : args[onlyIdx + 1];
  if (inline) onlyCategories = inline.split(',').map(s => s.trim()).filter(Boolean);
}

function selected() {
  return MANIFEST.filter(m => !onlyCategories || onlyCategories.includes(m.category));
}

// --- Shopify API helpers ---
async function mintToken() {
  if (PREMINTED && PREMINTED.startsWith('shpat_')) return PREMINTED;
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  if (!res.ok) throw new Error(`Token mint failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Token mint response missing access_token');
  return data.access_token;
}

async function graphql(token, query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error('GraphQL errors: ' + JSON.stringify(data.errors));
  return data.data;
}

async function stagedUpload(token, filename, fileSize, mimeType) {
  const query = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;
  const variables = {
    input: [{
      resource: 'FILE',
      filename,
      mimeType,
      httpMethod: 'POST',
      fileSize: String(fileSize)
    }]
  };
  const data = await graphql(token, query, variables);
  const errs = data.stagedUploadsCreate.userErrors;
  if (errs.length) throw new Error('stagedUploadsCreate: ' + JSON.stringify(errs));
  return data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToStaged(target, filePath, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  const blob = new Blob([fileBuffer], { type: mimeType });
  form.append('file', blob, fileName);

  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text.substring(0, 200)}`);
  }
  return target.resourceUrl;
}

async function createFile(token, resourceUrl, filename, alt) {
  const query = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        ... on MediaImage { image { url } }
      }
      userErrors { field message }
    }
  }`;
  const variables = { files: [{ alt, contentType: 'IMAGE', originalSource: resourceUrl, filename }] };
  const data = await graphql(token, query, variables);
  const errs = data.fileCreate.userErrors;
  if (errs.length) throw new Error('fileCreate: ' + JSON.stringify(errs));
  return data.fileCreate.files[0];
}

async function waitForFile(token, fileId, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const query = `query getFile($id: ID!) {
      node(id: $id) {
        ... on MediaImage { id image { url } fileStatus }
      }
    }`;
    const data = await graphql(token, query, { id: fileId });
    const node = data.node;
    if (node && node.fileStatus === 'READY' && node.image && node.image.url) {
      return node.image.url;
    }
    if (node && node.fileStatus === 'FAILED') {
      throw new Error(`File processing failed for ${fileId}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for file ${fileId}`);
}

// --- Main ---
async function main() {
  const list = selected();
  if (!list.length) {
    console.log('No assets matched filter.');
    return;
  }

  console.log(`\nShopify Files upload`);
  console.log(`  store     : ${STORE}`);
  console.log(`  assets    : ${list.length}`);
  console.log(`  categories: ${[...new Set(list.map(m => m.category))].join(', ')}`);
  console.log(`  dry-run   : ${dryRun ? 'YES' : 'no'}\n`);

  if (dryRun) {
    for (const m of list) {
      const fp = path.join(OUT_DIR, `${m.name}.webp`);
      const exists = fs.existsSync(fp);
      const size = exists ? (fs.statSync(fp).size / 1024).toFixed(1) + 'KB' : 'MISSING';
      console.log(`  [${m.category}] ${m.name}.webp  ${size}`);
    }
    return;
  }

  console.log('Minting admin token...');
  const token = await mintToken();
  console.log('Token ready.\n');

  const result = {};
  let done = 0, failed = 0;
  for (const m of list) {
    const fp = path.join(OUT_DIR, `${m.name}.webp`);
    if (!fs.existsSync(fp)) {
      console.error(`[${m.name}] SKIP — file not found at ${fp}`);
      failed++;
      continue;
    }
    const fileSize = fs.statSync(fp).size;
    const filename = `calqix-${m.name}.webp`;
    try {
      process.stdout.write(`[${done + failed + 1}/${list.length}] ${m.name} ... `);
      const tgt = await stagedUpload(token, filename, fileSize, 'image/webp');
      const resourceUrl = await uploadToStaged(tgt, fp, 'image/webp');
      const file = await createFile(token, resourceUrl, filename, m.alt);
      const cdnUrl = await waitForFile(token, file.id);
      result[m.name] = { cdnUrl, fileId: file.id, alt: m.alt, category: m.category };
      console.log(`OK (${file.id})`);
      done++;
    } catch (err) {
      console.log(`FAIL — ${err.message}`);
      result[m.name] = { error: err.message };
      failed++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const outPath = path.join(__dirname, 'upload-result.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\nDone. ${done} uploaded, ${failed} failed.`);
  console.log(`Result map written to: ${outPath}`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
