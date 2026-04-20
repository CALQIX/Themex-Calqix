#!/usr/bin/env node
/* Summarize the discovery report for quick human review. */
var fs = require('fs');
var path = require('path');

var input = path.resolve(__dirname, '..', '..', 'reports', 'discovery-multi-locale.json');
var raw = fs.readFileSync(input, 'utf8');
// Strip any non-JSON preamble (stdout log leakage from lib/store.js on cold start).
var firstBrace = raw.indexOf('{');
if (firstBrace > 0) raw = raw.slice(firstBrace);
var j = JSON.parse(raw);

console.log('=== PRODUCTS (' + j.products.length + ') ===');
j.products.forEach(function (p) {
  var pubs = p.resourcePublications.nodes.map(function (n) { return n.publication.name; }).join(', ');
  var mfs = p.metafields.nodes.map(function (m) { return m.namespace + '.' + m.key + '=' + String(m.value).slice(0, 40); }).join(' | ');
  console.log('  ' + p.handle.padEnd(36) + ' | ' + p.status.padEnd(8) + ' | type=' + (p.productType || '(none)').padEnd(20) + ' | id=' + p.id.replace('gid://shopify/Product/', ''));
  console.log('    pubs: ' + pubs);
  if (mfs) console.log('    metafields: ' + mfs);
});

console.log('\n=== MARKETS (' + j.markets.length + ') ===');
j.markets.forEach(function (m) {
  var cur = m.currencySettings && m.currencySettings.baseCurrency ? m.currencySettings.baseCurrency.currencyCode : '(none)';
  var countries = m.regions.nodes.map(function (r) { return r.code; }).join(',');
  console.log('  ' + m.handle.padEnd(18) + ' | ' + m.name.padEnd(22) + ' | enabled=' + m.enabled + ' primary=' + m.primary + ' | cur=' + cur + ' | countries=[' + countries + ']');
  m.webPresences.nodes.forEach(function (wp, idx) {
    var def = wp.defaultLocale ? wp.defaultLocale.locale : '(none)';
    var alts = (wp.alternateLocales || []).map(function (a) { return a.locale; }).join(',');
    var host = wp.domain ? wp.domain.host : '(none)';
    console.log('    webPresence[' + idx + ']: subfolder=' + (wp.subfolderSuffix || '(null)') + ' default=' + def + ' alts=[' + alts + '] host=' + host);
    (wp.rootUrls || []).forEach(function (r) {
      console.log('       ' + r.locale.padEnd(4) + ' -> ' + r.url);
    });
  });
});

console.log('\n=== LOCALES ===');
j.locales.forEach(function (l) {
  console.log('  ' + l.locale.padEnd(6) + ' | ' + l.name.padEnd(22) + ' | primary=' + l.primary + ' | published=' + l.published);
});

console.log('\n=== PUBLICATIONS (' + j.publications.length + ') ===');
j.publications.forEach(function (p) {
  console.log('  ' + p.id.replace('gid://shopify/Publication/', '').padEnd(14) + ' | ' + p.name);
});

console.log('\n=== DELIVERY / SHIPPING ZONES ===');
if (j.deliveryProfiles && j.deliveryProfiles.error) {
  console.log('  ERROR (schema): ' + j.deliveryProfiles.error);
} else if (j.deliveryProfiles) {
  (j.deliveryProfiles || []).forEach(function (p) {
    console.log('  Profile: ' + p.name + ' (default=' + p.default + ')');
    (p.profileLocationGroups || []).forEach(function (g) {
      (g.locationGroupZones.nodes || []).forEach(function (z) {
        var countries = (z.zone.countries || []).map(function (c) {
          if (c.code && c.code.restOfWorld) return 'ROW';
          return c.code && c.code.countryCode ? c.code.countryCode : '?';
        }).join(',');
        console.log('    - Zone: ' + z.zone.name + ' | countries=[' + countries + '] | rates=' + (z.methodDefinitionCounts ? z.methodDefinitionCounts.rateDefinitionsCount : '?'));
      });
    });
  });
}

console.log('\n=== URL REDIRECTS (' + (j.urlRedirects.length || 0) + ') ===');
(j.urlRedirects || []).slice(0, 15).forEach(function (r) {
  console.log('  ' + r.path + ' -> ' + r.target);
});

console.log('\n=== SHOP ===');
console.log('  ' + j.shop.shop.name + ' @ ' + j.shop.shop.primaryDomain.host);
