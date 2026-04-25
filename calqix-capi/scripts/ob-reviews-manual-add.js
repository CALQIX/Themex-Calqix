/**
 * One-shot: prepend hand-crafted reviews to all OralBiome Pro flavor
 * products' `calqix.ob_extra_reviews` metafield.
 *
 * Used when the daily QStash cron has missed days or when the operator
 * wants to add specific dated reviews. Idempotent: matches on (n, t, d)
 * to skip duplicates.
 *
 * Run:
 *   node scripts/ob-reviews-manual-add.js
 *
 * Edit the REVIEWS_TO_ADD array below to change the payload.
 */
'use strict';

require('dotenv').config();

var shopifyAdmin = require('../lib/shopify-admin');

// --- payload ------------------------------------------------------------

// Yesterday in Amsterdam time. Adjust if you re-run later.
var YESTERDAY = '2026-04-24';

var REVIEWS_TO_ADD = [
  {
    n: 'Saskia M.',
    cc: 'NL',
    co: 'Netherlands',
    r: 5,
    t: 'Bloedend tandvlees na zes weken weg',
    b: 'Begonnen na een vervelende afspraak bij de mondhygiënist — bloedend tandvlees bij elke flossbeurt. Na ruim zes weken trouw één tabletje voor het slapen is dat helemaal verdwenen. Smaak is mild, geen rare nasmaak. Past prima na poetsen en flossen, daarna direct naar bed.',
    tg: ['gum_health'],
    d: YESTERDAY
  },
  {
    n: 'Linnea K.',
    cc: 'SE',
    co: 'Sweden',
    r: 5,
    t: 'Min man märkte skillnaden först',
    b: 'Min man var faktiskt den första som kommenterade — mindre morgonandedräkt efter ungefär fyra veckor. En tablett varje kväll efter tandborstning, smälter på två minuter. Mild mintsmak, inget medicinaktigt. Stannar kvar på prenumerationen, levereras smidigt varje månad.',
    tg: ['fresh_breath', 'subscription'],
    d: YESTERDAY
  }
];

// --- target products ----------------------------------------------------

var PRODUCT_HANDLES = [
  'oralbiome-pro-freshmint',
  'oralbiome-pro-cool-mint',
  'oralbiome-pro-citrus-orange',
  'oralbiome-pro-peach',
  'oralbiome-pro-grape'
];

var METAFIELD_NAMESPACE = 'calqix';
var METAFIELD_KEY = 'ob_extra_reviews';
var MAX_METAFIELD_ENTRIES = 200;

// --- helpers ------------------------------------------------------------

async function resolveProductGid(handle) {
  var q = 'query($h: String!) { productByHandle(handle: $h) { id handle } }';
  var d = await shopifyAdmin.graphql(q, { h: handle });
  if (d && d.productByHandle && d.productByHandle.id) {
    return { gid: d.productByHandle.id, handle: d.productByHandle.handle };
  }
  return null;
}

async function fetchExisting(gid) {
  var q = 'query($id: ID!, $ns: String!, $key: String!) {' +
    ' product(id: $id) { metafield(namespace: $ns, key: $key) { value } } }';
  var d = await shopifyAdmin.graphql(q, {
    id: gid, ns: METAFIELD_NAMESPACE, key: METAFIELD_KEY
  });
  var raw = d && d.product && d.product.metafield && d.product.metafield.value;
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('  existing metafield not valid JSON, starting fresh');
    return [];
  }
}

async function writeExtras(gid, arr) {
  var m = 'mutation($m: [MetafieldsSetInput!]!) {' +
    ' metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }';
  var v = {
    m: [{
      ownerId: gid,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: 'json_string',
      value: JSON.stringify(arr)
    }]
  };
  var d = await shopifyAdmin.graphql(m, v);
  var errs = d && d.metafieldsSet && d.metafieldsSet.userErrors;
  if (errs && errs.length) {
    throw new Error('metafieldsSet errors: ' + JSON.stringify(errs));
  }
}

function alreadyPresent(arr, payload) {
  for (var i = 0; i < arr.length; i++) {
    var r = arr[i];
    if (!r) continue;
    if (r.n === payload.n && r.t === payload.t && r.d === payload.d) return true;
  }
  return false;
}

function nextIdAfter(arr, base) {
  var maxId = base;
  for (var i = 0; i < arr.length; i++) {
    var r = arr[i];
    if (r && typeof r.id === 'number' && r.id > maxId) maxId = r.id;
  }
  return maxId + 1;
}

// --- main ---------------------------------------------------------------

(async function main() {
  console.log('=== OB Reviews Manual Add ===');
  console.log('Date:', YESTERDAY, '(yesterday Amsterdam)');
  console.log('Reviews to add:', REVIEWS_TO_ADD.length);
  console.log('Target products:', PRODUCT_HANDLES.length);
  console.log('');

  var resolved = [];
  for (var i = 0; i < PRODUCT_HANDLES.length; i++) {
    try {
      var p = await resolveProductGid(PRODUCT_HANDLES[i]);
      if (p) {
        resolved.push(p);
        console.log('Resolved:', p.handle, '->', p.gid);
      } else {
        console.warn('NOT FOUND:', PRODUCT_HANDLES[i]);
      }
    } catch (e) {
      console.error('Resolve failed:', PRODUCT_HANDLES[i], e.message);
    }
  }
  if (!resolved.length) {
    console.error('No products resolved — aborting.');
    process.exit(1);
  }

  var totalAdded = 0;
  var totalSkipped = 0;

  for (var j = 0; j < resolved.length; j++) {
    var prod = resolved[j];
    console.log('\n--- ' + prod.handle + ' ---');

    var existing;
    try {
      existing = await fetchExisting(prod.gid);
      console.log('  existing extras:', existing.length);
    } catch (e) {
      console.error('  fetch failed:', e.message);
      continue;
    }

    var nextId = nextIdAfter(existing, 120);
    var newEntries = [];
    for (var k = 0; k < REVIEWS_TO_ADD.length; k++) {
      var src = REVIEWS_TO_ADD[k];
      if (alreadyPresent(existing, src)) {
        console.log('  SKIP (already present):', src.n, '-', src.t);
        totalSkipped++;
        continue;
      }
      newEntries.push({
        id: nextId++,
        n: src.n,
        cc: src.cc,
        co: src.co,
        r: src.r,
        t: src.t,
        b: src.b,
        tg: src.tg.slice(),
        d: src.d
      });
    }

    if (!newEntries.length) {
      console.log('  nothing to add for this product');
      continue;
    }

    var merged = newEntries.concat(existing);
    if (merged.length > MAX_METAFIELD_ENTRIES) {
      merged = merged.slice(0, MAX_METAFIELD_ENTRIES);
    }

    try {
      await writeExtras(prod.gid, merged);
      console.log('  WROTE +' + newEntries.length + ' (total now ' + merged.length + ')');
      totalAdded += newEntries.length;
    } catch (e) {
      console.error('  write failed:', e.message);
    }
  }

  console.log('\n=== DONE ===');
  console.log('Added:  ', totalAdded);
  console.log('Skipped:', totalSkipped, '(idempotent — already present)');
})().catch(function (e) {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
