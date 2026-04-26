/**
 * Adds the Shopify checkout `alternative_payment_method_banner` translations
 * (express_checkout label + "or" trust line) to every storefront locale file.
 *
 * Path: shopify.checkout.alternative_payment_method_banner.{express_checkout,or}
 *
 * Idempotent: existing keys are NEVER overwritten — only inserted when missing.
 * Writes UTF-8 WITHOUT BOM (Shopify silently rejects BOM JSON).
 *
 * Run: node scripts/add-checkout-banner-i18n.js
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Localized translations. Source phrasing kept consistent across languages,
// rating uses locale-correct decimal/grouping conventions.
const TRANSLATIONS = {
  'en.default': { express: 'Checkout with PayPal',           or: '\u2605\u2605\u2605\u2605\u2605 4.9/5 rating, trusted by 10,000+ satisfied customers.' },
  'nl':         { express: 'Afrekenen met PayPal',           or: '\u2605\u2605\u2605\u2605\u2605 Beoordeling 4,9/5, vertrouwd door 10.000+ tevreden klanten.' },
  'de':         { express: 'Zur Kasse mit PayPal',           or: '\u2605\u2605\u2605\u2605\u2605 Bewertung 4,9/5, vertraut von 10.000+ zufriedenen Kunden.' },
  'fr':         { express: 'Paiement avec PayPal',           or: '\u2605\u2605\u2605\u2605\u2605 Note 4,9/5, plebiscite par plus de 10 000 clients satisfaits.' },
  'es':         { express: 'Pagar con PayPal',               or: '\u2605\u2605\u2605\u2605\u2605 Valoracion 4,9/5, la confianza de mas de 10.000 clientes satisfechos.' },
  'it':         { express: 'Vai al pagamento con PayPal',    or: '\u2605\u2605\u2605\u2605\u2605 Valutazione 4,9/5, scelti da oltre 10.000 clienti soddisfatti.' },
  'pt-BR':      { express: 'Finalizar compra com PayPal',    or: '\u2605\u2605\u2605\u2605\u2605 Avaliacao 4,9/5, a confianca de mais de 10.000 clientes satisfeitos.' },
  'pt-PT':      { express: 'Finalizar compra com PayPal',    or: '\u2605\u2605\u2605\u2605\u2605 Classificacao 4,9/5, a confianca de mais de 10 000 clientes satisfeitos.' },
  'pl':         { express: 'Zaplac przez PayPal',            or: '\u2605\u2605\u2605\u2605\u2605 Ocena 4,9/5, wybor ponad 10 000 zadowolonych klientow.' },
  'sv':         { express: 'Betala med PayPal',              or: '\u2605\u2605\u2605\u2605\u2605 Betyg 4,9/5, anfortrott av over 10 000 nojda kunder.' },
  'nb':         { express: 'Betal med PayPal',               or: '\u2605\u2605\u2605\u2605\u2605 Vurdering 4,9/5, valgt av over 10 000 fornoyde kunder.' },
  'da':         { express: 'Betal med PayPal',               or: '\u2605\u2605\u2605\u2605\u2605 Bedommelse 4,9/5, brugt af over 10.000 tilfredse kunder.' },
  'fi':         { express: 'Maksa PayPalilla',               or: '\u2605\u2605\u2605\u2605\u2605 Arvosana 4,9/5, yli 10 000 tyytyvaisen asiakkaan luottamus.' },
  'cs':         { express: 'Zaplatit pres PayPal',           or: '\u2605\u2605\u2605\u2605\u2605 Hodnoceni 4,9/5, duveruje nam pres 10 000 spokojenych zakazniku.' },
  'sk-SK':      { express: 'Zaplatit cez PayPal',            or: '\u2605\u2605\u2605\u2605\u2605 Hodnotenie 4,9/5, doveruje nam viac ako 10 000 spokojnych zakaznikov.' },
  'hu':         { express: 'Fizetes PayPal-lal',             or: '\u2605\u2605\u2605\u2605\u2605 Ertekeles 4,9/5, tobb mint 10 000 elegedett vasarlo bizalma.' },
  'ro-RO':      { express: 'Plateste cu PayPal',             or: '\u2605\u2605\u2605\u2605\u2605 Evaluare 4,9/5, peste 10.000 de clienti multumiti ne-au ales.' },
  'bg-BG':      { express: '\u041F\u043B\u0430\u0449\u0430\u043D\u0435 \u0441 PayPal', or: '\u2605\u2605\u2605\u2605\u2605 \u041E\u0446\u0435\u043D\u043A\u0430 4,9/5, \u0434\u043E\u0432\u0435\u0440\u0438\u0435\u0442\u043E \u043D\u0430 \u043D\u0430\u0434 10\u202F000 \u0434\u043E\u0432\u043E\u043B\u043D\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u0438.' },
  'hr-HR':      { express: 'Plati s PayPalom',               or: '\u2605\u2605\u2605\u2605\u2605 Ocjena 4,9/5, povjerenje vise od 10.000 zadovoljnih kupaca.' },
  'sl-SI':      { express: 'Placaj s PayPalom',              or: '\u2605\u2605\u2605\u2605\u2605 Ocena 4,9/5, zaupa nam vec kot 10.000 zadovoljnih kupcev.' },
  'lt-LT':      { express: 'Moketi per PayPal',              or: '\u2605\u2605\u2605\u2605\u2605 Ivertinimas 4,9/5, mumis pasitiki daugiau nei 10 000 patenkintu klientu.' },
  'el':         { express: '\u03A0\u03BB\u03B7\u03C1\u03C9\u03BC\u03AE \u03BC\u03B5 PayPal', or: '\u2605\u2605\u2605\u2605\u2605 \u0392\u03B1\u03B8\u03BC\u03BF\u03BB\u03BF\u03B3\u03AF\u03B1 4,9/5, \u03BC\u03B1\u03C2 \u03B5\u03BC\u03C0\u03B9\u03C3\u03C4\u03B5\u03CD\u03BF\u03BD\u03C4\u03B1\u03B9 10.000+ \u03B9\u03BA\u03B1\u03BD\u03BF\u03C0\u03BF\u03B9\u03B7\u03BC\u03AD\u03BD\u03BF\u03B9 \u03C0\u03B5\u03BB\u03AC\u03C4\u03B5\u03C2.' },
  'tr':         { express: 'PayPal ile Ode',                 or: '\u2605\u2605\u2605\u2605\u2605 4,9/5 puan, 10.000\u2019den fazla memnun musterinin tercihi.' },
  'ru':         { express: '\u041E\u043F\u043B\u0430\u0442\u0438\u0442\u044C \u0447\u0435\u0440\u0435\u0437 PayPal', or: '\u2605\u2605\u2605\u2605\u2605 \u0420\u0435\u0439\u0442\u0438\u043D\u0433 4,9/5, \u043D\u0430\u043C \u0434\u043E\u0432\u0435\u0440\u044F\u044E\u0442 \u0431\u043E\u043B\u0435\u0435 10\u202F000 \u0434\u043E\u0432\u043E\u043B\u044C\u043D\u044B\u0445 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432.' },
  'ar':         { express: '\u0627\u0644\u062F\u0641\u0639 \u0639\u0628\u0631 PayPal', or: '\u2605\u2605\u2605\u2605\u2605 \u062A\u0642\u064A\u064A\u0645 4.9/5\u060C \u064A\u062B\u0642 \u0628\u0646\u0627 \u0623\u0643\u062B\u0631 \u0645\u0646 10,000 \u0639\u0645\u064A\u0644 \u0631\u0627\u0636\u064D.' },
  'ja':         { express: 'PayPal\u3067\u652F\u6255\u3046',  or: '\u2605\u2605\u2605\u2605\u2605 \u8A55\u4FA14.9/5\u300110,000\u4EBA\u4EE5\u4E0A\u306E\u304A\u5BA2\u69D8\u306B\u3054\u4FE1\u983C\u3044\u305F\u3060\u3044\u3066\u3044\u307E\u3059\u3002' },
  'ko':         { express: 'PayPal\uB85C \uACB0\uC81C',       or: '\u2605\u2605\u2605\u2605\u2605 \uD3C9\uC810 4.9/5, 10,000\uBA85 \uC774\uC0C1\uC758 \uB9CC\uC871\uD55C \uACE0\uAC1D\uC774 \uC2E0\uB8B0\uD569\uB2C8\uB2E4.' },
  'zh-CN':      { express: '\u4F7F\u7528 PayPal \u7ED3\u8D26', or: '\u2605\u2605\u2605\u2605\u2605 \u8BC4\u5206 4.9/5\uFF0C\u8D85\u8FC7 10,000 \u4F4D\u6EE1\u610F\u5BA2\u6237\u7684\u4FE1\u8D56\u4E4B\u9009\u3002' },
  'zh-TW':      { express: '\u4F7F\u7528 PayPal \u7D50\u5E33', or: '\u2605\u2605\u2605\u2605\u2605 \u8A55\u5206 4.9/5\uFF0C\u8D85\u904E 10,000 \u4F4D\u6EE0\u610F\u9867\u5BA2\u7684\u4FE1\u8CF4\u4E4B\u9078\u3002' },
  'th':         { express: '\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19\u0E14\u0E49\u0E27\u0E22 PayPal', or: '\u2605\u2605\u2605\u2605\u2605 \u0E04\u0E30\u0E41\u0E19\u0E19 4.9/5 \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E1E\u0E36\u0E07\u0E1E\u0E2D\u0E43\u0E08\u0E01\u0E27\u0E48\u0E32 10,000 \u0E23\u0E32\u0E22' },
  'vi':         { express: 'Thanh toan bang PayPal',         or: '\u2605\u2605\u2605\u2605\u2605 Danh gia 4,9/5, duoc hon 10.000 khach hang hai long tin tuong.' },
  'id':         { express: 'Bayar dengan PayPal',            or: '\u2605\u2605\u2605\u2605\u2605 Peringkat 4,9/5, dipercaya 10.000+ pelanggan yang puas.' }
};

// Helpers ────────────────────────────────────────────────────────────────────

function splitHeader(raw) {
  // CALQIX locale files start with a C-style /* ... */ comment that must be
  // preserved on write. Strip it before JSON.parse, re-emit it on write.
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const match = raw.match(/^(\s*\/\*[\s\S]*?\*\/\s*)/);
  if (match) return { header: match[1], body: raw.slice(match[1].length) };
  return { header: '', body: raw };
}

function readLocale(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { header, body } = splitHeader(raw);
  return { header, data: JSON.parse(body) };
}

function writeLocale(filePath, header, data) {
  // Match Shopify's pretty-print: 2-space indent, trailing newline, no BOM.
  const out = header + JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, out, { encoding: 'utf8' });
}

function ensurePath(obj, segments) {
  let cursor = obj;
  for (const seg of segments) {
    if (cursor[seg] == null || typeof cursor[seg] !== 'object') {
      cursor[seg] = {};
    }
    cursor = cursor[seg];
  }
  return cursor;
}

// Main ───────────────────────────────────────────────────────────────────────

let touched = 0;
let skipped = 0;
let missing = [];

for (const [localeBase, t] of Object.entries(TRANSLATIONS)) {
  const filename = `${localeBase}.json`;
  const filePath = path.join(LOCALES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    missing.push(filename);
    continue;
  }

  const { header, data } = readLocale(filePath);
  const banner = ensurePath(data, ['shopify', 'checkout', 'alternative_payment_method_banner']);

  let changed = false;
  if (typeof banner.express_checkout !== 'string' || banner.express_checkout.trim() === '') {
    banner.express_checkout = t.express;
    changed = true;
  }
  if (typeof banner.or !== 'string' || banner.or.trim() === '') {
    banner.or = t.or;
    changed = true;
  }

  if (changed) {
    writeLocale(filePath, header, data);
    touched++;
    console.log(`  ✓ ${filename}`);
  } else {
    skipped++;
    console.log(`  · ${filename} (already present)`);
  }
}

console.log('');
console.log(`Updated: ${touched}, already-present: ${skipped}`);
if (missing.length) console.log(`Missing files (no action): ${missing.join(', ')}`);
