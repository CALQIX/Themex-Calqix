/**
 * Register Store-Level Translations for Scandinavian Locales
 *
 * This script:
 *  1. Queries all translatable resources (products, collections, pages, policies, shop info)
 *  2. Fetches their translatable content + digests
 *  3. Generates native translations for sv, nb, da, fi
 *  4. Registers them via translationsRegister mutation
 *
 * Run: node scripts/register-store-translations.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var LOCALES = ['sv', 'nb', 'da', 'fi'];

var results = {
  resources: 0,
  translations: 0,
  errors: [],
  perLocale: { sv: 0, nb: 0, da: 0, fi: 0 }
};

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ============================================================
// STAP 1: Haal alle vertaalbare resources op
// ============================================================
async function fetchTranslatableResources(resourceType) {
  var allResources = [];
  var cursor = null;
  var hasNext = true;

  while (hasNext) {
    var afterClause = cursor ? ', after: "' + cursor + '"' : '';
    var query = '{ translatableResources(resourceType: ' + resourceType + ', first: 20' + afterClause + ') { ' +
      'edges { cursor node { resourceId translatableContent { key value digest locale } } } ' +
      'pageInfo { hasNextPage } } }';

    var data = await shopify.graphql(query);
    var edges = data.translatableResources.edges;

    for (var i = 0; i < edges.length; i++) {
      allResources.push(edges[i].node);
      cursor = edges[i].cursor;
    }

    hasNext = data.translatableResources.pageInfo.hasNextPage;
    await sleep(300);
  }

  return allResources;
}

// ============================================================
// STAP 2: Vertalingen genereren per resource
// ============================================================

// Product translations - based on CALQIX oral care brand
var PRODUCT_TRANSLATIONS = {
  sv: {
    'OralBiome Pro — Peach': 'OralBiome Pro — Persika',
    'FlowCore — Peppermint': 'FlowCore — Pepparmynta',
    'FlowCore — Fresh Mint': 'FlowCore — Frisk Mynta',
    'OralBiome Pro': 'OralBiome Pro',
    'FlowCore': 'FlowCore',
    // Common description fragments
    'Add to cart': 'Lägg i kundvagn',
    'Out of stock': 'Slut i lager',
    'Sold out': 'Slutsåld',
    'Sale': 'Rea',
    'Free shipping': 'Fri frakt',
    'Description': 'Beskrivning',
    'Ingredients': 'Ingredienser',
    'How to use': 'Så använder du',
    'Reviews': 'Recensioner',
    'Subscribe & Save': 'Prenumerera & Spara',
    'One-time purchase': 'Engångsköp',
    'Subscription': 'Prenumeration',
    'Default Title': 'Standardtitel'
  },
  nb: {
    'OralBiome Pro — Peach': 'OralBiome Pro — Fersken',
    'FlowCore — Peppermint': 'FlowCore — Peppermynte',
    'FlowCore — Fresh Mint': 'FlowCore — Frisk Mynte',
    'OralBiome Pro': 'OralBiome Pro',
    'FlowCore': 'FlowCore',
    'Add to cart': 'Legg i handlekurv',
    'Out of stock': 'Ikke på lager',
    'Sold out': 'Utsolgt',
    'Sale': 'Salg',
    'Free shipping': 'Gratis frakt',
    'Description': 'Beskrivelse',
    'Ingredients': 'Ingredienser',
    'How to use': 'Slik bruker du',
    'Reviews': 'Anmeldelser',
    'Subscribe & Save': 'Abonner & Spar',
    'One-time purchase': 'Engangskjøp',
    'Subscription': 'Abonnement',
    'Default Title': 'Standardtittel'
  },
  da: {
    'OralBiome Pro — Peach': 'OralBiome Pro — Fersken',
    'FlowCore — Peppermint': 'FlowCore — Pebermynte',
    'FlowCore — Fresh Mint': 'FlowCore — Frisk Mynte',
    'OralBiome Pro': 'OralBiome Pro',
    'FlowCore': 'FlowCore',
    'Add to cart': 'Tilføj til kurv',
    'Out of stock': 'Ikke på lager',
    'Sold out': 'Udsolgt',
    'Sale': 'Udsalg',
    'Free shipping': 'Gratis levering',
    'Description': 'Beskrivelse',
    'Ingredients': 'Ingredienser',
    'How to use': 'Sådan bruger du',
    'Reviews': 'Anmeldelser',
    'Subscribe & Save': 'Abonner & Spar',
    'One-time purchase': 'Engangskøb',
    'Subscription': 'Abonnement',
    'Default Title': 'Standardtitel'
  },
  fi: {
    'OralBiome Pro — Peach': 'OralBiome Pro — Persikka',
    'FlowCore — Peppermint': 'FlowCore — Piparminttu',
    'FlowCore — Fresh Mint': 'FlowCore — Raikas Minttu',
    'OralBiome Pro': 'OralBiome Pro',
    'FlowCore': 'FlowCore',
    'Add to cart': 'Lisää ostoskoriin',
    'Out of stock': 'Loppunut',
    'Sold out': 'Loppuunmyyty',
    'Sale': 'Ale',
    'Free shipping': 'Ilmainen toimitus',
    'Description': 'Kuvaus',
    'Ingredients': 'Ainesosat',
    'How to use': 'Käyttöohje',
    'Reviews': 'Arvostelut',
    'Subscribe & Save': 'Tilaa & Säästä',
    'One-time purchase': 'Kertaostos',
    'Subscription': 'Tilaus',
    'Default Title': 'Oletsotsikko'
  }
};

// HTML body translations need special handling
var BODY_HTML_KEYWORDS = {
  sv: {
    'Benefits': 'Fördelar',
    'Key Ingredients': 'Viktiga ingredienser',
    'How It Works': 'Så fungerar det',
    'Directions': 'Anvisningar',
    'Warning': 'Varning',
    'Warnings': 'Varningar',
    'Clinically tested': 'Kliniskt testad',
    'clinically tested': 'kliniskt testad',
    'oral microbiome': 'oralt mikrobiom',
    'probiotic': 'probiotisk',
    'probiotics': 'probiotika',
    'hydroxyapatite': 'hydroxyapatit',
    'fluoride-free': 'fluoridfri',
    'sugar-free': 'sockerfri',
    'toothpaste': 'tandkräm',
    'mouthwash': 'munvatten',
    'oral care': 'munvård',
    'enamel': 'emalj',
    'gum health': 'tandhälsa',
    'fresh breath': 'frisk andedräkt',
    'whitening': 'blekning',
    'sensitive teeth': 'känsliga tänder',
    'daily use': 'daglig användning',
    'twice daily': 'två gånger dagligen',
    'natural ingredients': 'naturliga ingredienser',
    'vegan': 'vegansk',
    'cruelty-free': 'djurförsöksfri',
    'made in': 'tillverkad i',
    'EU compliant': 'EU-godkänd'
  },
  nb: {
    'Benefits': 'Fordeler',
    'Key Ingredients': 'Viktige ingredienser',
    'How It Works': 'Slik fungerer det',
    'Directions': 'Bruksanvisning',
    'Warning': 'Advarsel',
    'Warnings': 'Advarsler',
    'Clinically tested': 'Klinisk testet',
    'clinically tested': 'klinisk testet',
    'oral microbiome': 'oralt mikrobiom',
    'probiotic': 'probiotisk',
    'probiotics': 'probiotika',
    'hydroxyapatite': 'hydroksyapatitt',
    'fluoride-free': 'fluoridfri',
    'sugar-free': 'sukkerfri',
    'toothpaste': 'tannkrem',
    'mouthwash': 'munnvann',
    'oral care': 'munnpleie',
    'enamel': 'emalje',
    'gum health': 'tannkjøtthelse',
    'fresh breath': 'frisk pust',
    'whitening': 'bleking',
    'sensitive teeth': 'sensitive tenner',
    'daily use': 'daglig bruk',
    'twice daily': 'to ganger daglig',
    'natural ingredients': 'naturlige ingredienser',
    'vegan': 'vegansk',
    'cruelty-free': 'dyreforsøksfri',
    'made in': 'laget i',
    'EU compliant': 'EU-godkjent'
  },
  da: {
    'Benefits': 'Fordele',
    'Key Ingredients': 'Vigtige ingredienser',
    'How It Works': 'Sådan virker det',
    'Directions': 'Brugsanvisning',
    'Warning': 'Advarsel',
    'Warnings': 'Advarsler',
    'Clinically tested': 'Klinisk testet',
    'clinically tested': 'klinisk testet',
    'oral microbiome': 'oralt mikrobiom',
    'probiotic': 'probiotisk',
    'probiotics': 'probiotika',
    'hydroxyapatite': 'hydroxyapatit',
    'fluoride-free': 'fluoridfri',
    'sugar-free': 'sukkerfri',
    'toothpaste': 'tandpasta',
    'mouthwash': 'mundskyl',
    'oral care': 'mundpleje',
    'enamel': 'emalje',
    'gum health': 'tandkødssundhed',
    'fresh breath': 'frisk ånde',
    'whitening': 'blegning',
    'sensitive teeth': 'følsomme tænder',
    'daily use': 'daglig brug',
    'twice daily': 'to gange dagligt',
    'natural ingredients': 'naturlige ingredienser',
    'vegan': 'vegansk',
    'cruelty-free': 'dyreforsøgsfri',
    'made in': 'fremstillet i',
    'EU compliant': 'EU-godkendt'
  },
  fi: {
    'Benefits': 'Edut',
    'Key Ingredients': 'Tärkeimmät ainesosat',
    'How It Works': 'Näin se toimii',
    'Directions': 'Käyttöohjeet',
    'Warning': 'Varoitus',
    'Warnings': 'Varoitukset',
    'Clinically tested': 'Kliinisesti testattu',
    'clinically tested': 'kliinisesti testattu',
    'oral microbiome': 'suun mikrobiomi',
    'probiotic': 'probioottinen',
    'probiotics': 'probiootit',
    'hydroxyapatite': 'hydroksiapatiitti',
    'fluoride-free': 'fluoriditon',
    'sugar-free': 'sokeriton',
    'toothpaste': 'hammastahna',
    'mouthwash': 'suuvesi',
    'oral care': 'suunhoito',
    'enamel': 'kiille',
    'gum health': 'ikenten terveys',
    'fresh breath': 'raikas hengitys',
    'whitening': 'valkaisu',
    'sensitive teeth': 'herkät hampaat',
    'daily use': 'päivittäinen käyttö',
    'twice daily': 'kahdesti päivässä',
    'natural ingredients': 'luonnolliset ainesosat',
    'vegan': 'vegaaninen',
    'cruelty-free': 'eläinkokeeton',
    'made in': 'valmistettu',
    'EU compliant': 'EU-hyväksytty'
  }
};

/**
 * Translate a text value. For titles, check the exact match table.
 * For body_html / descriptions, do keyword replacement.
 * For short simple strings, check the table.
 */
function translateValue(key, value, locale) {
  if (!value || value.trim() === '') return null;

  var table = PRODUCT_TRANSLATIONS[locale] || {};

  // Exact match first (titles, variant names, etc.)
  if (table[value]) return table[value];

  // For body_html, do keyword-based translation
  if (key === 'body_html' || key === 'description' || key === 'body') {
    return translateHTML(value, locale);
  }

  // For meta fields with simple text
  if (key === 'meta_title' || key === 'meta_description' || key === 'title') {
    return translateSimpleText(value, locale);
  }

  // For option names
  if (key === 'option1' || key === 'option2' || key === 'option3') {
    return translateSimpleText(value, locale);
  }

  // For handle - don't translate
  if (key === 'handle') return null;

  // Try simple text translation for everything else
  var translated = translateSimpleText(value, locale);
  if (translated !== value) return translated;

  return null; // Skip if no translation available
}

function translateHTML(html, locale) {
  var keywords = BODY_HTML_KEYWORDS[locale] || {};
  var result = html;
  var keys = Object.keys(keywords);
  var changed = false;

  for (var i = 0; i < keys.length; i++) {
    if (result.indexOf(keys[i]) !== -1) {
      result = result.split(keys[i]).join(keywords[keys[i]]);
      changed = true;
    }
  }

  return changed ? result : null;
}

function translateSimpleText(text, locale) {
  var table = PRODUCT_TRANSLATIONS[locale] || {};
  var keywords = BODY_HTML_KEYWORDS[locale] || {};

  // Exact match
  if (table[text]) return table[text];

  // Keyword replacement
  var result = text;
  var changed = false;
  var allKeys = Object.keys(table).concat(Object.keys(keywords));
  var allVals = {};
  var k;
  for (k in table) { allVals[k] = table[k]; }
  for (k in keywords) { allVals[k] = keywords[k]; }

  for (var i = 0; i < allKeys.length; i++) {
    var key = allKeys[i];
    if (result.indexOf(key) !== -1 && allVals[key]) {
      result = result.split(key).join(allVals[key]);
      changed = true;
    }
  }

  return changed ? result : text;
}

// ============================================================
// STAP 3: Registreer vertalingen
// ============================================================
async function registerTranslations(resourceId, translations) {
  if (translations.length === 0) return { ok: true, count: 0 };

  // Shopify max 20 translations per call
  var batchSize = 20;
  var totalRegistered = 0;

  for (var b = 0; b < translations.length; b += batchSize) {
    var batch = translations.slice(b, b + batchSize);

    try {
      var r = await shopify.graphql(
        'mutation registerTranslations($resourceId: ID!, $translations: [TranslationInput!]!) { ' +
        '  translationsRegister(resourceId: $resourceId, translations: $translations) { ' +
        '    translations { key locale value } ' +
        '    userErrors { field message } ' +
        '  } ' +
        '}',
        { resourceId: resourceId, translations: batch }
      );

      var errors = r.translationsRegister.userErrors || [];
      if (errors.length > 0) {
        for (var e = 0; e < errors.length; e++) {
          console.log('    FOUT: ' + errors[e].message);
        }
        results.errors.push({ resourceId: resourceId, errors: errors });
      } else {
        var registered = r.translationsRegister.translations || [];
        totalRegistered += registered.length;
      }
    } catch (err) {
      console.log('    API FOUT: ' + err.message);
      results.errors.push({ resourceId: resourceId, error: err.message });
    }
    await sleep(500);
  }

  return { ok: true, count: totalRegistered };
}

// ============================================================
// STAP 4: Verwerk een resource type
// ============================================================
async function processResourceType(resourceType, label) {
  console.log('\n--- ' + label + ' (' + resourceType + ') ---');
  var resources;
  try {
    resources = await fetchTranslatableResources(resourceType);
  } catch (err) {
    console.log('  FOUT bij ophalen: ' + err.message);
    results.errors.push({ step: 'fetch_' + resourceType, error: err.message });
    return;
  }

  console.log('  Gevonden: ' + resources.length + ' resources');
  results.resources += resources.length;

  for (var r = 0; r < resources.length; r++) {
    var resource = resources[r];
    var content = resource.translatableContent || [];

    // Find a name/title for logging
    var name = resource.resourceId;
    for (var c = 0; c < content.length; c++) {
      if (content[c].key === 'title' && content[c].value) {
        name = content[c].value;
        break;
      }
    }

    console.log('  [' + (r + 1) + '/' + resources.length + '] ' + name);

    for (var li = 0; li < LOCALES.length; li++) {
      var locale = LOCALES[li];
      var translations = [];

      for (var ci = 0; ci < content.length; ci++) {
        var item = content[ci];
        if (!item.value || !item.digest) continue;

        var translated = translateValue(item.key, item.value, locale);
        if (translated && translated !== item.value) {
          translations.push({
            key: item.key,
            value: translated,
            locale: locale,
            translatableContentDigest: item.digest
          });
        }
      }

      if (translations.length > 0) {
        var result = await registerTranslations(resource.resourceId, translations);
        results.translations += result.count;
        results.perLocale[locale] += result.count;
        process.stdout.write('    ' + locale + ': ' + result.count + ' vertalingen  ');
      }
    }
    console.log('');
  }
}

// ============================================================
// STAP 5: Shop-niveau vertalingen (checkout, mails)
// ============================================================
async function processShopTranslations() {
  console.log('\n--- Shop-niveau vertalingen ---');

  // Shop resource
  try {
    var data = await shopify.graphql(
      '{ translatableResource(resourceId: "gid://shopify/Shop/1") { ' +
      '  resourceId translatableContent { key value digest locale } ' +
      '} }'
    );

    if (data.translatableResource) {
      var content = data.translatableResource.translatableContent || [];
      console.log('  Shop velden: ' + content.length);

      for (var li = 0; li < LOCALES.length; li++) {
        var locale = LOCALES[li];
        var translations = [];

        for (var ci = 0; ci < content.length; ci++) {
          var item = content[ci];
          if (!item.value || !item.digest) continue;

          var translated = translateValue(item.key, item.value, locale);
          if (translated && translated !== item.value) {
            translations.push({
              key: item.key,
              value: translated,
              locale: locale,
              translatableContentDigest: item.digest
            });
          }
        }

        if (translations.length > 0) {
          var result = await registerTranslations(data.translatableResource.resourceId, translations);
          results.translations += result.count;
          results.perLocale[locale] += result.count;
          console.log('    ' + locale + ': ' + result.count + ' shop vertalingen');
        }
      }
    }
  } catch (err) {
    console.log('  Shop query mislukt: ' + err.message);
    // Not critical, continue
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('====================================================');
  console.log('CALQIX - Store-Level Vertalingen Registreren');
  console.log('Locales: ' + LOCALES.join(', '));
  console.log('Datum: ' + new Date().toLocaleDateString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).replace(/\//g, '-'));
  console.log('====================================================');

  var store = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  var token = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();

  if (!store || !token) {
    console.error('FATAAL: SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreekt');
    process.exit(1);
  }
  console.log('Store: ' + store);
  console.log('Token: ' + token.substring(0, 8) + '***');

  // Process all resource types
  await processResourceType('PRODUCT', 'Producten');
  await processResourceType('PRODUCT_VARIANT', 'Productvarianten');
  await processResourceType('COLLECTION', 'Collecties');
  await processResourceType('PAGE', 'Paginas');
  await processResourceType('BLOG', 'Blogs');
  await processResourceType('ARTICLE', 'Artikelen');
  await processResourceType('SHOP_POLICY', 'Winkelbeleid');
  await processResourceType('LINK', 'Navigatielinks');
  await processResourceType('MENU', 'Menus');
  await processResourceType('METAFIELD', 'Metavelden');
  await processResourceType('EMAIL_TEMPLATE', 'E-mail templates');
  await processResourceType('DELIVERY_METHOD_DEFINITION', 'Verzendmethodes');
  await processResourceType('PAYMENT_GATEWAY', 'Betaalmethodes');
  await processShopTranslations();

  // Samenvatting
  console.log('\n====================================================');
  console.log('SAMENVATTING');
  console.log('====================================================');
  console.log('Resources verwerkt:  ' + results.resources);
  console.log('Vertalingen totaal:  ' + results.translations);
  console.log('Per taal:');
  console.log('  sv (Zweeds):         ' + results.perLocale.sv);
  console.log('  nb (Noors Bokmal):   ' + results.perLocale.nb);
  console.log('  da (Deens):          ' + results.perLocale.da);
  console.log('  fi (Fins):           ' + results.perLocale.fi);
  console.log('Fouten:              ' + results.errors.length);

  if (results.errors.length > 0) {
    console.log('\nFouten detail:');
    for (var i = 0; i < results.errors.length; i++) {
      var e = results.errors[i];
      console.log('  - ' + (e.step || e.resourceId) + ': ' + (e.error || JSON.stringify(e.errors)));
    }
  }

  if (results.translations > 0) {
    console.log('\n==> SUCCES: ' + results.translations + ' vertalingen geregistreerd!');
    console.log('    Controleer in Shopify Admin > Settings > Languages');
  }
}

main().catch(function (err) {
  console.error('FATALE FOUT:', err.message);
  console.error(err.stack);
  process.exit(1);
});
