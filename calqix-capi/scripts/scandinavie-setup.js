/**
 * Scandinavie Market Setup Script
 * 
 * Executes FASE 4 from the runbook:
 * - 4.1: Inventory current markets (already done)
 * - 4.2: Create Scandinavie market (SE, NO, DK, FI, IS)
 * - 4.3: Enable locales (sv, nb, da, fi)
 * - 4.4: Check shipping profiles
 * - 4.5: Check currencies
 * - 4.6: Update MARKET_LANGUAGE_MAP (done separately in code)
 *
 * Run: node scripts/scandinavie-setup.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');

var results = {
  market: null,
  locales: [],
  shipping: null,
  currencies: null,
  errors: []
};

async function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// 4.2: Create Scandinavie market
async function createMarket() {
  console.log('\n=== STAP 4.2: Scandinavie markt aanmaken ===\n');
  try {
    var r = await shopify.graphql(
      'mutation marketCreate($input: MarketCreateInput!) { ' +
      '  marketCreate(input: $input) { ' +
      '    market { id name enabled regions(first: 10) { edges { node { ... on MarketRegionCountry { code name } } } } } ' +
      '    userErrors { field message } ' +
      '  } ' +
      '}',
      {
        input: {
          name: "Scandinavie",
          enabled: false,
          regions: [
            { countryCode: "SE" },
            { countryCode: "NO" },
            { countryCode: "DK" },
            { countryCode: "FI" },
            { countryCode: "IS" }
          ]
        }
      }
    );

    if (r.marketCreate.userErrors && r.marketCreate.userErrors.length > 0) {
      console.error('UserErrors:', JSON.stringify(r.marketCreate.userErrors, null, 2));
      results.errors.push({ step: 'market', errors: r.marketCreate.userErrors });
      results.market = { ok: false, errors: r.marketCreate.userErrors };
    } else {
      var m = r.marketCreate.market;
      var countries = m.regions.edges.map(function (e) { return e.node.code; });
      console.log('Markt aangemaakt:', m.name, '| ID:', m.id);
      console.log('Landen:', countries.join(', '));
      console.log('Enabled:', m.enabled);
      results.market = { ok: true, id: m.id, name: m.name, countries: countries };
    }
  } catch (err) {
    console.error('FOUT bij markt aanmaken:', err.message);
    results.errors.push({ step: 'market', error: err.message });
    results.market = { ok: false, error: err.message };
  }
}

// 4.3: Enable locales
async function enableLocales() {
  console.log('\n=== STAP 4.3: Locales activeren ===\n');
  var locales = ['sv', 'nb', 'da', 'fi'];

  for (var i = 0; i < locales.length; i++) {
    var locale = locales[i];
    try {
      var r = await shopify.graphql(
        'mutation shopLocaleEnable($locale: String!) { ' +
        '  shopLocaleEnable(locale: $locale) { ' +
        '    shopLocale { locale name published } ' +
        '    userErrors { field message } ' +
        '  } ' +
        '}',
        { locale: locale }
      );

      if (r.shopLocaleEnable.userErrors && r.shopLocaleEnable.userErrors.length > 0) {
        console.log(locale + ': FOUT -', JSON.stringify(r.shopLocaleEnable.userErrors));
        results.locales.push({ locale: locale, ok: false, errors: r.shopLocaleEnable.userErrors });
      } else {
        var sl = r.shopLocaleEnable.shopLocale;
        console.log(locale + ': OK -', sl.name, '| published:', sl.published);
        results.locales.push({ locale: locale, ok: true, name: sl.name, published: sl.published });
      }
    } catch (err) {
      console.log(locale + ': FOUT -', err.message);
      results.locales.push({ locale: locale, ok: false, error: err.message });
      results.errors.push({ step: 'locale_' + locale, error: err.message });
    }
    await sleep(500);
  }
}

// 4.4: Check shipping profiles
async function checkShipping() {
  console.log('\n=== STAP 4.4: Verzendprofielen ===\n');
  try {
    var r = await shopify.graphql(
      '{ deliveryProfiles(first: 5) { edges { node { id name profileLocationGroups { ' +
      '  locationGroupZones(first: 30) { edges { node { ' +
      '    zone { id name countries { code { countryCode } } } ' +
      '    methodDefinitions(first: 10) { edges { node { name rateProvider { ' +
      '      ... on DeliveryRateDefinition { price { amount currencyCode } } ' +
      '    } } } } ' +
      '  } } } ' +
      '} } } } }'
    );

    var profiles = r.deliveryProfiles.edges;
    console.log('Aantal profielen:', profiles.length);
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i].node;
      console.log('\nProfiel:', p.name || '(naamloos)', '| ID:', p.id);
      for (var g = 0; g < p.profileLocationGroups.length; g++) {
        var zones = p.profileLocationGroups[g].locationGroupZones.edges;
        for (var z = 0; z < zones.length; z++) {
          var zone = zones[z].node.zone;
          var methods = zones[z].node.methodDefinitions.edges;
          var countryCodes = zone.countries.map(function (c) { return c.code.countryCode; });
          console.log('  Zone:', zone.name, '| Landen:', countryCodes.join(', '));
          for (var m = 0; m < methods.length; m++) {
            var md = methods[m].node;
            var price = md.rateProvider && md.rateProvider.price
              ? md.rateProvider.price.amount + ' ' + md.rateProvider.price.currencyCode
              : 'carrier-calculated';
            console.log('    Methode:', md.name, '|', price);
          }
        }
      }
    }
    results.shipping = { ok: true, profiles: profiles.length };
  } catch (err) {
    console.error('FOUT bij verzending ophalen:', err.message);
    results.shipping = { ok: false, error: err.message };
    results.errors.push({ step: 'shipping', error: err.message });
  }
}

// 4.5: Check currencies
async function checkCurrencies() {
  console.log('\n=== STAP 4.5: Valuta instellingen ===\n');
  try {
    var r = await shopify.graphql(
      '{ shop { currencySettings(first: 30) { edges { node { currencyCode enabled } } } ' +
      '  paymentSettings { supportedDigitalWallets } } }'
    );

    var currencies = r.shop.currencySettings.edges.map(function (e) { return e.node; });
    var enabled = currencies.filter(function (c) { return c.enabled; });
    var needed = ['SEK', 'NOK', 'DKK', 'EUR', 'ISK'];

    console.log('Ingeschakelde valuta\'s:', enabled.map(function (c) { return c.currencyCode; }).join(', '));
    console.log('\nBenodigde valuta\'s check:');

    var missing = [];
    for (var i = 0; i < needed.length; i++) {
      var found = enabled.find(function (c) { return c.currencyCode === needed[i]; });
      console.log('  ' + needed[i] + ': ' + (found ? 'OK' : 'ONTBREEKT'));
      if (!found) missing.push(needed[i]);
    }

    if (missing.length > 0) {
      console.log('\nWAARSCHUWING: Ontbrekende valuta\'s:', missing.join(', '));
      console.log('Deze moeten handmatig worden ingeschakeld via Shopify Payments settings.');
    }

    var wallets = r.shop.paymentSettings.supportedDigitalWallets;
    console.log('\nDigitale wallets:', wallets.join(', '));

    results.currencies = { ok: missing.length === 0, enabled: enabled.map(function (c) { return c.currencyCode; }), missing: missing };
  } catch (err) {
    console.error('FOUT bij valuta ophalen:', err.message);
    results.currencies = { ok: false, error: err.message };
    results.errors.push({ step: 'currencies', error: err.message });
  }
}

// Main
async function main() {
  console.log('====================================');
  console.log('CALQIX Scandinavie Setup');
  console.log('Datum: ' + new Date().toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-'));
  console.log('====================================');

  await createMarket();
  await enableLocales();
  await checkShipping();
  await checkCurrencies();

  console.log('\n====================================');
  console.log('SAMENVATTING');
  console.log('====================================');
  console.log('Markt:', results.market.ok ? 'OK - ' + (results.market.countries || []).join(', ') : 'FOUT - ' + (results.market.error || JSON.stringify(results.market.errors)));
  console.log('Locales:');
  for (var i = 0; i < results.locales.length; i++) {
    var l = results.locales[i];
    console.log('  ' + l.locale + ': ' + (l.ok ? 'OK' : 'FOUT'));
  }
  console.log('Verzending:', results.shipping.ok ? 'OK' : 'FOUT');
  console.log('Valuta\'s:', results.currencies.ok ? 'OK' : 'Ontbrekend: ' + (results.currencies.missing || []).join(', '));
  console.log('Totaal fouten:', results.errors.length);

  if (results.errors.length > 0) {
    console.log('\nFouten detail:');
    for (var e = 0; e < results.errors.length; e++) {
      console.log('  -', results.errors[e].step + ':', results.errors[e].error || JSON.stringify(results.errors[e].errors));
    }
  }
}

main().catch(function (err) {
  console.error('FATALE FOUT:', err.message, err.stack);
  process.exit(1);
});
