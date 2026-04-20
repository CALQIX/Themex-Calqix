/*
 * Split Norway out of the scandinavie market into its own `norway` market
 * with NOK as base currency, so Norwegian product pages display NOK prices
 * (not EUR auto-converted).
 *
 * Why: when NOK is not in the shop's payment gateway accepted currencies,
 * putting NO in a multi-country market with localCurrencies=true silently
 * falls back to EUR. Forcing NOK as the BASE currency of a dedicated
 * single-country market auto-registers NOK in the shop's enabled
 * presentment currencies AND makes the product page display leading.
 *
 * Idempotent: safe to re-run; skips steps already done.
 *
 * Usage: node scripts/split-norway-from-scandinavie.js
 */

require('dotenv').config();
var shopify = require('../lib/shopify-admin');

(async function () {
  // 1. Fetch current markets
  var q = '{ markets(first:50){ nodes{ id handle conditions{ regionsCondition{ regions(first:50){ nodes{ id ... on MarketRegionCountry { code } } } } } } } }';
  var mr = await shopify.graphql(q);
  var scandi = mr.markets.nodes.find(function (n) { return n.handle === 'scandinavie'; });
  var existingNorway = mr.markets.nodes.find(function (n) { return n.handle === 'norway'; });

  if (existingNorway) {
    console.log('norway market already exists:', existingNorway.id);
  } else {
    // 2. Create norway market
    console.log('Creating norway market with NOK base...');
    var mCreate = 'mutation($input: MarketCreateInput!) { marketCreate(input: $input) { market { id handle currencySettings { baseCurrency { currencyCode enabled } } } userErrors { field message } } }';
    var rCreate = await shopify.graphql(mCreate, {
      input: {
        name: 'Norway',
        handle: 'norway',
        status: 'ACTIVE',
        conditions: { regionsCondition: { regions: [{ countryCode: 'NO' }] } },
        currencySettings: { baseCurrency: 'NOK', localCurrencies: false }
      }
    });
    if (rCreate.marketCreate.userErrors.length) {
      console.error('CREATE ERRORS:', JSON.stringify(rCreate.marketCreate.userErrors, null, 2));
      console.log('\nFalling back: try without currencySettings, then set currency in separate step');
      var rCreate2 = await shopify.graphql(mCreate, {
        input: {
          name: 'Norway',
          handle: 'norway',
          status: 'ACTIVE',
          conditions: { regionsCondition: { regions: [{ countryCode: 'NO' }] } }
        }
      });
      if (rCreate2.marketCreate.userErrors.length) {
        console.error('CREATE-NO-CURRENCY ERRORS:', JSON.stringify(rCreate2.marketCreate.userErrors));
        return;
      }
      existingNorway = rCreate2.marketCreate.market;
      console.log('Created norway (no currency):', existingNorway.id);

      // Try to set NOK after creation
      var mUpd = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id currencySettings { baseCurrency { currencyCode enabled } localCurrencies } } userErrors { field message } } }';
      var rUpd = await shopify.graphql(mUpd, {
        id: existingNorway.id,
        input: { currencySettings: { baseCurrency: 'NOK', localCurrencies: false } }
      });
      if (rUpd.marketUpdate.userErrors.length) {
        console.error('SET-NOK ERRORS:', JSON.stringify(rUpd.marketUpdate.userErrors));
      } else {
        console.log('NOK set on norway:', JSON.stringify(rUpd.marketUpdate.market.currencySettings));
      }
    } else {
      existingNorway = rCreate.marketCreate.market;
      console.log('Created norway with NOK:', JSON.stringify(rCreate.marketCreate.market));
    }
  }

  // 3. Remove NO from scandinavie
  if (scandi) {
    var noRegion = scandi.conditions.regionsCondition.regions.nodes.find(function (n) { return n.code === 'NO'; });
    if (noRegion) {
      console.log('\nRemoving NO from scandinavie (regionId=' + noRegion.id + ')...');
      var mDel = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id conditions { regionsCondition { regions(first: 50) { nodes { ... on MarketRegionCountry { code } } } } } } userErrors { field message } } }';
      var rDel = await shopify.graphql(mDel, {
        id: scandi.id,
        input: { conditions: { conditionsToDelete: { regionsCondition: { regionIds: [noRegion.id] } } } }
      });
      if (rDel.marketUpdate.userErrors.length) {
        console.error('  REMOVE ERRORS:', JSON.stringify(rDel.marketUpdate.userErrors));
      } else {
        console.log('  scandinavie regions now:', rDel.marketUpdate.market.conditions.regionsCondition.regions.nodes.map(function (n) { return n.code; }).join(','));
      }
    } else {
      console.log('\nNO already not in scandinavie, skipping removal');
    }
  }

  // 4. Final state
  console.log('\n=== Final state ===');
  var r2 = await shopify.graphql('{ shop { enabledPresentmentCurrencies } markets(first:50){ nodes{ handle currencySettings{ baseCurrency{ currencyCode enabled } localCurrencies } conditions{ regionsCondition{ regions(first:50){ nodes{ ... on MarketRegionCountry { code } } } } } } } }');
  console.log('Shop enabled:', r2.shop.enabledPresentmentCurrencies.join(', '));
  r2.markets.nodes.forEach(function (m) {
    var cs = m.currencySettings || {};
    var bc = cs.baseCurrency ? cs.baseCurrency.currencyCode + '(en=' + cs.baseCurrency.enabled + ')' : '(none)';
    var regions = (m.conditions && m.conditions.regionsCondition && m.conditions.regionsCondition.regions.nodes.map(function (n) { return n.code; }).join(',')) || '-';
    console.log('  ' + m.handle.padEnd(16) + ' [' + regions + ']  base=' + bc.padEnd(20) + ' local=' + cs.localCurrencies);
  });
})().catch(function (e) { console.error('fatal:', e && e.stack || e); process.exit(1); });
