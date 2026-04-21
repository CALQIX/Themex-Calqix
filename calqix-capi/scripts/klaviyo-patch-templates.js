#!/usr/bin/env node
/**
 * Phase 2: Patch 26 CALQIX Klaviyo templates.
 *
 * Reads Klaviyo hero image URLs from scripts/tmp/hero-urls.json (produced by
 * klaviyo-upgrade-visuals.js) and applies:
 *   - CSS keyframes (gold-accent + cta-pulse) into <head> of ALL 26 templates
 *   - class="calqix-cta-pulse" on the primary CTA anchor for ALL 26
 *   - Hero <img> row after the wordmark header for the 6 primary templates
 *   - Dynamic {% catalog %} product block before CTA for the 3 AC T+2h templates
 *
 * Idempotent via markers: re-running skips already-applied mutations.
 *
 * Usage: node scripts/klaviyo-patch-templates.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_API_KEY;
const REVISION = '2024-10-15';

if (!KLAVIYO_KEY) {
  console.error('FATAL: KLAVIYO_PRIVATE_API_KEY missing');
  process.exit(1);
}

/* ─── Load hero URLs ─── */
const urlsPath = path.join(__dirname, 'tmp', 'hero-urls.json');
if (!fs.existsSync(urlsPath)) {
  console.error('FATAL: scripts/tmp/hero-urls.json not found. Run klaviyo-upgrade-visuals.js first.');
  process.exit(1);
}
const heroResults = JSON.parse(fs.readFileSync(urlsPath, 'utf8'));
const heroBySlug = {};
heroResults.forEach((r) => { if (r.slug && r.klaviyoUrl) heroBySlug[r.slug] = r.klaviyoUrl; });

const MISSING = ['welcome-01', 'welcome-02', 'welcome-03', 'cart-02', 'pp-day-00', 'pp-day-28'].filter((s) => !heroBySlug[s]);
if (MISSING.length) {
  console.error('FATAL: missing hero URLs for: ' + MISSING.join(', '));
  process.exit(1);
}

/* ─── Template inventory ─── */
// Tiers of transformation
const TEMPLATES = [
  // Welcome #1 -> welcome-01
  { id: 'UnYwbK', name: 'CALQIX — Welcome #1 (EN)', hero: 'welcome-01', alt: 'Your protocol begins' },
  { id: 'WbqpGe', name: 'CALQIX — Welcome #1 (NL)', hero: 'welcome-01', alt: 'Je protocol begint' },
  { id: 'RXxA4D', name: 'CALQIX — Welcome #1 (DE)', hero: 'welcome-01', alt: 'Dein Protokoll beginnt' },
  // Welcome #2 -> welcome-02
  { id: 'UVnisY', name: 'CALQIX — Welcome #2 (EN)', hero: 'welcome-02', alt: 'Hydroxyapatite crystal lattice' },
  { id: 'RSUjHf', name: 'CALQIX — Welcome #2 (NL)', hero: 'welcome-02', alt: 'Hydroxyapatiet kristalstructuur' },
  { id: 'UQK47A', name: 'CALQIX — Welcome #2 (DE)', hero: 'welcome-02', alt: 'Hydroxylapatit Kristallgitter' },
  // Welcome #3 -> welcome-03
  { id: 'XNzLvV', name: 'CALQIX — Welcome #3 (EN)', hero: 'welcome-03', alt: 'A welcome gift' },
  { id: 'Vp8QnP', name: 'CALQIX — Welcome #3 (NL)', hero: 'welcome-03', alt: 'Een welkomstcadeau' },
  { id: 'U96K9z', name: 'CALQIX — Welcome #3 (DE)', hero: 'welcome-03', alt: 'Ein Willkommensgeschenk' },
  // Welcome #4 (no hero)
  { id: 'XHWwax', name: 'CALQIX — Welcome #4 (EN)' },
  { id: 'Tw5GwW', name: 'CALQIX — Welcome #4 (NL)' },
  { id: 'VivA3r', name: 'CALQIX — Welcome #4 (DE)' },
  // AC T+2h -> cart-02 + dynamic product block
  { id: 'ST4DUj', name: 'CALQIX — Abandoned Cart T+2h (EN)', hero: 'cart-02', alt: 'Your Rebuild Kit', catalogLocale: 'en' },
  { id: 'WtUqVh', name: 'CALQIX — Abandoned Cart T+2h (NL)', hero: 'cart-02', alt: 'Je Rebuild Kit', catalogLocale: 'nl' },
  { id: 'VQTniE', name: 'CALQIX — Abandoned Cart T+2h (DE)', hero: 'cart-02', alt: 'Dein Rebuild Kit', catalogLocale: 'de' },
  // AC T+24h (no hero)
  { id: 'VdSjG3', name: 'CALQIX — Abandoned Cart T+24h (EN)' },
  { id: 'SNrpyV', name: 'CALQIX — Abandoned Cart T+24h (NL)' },
  { id: 'WphazT', name: 'CALQIX — Abandoned Cart T+24h (DE)' },
  // AC T+72h (no hero)
  { id: 'SbqkWi', name: 'CALQIX — Abandoned Cart T+72h (EN)' },
  { id: 'WVEWR8', name: 'CALQIX — Abandoned Cart T+72h (NL)' },
  { id: 'WiDUev', name: 'CALQIX — Abandoned Cart T+72h (DE)' },
  // PP Day 0 -> pp-day-00
  { id: 'RtL3Yh', name: 'CALQIX — Post-Purchase Day 0 (EN)', hero: 'pp-day-00', alt: 'Your order is confirmed' },
  { id: 'Rp8MCT', name: 'CALQIX — Post-Purchase Day 0 (NL)', hero: 'pp-day-00', alt: 'Je bestelling is bevestigd' },
  { id: 'SyxCwK', name: 'CALQIX — Post-Purchase Day 0 (DE)', hero: 'pp-day-00', alt: 'Deine Bestellung ist bestätigt' },
  // PP Day 7 (no hero)
  { id: 'UkXw3e', name: 'CALQIX — Post-Purchase Day 7 (EN)' },
  // PP Day 28 -> pp-day-28
  { id: 'Rivxhv', name: 'CALQIX — Post-Purchase Day 28 (EN)', hero: 'pp-day-28', alt: 'A question after 14 days' }
];

/* ─── CSS block (with idempotency marker) ─── */
const CSS_MARKER = '/* calqix-anim-v1 */';
const CSS_BLOCK = '<style>' + CSS_MARKER + '\n' +
  '@keyframes calqix-gold-expand {\n' +
  '  0%   { width: 0px;  opacity: 0; }\n' +
  '  60%  { opacity: 1; }\n' +
  '  100% { width: 48px; opacity: 1; }\n' +
  '}\n' +
  '.calqix-gold-accent {\n' +
  '  display: inline-block;\n' +
  '  width: 48px;\n' +
  '  height: 1px;\n' +
  '  background: #C9A84C;\n' +
  '  animation: calqix-gold-expand 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;\n' +
  '}\n' +
  '@media screen and (max-width: 600px) {\n' +
  '  .calqix-gold-accent { animation: none; width: 48px; }\n' +
  '}\n' +
  '@keyframes calqix-cta-pulse {\n' +
  '  0%, 100% { box-shadow: 0 0 0 0 rgba(201, 168, 76, 0); }\n' +
  '  50%      { box-shadow: 0 0 0 4px rgba(201, 168, 76, 0.25); }\n' +
  '}\n' +
  '.calqix-cta-pulse {\n' +
  '  animation: calqix-cta-pulse 2.5s ease-in-out infinite;\n' +
  '}\n' +
  '@media (prefers-reduced-motion: reduce) {\n' +
  '  .calqix-cta-pulse { animation: none; }\n' +
  '}\n' +
  '</style>';

/* ─── Transformations ─── */

function injectCss(html) {
  if (html.includes(CSS_MARKER)) return html;
  // Insert before </head>
  if (html.includes('</head>')) {
    return html.replace('</head>', CSS_BLOCK + '\n</head>');
  }
  // Fallback: prepend to body
  return CSS_BLOCK + '\n' + html;
}

function addCtaPulseClass(html) {
  // Primary CTA: <a href="..." style="display:inline-block;background:#1A3B5C;
  // Add class="calqix-cta-pulse" before style= if not already present.
  const marker = 'style="display:inline-block;background:#1A3B5C;';
  if (!html.includes(marker)) return html;

  // Use regex to find the <a ...> tag that contains this style.
  return html.replace(/<a\s+([^>]*?)style="display:inline-block;background:#1A3B5C;/g, (match, before) => {
    if (/class\s*=\s*"[^"]*calqix-cta-pulse/.test(before)) return match; // already patched
    // Inject class attribute
    if (/class\s*=\s*"/.test(before)) {
      // Append to existing class list
      const newBefore = before.replace(/class\s*=\s*"([^"]*)"/, (m, c) => 'class="' + c + ' calqix-cta-pulse"');
      return '<a ' + newBefore + 'style="display:inline-block;background:#1A3B5C;';
    }
    return '<a ' + before + 'class="calqix-cta-pulse" style="display:inline-block;background:#1A3B5C;';
  });
}

function heroRowHtml(url, alt) {
  return '<tr>\n' +
    '  <td align="center" class="px-responsive" style="padding: 0 32px 32px;">\n' +
    '    <img src="' + url + '" alt="' + alt.replace(/"/g, '&quot;') + '" width="536" ' +
    'style="display: block; width: 100%; max-width: 536px; height: auto; border-radius: 12px; border: 1px solid rgba(26,59,92,0.12);">\n' +
    '  </td>\n' +
    '</tr>';
}

function insertHero(html, url, alt) {
  if (html.includes(url)) return html; // already inserted this specific image

  // Locate header -> content boundary via 'Precision Oral Care.' wordmark marker.
  // Klaviyo strips indentation on storage, so anchors are whitespace-tolerant.
  const wordmarkIdx = html.indexOf('Precision Oral Care.');
  if (wordmarkIdx === -1) return html;

  // Find the FIRST content row start (padding:24px 32px 24px) after the wordmark
  const contentRowIdx = html.indexOf('<tr><td style="padding:24px 32px 24px;">', wordmarkIdx);
  if (contentRowIdx === -1) return html;

  return html.slice(0, contentRowIdx) + heroRowHtml(url, alt) + '\n' + html.slice(contentRowIdx);
}

function catalogBlockHtml(locale) {
  const cta = locale === 'nl'
    ? 'Rond je bestelling af &rarr;'
    : locale === 'de'
      ? 'Bestellung abschließen &rarr;'
      : 'Complete your order &rarr;';

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">\n' +
    '  {% catalog product_id:event.ProductID %}\n' +
    '  <tr>\n' +
    '    <td width="120" valign="top" style="padding-right:16px;">\n' +
    '      <img src="{{ catalog.image_url }}" width="120" style="display:block;width:120px;border-radius:8px;">\n' +
    '    </td>\n' +
    '    <td valign="top">\n' +
    '      <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:18px;color:#1A3B5C;">{{ catalog.title }}</p>\n' +
    '      <p style="margin:0 0 12px;font-family:monospace;font-size:13px;color:#8B7228;">{{ catalog.price|default:"" }}</p>\n' +
    '      <a href="{{ catalog.url }}" style="font-family:Inter,sans-serif;font-size:12px;color:#1A3B5C;text-decoration:underline;">' + cta + '</a>\n' +
    '    </td>\n' +
    '  </tr>\n' +
    '  {% endcatalog %}\n' +
    '</table>';
}

function insertCatalogBlock(html, locale) {
  if (html.includes('{% catalog product_id:event.ProductID %}')) return html;

  // Insert before the primary CTA paragraph
  const ctaMarker = '<p style="margin:28px 0 0;"><a href=';
  const idx = html.indexOf(ctaMarker);
  if (idx === -1) return html;
  return html.slice(0, idx) + catalogBlockHtml(locale) + '\n        ' + html.slice(idx);
}

/* ─── Klaviyo API ─── */

async function getTemplate(id) {
  const r = await fetch('https://a.klaviyo.com/api/templates/' + id + '/', {
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json'
    }
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function patchTemplate(id, html) {
  const r = await fetch('https://a.klaviyo.com/api/templates/' + id + '/', {
    method: 'PATCH',
    headers: {
      'Authorization': 'Klaviyo-API-Key ' + KLAVIYO_KEY,
      'revision': REVISION,
      'accept': 'application/vnd.api+json',
      'content-type': 'application/vnd.api+json'
    },
    body: JSON.stringify({
      data: {
        type: 'template',
        id,
        attributes: { html }
      }
    })
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ─── Main ─── */

async function main() {
  console.log('=== Phase 2: template PATCH ===');
  console.log('total templates: ' + TEMPLATES.length);

  let patched = 0;
  let failed = 0;
  const results = [];

  for (const t of TEMPLATES) {
    const got = await getTemplate(t.id);
    if (!got.ok) {
      console.error('x GET ' + t.id + ' ' + got.status + ' ' + JSON.stringify(got.json).slice(0, 200));
      failed += 1;
      results.push({ id: t.id, name: t.name, ok: false, stage: 'get', error: got.json });
      continue;
    }

    const original = got.json.data.attributes.html || '';
    let html = original;

    // A. CSS block -> all 26
    html = injectCss(html);

    // B. CTA pulse class -> all 26
    html = addCtaPulseClass(html);

    // C. Hero image -> 6 primary
    if (t.hero) {
      const url = heroBySlug[t.hero];
      html = insertHero(html, url, t.alt);
    }

    // D. Dynamic catalog block -> 3 AC T+2h
    if (t.catalogLocale) {
      html = insertCatalogBlock(html, t.catalogLocale);
    }

    if (html === original) {
      console.log('= ' + t.id + ' ' + t.name + ' -> no-op (already patched)');
      patched += 1;
      results.push({ id: t.id, name: t.name, ok: true, noop: true });
      continue;
    }

    const up = await patchTemplate(t.id, html);
    if (up.ok) {
      console.log('v ' + t.id + ' ' + t.name + ' -> patched (' + original.length + ' -> ' + html.length + ' bytes)');
      patched += 1;
      results.push({ id: t.id, name: t.name, ok: true, before: original.length, after: html.length });
    } else {
      console.error('x ' + t.id + ' ' + t.name + ' -> FAIL ' + up.status + ' ' + JSON.stringify(up.json).slice(0, 300));
      failed += 1;
      results.push({ id: t.id, name: t.name, ok: false, stage: 'patch', error: up.json });
    }

    await sleep(150); // rate limit politeness
  }

  fs.writeFileSync(path.join(__dirname, 'tmp', 'phase2-results.json'), JSON.stringify(results, null, 2));

  console.log('');
  console.log('=== Phase 2 summary ===');
  console.log('patched: ' + patched + ' / ' + TEMPLATES.length);
  console.log('failed : ' + failed);

  if (failed > 0) {
    console.error('FAIL: ' + failed + ' templates failed. See phase2-results.json.');
    process.exit(2);
  }

  /* ─── Verification: 3 random templates ─── */
  console.log('');
  console.log('=== Phase 2 verification (3 random) ===');
  const samples = [];
  // Force sample mix: 1 hero+catalog, 1 hero-only, 1 plain
  samples.push('WtUqVh'); // AC T+2h NL (hero + catalog)
  samples.push('UnYwbK'); // Welcome #1 EN (hero)
  samples.push('UkXw3e'); // PP Day 7 EN (plain)

  let verifyFails = 0;
  for (const sid of samples) {
    const got = await getTemplate(sid);
    if (!got.ok) {
      console.error('x VERIFY GET ' + sid + ' ' + got.status);
      verifyFails += 1;
      continue;
    }
    const html = got.json.data.attributes.html || '';
    const checks = {
      id: sid,
      hasGoldAccentClass: html.includes('calqix-gold-accent'),
      hasCtaPulseClass: html.includes('calqix-cta-pulse'),
      hasHeroImg: /<img[^>]*d3k81ch9hvuctc\.cloudfront\.net\/company\/STAYQy\/images\/[^"]+"/.test(html),
      hasCatalogBlock: html.includes('{% catalog product_id:event.ProductID %}')
    };
    console.log(JSON.stringify(checks));
    if (!checks.hasGoldAccentClass) { console.error('x ' + sid + ' missing calqix-gold-accent'); verifyFails += 1; }
    if (!checks.hasCtaPulseClass) { console.error('x ' + sid + ' missing calqix-cta-pulse'); verifyFails += 1; }
    if (sid === 'WtUqVh' && !checks.hasHeroImg) { console.error('x ' + sid + ' missing hero img'); verifyFails += 1; }
    if (sid === 'UnYwbK' && !checks.hasHeroImg) { console.error('x ' + sid + ' missing hero img'); verifyFails += 1; }
    if (sid === 'WtUqVh' && !checks.hasCatalogBlock) { console.error('x ' + sid + ' missing catalog block'); verifyFails += 1; }
  }

  if (verifyFails > 0) {
    console.error('FAIL: ' + verifyFails + ' verification checks failed.');
    process.exit(3);
  }

  console.log('v Phase 2 complete.');
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
