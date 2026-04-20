#!/usr/bin/env node
/*
 * Single-pass read-only discovery for the multi-locale fix work.
 *
 * Dumps to stdout (and optionally to a JSON file) the full state of:
 *   - Products (id, handle, title, status, productType, vendor, publications, metafields)
 *   - Markets (handle, name, enabled, primary, currencySettings, webPresences, regions)
 *   - Shop locales (published / primary)
 *   - Publications (id, name, catalog)
 *   - Delivery profiles + shipping zones per profile
 *   - URL redirects (first 250)
 *
 * Usage:
 *   node scripts/discovery-multi-locale.js > ../reports/discovery-multi-locale.json
 */

require('dotenv').config();
var shopify = require('../lib/shopify-admin');

async function main() {
  var out = {};

  // --- Products (paginate up to 100; site currently has ~a handful) ---
  var productsQuery = '{\n' +
    '  products(first: 100) {\n' +
    '    nodes {\n' +
    '      id\n' +
    '      handle\n' +
    '      title\n' +
    '      status\n' +
    '      productType\n' +
    '      vendor\n' +
    '      createdAt\n' +
    '      updatedAt\n' +
    '      publishedAt\n' +
    '      resourcePublications(first: 20) { nodes { publication { id name catalog { id title } } } }\n' +
    '      metafields(first: 30) { nodes { namespace key type value } }\n' +
    '      variants(first: 5) { nodes { id price compareAtPrice sku availableForSale } }\n' +
    '    }\n' +
    '  }\n' +
    '}\n';
  out.products = (await shopify.graphql(productsQuery)).products.nodes;

  // --- Markets with web presences, regions, currency ---
  var marketsQuery = '{\n' +
    '  markets(first: 50) {\n' +
    '    nodes {\n' +
    '      id\n' +
    '      handle\n' +
    '      name\n' +
    '      enabled\n' +
    '      primary\n' +
    '      currencySettings { baseCurrency { currencyCode } localCurrencies }\n' +
    '      webPresences(first: 5) {\n' +
    '        nodes {\n' +
    '          defaultLocale { locale name primary published }\n' +
    '          alternateLocales { locale name published }\n' +
    '          subfolderSuffix\n' +
    '          rootUrls { locale url }\n' +
    '          domain { host }\n' +
    '        }\n' +
    '      }\n' +
    '      regions(first: 50) {\n' +
    '        nodes { ... on MarketRegionCountry { id name code } }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}\n';
  out.markets = (await shopify.graphql(marketsQuery)).markets.nodes;

  // --- Shop locales ---
  var localesQuery = '{ shopLocales { locale name primary published } }';
  out.locales = (await shopify.graphql(localesQuery)).shopLocales;

  // --- Publications ---
  var publicationsQuery = '{\n' +
    '  publications(first: 50) {\n' +
    '    nodes { id name catalog { id title } }\n' +
    '  }\n' +
    '}\n';
  out.publications = (await shopify.graphql(publicationsQuery)).publications.nodes;

  // --- Delivery profiles + zones (to understand shipping coverage) ---
  var deliveryQuery = '{\n' +
    '  deliveryProfiles(first: 20) {\n' +
    '    nodes {\n' +
    '      id\n' +
    '      name\n' +
    '      default\n' +
    '      profileLocationGroups {\n' +
    '        locationGroup { id locations(first: 5) { nodes { id name } } }\n' +
    '        locationGroupZones(first: 50) {\n' +
    '          nodes {\n' +
    '            zone {\n' +
    '              id\n' +
    '              name\n' +
    '              countries { id code { countryCode restOfWorld } name provinces { code name } }\n' +
    '            }\n' +
    '            methodDefinitionCounts { participantDefinitionsCount rateDefinitionsCount }\n' +
    '          }\n' +
    '        }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}\n';
  try {
    out.deliveryProfiles = (await shopify.graphql(deliveryQuery)).deliveryProfiles.nodes;
  } catch (e) {
    out.deliveryProfiles = { error: e.message };
  }

  // --- URL redirects (first page) ---
  var redirectsQuery = '{\n' +
    '  urlRedirects(first: 250) {\n' +
    '    nodes { id path target }\n' +
    '  }\n' +
    '}\n';
  try {
    out.urlRedirects = (await shopify.graphql(redirectsQuery)).urlRedirects.nodes;
  } catch (e) {
    out.urlRedirects = { error: e.message };
  }

  // --- Shop metafield: custom.guarantee_days (for step 6 prep) ---
  var shopMetaQuery = '{\n' +
    '  shop { id name primaryDomain { host } }\n' +
    '  currentAppInstallation { id }\n' +
    '}\n';
  out.shop = await shopify.graphql(shopMetaQuery);

  console.log(JSON.stringify(out, null, 2));
}

main().catch(function (err) {
  console.error('[discovery-multi-locale] fatal:', err.message);
  process.exit(1);
});
