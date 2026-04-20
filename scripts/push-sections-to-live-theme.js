/**
 * Force-push specific theme files to the live Shopify theme via Admin API.
 * Workaround for flaky GitHub theme sync that sometimes skips new/updated files.
 *
 * Usage: node scripts/push-sections-to-live-theme.js [file1] [file2] ...
 *   file args are theme-relative paths like "sections/calqix-flavor-banner.liquid"
 *   If no args, pushes a sane default set.
 *
 * Reads SHOPIFY_ADMIN_ACCESS_TOKEN + SHOPIFY_STORE_DOMAIN from .env.local
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

function readEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found at ' + envPath);
  }
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

function apiRequest(method, host, token, pathUri, body) {
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
        const status = res.statusCode;
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = data; }
        resolve({ status, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getMainThemeId(host, token) {
  const r = await apiRequest('GET', host, token, '/admin/api/2024-10/themes.json');
  if (r.status !== 200) throw new Error('List themes failed: ' + r.status);
  const main = r.body.themes.find((t) => t.role === 'main');
  if (!main) throw new Error('No main theme found');
  return main.id;
}

async function putAsset(host, token, themeId, key, value) {
  const r = await apiRequest(
    'PUT',
    host,
    token,
    `/admin/api/2024-10/themes/${themeId}/assets.json`,
    { asset: { key, value } },
  );
  return r;
}

async function main() {
  const env = readEnv();
  const token = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const domain = env.SHOPIFY_STORE_DOMAIN;
  if (!token || !domain) throw new Error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_STORE_DOMAIN');

  const files = process.argv.slice(2);
  const defaultSet = [
    'sections/calqix-flavor-banner.liquid',
    'sections/calqix-protocol.liquid',
    'sections/calqix-final-cta.liquid',
    'sections/calqix-before-after.liquid',
    'templates/index.json',
    'locales/en.default.json',
    'locales/nl.json',
    'locales/de.json',
    'locales/fr.json',
    'locales/fi.json',
    'locales/nb.json',
    'locales/sv.json',
    'locales/da.json',
  ];
  const list = files.length ? files : defaultSet;

  const themeId = await getMainThemeId(domain, token);
  console.log('Main theme id:', themeId);

  for (const f of list) {
    const abs = path.join(__dirname, '..', f);
    if (!fs.existsSync(abs)) {
      console.warn('  SKIP (missing on disk):', f);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const r = await putAsset(domain, token, themeId, f, content);
    if (r.status >= 200 && r.status < 300) {
      console.log(`  OK  ${f}  (size=${r.body?.asset?.size || '?'}, updated=${r.body?.asset?.updated_at || '?'})`);
    } else {
      console.error(`  ERR ${f}  status=${r.status}  body=${JSON.stringify(r.body).slice(0, 500)}`);
    }
    // Small delay to be polite to API rate limit.
    await new Promise((res) => setTimeout(res, 250));
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
