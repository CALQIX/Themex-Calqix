/**
 * Quick check: compare calqix_* keys between en.default.json and sv/nb/da/fi
 * Also checks all non-calqix keys used on product pages.
 */
var fs = require('fs');
var path = require('path');

var localeDir = path.join(__dirname, '..', '..', 'locales');

// Strip comments (the en.default.json may have JS-style comments)
function loadJson(file) {
  var raw = fs.readFileSync(path.join(localeDir, file), 'utf8');
  // Remove single-line comments
  raw = raw.replace(/\/\/.*$/gm, '');
  // Remove block comments
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(raw);
}

function getKeys(obj, prefix) {
  var keys = [];
  for (var k in obj) {
    var fullKey = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      keys = keys.concat(getKeys(obj[k], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

var en = loadJson('en.default.json');
var enKeys = getKeys(en, '');

// All calqix_* keys
var calqixKeys = enKeys.filter(function(k) { return k.indexOf('calqix_') === 0; });

// Also check critical product-page keys
var productKeys = enKeys.filter(function(k) {
  return k.indexOf('products.product.') === 0
    || k.indexOf('products.general.') === 0
    || k.indexOf('cart.') === 0
    || k.indexOf('sections.header.') === 0
    || k.indexOf('sections.announcement') === 0;
});

var checkKeys = calqixKeys.concat(productKeys);

console.log('EN total keys: ' + enKeys.length);
console.log('EN calqix_* keys: ' + calqixKeys.length);
console.log('EN product-page keys: ' + productKeys.length);
console.log('Checking: ' + checkKeys.length + ' keys across sv, nb, da, fi\n');

var locales = ['sv', 'nb', 'da', 'fi'];
var allMissing = {};

locales.forEach(function(loc) {
  var data = loadJson(loc + '.json');
  var lKeys = getKeys(data, '');
  var missing = checkKeys.filter(function(k) { return lKeys.indexOf(k) === -1; });
  var calqixCount = lKeys.filter(function(k) { return k.indexOf('calqix_') === 0; }).length;

  console.log('--- ' + loc.toUpperCase() + ' ---');
  console.log('  calqix_* keys: ' + calqixCount + '/' + calqixKeys.length);
  console.log('  Missing: ' + missing.length);

  if (missing.length > 0) {
    allMissing[loc] = missing;
    missing.forEach(function(m) {
      console.log('    MISSING: ' + m);
    });
  }
  console.log('');
});

// Summary
var totalMissing = 0;
locales.forEach(function(loc) {
  totalMissing += (allMissing[loc] || []).length;
});

if (totalMissing === 0) {
  console.log('ALL KEYS PRESENT in all 4 Scandinavian locales.');
} else {
  console.log('TOTAL MISSING: ' + totalMissing + ' keys across all locales.');
}
