/* eslint-disable no-console */
/**
 * scripts/add-drawer-greeting-locales.js
 * --------------------------------------------------------------------
 * One-off backfill: inject the `cx.header.greeting.{morning|afternoon|evening}`
 * keys into every Shopify content locale (skips *.schema.json which only
 * holds theme-editor labels).
 *
 * Idempotent: if a locale already contains `"greeting"` under `cx.header`
 * the file is left untouched. Files with a `cx` key but no `greeting`
 * sub-tree are also left alone — flag the file for manual review by
 * exiting non-zero in that case.
 * --------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');

/** Locale → { morning, afternoon, evening } */
const greetings = {
  ar:       { m: 'صباح الخير، {{ name }}',          a: 'طاب يومك، {{ name }}',         e: 'مساء الخير، {{ name }}' },
  'bg-BG':  { m: 'Добро утро, {{ name }}',          a: 'Добър ден, {{ name }}',        e: 'Добър вечер, {{ name }}' },
  cs:       { m: 'Dobré ráno, {{ name }}',          a: 'Dobré odpoledne, {{ name }}',  e: 'Dobrý večer, {{ name }}' },
  da:       { m: 'Godmorgen, {{ name }}',           a: 'Goddag, {{ name }}',           e: 'Godaften, {{ name }}' },
  de:       { m: 'Guten Morgen, {{ name }}',        a: 'Guten Tag, {{ name }}',        e: 'Guten Abend, {{ name }}' },
  el:       { m: 'Καλημέρα, {{ name }}',            a: 'Καλό απόγευμα, {{ name }}',    e: 'Καλησπέρα, {{ name }}' },
  es:       { m: 'Buenos días, {{ name }}',         a: 'Buenas tardes, {{ name }}',    e: 'Buenas noches, {{ name }}' },
  fi:       { m: 'Hyvää huomenta, {{ name }}',      a: 'Hyvää iltapäivää, {{ name }}', e: 'Hyvää iltaa, {{ name }}' },
  fr:       { m: 'Bonjour, {{ name }}',             a: 'Bon après-midi, {{ name }}',   e: 'Bonsoir, {{ name }}' },
  'hr-HR':  { m: 'Dobro jutro, {{ name }}',         a: 'Dobar dan, {{ name }}',        e: 'Dobra večer, {{ name }}' },
  hu:       { m: 'Jó reggelt, {{ name }}',          a: 'Jó napot, {{ name }}',         e: 'Jó estét, {{ name }}' },
  id:       { m: 'Selamat pagi, {{ name }}',        a: 'Selamat siang, {{ name }}',    e: 'Selamat malam, {{ name }}' },
  it:       { m: 'Buongiorno, {{ name }}',          a: 'Buon pomeriggio, {{ name }}',  e: 'Buonasera, {{ name }}' },
  ja:       { m: 'おはようございます、{{ name }}さん', a: 'こんにちは、{{ name }}さん',     e: 'こんばんは、{{ name }}さん' },
  ko:       { m: '좋은 아침이에요, {{ name }}님',     a: '좋은 오후예요, {{ name }}님',    e: '좋은 저녁이에요, {{ name }}님' },
  'lt-LT':  { m: 'Labas rytas, {{ name }}',         a: 'Laba diena, {{ name }}',       e: 'Labas vakaras, {{ name }}' },
  nb:       { m: 'God morgen, {{ name }}',          a: 'God ettermiddag, {{ name }}',  e: 'God kveld, {{ name }}' },
  pl:       { m: 'Dzień dobry, {{ name }}',         a: 'Dzień dobry, {{ name }}',      e: 'Dobry wieczór, {{ name }}' },
  'pt-BR':  { m: 'Bom dia, {{ name }}',             a: 'Boa tarde, {{ name }}',        e: 'Boa noite, {{ name }}' },
  'pt-PT':  { m: 'Bom dia, {{ name }}',             a: 'Boa tarde, {{ name }}',        e: 'Boa noite, {{ name }}' },
  'ro-RO':  { m: 'Bună dimineața, {{ name }}',      a: 'Bună ziua, {{ name }}',        e: 'Bună seara, {{ name }}' },
  ru:       { m: 'Доброе утро, {{ name }}',         a: 'Добрый день, {{ name }}',      e: 'Добрый вечер, {{ name }}' },
  'sk-SK':  { m: 'Dobré ráno, {{ name }}',          a: 'Dobrý deň, {{ name }}',        e: 'Dobrý večer, {{ name }}' },
  'sl-SI':  { m: 'Dobro jutro, {{ name }}',         a: 'Dober dan, {{ name }}',        e: 'Dober večer, {{ name }}' },
  sv:       { m: 'God morgon, {{ name }}',          a: 'God eftermiddag, {{ name }}',  e: 'God kväll, {{ name }}' },
  th:       { m: 'สวัสดีตอนเช้า {{ name }}',         a: 'สวัสดีตอนบ่าย {{ name }}',      e: 'สวัสดีตอนเย็น {{ name }}' },
  tr:       { m: 'Günaydın, {{ name }}',            a: 'İyi günler, {{ name }}',       e: 'İyi akşamlar, {{ name }}' },
  vi:       { m: 'Chào buổi sáng, {{ name }}',      a: 'Chào buổi chiều, {{ name }}',  e: 'Chào buổi tối, {{ name }}' },
  'zh-CN':  { m: '早上好，{{ name }}',                a: '下午好，{{ name }}',             e: '晚上好，{{ name }}' },
  'zh-TW':  { m: '早安，{{ name }}',                  a: '午安，{{ name }}',               e: '晚安，{{ name }}' }
};

function buildBlock(g) {
  return ',\n  "cx": {\n' +
         '    "header": {\n' +
         '      "greeting": {\n' +
         '        "morning": '   + JSON.stringify(g.m) + ',\n' +
         '        "afternoon": ' + JSON.stringify(g.a) + ',\n' +
         '        "evening": '   + JSON.stringify(g.e) + '\n' +
         '      }\n' +
         '    }\n' +
         '  }';
}

let added = 0, skipped = 0, missing = 0, conflicts = 0;

for (const [lang, g] of Object.entries(greetings)) {
  const file = path.join(localesDir, lang + '.json');
  if (!fs.existsSync(file)) {
    console.warn('[skip] ' + lang + '.json not found');
    missing++;
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');

  // If the file already has a cx.header.greeting tree, leave it alone.
  if (/"greeting"\s*:\s*\{[\s\S]*?"morning"/.test(content)) {
    skipped++;
    continue;
  }
  // If `cx` already exists but without our greeting tree, flag for manual merge
  // — mutating existing trees blindly could trample translator-added keys.
  if (/"cx"\s*:/.test(content)) {
    console.error('[conflict] ' + lang + '.json already has a "cx" block — skip, merge manually');
    conflicts++;
    continue;
  }

  // Inject the cx block right before the trailing root `}`.
  const block = buildBlock(g);
  const next  = content.replace(/(\s*)\}\s*$/, block + '\n}\n');
  if (next === content) {
    console.error('[parse-fail] Could not locate root close brace in ' + lang + '.json');
    conflicts++;
    continue;
  }
  fs.writeFileSync(file, next, 'utf8');
  added++;
}

console.log('Added: ' + added + ', Skipped (already present): ' + skipped + ', Missing files: ' + missing + ', Conflicts: ' + conflicts);
process.exit(conflicts > 0 ? 1 : 0);
