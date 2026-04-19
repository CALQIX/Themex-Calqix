#!/usr/bin/env node
/*
 * Verify SHOPIFY_ADMIN_ACCESS_TOKEN after re-authorizing the
 * "CALQIX Windsurf Integration" custom app.
 *
 * Checks:
 *   1. Token is present in env.
 *   2. Token authenticates against Shopify Admin GraphQL (shop { name }).
 *   3. All required scopes from shopify.app.toml are actually granted.
 *   4. Markets API is readable (proves write_markets scope was accepted).
 *
 * Usage:
 *   # from calqix-capi/
 *   node scripts/verify-shopify-token.js
 *
 *   # with a token passed directly (skips .env):
 *   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx node scripts/verify-shopify-token.js
 *
 * Required env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN.
 */

require('dotenv').config();
const shopify = require('../lib/shopify-admin');

const REQUIRED_SCOPES = [
  'read_products',
  'read_orders',
  'read_markets',
  'write_markets',
  'read_shipping',
  'write_shipping',
  'read_locales',
  'write_locales'
];

async function checkConnection() {
  console.log('\n1. Basic connection');
  const data = await shopify.graphql('{ shop { name primaryDomain { host } } }');
  if (!data || !data.shop) throw new Error('no shop data');
  console.log('   ok — shop: ' + data.shop.name + ' (' + data.shop.primaryDomain.host + ')');
}

async function checkScopes() {
  console.log('\n2. Granted access scopes');
  const data = await shopify.graphql(
    '{ currentAppInstallation { accessScopes { handle } } }'
  );
  const granted = (data.currentAppInstallation.accessScopes || []).map(
    function (s) { return s.handle; }
  );
  const missing = REQUIRED_SCOPES.filter(function (s) {
    return granted.indexOf(s) === -1;
  });
  console.log('   granted: ' + granted.join(', '));
  if (missing.length) {
    console.log('   MISSING: ' + missing.join(', '));
    throw new Error(
      'token does not have all required scopes — reinstall the app in Shopify Admin'
    );
  }
  console.log('   ok — all ' + REQUIRED_SCOPES.length + ' required scopes granted');
}

async function checkMarketsApi() {
  console.log('\n3. Markets API read');
  const data = await shopify.graphql(
    '{ markets(first: 20) { edges { node { id name enabled primary regions(first: 50) { edges { node { ... on MarketRegionCountry { code } } } } } } } }'
  );
  const markets = (data.markets.edges || []).map(function (e) { return e.node; });
  console.log('   markets found: ' + markets.length);
  markets.forEach(function (m) {
    const countries = (m.regions.edges || [])
      .map(function (r) { return r.node && r.node.code; })
      .filter(Boolean);
    console.log(
      '     - ' + m.name +
      (m.primary ? ' (primary)' : '') +
      ' · enabled=' + m.enabled +
      ' · countries=[' + countries.join(',') + ']'
    );
  });
  console.log('   ok — Markets API readable');
}

async function checkLocales() {
  console.log('\n4. Locales read');
  const data = await shopify.graphql(
    '{ shopLocales { locale name primary published } }'
  );
  const locales = data.shopLocales || [];
  console.log('   locales: ' + locales.map(function (l) {
    return l.locale + (l.primary ? '(primary)' : l.published ? '' : '(unpublished)');
  }).join(', '));
  console.log('   ok — Locales readable');
}

async function main() {
  console.log('CALQIX Shopify token verification');
  console.log('=================================');
  console.log('Store:  ' + (process.env.SHOPIFY_STORE_DOMAIN || '(not set)'));
  console.log('Token:  ' + (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
    ? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.slice(0, 10) + '***'
    : '(not set)'));

  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('\nFAIL — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in .env first.');
    process.exit(1);
  }

  try {
    await checkConnection();
    await checkScopes();
    await checkMarketsApi();
    await checkLocales();
    console.log('\n=================================');
    console.log('ALL CHECKS PASSED — token is healthy.');
    console.log('Note: since lib/shopify-admin.js now auto-refreshes on 401 via OAuth');
    console.log('      client_credentials, token rotation is fully automatic.');
    console.log('      Run `npm run test:selfheal` to exercise all 3 recovery paths.');
  } catch (err) {
    console.error('\n=================================');
    console.error('FAIL — ' + err.message);
    console.error('\nTroubleshooting:');
    console.error('  - 401/invalid token: reinstall the app in Shopify Admin → Develop apps.');
    console.error('  - 403 on a scope: open Configuration → Admin API scopes, add the missing scope, Save, then reinstall.');
    console.error('  - The old token is invalidated the moment a new one is generated.');
    process.exit(1);
  }
}

main();
