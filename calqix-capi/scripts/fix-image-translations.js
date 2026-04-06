/**
 * CALQIX — Remove Bad Image/URL Translations
 *
 * The translation audit incorrectly translated image URLs, video URLs,
 * and asset references. This script finds and removes those translations
 * so the original English assets are shown instead.
 *
 * Run: node scripts/fix-image-translations.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var LOCALES = ['da', 'de', 'fi', 'fr', 'nb', 'nl', 'sv'];

var SKIP_KEY_PATTERNS = [
  'image', 'logo', 'favicon', 'icon', 'video', 'background_video',
  'background_image', 'desktop_image', 'mobile_image', 'badge_image',
  'step_image', 'photo', 'thumbnail', 'poster'
];

var ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.mp4', '.webm', '.mov'];

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function isImageOrAssetKey(key) {
  var keyLower = key.toLowerCase();
  for (var i = 0; i < SKIP_KEY_PATTERNS.length; i++) {
    if (keyLower.indexOf(SKIP_KEY_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

function isAssetValue(value) {
  if (!value) return false;
  var v = value.trim();
  if (v.indexOf('shopify://') === 0) return true;
  if (v.indexOf('http://') === 0) return true;
  if (v.indexOf('https://') === 0) return true;
  for (var j = 0; j < ASSET_EXTENSIONS.length; j++) {
    if (v.indexOf(ASSET_EXTENSIONS[j]) !== -1 && v.length < 500) return true;
  }
  return false;
}

var stats = { scanned: 0, removed: 0, errors: 0 };

async function removeTranslations(resourceId, keysToRemove, locale) {
  if (keysToRemove.length === 0) return 0;

  var batchSize = 200;
  var totalRemoved = 0;

  for (var b = 0; b < keysToRemove.length; b += batchSize) {
    var batch = keysToRemove.slice(b, b + batchSize);

    try {
      var result = await shopify.graphql(
        'mutation rem($resourceId: ID!, $translationKeys: [String!]!, $locales: [String!]!) { ' +
        '  translationsRemove(resourceId: $resourceId, translationKeys: $translationKeys, locales: $locales) { ' +
        '    translations { key locale } ' +
        '    userErrors { field message } ' +
        '  } ' +
        '}',
        {
          resourceId: resourceId,
          translationKeys: batch,
          locales: [locale]
        }
      );

      var errors = result.translationsRemove.userErrors || [];
      if (errors.length > 0) {
        for (var e = 0; e < errors.length; e++) {
          console.log('    ERROR: ' + errors[e].message);
        }
      } else {
        totalRemoved += batch.length;
      }
    } catch (err) {
      console.log('    API ERROR: ' + err.message);
    }
    await sleep(400);
  }

  return totalRemoved;
}

async function scanAndFix(resourceType) {
  console.log('\n--- ' + resourceType + ' ---');
  var cursor = null;
  var hasNext = true;
  var pageCount = 0;

  while (hasNext && pageCount < 15) {
    var afterArg = cursor ? ', after: "' + cursor + '"' : '';
    var query = '{ translatableResources(resourceType: ' + resourceType + ', first: 30' + afterArg + ') { ' +
      'edges { cursor node { resourceId translatableContent { key value digest } } } ' +
      'pageInfo { hasNextPage } } }';

    try {
      var data = await shopify.graphql(query);
      var edges = data.translatableResources.edges || [];

      for (var i = 0; i < edges.length; i++) {
        var node = edges[i].node;
        cursor = edges[i].cursor;
        stats.scanned++;

        var content = node.translatableContent || [];
        var badKeys = [];

        for (var c = 0; c < content.length; c++) {
          var item = content[c];
          if (isImageOrAssetKey(item.key) || isAssetValue(item.value)) {
            badKeys.push(item.key);
          }
        }

        if (badKeys.length === 0) continue;

        var shortId = node.resourceId.split('/').pop();
        process.stdout.write('  ' + shortId + ': ' + badKeys.length + ' image keys...');

        var totalRemoved = 0;
        for (var li = 0; li < LOCALES.length; li++) {
          var removed = await removeTranslations(node.resourceId, badKeys, LOCALES[li]);
          totalRemoved += removed;
          await sleep(300);
        }

        stats.removed += totalRemoved;
        console.log(' removed ' + totalRemoved + ' translations');
      }

      hasNext = data.translatableResources.pageInfo.hasNextPage;
      pageCount++;
    } catch (err) {
      if (!err.message.includes('not a valid ResourceType')) {
        console.log('  Error: ' + err.message);
        stats.errors++;
      }
      hasNext = false;
    }

    await sleep(400);
  }
}

async function main() {
  console.log('====================================================');
  console.log('CALQIX — Fix Image/URL Translations');
  console.log('Removing bad translations for: ' + LOCALES.join(', '));
  console.log('====================================================');

  await scanAndFix('ONLINE_STORE_THEME');
  await scanAndFix('PRODUCT');
  await scanAndFix('COLLECTION');

  console.log('\n====================================================');
  console.log('DONE');
  console.log('====================================================');
  console.log('Resources scanned: ' + stats.scanned);
  console.log('Translations removed: ' + stats.removed);
  console.log('Errors: ' + stats.errors);

  if (stats.removed > 0) {
    console.log('\nImage/URL translations verwijderd. Originele Engelse assets zijn hersteld.');
  } else {
    console.log('\nGeen foute image translations gevonden.');
  }
}

main().catch(function (err) {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
