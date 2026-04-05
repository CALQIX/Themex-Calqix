/**
 * CALQIX Final Audit Report - Phase 7
 * Sends comprehensive summary to Telegram
 */
var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

var https = require('https');
var TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ chat_id: TELEGRAM_CHAT, text: text, parse_mode: 'HTML' });
    var opts = {
      hostname: 'api.telegram.org',
      path: '/bot' + TELEGRAM_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    var req = https.request(opts, function (res) {
      var d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: d }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  var now = new Date();
  var dd = String(now.getDate()).padStart(2, '0');
  var mm = String(now.getMonth() + 1).padStart(2, '0');
  var yyyy = now.getFullYear();
  var dateStr = dd + '-' + mm + '-' + yyyy;

  var report = [
    '<b>CALQIX Systeem Audit Rapport</b>',
    '<b>Datum:</b> ' + dateStr,
    '',
    '<b>== FASE 1: APPROVAL QUEUE ==</b>',
    '14 items verwijderd (pending/approved)',
    'Wachtrij is leeg en klaar voor live executie',
    '',
    '<b>== FASE 2: WORKFLOW AUDIT ==</b>',
    '<b>Endpoints:</b> 9/9 OK',
    '- cron/content-morning: OK',
    '- cron/content-review: OK',
    '- cron/content-publish: OK',
    '- cron/content-reflect: OK',
    '- cron/ad-morning: OK',
    '- cron/ad-midday-check: OK',
    '- cron/ad-daily-close: OK',
    '- ads/monitor: OK',
    '- recovery/run: OK',
    '',
    '<b>Verbindingen:</b> 6/6 OK',
    '- Predis API: OK',
    '- Claude API: OK',
    '- Telegram Bot: OK (webhook actief)',
    '- Redis (Upstash): OK',
    '- Meta API: OK (Pixel actief)',
    '- Predis webhook: Bereikbaar (405 = geen POST)',
    '',
    '<b>QStash:</b> 10 schedules actief',
    '- content-morning (05:45)',
    '- content-review (07:05)',
    '- content-publish-am (08:30)',
    '- content-publish-pm (18:30)',
    '- content-reflect (21:30)',
    '- ad-morning (09:00)',
    '- ad-midday (15:00)',
    '- ad-daily-close (21:00)',
    '- optimizer (elke 2 uur)',
    '- recovery (elke minuut)',
    '',
    '<b>== FASE 3: META PIXEL + CHECKOUT ==</b>',
    '- CAPI event keys in Redis: 18',
    '- Dedup keys in Redis: 10',
    '- Pixel actief: Calqix pixel (934134615770602)',
    '- Shopify Admin API: 401 (token verlopen)',
    '',
    '<b>== FASE 4: MARKTEN CH + LU ==</b>',
    'GEBLOKKEERD: SHOPIFY_ADMIN_ACCESS_TOKEN ongeldig',
    'Actie vereist: Nieuwe token aanmaken in Shopify Admin',
    'Scopes nodig: read_markets, write_markets, read_shipping,',
    'write_shipping, read_locales, write_locales, read_products,',
    'read_orders',
    '',
    '<b>== FASE 5: SCANDINAVIE VOORBEREIDING ==</b>',
    'MARKET_LANGUAGE_MAP bijgewerkt:',
    '- CH (Duits), LU (Frans) toegevoegd',
    '- SE (Zweeds), NO (Noors), DK (Deens) toegevoegd',
    '- FI (Fins), IS (IJslands) toegevoegd',
    'Shopify markt/locale aanmaken: geblokkeerd door token',
    '',
    '<b>== FASE 6: CRO VERBETERINGEN ==</b>',
    'Claude AI analyse uitgevoerd, 5 aanbevelingen ontvangen.',
    'Top 3 geimplementeerd:',
    '',
    '1. <b>Trust Stack onder ATC knop</b>',
    '   Gratis verzending + 30 dagen garantie + veilig betalen',
    '   4 talen (NL/DE/FR/EN), CALQIX design',
    '',
    '2. <b>Sticky trust line product-agnostisch</b>',
    '   Was hardcoded voor FlowCore, nu werkt voor alle',
    '   producten met locale-aware fallbacks',
    '',
    '3. <b>CRO CSS styling</b>',
    '   Fade-in animatie, CALQIX kleurenpalet,',
    '   responsive mobile layout',
    '',
    'Aanbevelingen opgeslagen: docs/cro-recommendations.md',
    '',
    '<b>== VOLGENDE STAPPEN ==</b>',
    '1. Shopify Admin token vernieuwen (kritiek)',
    '2. Na token: CH + LU markten toevoegen',
    '3. Na token: Scandinavische markt + locales aanmaken',
    '4. Theme wijzigingen deployen naar live',
    '5. CRO A/B test opzetten voor trust stack',
    '',
    '<b>== BESTANDEN GEWIJZIGD ==</b>',
    '- sections/main-product.liquid (trust stack + sticky fix)',
    '- assets/calqix-product-information.css (trust stack CSS)',
    '- lib/content-planner.js (MARKET_LANGUAGE_MAP)',
    '- scripts/audit-full.js (audit script)',
    '- scripts/markets-setup.js (markt setup script)',
    '- scripts/cro-analysis.js (Claude CRO analyse)',
    '- docs/cro-recommendations.md (aanbevelingen)',
  ].join('\n');

  console.log('Sending final report to Telegram...');
  console.log('');
  console.log(report.replace(/<\/?b>/g, ''));

  var res = await sendTelegram(report);
  if (res.status === 200) {
    console.log('\nRapport succesvol verzonden naar Telegram.');
  } else {
    console.error('\nTelegram fout:', res.status, res.body);
    // Try splitting if too long
    if (res.body.includes('message is too long')) {
      console.log('Bericht te lang, split in delen...');
      var lines = report.split('\n');
      var mid = Math.floor(lines.length / 2);
      var part1 = lines.slice(0, mid).join('\n');
      var part2 = lines.slice(mid).join('\n');
      await sendTelegram(part1);
      await sendTelegram(part2);
      console.log('Rapport in 2 delen verzonden.');
    }
  }
}

main().catch(function (e) { console.error('Fatal:', e); process.exit(1); });
