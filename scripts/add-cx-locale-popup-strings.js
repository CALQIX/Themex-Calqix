#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Adds `cx.header.locale.{title, country_currency, language, close}`
 * to every theme locale file under `locales/`. Idempotent — re-runs
 * safely overwrite any existing key values with the canonical
 * translation table below.
 *
 * Usage: node scripts/add-cx-locale-popup-strings.js
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Canonical translations. Keys must exactly match the locale file basenames.
const TRANSLATIONS = {
  'en.default': { title: 'Country & language', country_currency: 'Country / Currency', language: 'Language', close: 'Close' },
  'ar':         { title: 'البلد واللغة',          country_currency: 'البلد / العملة',     language: 'اللغة',    close: 'إغلاق' },
  'bg-BG':      { title: 'Държава и език',         country_currency: 'Държава / Валута',  language: 'Език',     close: 'Затвори' },
  'cs':         { title: 'Země a jazyk',           country_currency: 'Země / Měna',       language: 'Jazyk',    close: 'Zavřít' },
  'da':         { title: 'Land & sprog',           country_currency: 'Land / Valuta',     language: 'Sprog',    close: 'Luk' },
  'de':         { title: 'Land & Sprache',         country_currency: 'Land / Währung',    language: 'Sprache',  close: 'Schließen' },
  'el':         { title: 'Χώρα και γλώσσα',        country_currency: 'Χώρα / Νόμισμα',    language: 'Γλώσσα',   close: 'Κλείσιμο' },
  'es':         { title: 'País e idioma',          country_currency: 'País / Moneda',     language: 'Idioma',   close: 'Cerrar' },
  'fi':         { title: 'Maa ja kieli',           country_currency: 'Maa / Valuutta',    language: 'Kieli',    close: 'Sulje' },
  'fr':         { title: 'Pays et langue',         country_currency: 'Pays / Devise',     language: 'Langue',   close: 'Fermer' },
  'hr-HR':      { title: 'Zemlja i jezik',         country_currency: 'Zemlja / Valuta',   language: 'Jezik',    close: 'Zatvori' },
  'hu':         { title: 'Ország és nyelv',        country_currency: 'Ország / Pénznem',  language: 'Nyelv',    close: 'Bezárás' },
  'id':         { title: 'Negara & bahasa',        country_currency: 'Negara / Mata uang',language: 'Bahasa',   close: 'Tutup' },
  'it':         { title: 'Paese e lingua',         country_currency: 'Paese / Valuta',    language: 'Lingua',   close: 'Chiudi' },
  'ja':         { title: '国と言語',                country_currency: '国 / 通貨',          language: '言語',      close: '閉じる' },
  'ko':         { title: '국가 및 언어',             country_currency: '국가 / 통화',        language: '언어',      close: '닫기' },
  'lt-LT':      { title: 'Šalis ir kalba',         country_currency: 'Šalis / Valiuta',   language: 'Kalba',    close: 'Uždaryti' },
  'nb':         { title: 'Land og språk',          country_currency: 'Land / Valuta',     language: 'Språk',    close: 'Lukk' },
  'nl':         { title: 'Land & taal',            country_currency: 'Land / Valuta',     language: 'Taal',     close: 'Sluiten' },
  'pl':         { title: 'Kraj i język',           country_currency: 'Kraj / Waluta',     language: 'Język',    close: 'Zamknij' },
  'pt-BR':      { title: 'País e idioma',          country_currency: 'País / Moeda',      language: 'Idioma',   close: 'Fechar' },
  'pt-PT':      { title: 'País e idioma',          country_currency: 'País / Moeda',      language: 'Idioma',   close: 'Fechar' },
  'ro-RO':      { title: 'Țară și limbă',          country_currency: 'Țară / Monedă',     language: 'Limbă',    close: 'Închide' },
  'ru':         { title: 'Страна и язык',          country_currency: 'Страна / Валюта',   language: 'Язык',     close: 'Закрыть' },
  'sk-SK':      { title: 'Krajina a jazyk',        country_currency: 'Krajina / Mena',    language: 'Jazyk',    close: 'Zavrieť' },
  'sl-SI':      { title: 'Država in jezik',        country_currency: 'Država / Valuta',   language: 'Jezik',    close: 'Zapri' },
  'sv':         { title: 'Land & språk',           country_currency: 'Land / Valuta',     language: 'Språk',    close: 'Stäng' },
  'th':         { title: 'ประเทศและภาษา',           country_currency: 'ประเทศ / สกุลเงิน',  language: 'ภาษา',      close: 'ปิด' },
  'tr':         { title: 'Ülke ve dil',            country_currency: 'Ülke / Para birimi',language: 'Dil',      close: 'Kapat' },
  'vi':         { title: 'Quốc gia & ngôn ngữ',    country_currency: 'Quốc gia / Tiền tệ',language: 'Ngôn ngữ', close: 'Đóng' },
  'zh-CN':      { title: '国家和语言',              country_currency: '国家 / 货币',         language: '语言',      close: '关闭' },
  'zh-TW':      { title: '國家和語言',              country_currency: '國家 / 貨幣',         language: '語言',      close: '關閉' },
};

function basename(file) {
  return file.replace(/\.json$/, '');
}

function readJson(file) {
  // Strip BOM if present, but never re-write one.
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  // Shopify locale files often start with a /* ... */ auto-generated
  // header comment. Capture it so we can re-emit it verbatim.
  let header = '';
  const m = raw.match(/^\s*\/\*[\s\S]*?\*\/\s*/);
  if (m) {
    header = m[0];
    raw = raw.slice(m[0].length);
  }
  return { header, data: JSON.parse(raw) };
}

function writeJson(file, header, data) {
  // Match Shopify formatting: 2-space indent, trailing newline, NO BOM.
  const out = header + JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(file, out, { encoding: 'utf8' });
}

function main() {
  const files = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'));

  let updated = 0;
  let skipped = 0;
  const missing = [];

  for (const file of files) {
    const base = basename(file);
    const trans = TRANSLATIONS[base];
    if (!trans) {
      missing.push(base);
      skipped += 1;
      continue;
    }
    const fullPath = path.join(LOCALES_DIR, file);
    const { header, data } = readJson(fullPath);
    data.cx = data.cx || {};
    data.cx.header = data.cx.header || {};
    data.cx.header.locale = {
      title: trans.title,
      country_currency: trans.country_currency,
      language: trans.language,
      close: trans.close,
    };
    writeJson(fullPath, header, data);
    updated += 1;
    console.log(`  + ${file}`);
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped}`);
  if (missing.length) {
    console.log('Missing translation entries for:', missing.join(', '));
    process.exitCode = 1;
  }
}

main();
