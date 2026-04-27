/*
 * Adds the multi-milestone gift bar translations to every theme locale.
 * Three new keys are appended right after `calqix_cart.free_shipping_success`
 * (per locale) so the existing `free_shipping_*` group stays grouped:
 *   - free_support_text_prefix   (usually identical to the shipping prefix)
 *   - free_support_text_suffix   ("for FREE Premium Support!")
 *   - free_support_success       ("You've unlocked FREE Premium Support!")
 *   - all_gifts_unlocked         ("All gifts unlocked!")
 *
 * Run:  node scripts/add-cart-premium-support-i18n.js
 *
 * The script preserves the leading C-style comment header that Shopify-emitted
 * locale files use, writes UTF-8 without BOM, and only edits files that
 * already contain a `calqix_cart` namespace.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Each entry: prefix, suffix, support success line, all-unlocked line.
// Values keep the same tone as the existing free_shipping_* strings so the
// merged copy reads naturally on a single bar.
const TRANSLATIONS = {
  'en.default': {
    pref: 'Spend ',
    suff: ' for FREE Premium Support!',
    succ: "You've unlocked FREE Premium Support!",
    all:  'All gifts unlocked!',
  },
  nl: {
    pref: 'Besteed nog ',
    suff: ' voor GRATIS Premium Support!',
    succ: 'Je hebt GRATIS Premium Support ontgrendeld!',
    all:  'Alle cadeaus ontgrendeld!',
  },
  de: {
    pref: 'Gib noch ',
    suff: ' aus für GRATIS Premium Support!',
    succ: 'Du hast GRATIS Premium Support freigeschaltet!',
    all:  'Alle Geschenke freigeschaltet!',
  },
  fr: {
    pref: 'Dépensez ',
    suff: ' de plus pour un support premium GRATUIT !',
    succ: 'Support premium GRATUIT débloqué !',
    all:  'Tous les cadeaux débloqués !',
  },
  es: {
    pref: 'Gasta ',
    suff: ' más para soporte premium GRATIS!',
    succ: '¡Has desbloqueado soporte premium GRATIS!',
    all:  '¡Todos los regalos desbloqueados!',
  },
  it: {
    pref: 'Spendi ',
    suff: " in più per il supporto premium GRATUITO!",
    succ: 'Hai sbloccato il supporto premium GRATUITO!',
    all:  'Tutti i regali sbloccati!',
  },
  'pt-PT': {
    pref: 'Gasta ',
    suff: ' mais para Suporte Premium GRÁTIS!',
    succ: 'Desbloqueaste Suporte Premium GRÁTIS!',
    all:  'Todos os presentes desbloqueados!',
  },
  'pt-BR': {
    pref: 'Gaste ',
    suff: ' a mais para Suporte Premium GRÁTIS!',
    succ: 'Você desbloqueou Suporte Premium GRÁTIS!',
    all:  'Todos os presentes desbloqueados!',
  },
  sv: {
    pref: 'Spendera ',
    suff: ' till för GRATIS Premium Support!',
    succ: 'Du har låst upp GRATIS Premium Support!',
    all:  'Alla gåvor upplåsta!',
  },
  nb: {
    pref: 'Bruk ',
    suff: ' til for GRATIS Premium Support!',
    succ: 'Du har låst opp GRATIS Premium Support!',
    all:  'Alle gaver låst opp!',
  },
  da: {
    pref: 'Brug ',
    suff: ' mere for GRATIS Premium Support!',
    succ: 'Du har låst op for GRATIS Premium Support!',
    all:  'Alle gaver låst op!',
  },
  fi: {
    pref: 'Käytä vielä ',
    suff: ' saadaksesi ILMAISEN Premium-tuen!',
    succ: 'Olet avannut ILMAISEN Premium-tuen!',
    all:  'Kaikki lahjat avattu!',
  },
  pl: {
    pref: 'Wydaj jeszcze ',
    suff: ', aby uzyskać DARMOWE Wsparcie Premium!',
    succ: 'Odblokowałeś DARMOWE Wsparcie Premium!',
    all:  'Wszystkie prezenty odblokowane!',
  },
  cs: {
    pref: 'Utraťte ještě ',
    suff: ', získáte ZDARMA Premium podporu!',
    succ: 'Odemkli jste ZDARMA Premium podporu!',
    all:  'Všechny dárky odemčeny!',
  },
  'sk-SK': {
    pref: 'Minite ešte ',
    suff: ' a získate ZDARMA Premium podporu!',
    succ: 'Odomkli ste ZDARMA Premium podporu!',
    all:  'Všetky darčeky odomknuté!',
  },
  hu: {
    pref: 'Költs még ',
    suff: '-t INGYEN Premium támogatásért!',
    succ: 'INGYEN Premium támogatást nyitottál meg!',
    all:  'Az összes ajándék feloldva!',
  },
  'ro-RO': {
    pref: 'Cheltuiește încă ',
    suff: ' pentru Suport Premium GRATUIT!',
    succ: 'Ai deblocat Suportul Premium GRATUIT!',
    all:  'Toate cadourile deblocate!',
  },
  el: {
    pref: 'Ξόδεψε ',
    suff: ' ακόμη για ΔΩΡΕΑΝ Premium Υποστήριξη!',
    succ: 'Ξεκλείδωσες ΔΩΡΕΑΝ Premium Υποστήριξη!',
    all:  'Όλα τα δώρα ξεκλειδώθηκαν!',
  },
  'bg-BG': {
    pref: 'Похарчи още ',
    suff: ' за БЕЗПЛАТНА Premium поддръжка!',
    succ: 'Отключи БЕЗПЛАТНА Premium поддръжка!',
    all:  'Всички подаръци отключени!',
  },
  ru: {
    pref: 'Потрать ещё ',
    suff: ' на БЕСПЛАТНУЮ Premium-поддержку!',
    succ: 'Ты разблокировал БЕСПЛАТНУЮ Premium-поддержку!',
    all:  'Все подарки разблокированы!',
  },
  tr: {
    pref: 'Daha ',
    suff: " harca ÜCRETSİZ Premium Destek için!",
    succ: 'ÜCRETSİZ Premium Destek kilidini açtın!',
    all:  'Tüm hediyelerin kilidi açıldı!',
  },
  ar: {
    pref: 'أنفق ',
    suff: ' إضافية للحصول على دعم Premium مجاني!',
    succ: 'لقد فتحت دعم Premium المجاني!',
    all:  'تم فتح جميع الهدايا!',
  },
  ja: {
    pref: 'あと ',
    suff: ' お買い上げで無料のプレミアムサポート!',
    succ: '無料のプレミアムサポートを獲得しました!',
    all:  'すべてのギフトがアンロックされました!',
  },
  ko: {
    pref: '추가 ',
    suff: ' 구매 시 무료 프리미엄 지원!',
    succ: '무료 프리미엄 지원이 잠금 해제되었습니다!',
    all:  '모든 선물이 잠금 해제되었습니다!',
  },
  'zh-CN': {
    pref: '再购买 ',
    suff: ' 即可获得免费高级支持!',
    succ: '已解锁免费高级支持!',
    all:  '所有礼品均已解锁!',
  },
  'zh-TW': {
    pref: '再購買 ',
    suff: ' 即可獲得免費高級支援!',
    succ: '已解鎖免費高級支援!',
    all:  '所有禮品均已解鎖!',
  },
  th: {
    pref: 'ใช้จ่ายอีก ',
    suff: ' รับ Premium Support ฟรี!',
    succ: 'ปลดล็อก Premium Support ฟรีแล้ว!',
    all:  'ปลดล็อกของขวัญทั้งหมดแล้ว!',
  },
  vi: {
    pref: 'Chi thêm ',
    suff: ' để được Hỗ trợ Premium MIỄN PHÍ!',
    succ: 'Bạn đã mở khóa Hỗ trợ Premium MIỄN PHÍ!',
    all:  'Tất cả quà tặng đã được mở khóa!',
  },
  id: {
    pref: 'Belanja ',
    suff: ' lagi untuk Premium Support GRATIS!',
    succ: 'Kamu mendapatkan Premium Support GRATIS!',
    all:  'Semua hadiah terbuka!',
  },
  'hr-HR': {
    pref: 'Potroši još ',
    suff: ' za BESPLATNU Premium podršku!',
    succ: 'Otključao si BESPLATNU Premium podršku!',
    all:  'Svi pokloni otključani!',
  },
  'sl-SI': {
    pref: 'Porabi še ',
    suff: ' za BREZPLAČNO Premium podporo!',
    succ: 'Odklenil si BREZPLAČNO Premium podporo!',
    all:  'Vsa darila odklenjena!',
  },
  'lt-LT': {
    pref: 'Išleisk dar ',
    suff: ' ir gauk NEMOKAMĄ Premium pagalbą!',
    succ: 'Atrakinai NEMOKAMĄ Premium pagalbą!',
    all:  'Visos dovanos atrakintos!',
  },
};

function escapeForJsonString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function processFile(filePath, locale) {
  const t = TRANSLATIONS[locale];
  if (!t) {
    console.log(`  SKIP ${locale} (no translation defined)`);
    return false;
  }
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const eol = detectLineEnding(raw);

  // Idempotent: bail if any of the new keys already exist.
  if (raw.indexOf('"free_support_text_prefix"') !== -1) {
    console.log(`  OK   ${locale} (already present)`);
    return true;
  }

  // Anchor: append after `"free_shipping_success": "..."` line so all
  // free_*/all_* keys live next to the existing shipping group.
  const anchorRegex = /([ \t]*)"free_shipping_success"\s*:\s*"[^"]*"\s*,\s*\r?\n/;
  const m = raw.match(anchorRegex);
  if (!m) {
    console.log(`  WARN ${locale} no free_shipping_success found, skipping`);
    return false;
  }
  const indent = m[1] || '    ';
  const insertion =
    `${indent}"free_support_text_prefix": "${escapeForJsonString(t.pref)}",${eol}` +
    `${indent}"free_support_text_suffix": "${escapeForJsonString(t.suff)}",${eol}` +
    `${indent}"free_support_success": "${escapeForJsonString(t.succ)}",${eol}` +
    `${indent}"all_gifts_unlocked": "${escapeForJsonString(t.all)}",${eol}`;
  raw = raw.replace(anchorRegex, m[0] + insertion);
  fs.writeFileSync(filePath, raw, { encoding: 'utf8' });
  console.log(`  OK   ${locale}`);
  return true;
}

function validateJson(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const commentMatch = raw.match(/^\s*\/\*[\s\S]*?\*\//);
  if (commentMatch) raw = raw.slice(commentMatch[0].length);
  JSON.parse(raw);
}

function main() {
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'));
  console.log(`Found ${files.length} locale value files in ${LOCALES_DIR}`);
  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const locale = f.replace(/\.json$/, '').replace(/\.default$/, '');
    const filePath = path.join(LOCALES_DIR, f);
    try {
      const key = f === 'en.default.json' ? 'en.default' : locale;
      if (processFile(filePath, key)) ok++;
      validateJson(filePath);
    } catch (e) {
      fail++;
      console.error(`  FAIL ${f}: ${e.message}`);
    }
  }
  console.log(`Done. Updated: ${ok}. Failed: ${fail}.`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
