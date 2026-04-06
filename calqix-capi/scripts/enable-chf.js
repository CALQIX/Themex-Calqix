/**
 * CALQIX - Enable CHF for Switzerland
 *
 * 1. Find the market containing CH
 * 2. Enable local currencies so CHF is shown
 * 3. Report result to Telegram
 *
 * Run: node scripts/enable-chf.js
 */
require('dotenv').config();
var shopify = require('../lib/shopify-admin');
var { sendTelegram } = require('../lib/telegram');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  console.log('====================================================');
  console.log('CALQIX - CHF Valuta voor Zwitserland');
  console.log('====================================================\n');

  // Step 1: Find CH market
  console.log('Stap 1: Markten ophalen...');
  var data = await shopify.graphql('{ markets(first: 20) { edges { node { id name enabled primary regions(first: 30) { edges { node { ... on MarketRegionCountry { code name } } } } currencySettings { baseCurrency { currencyCode } localCurrencies } } } } }');

  var markets = data.markets.edges.map(function (e) { return e.node; });
  var chMarket = null;
  var chInSharedMarket = false;
  var sharedCountries = [];

  for (var i = 0; i < markets.length; i++) {
    var m = markets[i];
    var regions = m.regions.edges.map(function (e) { return e.node; });
    var codes = regions.map(function (r) { return r.code; });

    var cs = m.currencySettings || {};
    var baseCurr = cs.baseCurrency ? cs.baseCurrency.currencyCode : 'default';
    var localCurr = cs.localCurrencies ? 'AAN' : 'UIT';

    console.log((m.enabled ? '[ACTIEF]' : '[UIT]') + ' ' + m.name + (m.primary ? ' (primair)' : ''));
    console.log('  ID: ' + m.id);
    console.log('  Valuta: ' + baseCurr);
    console.log('  Lokale valuta: ' + localCurr);
    console.log('  Landen: ' + codes.join(', '));
    console.log('');

    if (codes.indexOf('CH') > -1) {
      chMarket = m;
      sharedCountries = codes;
      if (codes.length > 1) {
        chInSharedMarket = true;
      }
    }
  }

  if (!chMarket) {
    console.error('FOUT: Zwitserland (CH) niet gevonden in enige markt!');
    await sendTelegram('CHF Valuta Update\n\nFOUT: Zwitserland niet gevonden in enige markt. Handmatige actie nodig.');
    return;
  }

  console.log('CH gevonden in markt: ' + chMarket.name + ' (' + chMarket.id + ')');
  console.log('Gedeelde landen: ' + sharedCountries.join(', '));
  console.log('Huidige lokale valuta: ' + (chMarket.currencySettings.localCurrencies ? 'AAN' : 'UIT'));

  // Step 2: Enable local currencies
  if (chMarket.currencySettings.localCurrencies) {
    console.log('\nLokale valuta is al ingeschakeld. CHF zou al zichtbaar moeten zijn voor CH bezoekers.');
  } else {
    console.log('\nStap 2: Lokale valuta inschakelen...');

    if (chInSharedMarket) {
      console.log('LET OP: CH deelt een markt met ' + (sharedCountries.length - 1) + ' andere landen.');
      console.log('LocalCurrencies inschakelen geldt voor ALLE landen in deze markt.');
      console.log('Dit betekent dat elke klant in deze markt lokale valuta ziet (bijv. CHF voor CH).');
    }

    try {
      var result = await shopify.graphql(
        'mutation enableLocal($marketId: ID!) { marketCurrencySettingsUpdate(marketId: $marketId, input: { localCurrencies: true }) { market { id name currencySettings { baseCurrency { currencyCode } localCurrencies } } userErrors { field message } } }',
        { marketId: chMarket.id }
      );

      var errors = result.marketCurrencySettingsUpdate.userErrors || [];
      if (errors.length > 0) {
        var errMsg = errors[0].message;
        if (errMsg.indexOf('unified markets') > -1) {
          console.log('\nUnified Markets is ingeschakeld. CHF moet handmatig worden toegevoegd.');
          console.log('Ga naar: Shopify Admin > Settings > Markets > Preferences');
          console.log('Of: Shopify Admin > Settings > Payments > Manage (currencies)');

          var manualReport = [
            '<b>CHF Valuta Update - ' + new Date().toLocaleDateString('nl-NL') + '</b>',
            '',
            'CH gevonden in markt: ' + chMarket.name,
            'CH deelt markt met: ' + sharedCountries.filter(function (c) { return c !== 'CH'; }).join(', '),
            '',
            '<b>Unified Markets actief - handmatige actie nodig:</b>',
            '1. Ga naar Shopify Admin > Settings > Markets',
            '2. Klik op "German speaking" markt',
            '3. Voeg CHF toe als lokale valuta',
            '',
            'Of alternatief:',
            '1. Shopify Admin > Settings > Payments',
            '2. Manage currencies > Add currency > CHF',
            '',
            'Note: CH staat in 2 markten (French + German speaking).'
          ].join('\n');

          await sendTelegram(manualReport);
          return;
        }
        console.error('Fout bij inschakelen:', errMsg);
        await sendTelegram('CHF Valuta Update\n\nFOUT: ' + errMsg);
        return;
      }

      var updated = result.marketCurrencySettingsUpdate.market;
      console.log('Lokale valuta ingeschakeld voor markt: ' + updated.name);
      console.log('Basis valuta: ' + updated.currencySettings.baseCurrency.currencyCode);
      console.log('Lokale valuta: ' + (updated.currencySettings.localCurrencies ? 'AAN' : 'UIT'));
    } catch (err) {
      console.error('API fout:', err.message);
      await sendTelegram('CHF Valuta Update\n\nAPI FOUT: ' + err.message);
      return;
    }
  }

  // Step 3: Report
  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + now.getFullYear();

  var reportLines = [
    '<b>CHF Valuta Update - ' + dateStr + '</b>',
    '',
    '- CH markt: ' + chMarket.name + (chMarket.enabled ? ' (actief)' : ' (inactief)'),
    '- Markt ID: ' + chMarket.id,
    '- Basis valuta: ' + (chMarket.currencySettings.baseCurrency ? chMarket.currencySettings.baseCurrency.currencyCode : 'onbekend'),
    '- Lokale valuta ingeschakeld: Ja',
    '- CHF zichtbaar voor CH bezoekers: Ja',
    chInSharedMarket ? '- Let op: CH deelt markt met ' + sharedCountries.filter(function (c) { return c !== 'CH'; }).join(', ') : '- CH is in eigen markt',
    '',
    'Controleer: https://www.calqix.com (met CH VPN/proxy)'
  ];

  var report = reportLines.join('\n');
  console.log('\n' + report.replace(/<[^>]+>/g, ''));
  await sendTelegram(report);
}

main().catch(function (err) {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
