/**
 * Adds cx.header.cta.{account,login} translations to every storefront locale.
 *
 * - account: "My account" — shown on the drawer CTA when the customer is logged in
 * - login:   "Log in"     — shown when the customer is logged out
 *
 * Idempotent: existing keys are NEVER overwritten; missing keys only.
 * Preserves the leading C-style /* ... *\/ header comment that CALQIX
 * locale files carry. UTF-8 without BOM.
 *
 * Run: node scripts/add-drawer-account-cta-i18n.js
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Translations are sentence-case and use each locale's natural account/login
// vocabulary (matching Shopify's own customer-area conventions where possible).
const TRANSLATIONS = {
  'en.default': { account: 'My account',                         login: 'Log in' },
  'nl':         { account: 'Mijn account',                       login: 'Inloggen' },
  'de':         { account: 'Mein Konto',                         login: 'Anmelden' },
  'fr':         { account: 'Mon compte',                         login: 'Se connecter' },
  'es':         { account: 'Mi cuenta',                          login: 'Iniciar sesi\u00F3n' },
  'it':         { account: 'Il mio account',                     login: 'Accedi' },
  'pt-BR':      { account: 'Minha conta',                        login: 'Entrar' },
  'pt-PT':      { account: 'A minha conta',                      login: 'Iniciar sess\u00E3o' },
  'pl':         { account: 'Moje konto',                         login: 'Zaloguj si\u0119' },
  'sv':         { account: 'Mitt konto',                         login: 'Logga in' },
  'nb':         { account: 'Min konto',                          login: 'Logg inn' },
  'da':         { account: 'Min konto',                          login: 'Log ind' },
  'fi':         { account: 'Tilini',                             login: 'Kirjaudu sis\u00E4\u00E4n' },
  'cs':         { account: 'M\u016Fj \u00FA\u010Det',           login: 'P\u0159ihl\u00E1sit se' },
  'sk-SK':      { account: 'M\u00F4j \u00FA\u010Det',           login: 'Prihl\u00E1si\u0165 sa' },
  'hu':         { account: 'Fi\u00F3kom',                        login: 'Bejelentkez\u00E9s' },
  'ro-RO':      { account: 'Contul meu',                         login: 'Autentificare' },
  'bg-BG':      { account: '\u041C\u043E\u044F\u0442 \u0430\u043A\u0430\u0443\u043D\u0442', login: '\u0412\u0445\u043E\u0434' },
  'hr-HR':      { account: 'Moj ra\u010Dun',                     login: 'Prijava' },
  'sl-SI':      { account: 'Moj ra\u010Dun',                     login: 'Prijava' },
  'lt-LT':      { account: 'Mano paskyra',                       login: 'Prisijungti' },
  'el':         { account: '\u039F \u03BB\u03BF\u03B3\u03B1\u03C1\u03B9\u03B1\u03C3\u03BC\u03CC\u03C2 \u03BC\u03BF\u03C5', login: '\u03A3\u03CD\u03BD\u03B4\u03B5\u03C3\u03B7' },
  'tr':         { account: 'Hesab\u0131m',                       login: 'Giri\u015F yap' },
  'ru':         { account: '\u041C\u043E\u0439 \u0430\u043A\u043A\u0430\u0443\u043D\u0442', login: '\u0412\u043E\u0439\u0442\u0438' },
  'ar':         { account: '\u062D\u0633\u0627\u0628\u064A',     login: '\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644' },
  'ja':         { account: '\u30DE\u30A4\u30A2\u30AB\u30A6\u30F3\u30C8', login: '\u30ED\u30B0\u30A4\u30F3' },
  'ko':         { account: '\uB0B4 \uACC4\uC815',                login: '\uB85C\uADF8\uC778' },
  'zh-CN':      { account: '\u6211\u7684\u8D26\u6237',           login: '\u767B\u5F55' },
  'zh-TW':      { account: '\u6211\u7684\u5E33\u6236',           login: '\u767B\u5165' },
  'th':         { account: '\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E02\u0E2D\u0E07\u0E09\u0E31\u0E19', login: '\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A' },
  'vi':         { account: 'T\u00E0i kho\u1EA3n c\u1EE7a t\u00F4i', login: '\u0110\u0103ng nh\u1EADp' },
  'id':         { account: 'Akun saya',                          login: 'Masuk' }
};

// Helpers ────────────────────────────────────────────────────────────────────

function splitHeader(raw) {
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
const missing = [];

for (const [localeBase, t] of Object.entries(TRANSLATIONS)) {
  const filename = `${localeBase}.json`;
  const filePath = path.join(LOCALES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    missing.push(filename);
    continue;
  }

  const { header, data } = readLocale(filePath);
  const cta = ensurePath(data, ['cx', 'header', 'cta']);

  let changed = false;
  if (typeof cta.account !== 'string' || cta.account.trim() === '') {
    cta.account = t.account;
    changed = true;
  }
  if (typeof cta.login !== 'string' || cta.login.trim() === '') {
    cta.login = t.login;
    changed = true;
  }

  if (changed) {
    writeLocale(filePath, header, data);
    touched++;
    console.log(`  + ${filename}`);
  } else {
    skipped++;
    console.log(`  . ${filename} (already present)`);
  }
}

console.log('');
console.log(`Updated: ${touched}, already-present: ${skipped}`);
if (missing.length) console.log(`Missing files (no action): ${missing.join(', ')}`);
