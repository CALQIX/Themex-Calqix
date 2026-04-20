/**
 * Generate CALQIX flavor HERO compositions (NOT jars) for the flavor
 * banner's right-side display area. Each composition shows:
 *  - 3-5 floating CALQIX lozenges (oval pill shape) in the flavor accent color
 *  - Flavor-specific botanicals/fruit
 *  - Scientific/minimal vibe, transparent background
 *
 * Saves to assets/calqix-hero-{flavor}.png and uploads to the live theme.
 *
 * Usage: node scripts/generate-flavor-hero-icons.js
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

const FLAVORS = [
  {
    key: 'freshmint',
    lozenge_color: 'soft cool mint green with subtle white crystalline highlights',
    botanical: 'three large fresh mint leaves with crisp visible veins',
  },
  {
    key: 'grape',
    lozenge_color: 'deep violet-purple with a soft lilac sheen',
    botanical: 'a cluster of four plump deep-purple grapes with one curled green leaf',
  },
  {
    key: 'peach',
    lozenge_color: 'warm peach-rose with a soft blush gradient',
    botanical: 'one ripe peach with a pink-coral blush and one green leaf',
  },
  {
    key: 'citrus_orange',
    lozenge_color: 'bright warm orange with a juicy gloss',
    botanical: 'two translucent orange citrus wedges showing juicy segments and one green leaf',
  },
  {
    key: 'cool_mint',
    lozenge_color: 'cool icy cyan-blue with frost highlights',
    botanical: 'two crystalline ice-mint leaves with frost and a few floating ice shards',
  },
];

function buildPrompt(flavor) {
  return [
    `A floating composition for CALQIX OralBiome Pro: 4 to 5 small oval lozenge tablets`,
    `in ${flavor.lozenge_color}, arranged mid-air in a gentle asymmetric cluster.`,
    `The lozenges are smooth, matte, premium, each about the size and proportion of a pharmacy lozenge,`,
    `with a soft specular highlight and a tiny embossed CALQIX mark on one of them.`,
    `Interwoven with the lozenges are ${flavor.botanical}, rendered in high detail with soft-focus depth.`,
    `Tiny flavor particles drift between them (dust motes, fine botanical fragments).`,
    `Style: editorial studio product photography, minimalist luxury oral-care aesthetic,`,
    `clinical-premium, scientifically credible. NO jar, NO bottle, NO container, NO text labels other than the embossed wordmark.`,
    `Centered composition, generous padding, square framing.`,
    `Pure transparent background — no scene, no floor, no surface shadow. Deliver an isolated PNG cutout.`,
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
          reject(new Error(`OpenAI ${res.statusCode}: ${data.slice(0, 500)}`));
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
  return r.body.themes.find((t) => t.role === 'main').id;
}

async function main() {
  const env = readEnv();
  const openaiKey = env.OPENAI_API_KEY;
  const shopToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shopDomain = env.SHOPIFY_STORE_DOMAIN;

  const assetsDir = path.join(__dirname, '..', 'assets');
  const themeId = await getMainThemeId(shopDomain, shopToken);
  console.log('Main theme:', themeId);

  for (const flavor of FLAVORS) {
    const filename = `calqix-hero-${flavor.key.replace('_', '-')}.png`;
    const localPath = path.join(assetsDir, filename);

    const prompt = buildPrompt(flavor);
    console.log(`\n[${flavor.key}] Prompt: ${prompt.slice(0, 120)}...`);

    let response;
    try {
      console.log('  Generating...');
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
      console.error(`  ERROR: ${e.message}`);
      continue;
    }

    const img = response.data && response.data[0];
    if (!img || !img.b64_json) { console.error('  No image data'); continue; }

    const pngBuffer = Buffer.from(img.b64_json, 'base64');
    fs.writeFileSync(localPath, pngBuffer);
    console.log(`  Saved local: ${filename} (${pngBuffer.length} bytes)`);

    const r = await shopifyRequest(
      'PUT',
      shopDomain,
      shopToken,
      `/admin/api/2024-10/themes/${themeId}/assets.json`,
      { asset: { key: 'assets/' + filename, attachment: pngBuffer.toString('base64') } },
    );
    if (r.status >= 200 && r.status < 300) {
      console.log(`  Uploaded to theme: ${filename}`);
    } else {
      console.error(`  Upload failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    }

    await new Promise((res) => setTimeout(res, 1000));
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
