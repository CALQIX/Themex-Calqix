/**
 * CALQIX Markets Setup Script
 * Phase 4: Add CH + LU markets
 * Phase 5: Prepare Scandinavian markets (disabled)
 * 
 * Run: node scripts/markets-setup.js
 */
var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

var https = require('https');

var SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
var SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
var TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

function fetchJSON(url, opts) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var reqOpts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    var req = https.request(reqOpts, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: body });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sendTelegram(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: text, parse_mode: 'HTML' })
  });
}

async function shopifyGraphQL(query, variables) {
  var url = 'https://' + SHOPIFY_DOMAIN + '/admin/api/2024-10/graphql.json';
  var body = JSON.stringify({ query: query, variables: variables || {} });
  var res = await fetchJSON(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN
    },
    body: body
  });
  if (res.status !== 200) {
    console.error('GraphQL HTTP ' + res.status + ':', res.body.substring(0, 500));
    return null;
  }
  try {
    return JSON.parse(res.body);
  } catch (e) {
    console.error('GraphQL parse error:', res.body.substring(0, 500));
    return null;
  }
}

// ============================================================
// FASE 4.1: Inventariseer huidige markten
// ============================================================

async function listMarkets() {
  console.log('\n=== FASE 4.1: HUIDIGE MARKTEN ===\n');
  
  var data = await shopifyGraphQL(`{
    markets(first: 20) {
      edges {
        node {
          id
          name
          enabled
          primary
          regions(first: 30) {
            edges {
              node {
                ... on MarketRegionCountry {
                  code
                  name
                }
              }
            }
          }
          currencySettings {
            baseCurrency { currencyCode }
          }
        }
      }
    }
  }`);
  
  if (!data || !data.data) {
    console.error('Kan markten niet ophalen');
    console.log('Response:', JSON.stringify(data, null, 2));
    return null;
  }
  
  var markets = data.data.markets.edges.map(function (e) { return e.node; });
  var allCountryCodes = [];
  
  for (var i = 0; i < markets.length; i++) {
    var m = markets[i];
    var regions = m.regions.edges.map(function (e) { return e.node; });
    var codes = regions.map(function (r) { return r.code; });
    allCountryCodes = allCountryCodes.concat(codes);
    
    console.log((m.enabled ? '[ACTIEF]' : '[UIT]') + ' ' + m.name + (m.primary ? ' (primair)' : ''));
    console.log('  ID: ' + m.id);
    console.log('  Valuta: ' + (m.currencySettings.baseCurrency ? m.currencySettings.baseCurrency.currencyCode : 'default'));
    console.log('  Landen: ' + codes.join(', '));
    console.log('');
  }
  
  return { markets: markets, allCountryCodes: allCountryCodes };
}

// ============================================================
// FASE 4.2-4.3: Markten toevoegen (CH + LU)
// ============================================================

async function addMarket(name, countryCodes, enabled) {
  var regions = countryCodes.map(function (c) { return '{ countryCode: ' + c + ' }'; }).join(', ');
  
  var mutation = `mutation {
    marketCreate(input: {
      name: "${name}"
      enabled: ${enabled}
      regions: [${regions}]
    }) {
      market {
        id
        name
        enabled
        regions(first: 10) {
          edges {
            node {
              ... on MarketRegionCountry {
                code
                name
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;
  
  var result = await shopifyGraphQL(mutation);
  if (!result || !result.data) {
    console.error('Market aanmaken mislukt voor ' + name);
    return null;
  }
  
  var errors = result.data.marketCreate.userErrors || [];
  if (errors.length > 0) {
    console.error('Fouten bij aanmaken ' + name + ':');
    errors.forEach(function (e) { console.error('  ' + e.field + ': ' + e.message); });
    return null;
  }
  
  var market = result.data.marketCreate.market;
  console.log('Markt aangemaakt: ' + market.name + ' (' + market.id + ')');
  var regions2 = market.regions.edges.map(function (e) { return e.node.code; });
  console.log('  Landen: ' + regions2.join(', '));
  console.log('  Actief: ' + market.enabled);
  return market;
}

// ============================================================
// FASE 4.4: Controleer verzendprofielen
// ============================================================

async function checkShipping() {
  console.log('\n=== FASE 4.4: VERZENDPROFIELEN ===\n');
  
  var data = await shopifyGraphQL(`{
    deliveryProfiles(first: 5) {
      edges {
        node {
          id
          name
          profileLocationGroups {
            locationGroupZones(first: 30) {
              edges {
                node {
                  zone {
                    id
                    name
                    countries {
                      code { countryCode }
                    }
                  }
                  methodDefinitions(first: 10) {
                    edges {
                      node {
                        id
                        name
                        rateProvider {
                          ... on DeliveryRateDefinition {
                            price { amount currencyCode }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`);
  
  if (!data || !data.data) {
    console.error('Kan verzendprofielen niet ophalen');
    console.log('Response:', JSON.stringify(data, null, 2));
    return;
  }
  
  var profiles = data.data.deliveryProfiles.edges.map(function (e) { return e.node; });
  var chInZone = false;
  var luInZone = false;
  
  for (var p = 0; p < profiles.length; p++) {
    var profile = profiles[p];
    console.log('Profiel: ' + profile.name + ' (' + profile.id + ')');
    
    var groups = profile.profileLocationGroups || [];
    for (var g = 0; g < groups.length; g++) {
      var zones = (groups[g].locationGroupZones || { edges: [] }).edges.map(function (e) { return e.node; });
      for (var z = 0; z < zones.length; z++) {
        var zone = zones[z].zone;
        var methods = (zones[z].methodDefinitions || { edges: [] }).edges.map(function (e) { return e.node; });
        var countryCodes = (zone.countries || []).map(function (c) { return c.code ? c.code.countryCode : '?'; });
        
        if (countryCodes.includes('CH')) chInZone = true;
        if (countryCodes.includes('LU')) luInZone = true;
        
        console.log('  Zone: ' + zone.name + ' (' + countryCodes.length + ' landen)');
        if (countryCodes.length <= 20) {
          console.log('    Landen: ' + countryCodes.join(', '));
        }
        methods.forEach(function (m) {
          var price = m.rateProvider && m.rateProvider.price ? m.rateProvider.price.amount + ' ' + m.rateProvider.price.currencyCode : 'carrier-calculated';
          console.log('    Methode: ' + m.name + ' - ' + price);
        });
      }
    }
    console.log('');
  }
  
  console.log('CH in verzendzone: ' + (chInZone ? 'JA' : 'NEE - handmatig toevoegen'));
  console.log('LU in verzendzone: ' + (luInZone ? 'JA' : 'NEE - handmatig toevoegen'));
  
  return { chInZone: chInZone, luInZone: luInZone };
}

// ============================================================
// FASE 4.6: Productbeschikbaarheid
// ============================================================

async function checkProducts() {
  console.log('\n=== FASE 4.6: PRODUCTBESCHIKBAARHEID ===\n');
  
  var data = await shopifyGraphQL(`{
    products(first: 10) {
      edges {
        node {
          title
          handle
          status
          totalInventory
        }
      }
    }
  }`);
  
  if (!data || !data.data) {
    console.error('Kan producten niet ophalen');
    return;
  }
  
  var products = data.data.products.edges.map(function (e) { return e.node; });
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    console.log('  ' + p.title + ' (' + p.handle + ') - Status: ' + p.status + ' - Voorraad: ' + p.totalInventory);
  }
}

// ============================================================
// FASE 5: SCANDINAVISCHE MARKTEN VOORBEREIDEN
// ============================================================

async function prepareScandi(allCountryCodes) {
  console.log('\n=== FASE 5: SCANDINAVISCHE MARKTEN VOORBEREIDEN ===\n');
  
  var scandiCountries = ['SE', 'NO', 'DK', 'FI', 'IS'];
  var alreadyPresent = scandiCountries.filter(function (c) { return allCountryCodes.includes(c); });
  var toAdd = scandiCountries.filter(function (c) { return !allCountryCodes.includes(c); });
  
  if (alreadyPresent.length > 0) {
    console.log('Al aanwezig in een markt: ' + alreadyPresent.join(', '));
  }
  
  if (toAdd.length === 0) {
    console.log('Alle Scandinavische landen zijn al toegewezen aan een markt.');
    return { created: false, reason: 'already_present' };
  }
  
  console.log('Toe te voegen (disabled): ' + toAdd.join(', '));
  
  var regions = toAdd.map(function (c) { return '{ countryCode: ' + c + ' }'; }).join(', ');
  
  var mutation = `mutation {
    marketCreate(input: {
      name: "Scandinavie"
      enabled: false
      regions: [${regions}]
    }) {
      market {
        id
        name
        enabled
        regions(first: 10) {
          edges {
            node {
              ... on MarketRegionCountry {
                code
                name
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;
  
  var result = await shopifyGraphQL(mutation);
  if (!result || !result.data) {
    console.error('Scandinavische markt aanmaken mislukt');
    return { created: false, error: 'api_error' };
  }
  
  var errors = result.data.marketCreate.userErrors || [];
  if (errors.length > 0) {
    console.error('Fouten:');
    errors.forEach(function (e) { console.error('  ' + e.field + ': ' + e.message); });
    return { created: false, errors: errors };
  }
  
  var market = result.data.marketCreate.market;
  var codes = market.regions.edges.map(function (e) { return e.node.code; });
  console.log('Markt aangemaakt: ' + market.name + ' (' + market.id + ')');
  console.log('  Landen: ' + codes.join(', '));
  console.log('  Actief: ' + market.enabled + ' (voorbereid, niet live)');
  
  return { created: true, market: market, countries: codes };
}

// ============================================================
// FASE 5.6: Check en enable locales
// ============================================================

async function checkAndEnableLocales() {
  console.log('\n=== FASE 5.6: LOCALES CONTROLEREN ===\n');
  
  var data = await shopifyGraphQL(`{
    shopLocales {
      locale
      name
      primary
      published
    }
  }`);
  
  if (!data || !data.data) {
    console.error('Kan locales niet ophalen');
    return;
  }
  
  var locales = data.data.shopLocales;
  console.log('Huidige locales:');
  var existingCodes = [];
  for (var i = 0; i < locales.length; i++) {
    var l = locales[i];
    existingCodes.push(l.locale);
    console.log('  ' + l.locale + ' (' + l.name + ')' + (l.primary ? ' [PRIMAIR]' : '') + (l.published ? ' [GEPUBLICEERD]' : ' [NIET GEPUBLICEERD]'));
  }
  
  // Scandinavian locales to enable (unpublished)
  var scandiLocales = ['sv', 'nb', 'da', 'fi'];
  var toEnable = scandiLocales.filter(function (l) { return !existingCodes.includes(l); });
  
  if (toEnable.length === 0) {
    console.log('\nAlle Scandinavische locales bestaan al.');
    return { enabled: [], alreadyPresent: scandiLocales };
  }
  
  console.log('\nTe enablen locales: ' + toEnable.join(', '));
  var enabled = [];
  
  for (var j = 0; j < toEnable.length; j++) {
    var locale = toEnable[j];
    var result = await shopifyGraphQL(`mutation {
      shopLocaleEnable(locale: "${locale}") {
        shopLocale {
          locale
          name
          published
        }
        userErrors {
          field
          message
        }
      }
    }`);
    
    if (result && result.data && result.data.shopLocaleEnable) {
      var errors = result.data.shopLocaleEnable.userErrors || [];
      if (errors.length > 0) {
        console.log('  ' + locale + ': FOUT - ' + errors[0].message);
      } else {
        var sl = result.data.shopLocaleEnable.shopLocale;
        console.log('  ' + sl.locale + ' (' + sl.name + ') enabled, published: ' + sl.published);
        enabled.push(sl.locale);
      }
    }
  }
  
  return { enabled: enabled, alreadyPresent: existingCodes };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('CALQIX Markets Setup');
  console.log('====================\n');
  
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    console.error('SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreekt!');
    process.exit(1);
  }
  
  console.log('Shopify domain: ' + SHOPIFY_DOMAIN);
  
  // Phase 4.1: List current markets
  var marketInfo = await listMarkets();
  if (!marketInfo) {
    console.error('Kan niet doorgaan zonder marktinformatie.');
    process.exit(1);
  }
  
  var allCodes = marketInfo.allCountryCodes;
  
  // Phase 4.2-4.3: Add CH and LU if not present
  console.log('\n=== FASE 4.2-4.3: MARKTEN TOEVOEGEN ===\n');
  
  var chAdded = false, luAdded = false;
  
  if (allCodes.includes('CH')) {
    console.log('CH (Zwitserland) is al toegewezen aan een markt. Overslaan.');
  } else {
    console.log('CH (Zwitserland) toevoegen...');
    var chMarket = await addMarket('Zwitserland', ['CH'], true);
    chAdded = !!chMarket;
  }
  
  if (allCodes.includes('LU')) {
    console.log('LU (Luxemburg) is al toegewezen aan een markt. Overslaan.');
  } else {
    console.log('LU (Luxemburg) toevoegen...');
    var luMarket = await addMarket('Luxemburg', ['LU'], true);
    luAdded = !!luMarket;
  }
  
  // Phase 4.4: Check shipping
  var shipping = await checkShipping();
  
  // Phase 4.6: Check products
  await checkProducts();
  
  // Phase 5: Scandinavian markets
  var scandiResult = await prepareScandi(allCodes);
  
  // Phase 5.6: Enable locales
  var localeResult = await checkAndEnableLocales();
  
  // Send Telegram summary
  var lines = ['<b>CALQIX Markten Update</b>\n'];
  lines.push('<b>Fase 4: CH + LU</b>');
  lines.push('- CH (Zwitserland): ' + (chAdded ? 'TOEGEVOEGD (actief)' : (allCodes.includes('CH') ? 'Was al aanwezig' : 'MISLUKT')));
  lines.push('- LU (Luxemburg): ' + (luAdded ? 'TOEGEVOEGD (actief)' : (allCodes.includes('LU') ? 'Was al aanwezig' : 'MISLUKT')));
  if (shipping) {
    lines.push('- CH in verzendzone: ' + (shipping.chInZone ? 'Ja' : 'Nee - handmatig toevoegen'));
    lines.push('- LU in verzendzone: ' + (shipping.luInZone ? 'Ja' : 'Nee - handmatig toevoegen'));
  }
  lines.push('');
  lines.push('<b>Fase 5: Scandinavie</b>');
  if (scandiResult && scandiResult.created) {
    lines.push('- Markt "Scandinavie" aangemaakt (NIET ACTIEF)');
    lines.push('- Landen: ' + (scandiResult.countries || []).join(', '));
  } else if (scandiResult && scandiResult.reason === 'already_present') {
    lines.push('- Scandinavische landen waren al toegewezen');
  } else {
    lines.push('- Aanmaken mislukt: ' + JSON.stringify(scandiResult));
  }
  if (localeResult) {
    if (localeResult.enabled && localeResult.enabled.length > 0) {
      lines.push('- Locales enabled: ' + localeResult.enabled.join(', '));
    } else {
      lines.push('- Locales: al aanwezig');
    }
  }
  
  var text = lines.join('\n');
  console.log('\n' + text.replace(/<\/?b>/g, ''));
  await sendTelegram(text);
  console.log('\nTelegram bericht verzonden.');
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error('Fatal:', e); process.exit(1); });
