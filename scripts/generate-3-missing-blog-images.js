/**
 * Generate the 3 missing blog placeholder images and upload+replace them in Shopify
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', 'calqix-capi', '.env') });

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!CLIENT_ID || !CLIENT_SECRET) { console.error('Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY in calqix-capi/.env'); process.exit(1); }

const BLOG_ID = 123272659273;
const NHA_ID = 615270777161;
const OUT_DIR = path.resolve(__dirname, '..', 'calqix-capi', 'generated-images', 'blog');

const IMAGES = [
  {
    id: 'nha-enamel-microscopic',
    prompt: 'Professional scientific illustration: split-screen microscopic comparison of tooth enamel. LEFT side shows damaged, porous enamel with visible micro-lesions, rough crystalline surface with gaps and erosion. RIGHT side shows the same enamel fully repaired — smooth, dense hydroxyapatite crystal lattice with nano-particles integrated into the structure. Deep navy (#1A3B5C) background. Clean, clinical, high-end medical textbook style. No text, no labels, no watermarks. 3D render quality.',
    alt: 'Microscopic comparison: damaged tooth enamel with micro-lesions vs enamel repaired by nano-hydroxyapatite',
    caption: 'Damaged enamel (left) vs. nano-hydroxyapatite repaired enamel (right) at microscopic level',
    size: '1792x1024',
    placeholder_search: '[Microscopische vergelijking: beschadigd glazuur (links) vs. n-HA gerepareerd glazuur (rechts).'
  },
  {
    id: 'nha-fluoride-mechanism',
    prompt: 'Professional scientific diagram comparing two dental mechanisms side by side. LEFT: fluoride forming a thin protective COATING layer ON TOP of the tooth enamel surface (shown as a separate colored layer sitting on the tooth). RIGHT: nano-hydroxyapatite particles filling INTO and INTEGRATING with the tooth enamel crystal structure from within. Clean schematic cross-section view. Navy blue and white color scheme. Medical illustration style. No text, no labels, no watermarks.',
    alt: 'Diagram comparing fluoride surface coating mechanism vs nano-hydroxyapatite enamel integration',
    caption: 'Fluoride coats the surface (fluorapatite) — nano-HA integrates into the enamel structure itself',
    size: '1792x1024',
    placeholder_search: '[Split-screen diagram: links fluoride dat een laag vormt OP de tand, rechts n-HA dat IN de tand integreert.'
  },
  {
    id: 'nha-routine-steps',
    prompt: 'Minimalist step-by-step oral care routine illustration with 3 steps shown left to right. Step 1: a toothbrush icon brushing teeth. Step 2: a small tablet being placed on the tongue. Step 3: a timer/clock showing 30 minutes wait time. Clean, modern, flat design. Navy blue (#1A3B5C) and white color palette with subtle gold (#C9A84C) accents. Icons are simple and elegant. White background. No text, no labels, no watermarks.',
    alt: 'Three-step nano-hydroxyapatite routine: brush, tablet on tongue, wait 30 minutes',
    caption: 'The nano-HA routine: 1) Brush — 2) Chew tablet — 3) Wait 30 minutes before eating or drinking',
    size: '1792x1024',
    placeholder_search: '[Stap-voor-stap routine visual: 1) Poets, 2) Tablet op tong, 3) 30 min wachten.'
  }
];

// --- DALL-E 3 generation ---
async function generateImage(prompt, size) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: 'hd',
      style: 'natural'
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('DALL-E error: ' + data.error.message);
  return data.data[0].url;
}

async function downloadImage(url, outPath) {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  return buffer.length;
}

// --- Shopify helpers ---
async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  return (await res.json()).access_token;
}

async function graphql(token, query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function uploadToShopify(token, filePath, filename, alt) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;

  // 1. Staged upload
  const stageQuery = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;
  const stageData = await graphql(token, stageQuery, {
    input: [{ resource: 'FILE', filename, mimeType: 'image/png', httpMethod: 'POST', fileSize: String(fileSize) }]
  });
  const target = stageData.data.stagedUploadsCreate.stagedTargets[0];

  // 2. Upload to staged URL
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([fileBuffer], { type: 'image/png' }), filename);
  await fetch(target.url, { method: 'POST', body: form });

  // 3. Create file in Shopify
  const createQuery = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id ... on MediaImage { image { url } } }
      userErrors { field message }
    }
  }`;
  const createData = await graphql(token, createQuery, {
    files: [{ alt, contentType: 'IMAGE', originalSource: target.resourceUrl, filename }]
  });
  const fileId = createData.data.fileCreate.files[0].id;

  // 4. Wait for processing
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const q = `query($id:ID!){node(id:$id){...on MediaImage{id image{url} fileStatus}}}`;
    const d = await graphql(token, q, { id: fileId });
    if (d.data.node && d.data.node.fileStatus === 'READY' && d.data.node.image) {
      return d.data.node.image.url;
    }
    if (d.data.node && d.data.node.fileStatus === 'FAILED') throw new Error('File processing failed');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout waiting for file processing');
}

async function run() {
  console.log('=== Generate & Upload 3 Missing Blog Images ===\n');

  const token = await getToken();
  console.log('Shopify token obtained.\n');

  const cdnUrls = {};

  // Step 1: Generate + download + upload each image
  for (const img of IMAGES) {
    console.log(`[${img.id}] Generating with DALL-E 3 (${img.size})...`);
    try {
      const dalleUrl = await generateImage(img.prompt, img.size);
      console.log('  Generated. Downloading...');

      const outPath = path.join(OUT_DIR, img.id + '.png');
      const bytes = await downloadImage(dalleUrl, outPath);
      console.log(`  Saved locally: ${(bytes / 1024).toFixed(0)} KB`);

      console.log('  Uploading to Shopify...');
      const cdnUrl = await uploadToShopify(token, outPath, 'calqix-blog-' + img.id + '.png', img.alt);
      console.log(`  CDN: ${cdnUrl}\n`);
      cdnUrls[img.id] = cdnUrl;
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
    }
    // brief pause between API calls
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 2: Get current article HTML
  console.log('Fetching current article...');
  const artRes = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${NHA_ID}.json?fields=id,body_html`, {
    headers: { 'X-Shopify-Access-Token': token }
  });
  const artData = await artRes.json();
  let html = artData.article.body_html;
  console.log(`  Current length: ${html.length} chars\n`);

  // Step 3: Replace each placeholder with the real image
  let replacements = 0;
  for (const img of IMAGES) {
    if (!cdnUrls[img.id]) {
      console.log(`  SKIP ${img.id} — no CDN URL`);
      continue;
    }

    const searchIdx = html.indexOf(img.placeholder_search);
    if (searchIdx === -1) {
      console.log(`  WARNING: Placeholder not found for ${img.id}`);
      continue;
    }

    // Find the full placeholder div
    const divStart = html.lastIndexOf('<div', searchIdx);
    const divEnd = html.indexOf('</div>', searchIdx);
    if (divStart === -1 || divEnd === -1) {
      console.log(`  WARNING: Could not find div boundaries for ${img.id}`);
      continue;
    }

    const oldDiv = html.substring(divStart, divEnd + 6);
    const w = img.size === '1024x1024' ? 1024 : 1792;
    const h = img.size === '1024x1024' ? 1024 : 1024;

    const newFigure = `<figure class="blog-image" style="margin:2rem 0;"><img src="${cdnUrls[img.id]}" alt="${img.alt}" loading="lazy" width="${w}" height="${h}" style="width:100%;height:auto;border-radius:12px;"><figcaption style="text-align:center;color:#666;font-size:14px;margin-top:8px;">${img.caption}</figcaption></figure>`;

    html = html.replace(oldDiv, newFigure);
    console.log(`  Replaced placeholder: ${img.id}`);
    replacements++;
  }

  if (replacements === 0) {
    console.log('\nNo replacements made — nothing to update.');
    return;
  }

  // Step 4: Update article
  console.log(`\nUpdating article (${replacements} replacements)...`);
  const updateRes = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${NHA_ID}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ article: { id: NHA_ID, body_html: html } })
  });
  const updateData = await updateRes.json();
  if (updateData.article) {
    console.log(`  Done! New body length: ${updateData.article.body_html.length} chars`);
  } else {
    console.error('  Update failed:', JSON.stringify(updateData));
  }

  console.log('\n=== COMPLETE ===');
  console.log('Check: https://www.calqix.com/blogs/calqix-elena-writes/nano-hydroxyapatite-the-fluoride-alternative');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
