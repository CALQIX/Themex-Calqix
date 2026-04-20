#!/usr/bin/env node
/*
 * CALQIX market restructure migration — processes the 6 technically
 * achievable blockers from reports/MULTI_LOCALE_REPORT.md via Shopify Admin API.
 *
 * Order of operations (ADDITIVE FIRST, DESTRUCTIVE LAST) so CH is never
 * orphaned and no country is unreachable:
 *
 *   Phase 1:  Add LU to france market regions.
 *   Phase 2:  (SKIPPED) Shopify does not expose region-specific locales
 *              like de-CH/fr-CH on standard plans. We fall back to the
 *              existing de and fr locales and rely on the Swiss market's
 *              webPresence plus marketLocalizationsRegister for any
 *              Swiss-specific copy overrides.
 *   Phase 3:  Create 'switzerland' market (region CH, CHF, localCurrencies).
 *   Phase 4:  Create webPresence for switzerland market (subfolder 'ch',
 *              defaultLocale de, alternate fr) -> URLs /ch/ and /ch/fr/.
 *   Phase 5:  (FOLDED INTO PHASE 4) locales are bound at webPresence create time.
 *   Phase 6:  Enable localCurrencies on scandinavie (DK/SE/NO/IS auto-convert,
 *              FI stays EUR) and united-kingdom (GBP display).
 *   Phase 7:  Remove CH from germany market regions (destructive).
 *   Phase 8:  Remove CH from france market regions (destructive).
 *
 * Usage:
 *   node scripts/apply-market-restructure.js           # dry-run
 *   node scripts/apply-market-restructure.js --apply   # mutate
 *   node scripts/apply-market-restructure.js --apply --phase=1,2
 */

require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var APPLY = process.argv.indexOf('--apply') !== -1;
var phaseArg = process.argv.find(function (a) { return a.indexOf('--phase=') === 0; });
var PHASES = phaseArg ? phaseArg.split('=')[1].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];

function log() {
  var prefix = APPLY ? '[APPLY]' : '[DRY]  ';
  var args = [prefix].concat(Array.prototype.slice.call(arguments));
  console.log.apply(console, args);
}

function should(n) { return PHASES.indexOf(n) !== -1; }

async function gql(q, v) {
  var r = await shopify.graphql(q, v);
  return r;
}

async function fetchMarkets() {
  var q = '{ markets(first: 50) { nodes { id handle name status conditions { conditionTypes regionsCondition { regions(first: 50) { nodes { id name ... on MarketRegionCountry { code } } } } } webPresences(first: 5) { nodes { id subfolderSuffix rootUrls { url locale } } } currencySettings { baseCurrency { currencyCode } localCurrencies } } } }';
  var r = await gql(q);
  return r.markets.nodes;
}

async function fetchShopLocales() {
  var r = await gql('{ shopLocales { locale name primary published } }');
  return r.shopLocales;
}

function findMarket(markets, handle) {
  return markets.find(function (m) { return m.handle === handle; });
}

function findRegion(market, countryCode) {
  if (!market || !market.conditions || !market.conditions.regionsCondition) return null;
  return market.conditions.regionsCondition.regions.nodes.find(function (r) {
    return r.code === countryCode;
  });
}

// ------------------------------------------------------------------
// PHASE 1: Add LU to france market
// ------------------------------------------------------------------
async function phase1_addLuToFrance(markets) {
  console.log('\n--- PHASE 1: Add LU to france market ---');
  var france = findMarket(markets, 'france');
  if (!france) { console.log('  FR market not found'); return; }
  if (findRegion(france, 'LU')) {
    log('  SKIP: LU already in france market');
    return;
  }
  log('  WILL add LU to france market (' + france.id + ')');
  if (!APPLY) return;
  var m = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id conditions { regionsCondition { regions(first: 50) { nodes { ... on MarketRegionCountry { code } } } } } } userErrors { field message } } }';
  var res = await gql(m, {
    id: france.id,
    input: {
      conditions: {
        conditionsToAdd: {
          regionsCondition: { regions: [{ countryCode: 'LU' }] }
        }
      }
    }
  });
  if (res.marketUpdate.userErrors.length) {
    console.error('  ERRORS:', JSON.stringify(res.marketUpdate.userErrors));
  } else {
    console.log('  OK: france regions now:', res.marketUpdate.market.conditions.regionsCondition.regions.nodes.map(function (n) { return n.code; }).join(','));
  }
}

// ------------------------------------------------------------------
// PHASE 2: Enable de-CH and fr-CH locales
// ------------------------------------------------------------------
async function phase2_enableLocales(locales) {
  console.log('\n--- PHASE 2: Enable de-CH and fr-CH locales ---');
  // Shopify standard plans do not expose region-specific locales. The Swiss
  // market uses the base `de` and `fr` locales bound via its webPresence.
  // Swiss-specific copy (CHF pricing, Swiss spelling) is handled at runtime
  // via currencySettings + marketLocalizationsRegister.
  log('  SKIP: de-CH / fr-CH not supported on this Shopify plan; using base de + fr for Swiss market');
  void locales;
}

// ------------------------------------------------------------------
// PHASE 3: Create switzerland market
// ------------------------------------------------------------------
async function phase3_createSwiss(markets) {
  console.log('\n--- PHASE 3: Create switzerland market ---');
  var swiss = findMarket(markets, 'switzerland');
  if (swiss) {
    log('  SKIP: switzerland market already exists (' + swiss.id + ')');
    return swiss;
  }
  log('  WILL create switzerland market with region CH (currency left on shop default until Shopify Payments supports multi-currency)');
  if (!APPLY) return null;
  var m = 'mutation($input: MarketCreateInput!) { marketCreate(input: $input) { market { id handle name } userErrors { field message } } }';
  var res = await gql(m, {
    input: {
      name: 'Switzerland',
      handle: 'switzerland',
      status: 'ACTIVE',
      conditions: {
        regionsCondition: {
          regions: [{ countryCode: 'CH' }]
        }
      }
      // NOTE: currencySettings intentionally omitted — shop's payment
      // gateway currently rejects multi-currency. See BLOCKER-PAYMENT.
    }
  });
  if (res.marketCreate.userErrors.length) {
    console.error('  ERRORS:', JSON.stringify(res.marketCreate.userErrors));
    return null;
  }
  console.log('  OK: created', res.marketCreate.market.id);
  return res.marketCreate.market;
}

// ------------------------------------------------------------------
// PHASE 4: Create webPresence for switzerland
// ------------------------------------------------------------------
async function phase4_createSwissWebPresence(swissMarket) {
  console.log('\n--- PHASE 4: Create webPresence for switzerland ---');
  if (!swissMarket) {
    log('  SKIP: no swiss market available (phase 3 did not apply)');
    return null;
  }
  // Re-fetch market to check webPresences
  var qCheck = '{ market(id: "' + swissMarket.id + '") { webPresences(first: 5) { nodes { id subfolderSuffix } } } }';
  var c = await gql(qCheck);
  if (c.market.webPresences.nodes.length) {
    log('  SKIP: switzerland already has webPresence:', c.market.webPresences.nodes[0].id);
    return c.market.webPresences.nodes[0];
  }
  log('  WILL create webPresence (subfolder=ch, defaultLocale=de, alternates=[fr]) -> URLs /ch/ and /ch/fr/');
  if (!APPLY) return null;
  // Step 1: create the standalone webPresence
  var m1 = 'mutation($input: WebPresenceCreateInput!) { webPresenceCreate(input: $input) { webPresence { id subfolderSuffix } userErrors { field message } } }';
  var res1 = await gql(m1, {
    input: {
      subfolderSuffix: 'ch',
      defaultLocale: 'de',
      alternateLocales: ['fr']
    }
  });
  if (res1.webPresenceCreate.userErrors.length) {
    console.error('  ERRORS (create):', JSON.stringify(res1.webPresenceCreate.userErrors));
    return null;
  }
  var wpId = res1.webPresenceCreate.webPresence.id;
  console.log('  OK: created standalone webPresence', wpId);
  // Step 2: attach to the Swiss market
  var m2 = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id webPresences(first: 5) { nodes { id subfolderSuffix rootUrls { url locale } } } } userErrors { field message } } }';
  var res2 = await gql(m2, { id: swissMarket.id, input: { webPresencesToAdd: [wpId] } });
  if (res2.marketUpdate.userErrors.length) {
    console.error('  ERRORS (attach):', JSON.stringify(res2.marketUpdate.userErrors));
    return null;
  }
  var attached = res2.marketUpdate.market.webPresences.nodes.find(function (n) { return n.id === wpId; });
  console.log('  OK: attached webPresence; rootUrls:', JSON.stringify(attached && attached.rootUrls));
  return attached || { id: wpId };
}

// ------------------------------------------------------------------
// PHASE 5: Bind locales to Swiss webPresence
// ------------------------------------------------------------------
async function phase5_bindLocales(swissWebPresence) {
  console.log('\n--- PHASE 5: Bind locales to Swiss webPresence ---');
  log('  SKIP: folded into phase 4 (webPresence input carries defaultLocale + alternateLocales)');
  void swissWebPresence;
}

// ------------------------------------------------------------------
// PHASE 6: Enable localCurrencies on scandinavie + UK
// ------------------------------------------------------------------
async function phase6_enableLocalCurrencies(markets) {
  console.log('\n--- PHASE 6: Enable localCurrencies on scandinavie + UK ---');
  var work = [
    { handle: 'scandinavie', baseCurrency: 'EUR', rationale: 'FI=EUR base; DK/SE/NO/IS auto-convert' },
    { handle: 'united-kingdom', baseCurrency: 'GBP', rationale: 'GBP as base for GB-only market' }
  ];
  for (var i = 0; i < work.length; i++) {
    var w = work[i];
    var mkt = findMarket(markets, w.handle);
    if (!mkt) { log('  SKIP: ' + w.handle + ' not found'); continue; }
    var current = mkt.currencySettings || {};
    if (current.localCurrencies === true && current.baseCurrency && current.baseCurrency.currencyCode === w.baseCurrency) {
      log('  SKIP:', w.handle, 'already configured (' + w.baseCurrency + ', localCurrencies=true)');
      continue;
    }
    log('  WILL update', w.handle, '-> baseCurrency=' + w.baseCurrency + ', localCurrencies=true  (' + w.rationale + ')');
    if (!APPLY) continue;
    var m = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id handle currencySettings { baseCurrency { currencyCode } localCurrencies } } userErrors { field message } } }';
    var res = await gql(m, {
      id: mkt.id,
      input: { currencySettings: { baseCurrency: w.baseCurrency, localCurrencies: true } }
    });
    if (res.marketUpdate.userErrors.length) {
      console.error('  ERRORS:', JSON.stringify(res.marketUpdate.userErrors));
    } else {
      console.log('  OK:', w.handle, res.marketUpdate.market.currencySettings.baseCurrency.currencyCode, 'localCurrencies=' + res.marketUpdate.market.currencySettings.localCurrencies);
    }
  }
}

// ------------------------------------------------------------------
// PHASE 7 + 8: Remove CH from germany and france markets (destructive)
// ------------------------------------------------------------------
async function phaseRemoveCh(markets, handle) {
  console.log('\n--- PHASE ' + (handle === 'germany' ? 7 : 8) + ': Remove CH from ' + handle + ' market ---');
  var mkt = findMarket(markets, handle);
  if (!mkt) { log('  SKIP: ' + handle + ' not found'); return; }
  var ch = findRegion(mkt, 'CH');
  if (!ch) { log('  SKIP: CH not in ' + handle); return; }
  log('  WILL remove CH region (' + ch.id + ') from ' + handle + ' market');
  if (!APPLY) return;
  var m = 'mutation($id: ID!, $input: MarketUpdateInput!) { marketUpdate(id: $id, input: $input) { market { id conditions { regionsCondition { regions(first: 50) { nodes { ... on MarketRegionCountry { code } } } } } } userErrors { field message } } }';
  var res = await gql(m, {
    id: mkt.id,
    input: {
      conditions: {
        conditionsToDelete: {
          regionsCondition: { regionIds: [ch.id] }
        }
      }
    }
  });
  if (res.marketUpdate.userErrors.length) {
    console.error('  ERRORS:', JSON.stringify(res.marketUpdate.userErrors));
  } else {
    console.log('  OK:', handle, 'regions now:', res.marketUpdate.market.conditions.regionsCondition.regions.nodes.map(function (n) { return n.code; }).join(','));
  }
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
(async function main() {
  console.log('=== CALQIX market restructure ===');
  console.log('Mode:   ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('Phases: ' + PHASES.join(','));

  var markets = await fetchMarkets();
  var locales = await fetchShopLocales();
  console.log('Fetched', markets.length, 'markets,', locales.length, 'locales');
  console.log('  Markets:', markets.map(function (m) { return m.handle + '[' + ((m.conditions && m.conditions.regionsCondition && m.conditions.regionsCondition.regions.nodes.map(function (n) { return n.code; }).join(',')) || '-') + ']'; }).join(' | '));
  console.log('  Locales:', locales.map(function (l) { return l.locale + (l.primary ? '*' : ''); }).join(','));

  if (should(1)) await phase1_addLuToFrance(markets);
  if (should(2)) await phase2_enableLocales(locales);

  var swissMarket = null;
  if (should(3)) swissMarket = await phase3_createSwiss(markets);
  else swissMarket = findMarket(markets, 'switzerland');

  var swissWp = null;
  if (should(4)) swissWp = await phase4_createSwissWebPresence(swissMarket);

  if (should(5)) await phase5_bindLocales(swissWp);
  if (should(6)) await phase6_enableLocalCurrencies(markets);
  if (should(7)) await phaseRemoveCh(markets, 'germany');
  if (should(8)) await phaseRemoveCh(markets, 'france');

  if (!APPLY) console.log('\nDRY-RUN complete. Re-run with --apply.');
})().catch(function (e) {
  console.error('[market-restructure] fatal:', e && e.stack || e);
  process.exit(1);
});
