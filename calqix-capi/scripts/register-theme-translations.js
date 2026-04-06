/**
 * CALQIX — Theme-Level Translations (announcement bar, header, section settings)
 *
 * Queries ONLINE_STORE_THEME translatable resources and registers
 * Scandinavian translations for announcement bar texts, header drawer title, etc.
 *
 * Run: node scripts/register-theme-translations.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var LOCALES = ['sv', 'nb', 'da', 'fi'];

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ═══════════════════════════════════════════════════════════
// THEME SETTING TRANSLATIONS
// ═══════════════════════════════════════════════════════════

var THEME_TRANSLATIONS = {
  // Announcement bar texts
  'Free shipping on orders over €80, ships within 2 business days': {
    sv: 'Fri frakt på beställningar över 800 kr, skickas inom 2 arbetsdagar',
    nb: 'Gratis frakt på bestillinger over 800 kr, sendes innen 2 virkedager',
    da: 'Gratis fragt på ordrer over 600 kr, afsendes inden for 2 hverdage',
    fi: 'Ilmainen toimitus yli 80 € tilauksiin, lähetetään 2 arkipäivän kuluessa'
  },
  '⚡ Launch offer: FlowCore Pro': {
    sv: '⚡ Lanseringserbjudande: FlowCore Pro',
    nb: '⚡ Lanseringstilbud: FlowCore Pro',
    da: '⚡ Lanceringstilbud: FlowCore Pro',
    fi: '⚡ Julkaisutarjous: FlowCore Pro'
  },
  '✓ 30-day money-back guarantee, try it completely risk-free': {
    sv: '✓ 30 dagars pengarna-tillbaka-garanti, prova helt riskfritt',
    nb: '✓ 30 dagers pengene-tilbake-garanti, prøv helt risikofritt',
    da: '✓ 30 dages pengene-tilbage-garanti, prøv helt risikofrit',
    fi: '✓ 30 päivän rahat-takaisin-takuu, kokeile täysin riskittömästi'
  },
  '🔬 Clinically tested · 4.9★ · Verified customer reviews': {
    sv: '🔬 Kliniskt testat · 4.9★ · Verifierade kundrecensioner',
    nb: '🔬 Klinisk testet · 4.9★ · Verifiserte kundeanmeldelser',
    da: '🔬 Klinisk testet · 4.9★ · Verificerede kundeanmeldelser',
    fi: '🔬 Kliinisesti testattu · 4.9★ · Vahvistetut asiakasarviot'
  },
  // Header drawer title
  'Welcome to CALQIX': {
    sv: 'Välkommen till CALQIX',
    nb: 'Velkommen til CALQIX',
    da: 'Velkommen til CALQIX',
    fi: 'Tervetuloa CALQIXiin'
  },
  // Search placeholder
  'Search...': {
    sv: 'Sök...',
    nb: 'Søk...',
    da: 'Søg...',
    fi: 'Hae...'
  },
  // Suggestions title
  'most popular': {
    sv: 'mest populärt',
    nb: 'mest populært',
    da: 'mest populært',
    fi: 'suosituimmat'
  },
  // Header mega menu texts
  'View All Products': {
    sv: 'Visa alla produkter',
    nb: 'Vis alle produkter',
    da: 'Vis alle produkter',
    fi: 'Näytä kaikki tuotteet'
  }
};

// ═══════════════════════════════════════════════════════════
// QUERY + REGISTER
// ═══════════════════════════════════════════════════════════

async function fetchThemeResources() {
  console.log('Querying ONLINE_STORE_THEME translatable resources...');
  var allResources = [];
  var cursor = null;
  var hasNext = true;

  while (hasNext) {
    var afterArg = cursor ? ', after: "' + cursor + '"' : '';
    var query = '{ translatableResources(resourceType: ONLINE_STORE_THEME, first: 20' + afterArg + ') { edges { cursor node { resourceId translatableContent { key value digest locale } } } pageInfo { hasNextPage } } }';

    try {
      var r = await shopify.graphql(query);
      var edges = r.translatableResources.edges || [];
      for (var i = 0; i < edges.length; i++) {
        allResources.push(edges[i].node);
        cursor = edges[i].cursor;
      }
      hasNext = r.translatableResources.pageInfo.hasNextPage;
      console.log('  Fetched ' + edges.length + ' resources (total: ' + allResources.length + ')');
    } catch (err) {
      console.log('  Query error: ' + err.message);
      hasNext = false;
    }
    await sleep(500);
  }

  return allResources;
}

async function registerBatch(resourceId, translations) {
  if (!translations.length) return 0;
  try {
    var r = await shopify.graphql(
      'mutation reg($resourceId: ID!, $translations: [TranslationInput!]!) { translationsRegister(resourceId: $resourceId, translations: $translations) { translations { key locale } userErrors { field message } } }',
      { resourceId: resourceId, translations: translations }
    );
    var errors = r.translationsRegister.userErrors || [];
    if (errors.length > 0) {
      for (var e = 0; e < errors.length; e++) console.log('    ERROR: ' + errors[e].message);
      return 0;
    }
    return (r.translationsRegister.translations || []).length;
  } catch (err) {
    console.log('    API ERROR: ' + err.message);
    return 0;
  }
}

async function main() {
  console.log('====================================================');
  console.log('CALQIX — Theme-Level Translations');
  console.log('Locales: ' + LOCALES.join(', '));
  console.log('====================================================\n');

  var resources = await fetchThemeResources();
  console.log('\nFound ' + resources.length + ' ONLINE_STORE_THEME resources.\n');

  var totalRegistered = 0;
  var matched = 0;

  for (var ri = 0; ri < resources.length; ri++) {
    var resource = resources[ri];
    var content = resource.translatableContent || [];
    var translations = [];

    for (var ci = 0; ci < content.length; ci++) {
      var item = content[ci];
      if (!item.digest || !item.value) continue;

      var map = THEME_TRANSLATIONS[item.value];
      if (!map) continue;

      matched++;
      for (var li = 0; li < LOCALES.length; li++) {
        var locale = LOCALES[li];
        if (map[locale]) {
          translations.push({
            key: item.key,
            value: map[locale],
            locale: locale,
            translatableContentDigest: item.digest
          });
        }
      }
    }

    if (translations.length > 0) {
      var label = resource.resourceId.substring(0, 60);
      process.stdout.write('  ' + label + '...');
      var count = await registerBatch(resource.resourceId, translations);
      totalRegistered += count;
      console.log(' => ' + count + ' translations');
      await sleep(400);
    }
  }

  console.log('\n====================================================');
  console.log('SUMMARY');
  console.log('====================================================');
  console.log('Theme resources scanned: ' + resources.length);
  console.log('Matching settings found: ' + matched);
  console.log('Translations registered: ' + totalRegistered);
}

main().catch(function (err) {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
