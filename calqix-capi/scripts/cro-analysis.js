/**
 * CALQIX CRO Analysis via Claude API
 * Phase 6: Get concrete CRO recommendations for product pages
 */
var path = require('path');
var fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

var https = require('https');
var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
      res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', reject);
    req.setTimeout(120000, function () { req.destroy(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  // Current page analysis based on theme file inspection
  var pageAnalysis = {
    product_oralbiome: {
      name: 'OralBiome Pro Peach',
      price: 'EUR 14.95 (sale from 19.95)',
      has_price: true,
      has_add_to_cart: true,
      has_variant_picker: true,
      has_quantity_selector: true,
      has_trust_badges: true,
      trust_badge_count: 4,
      has_sticky_buy_button: true,
      has_faq: true,
      has_reviews: false,
      has_star_rating: false,
      has_social_proof_counter: false,
      has_urgency_element: false,
      has_shipping_info_near_atc: false,
      has_money_back_guarantee_near_atc: false,
      has_subscription_option: false,
      has_bundle_upsell: true,
      has_complementary_products: true,
      has_before_after: true,
      has_how_it_works: true,
      has_ingredients_section: true,
      page_sections: ['hero', 'product_info', 'how_it_works', 'stats', 'faq', 'before_after', 'complete_routine', 'bundle']
    },
    product_flowcore: {
      name: 'FlowCore Waterflosser',
      price: 'EUR 39.95 (sale from 59.95)',
      has_price: true,
      has_add_to_cart: true,
      has_variant_picker: true,
      has_quantity_selector: true,
      has_trust_badges: true,
      trust_badge_count: 5,
      has_sticky_buy_button: true,
      has_faq: true,
      has_reviews: false,
      has_star_rating: false,
      has_social_proof_counter: false,
      has_urgency_element: false,
      has_shipping_info_near_atc: false,
      has_money_back_guarantee_near_atc: false,
      has_subscription_option: false,
      has_bundle_upsell: true,
      has_complementary_products: true,
      has_before_after: true,
      has_how_it_works: true,
      page_sections: ['hero', 'product_info', 'how_it_works', 'how_it_cleans', 'stats', 'faq', 'before_after', 'complete_routine']
    },
    locales_supported: ['nl', 'de', 'fr', 'en'],
    mobile_traffic_pct: 82,
    current_conversion_rate: 'unknown',
    theme_framework: 'Shopify OS 2.0 Liquid',
    existing_cro_elements: [
      'Trust badges block (4-5 badges per product)',
      'Sticky buy button on mobile with trust line',
      'Compare-at price with discount badge',
      'FAQ accordion section',
      'Before/after section',
      'How it works section',
      'Bundle/routine upsell section'
    ],
    missing_cro_elements: [
      'No star rating or review count near title',
      'No social proof counter (X sold / X customers)',
      'No urgency element (limited stock, timer)',
      'No shipping info directly below ATC button',
      'No money-back guarantee icon near ATC',
      'No subscription/auto-refill option',
      'No payment method icons near ATC'
    ]
  };

  var croPrompt = 'Je bent een e-commerce CRO specialist voor CALQIX, een premium oral care merk.\n\n' +
    'Huidige productpagina analyse:\n' + JSON.stringify(pageAnalysis, null, 2) + '\n\n' +
    'Producten:\n' +
    '- OralBiome Pro: nano-hydroxyapatite tandpasta tabletten, EUR 14.95 (van 19.95)\n' +
    '- FlowCore: draadloze waterflosser, EUR 39.95 (van 59.95)\n\n' +
    'Doelgroep: 25-45 jaar, gezondheidsbewust, NL/DE/BE/AT\n' +
    '82% van het verkeer is mobiel (Meta ads traffic).\n\n' +
    'De conversieratio moet omhoog. Geef me exact 5 concrete verbeteringen die ik vandaag kan implementeren.\n' +
    'Sorteer op verwachte impact (hoogste eerst).\n\n' +
    'Voor elke verbetering geef:\n' +
    '1. Wat: concrete beschrijving\n' +
    '2. Waar: exact element op de pagina\n' +
    '3. Waarom: welk psychologisch principe het activeert\n' +
    '4. Implementatie: Shopify Liquid/HTML/CSS code snippet\n\n' +
    'Antwoord in het Nederlands. Focus op vertrouwen, urgentie, en waardecommunicatie.\n' +
    'Geen generiek advies. Specifiek voor premium oral care.\n' +
    'Houd er rekening mee dat dit een Shopify OS 2.0 theme is met Liquid templates.\n' +
    'De sticky buy button en trust badges bestaan al. Focus op wat er ONTBREEKT.';

  console.log('Sending CRO analysis request to Claude...');
  
  var res = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: croPrompt }]
    })
  });

  if (res.status !== 200) {
    console.error('Claude API error:', res.status, res.body.substring(0, 500));
    return;
  }

  var data = JSON.parse(res.body);
  var recommendations = data.content[0].text;
  
  // Save to file for reference
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'cro-recommendations.md'), 
    '# CRO Aanbevelingen - ' + new Date().toLocaleDateString('nl-NL') + '\n\n' + recommendations);
  
  console.log('\n=== CRO AANBEVELINGEN ===\n');
  console.log(recommendations);
  console.log('\nOpgeslagen in docs/cro-recommendations.md');
}

main().catch(function (e) { console.error('Fatal:', e); process.exit(1); });
