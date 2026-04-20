#!/usr/bin/env node
/*
 * CALQIX multi-locale fix migration.
 *
 * Runs a batch of Shopify Admin API mutations to:
 *   1. Fix productType on 5 OralBiome Pro products ("Teeth Whitening" -> "Oral Probiotics").
 *   2. Seed shop.metafields.custom.guarantee_days = 60 (single source of truth).
 *   3. Seed product.metafields.custom.gtm_category for every product
 *      (Oral Probiotics / Dental Flosser / Accessory / Digital Service / Teeth Whitening).
 *   4. Create 301 redirects /en/products/<handle> -> /products/<handle> for every active product,
 *      so hreflang references to /en/* no longer 404.
 *   5. Register Swedish and Norwegian product titles:
 *        - sv: OralBiome Pro Farsk Mynta   (for oralbiome-pro-freshmint)
 *        - nb: OralBiome Pro Frisk Mynte
 *   6. Scan all Finnish translations for the typo "bakteerilaijia" and fix to "bakteerilajia".
 *
 * Safety:
 *   - Dry-run by default. Prints what it WOULD do, mutates nothing.
 *   - Pass `--apply` to actually mutate.
 *   - Pass `--phase=<name>` to run only a specific phase (product-type, shop-meta, product-meta,
 *     redirects, translations, fi-typo). Default: all.
 *   - Existing redirects are detected and skipped.
 *   - Existing metafields are upserted idempotently via metafieldsSet.
 *
 * Usage:
 *   node scripts/migrate-multi-locale-fix.js                        # dry-run, all phases
 *   node scripts/migrate-multi-locale-fix.js --apply                # apply all phases
 *   node scripts/migrate-multi-locale-fix.js --apply --phase=redirects
 */

require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var APPLY = process.argv.indexOf('--apply') !== -1;
var phaseArg = process.argv.find(function (a) { return a.indexOf('--phase=') === 0; });
var PHASE = phaseArg ? phaseArg.split('=')[1] : 'all';

function log() {
  var prefix = APPLY ? '[APPLY]' : '[DRY]  ';
  var args = [prefix].concat(Array.prototype.slice.call(arguments));
  console.log.apply(console, args);
}

function shouldRun(phase) {
  return PHASE === 'all' || PHASE === phase;
}

// ------------------------------------------------------------------
// Canonical product -> category mapping (for gtm_category metafield)
// ------------------------------------------------------------------
var PRODUCT_CATEGORY_MAP = {
  'calqix-flowcore': 'Dental Flosser',
  'flowcore-white': 'Dental Flosser',
  'flowcore-green': 'Dental Flosser',
  'flowcore-pink': 'Dental Flosser',
  'flowcore-travel-pouch': 'Accessory',
  'priority-support': 'Digital Service',
  'lumicore-pap-whitening-kit': 'Teeth Whitening',
  'oralbiome-pro-freshmint': 'Oral Probiotics',
  'oralbiome-pro-cool-mint': 'Oral Probiotics',
  'oralbiome-pro-citrus-orange': 'Oral Probiotics',
  'oralbiome-pro-peach': 'Oral Probiotics',
  'oralbiome-pro-grape': 'Oral Probiotics'
};

// Products whose productType must be corrected
var ORALBIOME_HANDLES = [
  'oralbiome-pro-freshmint',
  'oralbiome-pro-cool-mint',
  'oralbiome-pro-citrus-orange',
  'oralbiome-pro-peach',
  'oralbiome-pro-grape'
];

// Swedish / Norwegian title fixes for OralBiome Pro Freshmint
var TITLE_TRANSLATIONS = {
  'oralbiome-pro-freshmint': {
    sv: 'OralBiome Pro Farsk Mynta',
    nb: 'OralBiome Pro Frisk Mynte'
  }
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
async function fetchAllProducts() {
  var q = '{ products(first: 100) { nodes { id handle title productType status } } }';
  var data = await shopify.graphql(q);
  return data.products.nodes;
}

async function fetchShopId() {
  var data = await shopify.graphql('{ shop { id } }');
  return data.shop.id;
}

async function fetchExistingRedirects() {
  // Paginate up to 500. If the store has more we'd need proper pagination.
  var q = '{ urlRedirects(first: 250) { nodes { id path target } pageInfo { hasNextPage endCursor } } }';
  var data = await shopify.graphql(q);
  return data.urlRedirects.nodes;
}

// ------------------------------------------------------------------
// Phase 1: productType fix
// ------------------------------------------------------------------
async function phaseProductType(products) {
  if (!shouldRun('product-type')) return { skipped: true };
  console.log('\n--- Phase: product-type (OralBiome Pro -> Oral Probiotics) ---');
  var changed = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (ORALBIOME_HANDLES.indexOf(p.handle) === -1) continue;
    if (p.productType === 'Oral Probiotics') {
      log('  SKIP', p.handle, 'already Oral Probiotics');
      continue;
    }
    log('  WILL update', p.handle, p.productType, '->', 'Oral Probiotics');
    if (!APPLY) { changed++; continue; }
    var m = 'mutation($input: ProductInput!) { productUpdate(input: $input) { product { id productType } userErrors { field message } } }';
    var res = await shopify.graphql(m, { input: { id: p.id, productType: 'Oral Probiotics' } });
    if (res.productUpdate.userErrors.length) {
      console.error('    ERRORS:', JSON.stringify(res.productUpdate.userErrors));
    } else {
      console.log('    OK:', res.productUpdate.product.productType);
      changed++;
    }
  }
  return { changed: changed };
}

// ------------------------------------------------------------------
// Phase 2: shop-level metafield (guarantee_days = 60)
// ------------------------------------------------------------------
async function phaseShopMeta(shopId) {
  if (!shouldRun('shop-meta')) return { skipped: true };
  console.log('\n--- Phase: shop-meta (custom.guarantee_days = 60) ---');
  log('  WILL set shop.metafields.custom.guarantee_days = "60" (number_integer)');
  if (!APPLY) return { changed: 1 };
  var m = 'mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id key namespace value type } userErrors { field message } } }';
  var res = await shopify.graphql(m, {
    metafields: [{
      ownerId: shopId,
      namespace: 'custom',
      key: 'guarantee_days',
      type: 'number_integer',
      value: '60'
    }]
  });
  if (res.metafieldsSet.userErrors.length) {
    console.error('    ERRORS:', JSON.stringify(res.metafieldsSet.userErrors));
    return { changed: 0 };
  }
  console.log('    OK:', res.metafieldsSet.metafields[0].namespace + '.' + res.metafieldsSet.metafields[0].key + ' = ' + res.metafieldsSet.metafields[0].value);
  return { changed: 1 };
}

// ------------------------------------------------------------------
// Phase 3: product-level metafield (gtm_category)
// ------------------------------------------------------------------
async function phaseProductMeta(products) {
  if (!shouldRun('product-meta')) return { skipped: true };
  console.log('\n--- Phase: product-meta (custom.gtm_category per product) ---');
  var todo = [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var cat = PRODUCT_CATEGORY_MAP[p.handle];
    if (!cat) {
      log('  SKIP', p.handle, 'no category mapping');
      continue;
    }
    todo.push({
      ownerId: p.id,
      namespace: 'custom',
      key: 'gtm_category',
      type: 'single_line_text_field',
      value: cat
    });
    log('  WILL set', p.handle.padEnd(36), '-> gtm_category =', cat);
  }
  if (!todo.length) return { changed: 0 };
  if (!APPLY) return { changed: todo.length };
  // Shopify accepts up to 25 metafields per call; we batch.
  var total = 0;
  for (var j = 0; j < todo.length; j += 25) {
    var batch = todo.slice(j, j + 25);
    var m = 'mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id key value } userErrors { field message } } }';
    var res = await shopify.graphql(m, { metafields: batch });
    if (res.metafieldsSet.userErrors.length) {
      console.error('    ERRORS:', JSON.stringify(res.metafieldsSet.userErrors));
    } else {
      total += res.metafieldsSet.metafields.length;
    }
  }
  console.log('    OK: set', total, 'product metafields');
  return { changed: total };
}

// ------------------------------------------------------------------
// Phase 4: URL redirects (/en/products/X -> /products/X)
// ------------------------------------------------------------------
async function phaseRedirects(products, existing) {
  if (!shouldRun('redirects')) return { skipped: true };
  console.log('\n--- Phase: redirects (/en/products/<handle> -> /products/<handle>) ---');
  var existingPaths = new Set(existing.map(function (r) { return r.path; }));
  var todo = [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p.status !== 'ACTIVE') continue;
    var src = '/en/products/' + p.handle;
    var dst = '/products/' + p.handle;
    if (existingPaths.has(src)) {
      log('  SKIP', src, '(already exists)');
      continue;
    }
    todo.push({ path: src, target: dst });
    log('  WILL create', src, '->', dst);
  }
  // Also add /en/ root redirect, and /en/collections/all if common hreflang target.
  if (!existingPaths.has('/en/')) {
    todo.push({ path: '/en/', target: '/' });
    log('  WILL create /en/ -> /');
  }
  if (!existingPaths.has('/en')) {
    todo.push({ path: '/en', target: '/' });
    log('  WILL create /en -> /');
  }
  if (!APPLY) return { changed: todo.length };
  var total = 0;
  for (var j = 0; j < todo.length; j++) {
    var r = todo[j];
    var m = 'mutation($path: String!, $target: String!) { urlRedirectCreate(urlRedirect: { path: $path, target: $target }) { urlRedirect { id path target } userErrors { field message } } }';
    var res = await shopify.graphql(m, { path: r.path, target: r.target });
    if (res.urlRedirectCreate.userErrors.length) {
      console.error('    ERRORS for', r.path, ':', JSON.stringify(res.urlRedirectCreate.userErrors));
    } else {
      total++;
    }
  }
  console.log('    OK: created', total, 'redirects');
  return { changed: total };
}

// ------------------------------------------------------------------
// Phase 5: translations (sv/nb OralBiome Pro titles)
// ------------------------------------------------------------------
async function phaseTranslations(products) {
  if (!shouldRun('translations')) return { skipped: true };
  console.log('\n--- Phase: translations (sv/nb OralBiome Pro titles) ---');
  var total = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var map = TITLE_TRANSLATIONS[p.handle];
    if (!map) continue;
    // Fetch translatable digest for the title
    var tq = 'query($id: ID!) { translatableResource(resourceId: $id) { translatableContent { key locale value digest } } }';
    var tres = await shopify.graphql(tq, { id: p.id });
    var titleItem = (tres.translatableResource.translatableContent || []).find(function (c) { return c.key === 'title'; });
    if (!titleItem) {
      console.error('  MISS', p.handle, 'no title translatable content found');
      continue;
    }
    for (var locale in map) {
      if (!Object.prototype.hasOwnProperty.call(map, locale)) continue;
      var newValue = map[locale];
      log('  WILL register', p.handle, locale, 'title ->', newValue);
      if (!APPLY) { total++; continue; }
      var m = 'mutation($resourceId: ID!, $translations: [TranslationInput!]!) { translationsRegister(resourceId: $resourceId, translations: $translations) { translations { key locale value } userErrors { field message } } }';
      var res = await shopify.graphql(m, {
        resourceId: p.id,
        translations: [{
          locale: locale,
          key: 'title',
          value: newValue,
          translatableContentDigest: titleItem.digest
        }]
      });
      if (res.translationsRegister.userErrors.length) {
        console.error('    ERRORS:', JSON.stringify(res.translationsRegister.userErrors));
      } else {
        total++;
      }
    }
  }
  console.log('    OK: registered', total, 'translations');
  return { changed: total };
}

// ------------------------------------------------------------------
// Phase 6: Finnish typo fix (bakteerilaijia -> bakteerilajia)
// ------------------------------------------------------------------
async function phaseFiTypo(products) {
  if (!shouldRun('fi-typo')) return { skipped: true };
  console.log('\n--- Phase: fi-typo (bakteerilaijia -> bakteerilajia) ---');
  var total = 0;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    // Look at all FI translations for this product
    var tq = 'query($id: ID!, $locale: String!) { translatableResource(resourceId: $id) { translatableContent { key locale value digest } } translations: translatableResource(resourceId: $id) { translations(locale: $locale) { key locale value } } }';
    var tres = await shopify.graphql(tq, { id: p.id, locale: 'fi' });
    var fiTranslations = (tres.translations && tres.translations.translations) || [];
    var contentMap = {};
    (tres.translatableResource.translatableContent || []).forEach(function (c) { contentMap[c.key] = c; });
    for (var j = 0; j < fiTranslations.length; j++) {
      var t = fiTranslations[j];
      if (!t.value || t.value.indexOf('bakteerilaijia') === -1) continue;
      var fixed = t.value.replace(/bakteerilaijia/g, 'bakteerilajia');
      log('  WILL fix', p.handle, 'fi.' + t.key, '(' + (t.value.length) + ' chars)');
      if (!APPLY) { total++; continue; }
      var digest = contentMap[t.key] && contentMap[t.key].digest;
      if (!digest) {
        console.error('    MISS: no digest for', t.key);
        continue;
      }
      var m = 'mutation($resourceId: ID!, $translations: [TranslationInput!]!) { translationsRegister(resourceId: $resourceId, translations: $translations) { translations { key } userErrors { field message } } }';
      var res = await shopify.graphql(m, {
        resourceId: p.id,
        translations: [{
          locale: 'fi',
          key: t.key,
          value: fixed,
          translatableContentDigest: digest
        }]
      });
      if (res.translationsRegister.userErrors.length) {
        console.error('    ERRORS:', JSON.stringify(res.translationsRegister.userErrors));
      } else {
        total++;
      }
    }
  }
  console.log('    OK: fixed', total, 'fi typos');
  return { changed: total };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log('=== CALQIX multi-locale fix migration ===');
  console.log('Mode:  ' + (APPLY ? 'APPLY (mutations will run)' : 'DRY-RUN (no mutations)'));
  console.log('Phase: ' + PHASE);
  console.log();

  var products = await fetchAllProducts();
  console.log('Fetched ' + products.length + ' products');
  var shopId = await fetchShopId();
  console.log('Shop ID: ' + shopId);
  var existing = await fetchExistingRedirects();
  console.log('Existing redirects: ' + existing.length);

  var results = {
    productType:    await phaseProductType(products),
    shopMeta:       await phaseShopMeta(shopId),
    productMeta:    await phaseProductMeta(products),
    redirects:      await phaseRedirects(products, existing),
    translations:   await phaseTranslations(products),
    fiTypo:         await phaseFiTypo(products)
  };

  console.log('\n=== Summary ===');
  Object.keys(results).forEach(function (k) {
    var r = results[k];
    if (r.skipped) console.log('  ' + k.padEnd(14) + ' : SKIPPED');
    else console.log('  ' + k.padEnd(14) + ' : changed=' + (r.changed || 0));
  });
  if (!APPLY) {
    console.log('\nDRY-RUN complete. Re-run with --apply to mutate.');
  }
}

main().catch(function (err) {
  console.error('[migrate-multi-locale-fix] fatal:', err && err.stack || err);
  process.exit(1);
});
