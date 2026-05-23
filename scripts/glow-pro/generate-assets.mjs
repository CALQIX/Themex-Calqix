import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const API_VERSION = '2025-10';
const TIMEOUT_MS = 180000;

function loadEnv() {
  for (const file of ['.env.local', '.env.vercel.tmp', '.env']) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const STORE = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_API_KEY || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_API_SECRET || '').trim();
let adminToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();

if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ontbreekt');
if (!STORE) throw new Error('SHOPIFY_STORE_DOMAIN ontbreekt');

const basePrompt = [
  'CALQIX premium oral care visual language.',
  'Palette: navy #0B1B3B, cream #F5F0E8, gold #C9A961, off-white #FFFFFF.',
  'Style: clean premium scientific minimalism, high-end clinical product photography, calm luxury, precise lighting.',
  'Avoid cartoon style, clutter, fake over-white teeth, competing brand logos, medical claims, children and teenagers.'
].join(' ');

const manifest = [
  {
    name: 'hero-pack-shot',
    size: '1536x1536',
    prompt: `${basePrompt} Full CALQIX Glow Pro kit components arranged in clean studio lighting on a navy #0B1B3B background. Include PAP+ gel syringes, nHAp recovery serum, blue LED mouthpiece, silicone tray, shade guide and protocol card. 3/4 top-down angle, soft drop shadow, premium minimal aesthetic, accurate adult cosmetic oral care kit.`
  },
  {
    name: 'hero-lifestyle',
    size: '1536x1024',
    prompt: `${basePrompt} Smiling adult age 28 to 45 with natural bright teeth in soft natural bathroom light, neutral skin tone, no branded clothing, no other dental products visible. The smile looks healthy and believable, not artificially white. Editorial clinical lifestyle photography.`
  },
  {
    name: 'refill-hero',
    size: '1024x1024',
    prompt: `${basePrompt} CALQIX Glow Pro refill pack on cream surface: PAP+ gel and nHAp recovery serum only, no LED mouthpiece, no tray. Premium small refill product photography, navy label accents, soft shadow.`
  },
  {
    name: 'icon-enamel-damage',
    size: '1024x1024',
    transparent: true,
    prompt: `${basePrompt} Minimalist single-line icon in #0B1B3B on a clean off-white #FFFFFF background. Concept: tooth enamel surface with a subtle sensitivity spark, elegant clinical line art, no text.`
  },
  {
    name: 'icon-eu-regulation',
    size: '1024x1024',
    transparent: true,
    prompt: `${basePrompt} Minimalist single-line icon in #0B1B3B on a clean off-white #FFFFFF background. Concept: EU compliance document with a small checkmark and tooth outline, elegant clinical line art, no text.`
  },
  {
    name: 'icon-incomplete-care',
    size: '1024x1024',
    transparent: true,
    prompt: `${basePrompt} Minimalist single-line icon in #0B1B3B on a clean off-white #FFFFFF background. Concept: tooth with an unfinished mineral layer and small recovery droplet, elegant clinical line art, no text.`
  },
  {
    name: 'how-it-works-cross-section',
    size: '1536x1024',
    prompt: `${basePrompt} Scientific cross-section illustration of an enamel surface. PAP+ molecules lift chromogens from the top surface while nHAp crystals deposit into tiny micro-defects below. Navy and cream palette with refined gold guide lines. Label exactly: PAP+ and nHAp. No cartoon style.`
  },
  {
    name: 'protocol-step-1',
    size: '1024x1024',
    prompt: `${basePrompt} Minimalist premium illustration for Day 01-03 baseline brightening. PAP+ gel applied to tray, blue LED mouthpiece nearby, 10 minute ritual, navy and cream, no text.`
  },
  {
    name: 'protocol-step-2',
    size: '1024x1024',
    prompt: `${basePrompt} Minimalist premium illustration for Day 04-10 visible shade shift. Shade guide with subtle movement from warm ivory to natural bright white, nHAp serum beside it, no text.`
  },
  {
    name: 'protocol-step-3',
    size: '1024x1024',
    prompt: `${basePrompt} Minimalist premium illustration for Day 11-14 lock in results. Enamel shield with nHAp crystal layer and calm blue LED glow, no text.`
  },
  {
    name: 'protocol-step-4',
    size: '1024x1024',
    prompt: `${basePrompt} Minimalist premium illustration for maintenance. Small refill pack with calendar rhythm and one to two weekly sessions, navy and cream, no text.`
  },
  {
    name: 'box-item-1',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of PAP+ Whitening Gel syringe, 12% PAP+, navy background, clinical studio lighting, no readable tiny text except clean CALQIX style cues.`
  },
  {
    name: 'box-item-2',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of nHAp Recovery Serum bottle, 10% nano-hydroxyapatite, navy background, clinical studio lighting, refined gold accent.`
  },
  {
    name: 'box-item-3',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of LED activator mouthpiece with 16 blue LEDs, USB-C detail, navy background, clinical studio lighting.`
  },
  {
    name: 'box-item-4',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of universal transparent silicone tray, BPA-free food-grade look, navy background, clinical studio lighting.`
  },
  {
    name: 'box-item-5',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of VITA-style shade guide card with eight natural tooth shade tabs, navy background, clinical studio lighting, no brand confusion.`
  },
  {
    name: 'box-item-6',
    size: '1024x1024',
    prompt: `${basePrompt} Premium pack-shot of CALQIX 14-day protocol guide booklet in 8 languages, navy cover with cream and gold accents, clinical studio lighting.`
  },
  {
    name: 'before-after-1',
    size: '1024x1024',
    prompt: `${basePrompt} Split-screen adult smile comparison. Left label Day 1, right label Day 14. Natural believable brighter-looking teeth, same person, soft bathroom light. Mandatory overlay text: Illustrative result. Individual outcomes vary.`
  },
  {
    name: 'before-after-2',
    size: '1024x1024',
    prompt: `${basePrompt} Split-screen adult smile comparison, close but tasteful crop. Left label Day 1, right label Day 14. Natural believable brightening, not fake white. Mandatory overlay text: Illustrative result. Individual outcomes vary.`
  },
  {
    name: 'before-after-3',
    size: '1024x1024',
    prompt: `${basePrompt} Split-screen adult smile comparison in a clean clinical vanity setting. Left label Day 1, right label Day 14. Natural believable brighter finish. Mandatory overlay text: Illustrative result. Individual outcomes vary.`
  }
];

function ensureDirs() {
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets', 'glow-pro'), { recursive: true });
}

async function generateImage(item) {
  const body = {
    model: 'gpt-image-2',
    prompt: item.prompt,
    n: 1,
    size: item.size,
    quality: 'high',
    output_format: 'webp'
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
    const data = JSON.parse(text);
    const image = data.data && data.data[0];
    if (!image || !image.b64_json) throw new Error(`OpenAI response missing b64_json for ${item.name}`);
    return Buffer.from(image.b64_json, 'base64');
  } finally {
    clearTimeout(timeout);
  }
}

async function mintToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  });
  if (!res.ok) throw new Error(`Shopify token mint failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

async function getAdminToken() {
  if (!adminToken) return mintToken();
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({ query: '{ shop { name } }' })
  });
  if (res.ok) return adminToken;
  adminToken = await mintToken();
  return adminToken;
}

async function shopifyRest(endpoint, method = 'GET', body = null) {
  const token = await getAdminToken();
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Shopify ${method} ${endpoint} failed ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

async function findProduct(handle) {
  const data = await shopifyRest(`products.json?handle=${encodeURIComponent(handle)}`);
  return data.products && data.products[0] ? data.products[0] : null;
}

async function uploadProductImage(handle, filename, buffer) {
  const product = await findProduct(handle);
  if (!product) throw new Error(`Product not found for image upload: ${handle}`);
  await shopifyRest(`products/${product.id}/images.json`, 'POST', {
    image: {
      attachment: buffer.toString('base64'),
      filename,
      alt: handle === 'glow-pro-refill'
        ? 'CALQIX Glow Pro refill pack with PAP+ gel and nHAp recovery serum'
        : 'CALQIX Glow Pro 14-day whitening system kit'
    }
  });
}

async function main() {
  ensureDirs();
  const skipExisting = process.env.SKIP_EXISTING === '1';
  const only = process.argv[2];
  const selected = only ? manifest.filter((item) => item.name === only) : manifest;
  if (!selected.length) throw new Error(`No asset matched ${only}`);

  for (const item of selected) {
    const flatName = `glow-pro-${item.name}.webp`;
    const flatPath = path.join(ROOT, 'assets', flatName);
    const folderPath = path.join(ROOT, 'assets', 'glow-pro', `${item.name}.webp`);
    if (skipExisting && fs.existsSync(flatPath)) {
      console.log(`skip ${flatName}`);
      continue;
    }
    console.log(`generate ${flatName} (${item.size})`);
    const buffer = await generateImage(item);
    fs.writeFileSync(flatPath, buffer);
    fs.writeFileSync(folderPath, buffer);
    console.log(`saved ${flatName} ${Math.round(buffer.length / 1024)} KB`);
  }

  if (!only || only === 'hero-pack-shot') {
    const kitHero = fs.readFileSync(path.join(ROOT, 'assets', 'glow-pro-hero-pack-shot.webp'));
    await uploadProductImage('glow-pro', 'glow-pro-hero-pack-shot.webp', kitHero);
  }
  if (!only || only === 'hero-lifestyle') {
    const lifestyle = fs.readFileSync(path.join(ROOT, 'assets', 'glow-pro-hero-lifestyle.webp'));
    await uploadProductImage('glow-pro', 'glow-pro-hero-lifestyle.webp', lifestyle);
  }
  if (!only || only === 'refill-hero') {
    const refill = fs.readFileSync(path.join(ROOT, 'assets', 'glow-pro-refill-hero.webp'));
    await uploadProductImage('glow-pro-refill', 'glow-pro-refill-hero.webp', refill);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
