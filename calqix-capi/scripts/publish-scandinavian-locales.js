/**
 * Publish Scandinavian Locales + Upload Theme Translations
 *
 * This script:
 *  1. Lists current shop locale status
 *  2. Enables any missing Scandinavian locales (sv, nb, da, fi)
 *  3. Publishes them so they are visible in the webshop
 *  4. Finds the active/published theme
 *  5. Uploads locale JSON files to the theme via Asset API
 *  6. Verifies everything is live
 *
 * Run: node scripts/publish-scandinavian-locales.js
 *
 * Requires env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN
 */
require('dotenv').config();
var fs = require('fs');
var path = require('path');
var shopify = require('../lib/shopify-admin');

var SCANDI_LOCALES = ['sv', 'nb', 'da', 'fi'];
var LOCALE_DIR = path.resolve(__dirname, '..', '..', 'locales');

var results = {
  currentLocales: [],
  enabled: [],
  published: [],
  themeId: null,
  themeName: null,
  uploaded: [],
  errors: []
};

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ============================================================
// STAP 1: Huidige locale status ophalen
// ============================================================
async function listLocales() {
  console.log('\n=== STAP 1: HUIDIGE LOCALE STATUS ===\n');
  var data = await shopify.graphql('{ shopLocales { locale name primary published } }');
  var locales = data.shopLocales;

  for (var i = 0; i < locales.length; i++) {
    var l = locales[i];
    var status = l.primary ? 'PRIMAIR' : (l.published ? 'GEPUBLICEERD' : 'NIET GEPUBLICEERD');
    console.log('  ' + l.locale + ' (' + l.name + ') - ' + status);
  }

  results.currentLocales = locales;
  return locales;
}

// ============================================================
// STAP 2: Ontbrekende locales enablen
// ============================================================
async function enableMissingLocales(existingLocales) {
  console.log('\n=== STAP 2: ONTBREKENDE LOCALES ENABLEN ===\n');
  var existingCodes = existingLocales.map(function (l) { return l.locale; });

  for (var i = 0; i < SCANDI_LOCALES.length; i++) {
    var locale = SCANDI_LOCALES[i];
    if (existingCodes.indexOf(locale) !== -1) {
      console.log('  ' + locale + ': al aanwezig, overslaan');
      continue;
    }

    try {
      var r = await shopify.graphql(
        'mutation shopLocaleEnable($locale: String!) { ' +
        '  shopLocaleEnable(locale: $locale) { ' +
        '    shopLocale { locale name published } ' +
        '    userErrors { field message } ' +
        '  } ' +
        '}',
        { locale: locale }
      );

      var errors = r.shopLocaleEnable.userErrors || [];
      if (errors.length > 0) {
        console.log('  ' + locale + ': FOUT - ' + errors[0].message);
        results.errors.push({ step: 'enable_' + locale, error: errors[0].message });
      } else {
        var sl = r.shopLocaleEnable.shopLocale;
        console.log('  ' + sl.locale + ' (' + sl.name + '): ENABLED');
        results.enabled.push(sl.locale);
      }
    } catch (err) {
      console.log('  ' + locale + ': FOUT - ' + err.message);
      results.errors.push({ step: 'enable_' + locale, error: err.message });
    }
    await sleep(500);
  }
}

// ============================================================
// STAP 3: Locales publiceren (maakt ze zichtbaar in webshop)
// ============================================================
async function publishLocales() {
  console.log('\n=== STAP 3: LOCALES PUBLICEREN ===\n');

  // Haal opnieuw de huidige status op
  var data = await shopify.graphql('{ shopLocales { locale name primary published } }');
  var locales = data.shopLocales;

  for (var i = 0; i < SCANDI_LOCALES.length; i++) {
    var locale = SCANDI_LOCALES[i];
    var existing = null;
    for (var j = 0; j < locales.length; j++) {
      if (locales[j].locale === locale) { existing = locales[j]; break; }
    }

    if (!existing) {
      console.log('  ' + locale + ': NIET GEVONDEN - kan niet publiceren');
      results.errors.push({ step: 'publish_' + locale, error: 'locale not found' });
      continue;
    }

    if (existing.published) {
      console.log('  ' + locale + ' (' + existing.name + '): al gepubliceerd');
      results.published.push(locale);
      continue;
    }

    try {
      var r = await shopify.graphql(
        'mutation updateLocale($locale: String!, $shopLocale: ShopLocaleInput!) { ' +
        '  shopLocaleUpdate(locale: $locale, shopLocale: $shopLocale) { ' +
        '    shopLocale { locale name published } ' +
        '    userErrors { field message } ' +
        '  } ' +
        '}',
        { locale: locale, shopLocale: { published: true } }
      );

      var errors = r.shopLocaleUpdate.userErrors || [];
      if (errors.length > 0) {
        console.log('  ' + locale + ': FOUT bij publiceren - ' + errors[0].message);
        results.errors.push({ step: 'publish_' + locale, error: errors[0].message });
      } else {
        var sl = r.shopLocaleUpdate.shopLocale;
        console.log('  ' + sl.locale + ' (' + sl.name + '): GEPUBLICEERD = ' + sl.published);
        results.published.push(sl.locale);
      }
    } catch (err) {
      console.log('  ' + locale + ': FOUT - ' + err.message);
      results.errors.push({ step: 'publish_' + locale, error: err.message });
    }
    await sleep(500);
  }
}

// ============================================================
// STAP 4: Actief thema vinden
// ============================================================
async function findActiveTheme() {
  console.log('\n=== STAP 4: ACTIEF THEMA ZOEKEN ===\n');

  var data = await shopify.rest('themes.json');
  var themes = data.themes || [];

  var active = null;
  for (var i = 0; i < themes.length; i++) {
    var t = themes[i];
    console.log('  ' + t.name + ' (ID: ' + t.id + ') - rol: ' + t.role);
    if (t.role === 'main') {
      active = t;
    }
  }

  if (!active) {
    console.error('FOUT: Geen actief thema gevonden!');
    results.errors.push({ step: 'find_theme', error: 'No active theme found' });
    return null;
  }

  console.log('\n  Actief thema: ' + active.name + ' (ID: ' + active.id + ')');
  results.themeId = active.id;
  results.themeName = active.name;
  return active;
}

// ============================================================
// STAP 5: Locale bestanden uploaden naar thema
// ============================================================
async function uploadLocaleFiles(themeId) {
  console.log('\n=== STAP 5: LOCALE BESTANDEN UPLOADEN ===\n');

  var fileMap = {
    'sv': 'sv.json',
    'nb': 'nb.json',
    'da': 'da.json',
    'fi': 'fi.json'
  };

  for (var i = 0; i < SCANDI_LOCALES.length; i++) {
    var locale = SCANDI_LOCALES[i];
    var filename = fileMap[locale];
    var filepath = path.join(LOCALE_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.log('  ' + filename + ': BESTAND NIET GEVONDEN op ' + filepath);
      results.errors.push({ step: 'upload_' + locale, error: 'File not found: ' + filepath });
      continue;
    }

    var content = fs.readFileSync(filepath, 'utf8');
    console.log('  ' + filename + ': gelezen (' + content.length + ' bytes)');

    try {
      var r = await shopify.rest(
        'themes/' + themeId + '/assets.json',
        'PUT',
        {
          asset: {
            key: 'locales/' + filename,
            value: content
          }
        }
      );

      if (r.errors) {
        console.log('  ' + filename + ': FOUT bij upload - ' + JSON.stringify(r.errors));
        results.errors.push({ step: 'upload_' + locale, error: JSON.stringify(r.errors) });
      } else if (r.asset) {
        console.log('  ' + filename + ': GEUPLOAD naar thema (key: ' + r.asset.key + ')');
        results.uploaded.push(filename);
      } else {
        console.log('  ' + filename + ': ONVERWACHT antwoord - ' + JSON.stringify(r).substring(0, 200));
        results.errors.push({ step: 'upload_' + locale, error: 'Unexpected response' });
      }
    } catch (err) {
      console.log('  ' + filename + ': FOUT - ' + err.message);
      results.errors.push({ step: 'upload_' + locale, error: err.message });
    }
    await sleep(1000); // iets langer wachten bij asset uploads
  }
}

// ============================================================
// STAP 6: Verificatie
// ============================================================
async function verify() {
  console.log('\n=== STAP 6: VERIFICATIE ===\n');

  // Check locales opnieuw
  var data = await shopify.graphql('{ shopLocales { locale name primary published } }');
  var locales = data.shopLocales;

  console.log('  Huidige locale status na wijzigingen:');
  var allPublished = true;
  for (var i = 0; i < locales.length; i++) {
    var l = locales[i];
    var isScandi = SCANDI_LOCALES.indexOf(l.locale) !== -1;
    var status = l.primary ? 'PRIMAIR' : (l.published ? 'GEPUBLICEERD' : 'NIET GEPUBLICEERD');
    if (isScandi) {
      console.log('  >> ' + l.locale + ' (' + l.name + ') - ' + status + (l.published ? ' OK' : ' PROBLEEM'));
      if (!l.published) allPublished = false;
    } else {
      console.log('     ' + l.locale + ' (' + l.name + ') - ' + status);
    }
  }

  // Check theme assets
  if (results.themeId) {
    console.log('\n  Theme assets check:');
    for (var j = 0; j < SCANDI_LOCALES.length; j++) {
      var locale = SCANDI_LOCALES[j];
      var key = 'locales/' + locale + '.json';
      try {
        var asset = await shopify.rest(
          'themes/' + results.themeId + '/assets.json?asset[key]=' + encodeURIComponent(key)
        );
        if (asset.asset) {
          console.log('  >> ' + key + ': AANWEZIG (' + (asset.asset.size || 'onbekend') + ' bytes)');
        } else {
          console.log('  >> ' + key + ': NIET GEVONDEN');
        }
      } catch (err) {
        console.log('  >> ' + key + ': FOUT - ' + err.message);
      }
      await sleep(300);
    }
  }

  return allPublished;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('====================================================');
  console.log('CALQIX - Scandinavische Locales Publiceren + Uploaden');
  console.log('Datum: ' + new Date().toLocaleDateString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).replace(/\//g, '-'));
  console.log('====================================================');

  // Controleer env
  var store = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  var token = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();

  if (!store || !token) {
    console.error('\nFATAAL: SHOPIFY_STORE_DOMAIN en/of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreken!');
    console.error('Stel in via .env of Vercel env vars.');
    process.exit(1);
  }

  console.log('\nStore: ' + store);
  console.log('Token: ' + token.substring(0, 8) + '***');

  // Controleer of locale bestanden bestaan
  console.log('\nLocale bestanden check:');
  var allFilesExist = true;
  for (var i = 0; i < SCANDI_LOCALES.length; i++) {
    var f = path.join(LOCALE_DIR, SCANDI_LOCALES[i] + '.json');
    var exists = fs.existsSync(f);
    console.log('  ' + SCANDI_LOCALES[i] + '.json: ' + (exists ? 'OK' : 'ONTBREEKT'));
    if (!exists) allFilesExist = false;
  }
  if (!allFilesExist) {
    console.error('\nFATAAL: Niet alle locale bestanden gevonden in ' + LOCALE_DIR);
    process.exit(1);
  }

  // Execute stappen
  var existingLocales = await listLocales();
  await enableMissingLocales(existingLocales);
  await publishLocales();

  var theme = await findActiveTheme();
  if (theme) {
    await uploadLocaleFiles(theme.id);
  }

  var allOk = await verify();

  // Samenvatting
  console.log('\n====================================================');
  console.log('SAMENVATTING');
  console.log('====================================================');
  console.log('Locales enabled:    ' + (results.enabled.length > 0 ? results.enabled.join(', ') : 'geen nieuwe (al aanwezig)'));
  console.log('Locales published:  ' + (results.published.length > 0 ? results.published.join(', ') : 'geen'));
  console.log('Thema:              ' + (results.themeName || 'niet gevonden') + ' (ID: ' + (results.themeId || '?') + ')');
  console.log('Bestanden geupload: ' + (results.uploaded.length > 0 ? results.uploaded.join(', ') : 'geen'));
  console.log('Fouten:             ' + results.errors.length);
  console.log('Alles gepubliceerd: ' + (allOk ? 'JA' : 'NEE'));

  if (results.errors.length > 0) {
    console.log('\nFouten detail:');
    for (var e = 0; e < results.errors.length; e++) {
      console.log('  - ' + results.errors[e].step + ': ' + results.errors[e].error);
    }
  }

  if (allOk && results.uploaded.length === 4) {
    console.log('\n==> SUCCES: Alle Scandinavische talen zijn gepubliceerd en zichtbaar in de webshop!');
    console.log('    Controleer: https://' + store + ' > taalwisselaar');
  } else {
    console.log('\n==> WAARSCHUWING: Niet alles is gelukt. Bekijk de fouten hierboven.');
  }
}

main().catch(function (err) {
  console.error('FATALE FOUT:', err.message);
  console.error(err.stack);
  process.exit(1);
});
