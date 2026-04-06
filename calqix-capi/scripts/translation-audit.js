/**
 * CALQIX Translation Audit + Auto-Fill
 *
 * 1. Queries all published locales
 * 2. Scans ALL resource types for missing translations
 * 3. Generates premium translations via Claude API
 * 4. Registers via Shopify translationsRegister
 * 5. Sends Telegram report
 *
 * Run: node scripts/translation-audit.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');
var fetch = require('node-fetch');
var { sendTelegram } = require('../lib/telegram');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var LANGUAGE_NAMES = {
  de: 'German', nl: 'Dutch', fr: 'French',
  sv: 'Swedish', nb: 'Norwegian Bokmal', da: 'Danish', fi: 'Finnish',
  en: 'English'
};

var RESOURCE_TYPES = [
  'PRODUCT', 'COLLECTION', 'SHOP', 'SHOP_POLICY', 'LINK',
  'ONLINE_STORE_THEME', 'ONLINE_STORE_PAGE'
];

var stats = {
  locales: [],
  perLocale: {},
  perType: {},
  totalMissing: 0,
  totalFilled: 0,
  totalErrors: 0
};

// ============================================================
// STAP 1: Inventariseer actieve locales
// ============================================================

async function getPublishedLocales() {
  console.log('\n=== STAP 1: ACTIEVE LOCALES ===\n');
  var data = await shopify.graphql('{ shopLocales { locale name primary published } }');
  var locales = data.shopLocales || [];

  console.log('Alle locales:');
  var published = [];
  for (var i = 0; i < locales.length; i++) {
    var l = locales[i];
    var tag = l.published ? '[PUBLISHED]' : '[DRAFT]';
    var primary = l.primary ? ' (PRIMARY)' : '';
    console.log('  ' + tag + ' ' + l.locale + ' - ' + l.name + primary);
    if (l.published && !l.primary) {
      published.push(l.locale);
    }
  }

  console.log('\nTe controleren locales: ' + published.join(', '));
  return published;
}

// ============================================================
// STAP 2: Scan alle resource types per locale
// ============================================================

async function scanResourceType(resourceType, locale) {
  var missing = [];
  var cursor = null;
  var hasNext = true;
  var pageCount = 0;

  while (hasNext && pageCount < 10) {
    var afterArg = cursor ? ', after: "' + cursor + '"' : '';
    var query = '{ translatableResources(resourceType: ' + resourceType + ', first: 50' + afterArg + ') { edges { cursor node { resourceId translatableContent { key value digest locale } translations(locale: "' + locale + '") { key value outdated } } } pageInfo { hasNextPage } } }';

    try {
      var data = await shopify.graphql(query);
      var edges = data.translatableResources.edges || [];

      for (var i = 0; i < edges.length; i++) {
        var node = edges[i].node;
        cursor = edges[i].cursor;
        var content = node.translatableContent || [];
        var translations = node.translations || [];

        // Build lookup of existing translations
        var translatedKeys = {};
        for (var t = 0; t < translations.length; t++) {
          if (translations[t].value && translations[t].value.trim()) {
            translatedKeys[translations[t].key] = {
              value: translations[t].value,
              outdated: translations[t].outdated
            };
          }
        }

        // Find missing keys
        for (var c = 0; c < content.length; c++) {
          var item = content[c];
          if (!item.value || !item.value.trim()) continue; // Skip empty source content
          if (!item.digest) continue; // Skip items without digest

          var existing = translatedKeys[item.key];
          if (!existing || !existing.value || existing.outdated) {
            missing.push({
              resourceId: node.resourceId,
              key: item.key,
              value: item.value,
              digest: item.digest,
              outdated: existing ? existing.outdated : false
            });
          }
        }
      }

      hasNext = data.translatableResources.pageInfo.hasNextPage;
      pageCount++;
    } catch (err) {
      if (!err.message.includes('not a valid ResourceType')) {
        console.error('  Error scanning ' + resourceType + '/' + locale + ': ' + err.message);
      }
      hasNext = false;
    }

    await sleep(300);
  }

  return missing;
}

async function scanAllMissing(locales) {
  console.log('\n=== STAP 2: SCAN ONTBREKENDE VERTALINGEN ===\n');

  var allMissing = {}; // { locale: { resourceType: [items] } }

  for (var li = 0; li < locales.length; li++) {
    var locale = locales[li];
    allMissing[locale] = {};
    stats.perLocale[locale] = { missing: 0, filled: 0, errors: 0 };

    for (var ri = 0; ri < RESOURCE_TYPES.length; ri++) {
      var type = RESOURCE_TYPES[ri];
      process.stdout.write('  [' + locale + '] ' + type + '...');
      var missing = await scanResourceType(type, locale);

      if (missing.length > 0) {
        allMissing[locale][type] = missing;
        stats.perLocale[locale].missing += missing.length;
        stats.totalMissing += missing.length;

        if (!stats.perType[type]) stats.perType[type] = 0;
        stats.perType[type] += missing.length;
      }

      console.log(' ' + missing.length + ' ontbrekend');
      await sleep(200);
    }
  }

  console.log('\nTotaal ontbrekend: ' + stats.totalMissing);
  return allMissing;
}

// ============================================================
// STAP 2b: Filter — skip image/URL/video settings (should never be translated)
// ============================================================

var SKIP_KEY_PATTERNS = [
  'image', 'logo', 'favicon', 'icon', 'video', 'background_video',
  'background_image', 'desktop_image', 'mobile_image', 'badge_image',
  'step_image', 'photo', 'thumbnail', 'poster'
];

function shouldSkipTranslation(key, value) {
  // Skip keys that are image/video/icon settings
  var keyLower = key.toLowerCase();
  for (var i = 0; i < SKIP_KEY_PATTERNS.length; i++) {
    if (keyLower.indexOf(SKIP_KEY_PATTERNS[i]) !== -1) return true;
  }

  // Skip values that are URLs (shopify://, http://, https://)
  if (!value) return false;
  var valTrimmed = value.trim();
  if (valTrimmed.indexOf('shopify://') === 0) return true;
  if (valTrimmed.indexOf('http://') === 0) return true;
  if (valTrimmed.indexOf('https://') === 0) return true;

  // Skip values that look like asset file references
  var assetExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.mp4', '.webm', '.mov'];
  for (var j = 0; j < assetExtensions.length; j++) {
    if (valTrimmed.indexOf(assetExtensions[j]) !== -1 && valTrimmed.length < 500) return true;
  }

  return false;
}

// ============================================================
// STAP 3: Genereer vertalingen via Claude API
// ============================================================

async function translateWithClaude(sourceText, targetLocale, context) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Skip very long HTML bodies (>3000 chars) - these need manual review
  if (sourceText.length > 3000) {
    console.log('    [SKIP] Te lang voor auto-vertaling (' + sourceText.length + ' chars)');
    return null;
  }

  var langName = LANGUAGE_NAMES[targetLocale] || targetLocale;
  var isHtml = sourceText.indexOf('<') > -1 && sourceText.indexOf('>') > -1;

  var prompt = 'Translate the following text for CALQIX, a premium oral care brand.\n\n'
    + 'Source (English): "' + sourceText.replace(/"/g, '\\"').substring(0, 2000) + '"\n'
    + 'Target language: ' + langName + '\n'
    + 'Context: ' + (context || 'product/store content') + '\n\n'
    + 'Rules:\n'
    + '- Premium, clinical, scientific tone\n'
    + '- Natural native phrasing, not robotic translation\n'
    + '- Keep brand name "CALQIX" unchanged\n'
    + '- Keep product names "FlowCore", "OralBiome", "LumiCore" unchanged\n'
    + '- Keep technical terms like "nano-hydroxyapatite", "PAP+" unchanged\n'
    + (isHtml ? '- Preserve ALL HTML tags exactly as they are. Only translate the text content.\n' : '')
    + '- For currency: use EUR format for EU countries, CHF for Switzerland, SEK/NOK/DKK for Scandinavia\n'
    + '- Be concise and clear\n\n'
    + 'Respond with ONLY the translated text, nothing else.';

  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    var data = await res.json();
    if (!res.ok) {
      console.error('    Claude API error:', data.error ? data.error.message : res.statusText);
      return null;
    }

    var text = data.content && data.content[0] ? data.content[0].text : '';
    return text.trim() || null;
  } catch (err) {
    console.error('    Claude exception:', err.message);
    return null;
  }
}

// ============================================================
// STAP 4: Registreer vertalingen bij Shopify
// ============================================================

async function registerTranslation(resourceId, locale, key, value, digest) {
  try {
    var result = await shopify.graphql(
      'mutation reg($rid: ID!, $translations: [TranslationInput!]!) { translationsRegister(resourceId: $rid, translations: $translations) { translations { key locale } userErrors { field message } } }',
      {
        rid: resourceId,
        translations: [{
          key: key,
          value: value,
          locale: locale,
          translatableContentDigest: digest
        }]
      }
    );

    var errors = result.translationsRegister.userErrors || [];
    if (errors.length > 0) {
      console.log('    REGISTER ERROR: ' + errors[0].message);
      return false;
    }
    return true;
  } catch (err) {
    console.log('    REGISTER ERROR: ' + err.message);
    return false;
  }
}

// ============================================================
// STAP 5: Process - translate + register
// ============================================================

async function processAllMissing(allMissing) {
  console.log('\n=== STAP 3-4: VERTALEN EN REGISTREREN ===\n');

  var locales = Object.keys(allMissing);
  for (var li = 0; li < locales.length; li++) {
    var locale = locales[li];
    var types = Object.keys(allMissing[locale]);

    for (var ti = 0; ti < types.length; ti++) {
      var type = types[ti];
      var items = allMissing[locale][type];
      console.log('[' + locale.toUpperCase() + '] ' + type + ': ' + items.length + ' items');

      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        var shortId = item.resourceId.split('/').pop();
        var context = type.toLowerCase() + ' ' + item.key;

        process.stdout.write('  ' + shortId + '.' + item.key + ':' + item.digest.substring(0, 13) + ' -> ');

        // Skip image/URL/video settings — these should NEVER be translated
        if (shouldSkipTranslation(item.key, item.value)) {
          console.log('SKIP (image/URL/asset — niet vertalen)');
          stats.perLocale[locale].errors++;
          stats.totalErrors++;
          continue;
        }

        // Generate translation
        var translated = await translateWithClaude(item.value, locale, context);
        if (!translated) {
          console.log('SKIP (no translation)');
          stats.perLocale[locale].errors++;
          stats.totalErrors++;
          continue;
        }

        // Register with Shopify
        var ok = await registerTranslation(item.resourceId, locale, item.key, translated, item.digest);
        if (ok) {
          console.log('OK (' + translated.substring(0, 50) + '...)');
          stats.perLocale[locale].filled++;
          stats.totalFilled++;
        } else {
          stats.perLocale[locale].errors++;
          stats.totalErrors++;
        }

        // Rate limit: 1 Claude call per second, batch Shopify calls
        await sleep(1200);
      }
    }
  }
}

// ============================================================
// STAP 6: Telegram rapport
// ============================================================

async function sendReport() {
  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + now.getFullYear();

  var lines = [
    '<b>CALQIX Vertaalrapport - ' + dateStr + '</b>',
    '',
    '<b>Per taal:</b>'
  ];

  var localeNames = {
    de: 'Duits', nl: 'Nederlands', fr: 'Frans',
    sv: 'Zweeds', nb: 'Noors', da: 'Deens', fi: 'Fins'
  };

  var locales = Object.keys(stats.perLocale);
  for (var i = 0; i < locales.length; i++) {
    var l = locales[i];
    var s = stats.perLocale[l];
    var name = localeNames[l] || l;
    lines.push('- ' + name + ' (' + l + '): ' + s.missing + ' ontbrekend, ' + s.filled + ' aangevuld' + (s.errors > 0 ? ', ' + s.errors + ' fouten' : ''));
  }

  lines.push('');
  lines.push('<b>Per type:</b>');
  var types = Object.keys(stats.perType);
  for (var t = 0; t < types.length; t++) {
    lines.push('- ' + types[t] + ': ' + stats.perType[types[t]] + ' ontbrekend');
  }

  lines.push('');
  lines.push('<b>Totaal:</b>');
  lines.push('- Ontbrekend gevonden: ' + stats.totalMissing);
  lines.push('- Aangevuld: ' + stats.totalFilled);
  lines.push('- Fouten/overgeslagen: ' + stats.totalErrors);

  var msg = lines.join('\n');
  console.log('\n' + msg.replace(/<[^>]+>/g, ''));

  await sendTelegram(msg);
  return stats;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('====================================================');
  console.log('CALQIX Translation Audit + Auto-Fill');
  console.log('====================================================');

  // Step 1: Get published locales
  var locales = await getPublishedLocales();
  stats.locales = locales;

  if (locales.length === 0) {
    console.log('Geen niet-primaire published locales gevonden. Stop.');
    return;
  }

  // Step 2: Scan all missing
  var allMissing = await scanAllMissing(locales);

  if (stats.totalMissing === 0) {
    console.log('\nGeen ontbrekende vertalingen gevonden!');
    await sendTelegram('CALQIX Vertaalrapport\n\nAlle vertalingen compleet voor: ' + locales.join(', '));
    return stats;
  }

  // Step 3-4: Translate and register
  await processAllMissing(allMissing);

  // Step 5: Report
  return await sendReport();
}

main().catch(function (err) {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
