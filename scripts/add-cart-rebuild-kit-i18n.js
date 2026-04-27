/*
 * Adds the Rebuild Kit add-on card translations to every theme locale and
 * rewrites the obsolete UPPERCASE `addons_heading` value to a sentence-case
 * version (the cart drawer no longer applies CSS `text-transform: uppercase`).
 *
 * Three new keys are appended right after `calqix_cart.addon_2_price` so the
 * existing `addon_*` group stays grouped:
 *   - addon_rebuild_kit_title
 *   - addon_rebuild_kit_text
 *   - addon_rebuild_kit_badge
 *
 * Run:  node scripts/add-cart-rebuild-kit-i18n.js
 *
 * The script preserves the C-style comment header that Shopify-emitted
 * locale files start with, writes UTF-8 without BOM (per the repo memory
 * about Shopify silently rejecting BOM JSON), and only touches files that
 * already have a `calqix_cart` namespace with `addon_2_price` defined.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

const TRANSLATIONS = {
  'en.default': {
    heading: 'Always handy to have',
    rkTitle: 'Complete the Rebuild Kit',
    rkText: 'Pair your OralBiome with a FlowCore colour for 30% off.',
    rkBadge: '30% OFF',
  },
  nl: {
    heading: 'Altijd handig om te hebben',
    rkTitle: 'Maak je Rebuild Kit compleet',
    rkText: 'Combineer je OralBiome met een FlowCore-kleur en bespaar 30%.',
    rkBadge: '-30%',
  },
  de: {
    heading: 'Immer praktisch zu haben',
    rkTitle: 'Vervollständige dein Rebuild Kit',
    rkText: 'Kombiniere dein OralBiome mit einer FlowCore-Farbe und spare 30%.',
    rkBadge: '-30%',
  },
  fr: {
    heading: 'Toujours utiles à avoir',
    rkTitle: 'Complétez votre Rebuild Kit',
    rkText: 'Associez votre OralBiome à une couleur FlowCore et bénéficiez de 30% de réduction.',
    rkBadge: '-30%',
  },
  es: {
    heading: 'Siempre prácticos para tener',
    rkTitle: 'Completa tu Rebuild Kit',
    rkText: 'Combina tu OralBiome con un color FlowCore y ahorra un 30%.',
    rkBadge: '-30%',
  },
  it: {
    heading: 'Sempre utili da avere',
    rkTitle: 'Completa il tuo Rebuild Kit',
    rkText: 'Abbina il tuo OralBiome a un colore FlowCore e risparmia il 30%.',
    rkBadge: '-30%',
  },
  'pt-PT': {
    heading: 'Sempre à mão',
    rkTitle: 'Completa o teu Rebuild Kit',
    rkText: 'Combina o teu OralBiome com uma cor FlowCore e poupa 30%.',
    rkBadge: '-30%',
  },
  'pt-BR': {
    heading: 'Sempre à mão',
    rkTitle: 'Complete seu Rebuild Kit',
    rkText: 'Combine seu OralBiome com uma cor FlowCore e economize 30%.',
    rkBadge: '-30%',
  },
  sv: {
    heading: 'Alltid bra att ha',
    rkTitle: 'Komplettera din Rebuild Kit',
    rkText: 'Kombinera din OralBiome med en FlowCore-färg och spara 30%.',
    rkBadge: '-30%',
  },
  nb: {
    heading: 'Alltid greit å ha',
    rkTitle: 'Fullfør ditt Rebuild Kit',
    rkText: 'Kombiner OralBiome med en FlowCore-farge og spar 30%.',
    rkBadge: '-30%',
  },
  da: {
    heading: 'Altid godt at have',
    rkTitle: 'Komplettér dit Rebuild Kit',
    rkText: 'Kombiner din OralBiome med en FlowCore-farve og spar 30%.',
    rkBadge: '-30%',
  },
  fi: {
    heading: 'Aina käteviä',
    rkTitle: 'Täydennä Rebuild Kit -setti',
    rkText: 'Yhdistä OralBiome ja FlowCore-väri ja säästä 30%.',
    rkBadge: '-30%',
  },
  pl: {
    heading: 'Zawsze pod ręką',
    rkTitle: 'Skompletuj swój Rebuild Kit',
    rkText: 'Połącz OralBiome z kolorem FlowCore i zaoszczędź 30%.',
    rkBadge: '-30%',
  },
  cs: {
    heading: 'Vždy po ruce',
    rkTitle: 'Doplň svůj Rebuild Kit',
    rkText: 'Spoj OralBiome s barvou FlowCore a ušetři 30%.',
    rkBadge: '-30%',
  },
  'sk-SK': {
    heading: 'Vždy po ruke',
    rkTitle: 'Doplň svoj Rebuild Kit',
    rkText: 'Spoj OralBiome s farbou FlowCore a ušetri 30%.',
    rkBadge: '-30%',
  },
  hu: {
    heading: 'Mindig jól jön',
    rkTitle: 'Egészítsd ki a Rebuild Kitet',
    rkText: 'Párosítsd az OralBiome-ot egy FlowCore színnel, és spórolj 30%-ot.',
    rkBadge: '-30%',
  },
  'ro-RO': {
    heading: 'Mereu la îndemână',
    rkTitle: 'Completează-ți Rebuild Kit-ul',
    rkText: 'Combină OralBiome cu o culoare FlowCore și economisește 30%.',
    rkBadge: '-30%',
  },
  el: {
    heading: 'Πάντα χρήσιμα',
    rkTitle: 'Ολοκλήρωσε το Rebuild Kit',
    rkText: 'Συνδύασε το OralBiome σου με ένα χρώμα FlowCore και κέρδισε 30% έκπτωση.',
    rkBadge: '-30%',
  },
  'bg-BG': {
    heading: 'Винаги под ръка',
    rkTitle: 'Завърши своя Rebuild Kit',
    rkText: 'Комбинирай своя OralBiome с цвят FlowCore и спести 30%.',
    rkBadge: '-30%',
  },
  ru: {
    heading: 'Всегда под рукой',
    rkTitle: 'Заверши свой Rebuild Kit',
    rkText: 'Сочетай OralBiome с цветом FlowCore и сэкономь 30%.',
    rkBadge: '-30%',
  },
  tr: {
    heading: 'Her zaman yanında',
    rkTitle: "Rebuild Kit'ini tamamla",
    rkText: "OralBiome'unu bir FlowCore rengiyle eşleştir, %30 indirim kazan.",
    rkBadge: '-%30',
  },
  ar: {
    heading: 'دائمًا في متناول اليد',
    rkTitle: 'أكمل مجموعة Rebuild Kit الخاصة بك',
    rkText: 'اقرن OralBiome مع لون FlowCore واحصل على خصم 30%.',
    rkBadge: '-30%',
  },
  ja: {
    heading: 'いつでも便利',
    rkTitle: 'Rebuild Kit を完成させる',
    rkText: 'OralBiome に FlowCore カラーを組み合わせて 30% オフ。',
    rkBadge: '-30%',
  },
  ko: {
    heading: '언제나 유용한',
    rkTitle: 'Rebuild Kit를 완성하세요',
    rkText: 'OralBiome와 FlowCore 색상을 함께 구매하고 30% 할인 받으세요.',
    rkBadge: '-30%',
  },
  'zh-CN': {
    heading: '常备好物',
    rkTitle: '完成您的 Rebuild Kit',
    rkText: '将您的 OralBiome 与 FlowCore 颜色搭配,享受 30% 折扣。',
    rkBadge: '-30%',
  },
  'zh-TW': {
    heading: '常備實用',
    rkTitle: '完成您的 Rebuild Kit',
    rkText: '將您的 OralBiome 與 FlowCore 顏色搭配,享受 30% 折扣。',
    rkBadge: '-30%',
  },
  th: {
    heading: 'หยิบใช้ได้ตลอด',
    rkTitle: 'ทำชุด Rebuild Kit ให้ครบ',
    rkText: 'จับคู่ OralBiome กับสี FlowCore รับส่วนลด 30%',
    rkBadge: '-30%',
  },
  vi: {
    heading: 'Luôn hữu dụng',
    rkTitle: 'Hoàn thiện Rebuild Kit của bạn',
    rkText: 'Kết hợp OralBiome với màu FlowCore để được giảm 30%.',
    rkBadge: '-30%',
  },
  id: {
    heading: 'Selalu praktis',
    rkTitle: 'Lengkapi Rebuild Kit kamu',
    rkText: 'Padukan OralBiome dengan warna FlowCore dan hemat 30%.',
    rkBadge: '-30%',
  },
  'hr-HR': {
    heading: 'Uvijek pri ruci',
    rkTitle: 'Upotpuni svoj Rebuild Kit',
    rkText: 'Spoji svoj OralBiome s bojom FlowCore i uštedi 30%.',
    rkBadge: '-30%',
  },
  'sl-SI': {
    heading: 'Vedno pri roki',
    rkTitle: 'Dopolni svoj Rebuild Kit',
    rkText: 'Združi svoj OralBiome z barvo FlowCore in prihrani 30%.',
    rkBadge: '-30%',
  },
  'lt-LT': {
    heading: 'Visada po ranka',
    rkTitle: 'Užbaik savo Rebuild Kit',
    rkText: 'Suderink OralBiome su FlowCore spalva ir sutaupyk 30%.',
    rkBadge: '-30%',
  },
};

function escapeForJsonString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function detectIndent(line) {
  const match = line.match(/^([ \t]+)/);
  return match ? match[1] : '    ';
}

function processFile(filePath, locale) {
  const t = TRANSLATIONS[locale];
  if (!t) {
    console.log(`  SKIP ${locale} (no translation defined)`);
    return false;
  }
  let raw = fs.readFileSync(filePath, 'utf8');
  // Strip BOM if present (defensive — Shopify locale files should be BOM-free)
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const eol = detectLineEnding(raw);

  // 1) Replace the addons_heading value with the new sentence-case version.
  const headingRegex = /("addons_heading"\s*:\s*")([^"]*)(")/;
  if (!headingRegex.test(raw)) {
    console.log(`  WARN ${locale} no addons_heading found`);
    return false;
  }
  raw = raw.replace(headingRegex, `$1${escapeForJsonString(t.heading)}$3`);

  // 2) Insert the three rebuild_kit keys after addon_2_price (idempotent).
  if (raw.indexOf('addon_rebuild_kit_title') !== -1) {
    // Already inserted — only the heading change remains.
    fs.writeFileSync(filePath, raw, { encoding: 'utf8' });
    console.log(`  OK   ${locale} (heading only; rk keys already present)`);
    return true;
  }
  const anchorRegex = /([ \t]*)"addon_2_price"\s*:\s*"[^"]*"\s*,\s*\r?\n/;
  const m = raw.match(anchorRegex);
  if (!m) {
    console.log(`  WARN ${locale} no addon_2_price found, skipping rk insertion`);
    fs.writeFileSync(filePath, raw, { encoding: 'utf8' });
    return false;
  }
  const indent = m[1] || '    ';
  const insertion =
    `${indent}"addon_rebuild_kit_title": "${escapeForJsonString(t.rkTitle)}",${eol}` +
    `${indent}"addon_rebuild_kit_text": "${escapeForJsonString(t.rkText)}",${eol}` +
    `${indent}"addon_rebuild_kit_badge": "${escapeForJsonString(t.rkBadge)}",${eol}`;
  raw = raw.replace(anchorRegex, m[0] + insertion);

  fs.writeFileSync(filePath, raw, { encoding: 'utf8' });
  console.log(`  OK   ${locale}`);
  return true;
}

function validateJson(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  // Strip leading C-style comment header if present.
  const commentMatch = raw.match(/^\s*\/\*[\s\S]*?\*\//);
  if (commentMatch) raw = raw.slice(commentMatch[0].length);
  JSON.parse(raw);
}

function main() {
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'));
  console.log(`Found ${files.length} locale value files in ${LOCALES_DIR}`);
  let updated = 0;
  let failed = 0;
  for (const f of files) {
    const locale = f.replace(/\.json$/, '').replace(/\.default$/, '');
    const filePath = path.join(LOCALES_DIR, f);
    try {
      if (processFile(filePath, f === 'en.default.json' ? 'en.default' : locale)) updated++;
      validateJson(filePath);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${f}: ${e.message}`);
    }
  }
  console.log(`Done. Updated: ${updated}. Failed: ${failed}.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
