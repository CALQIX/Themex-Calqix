/**
 * Generate CALQIX flavor jar icons with OpenAI gpt-image-1 (transparent PNG).
 *
 * One image per flavor (freshmint, grape, peach, citrus_orange, cool_mint).
 * Also uploads each to the live Shopify theme's /assets folder.
 *
 * Usage: node scripts/generate-jar-icons.js
 *   Set SKIP_EXISTING=1 to skip flavors that already have local files.
 *   Set DRY_RUN=1 to preview prompts without calling OpenAI.
 *
 * Reads OPENAI_API_KEY + SHOPIFY_ADMIN_ACCESS_TOKEN + SHOPIFY_STORE_DOMAIN from .env.local
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

function readEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\r|\n/g, '').trim();
  }
  return env;
}

// CALQIX brand: scientific, premium, minimalist.
// Each jar: a softly back-lit lozenge/pill shape inside a subtle crystal capsule,
// with flavor-specific botanical accents. Transparent background.
const FLAVORS = [
  {
    key: 'freshmint',
    accent: 'cool teal-green',
    botanical: 'fresh mint leaves with crisp vein detail',
    vibe: 'cool clinical freshness',
  },
  {
    key: 'grape',
    accent: 'deep violet-purple',
    botanical: 'a small cluster of three dark-purple grapes with a single green leaf',
    vibe: 'evening-soft, quiet luxury',
  },
  {
    key: 'peach',
    accent: 'warm rose-peach',
    botanical: 'one ripe peach half with a soft pink blush and a delicate green leaf',
    vibe: 'warm stone-fruit comfort',
  },
  {
    key: 'citrus_orange',
    accent: 'bright warm orange',
    botanical: 'one translucent citrus orange wedge showing juicy segments and one green leaf',
    vibe: 'morning zest, uplifted',
  },
  {
    key: 'cool_mint',
    accent: 'icy blue-cyan',
    botanical: 'two crystalline ice-mint leaves with frost highlights',
    vibe: 'ice-clear menthol reset',
  },
];

function buildPrompt(flavor) {
  return [
    `A premium CALQIX OralBiome Pro jar: a short cylindrical translucent glass container with a matte white lid,`,
    `softly back-lit with a ${flavor.accent} inner glow.`,
    `A CALQIX wordmark is subtly embossed on the front of the jar in a thin, tall serif.`,
    `Next to the jar, floating ${flavor.botanical}, rendered in high detail with a soft-focus drop shadow.`,
    `Style: editorial product photography, studio lit, clinical-premium, minimal, high-end skincare aesthetic,`,
    `scientifically credible, not cartoony. ${flavor.vibe}.`,
    `Centered composition, small padding around the subject.`,
    `Pure transparent background with no scene, no floor, no surface, no shadow on a surface.`,
    `Deliver an isolated cutout on transparent background ready to be dropped onto any web page.`,
  ].join(' ');
}

function openaiRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function shopifyRequest(method, host, token, pathUri, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: host,
      path: pathUri,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getMainThemeId(host, token) {
  const r = await shopifyRequest('GET', host, token, '/admin/api/2024-10/themes.json');
  if (r.status !== 200) throw new Error('List themes failed');
  return r.body.themes.find((t) => t.role === 'main').id;
}

async function uploadAssetBinary(host, token, themeId, key, base64) {
  const r = await shopifyRequest(
    'PUT',
    host,
    token,
    `/admin/api/2024-10/themes/${themeId}/assets.json`,
    { asset: { key, attachment: base64 } },
  );
  return r;
}

async function main() {
  const env = readEnv();
  const openaiKey = env.OPENAI_API_KEY;
  const shopToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shopDomain = env.SHOPIFY_STORE_DOMAIN;
  if (!openaiKey) throw new Error('OPENAI_API_KEY missing');
  if (!shopToken || !shopDomain) throw new Error('Shopify credentials missing');

  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const dryRun = process.env.DRY_RUN === '1';
  const skipExisting = process.env.SKIP_EXISTING === '1';

  let themeId = null;
  if (!dryRun) themeId = await getMainThemeId(shopDomain, shopToken);
  console.log('Main theme:', themeId || '(dry-run)');

  for (const flavor of FLAVORS) {
    const filename = `calqix-jar-${flavor.key.replace('_', '-')}.png`;
    const localPath = path.join(assetsDir, filename);

    if (skipExisting && fs.existsSync(localPath)) {
      console.log(`  SKIP ${flavor.key} (local file exists)`);
      continue;
    }

    const prompt = buildPrompt(flavor);
    console.log(`\n[${flavor.key}] Prompt: ${prompt.slice(0, 140)}...`);

    if (dryRun) { continue; }

    // gpt-image-1 supports transparent background. 1024x1024 is enough for hero-size jars.
    console.log(`  Generating with gpt-image-1...`);
    let response;
    try {
      response = await openaiRequest(openaiKey, {
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        background: 'transparent',
        output_format: 'png',
        quality: 'high',
      });
    } catch (e) {
      console.error(`  OpenAI ERROR for ${flavor.key}:`, e.message.slice(0, 500));
      continue;
    }

    const img = response.data && response.data[0];
    if (!img) { console.error('  No image data in response'); continue; }

    // gpt-image-1 returns base64-encoded b64_json.
    let pngBuffer;
    if (img.b64_json) {
      pngBuffer = Buffer.from(img.b64_json, 'base64');
    } else if (img.url) {
      pngBuffer = await downloadToBuffer(img.url);
    } else {
      console.error('  No b64_json or url in response');
      continue;
    }

    fs.writeFileSync(localPath, pngBuffer);
    console.log(`  Saved local: ${localPath} (${pngBuffer.length} bytes)`);

    // Upload to live theme /assets folder (Shopify strips the /assets prefix internally).
    const themeKey = 'assets/' + filename;
    const r = await uploadAssetBinary(shopDomain, shopToken, themeId, themeKey, pngBuffer.toString('base64'));
    if (r.status >= 200 && r.status < 300) {
      console.log(`  Uploaded to theme: ${themeKey} (${r.body?.asset?.size} bytes)`);
    } else {
      console.error(`  Theme upload failed ${r.status}:`, JSON.stringify(r.body).slice(0, 400));
    }

    // Rate-limit courtesy pause.
    await new Promise((res) => setTimeout(res, 1000));
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
