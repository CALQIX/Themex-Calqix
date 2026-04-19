#!/usr/bin/env node
/* eslint-disable */
// One-off: adds 7 new keys under customer.register in all 8 shipped locales.
// Idempotent: if a key exists already, it is kept as-is.

const fs = require('fs');
const path = require('path');

const TRANSLATIONS = {
  'en.default.json': {
    optional_profile: 'Optional (helps us personalise your experience)',
    birthday: 'Birthday',
    gender: 'Gender',
    gender_placeholder: 'Prefer not to say',
    gender_female: 'Female',
    gender_male: 'Male',
    gender_other: 'Other'
  },
  'nl.json': {
    optional_profile: 'Optioneel (helpt ons jouw ervaring te personaliseren)',
    birthday: 'Geboortedatum',
    gender: 'Geslacht',
    gender_placeholder: 'Zeg ik liever niet',
    gender_female: 'Vrouw',
    gender_male: 'Man',
    gender_other: 'Anders'
  },
  'de.json': {
    optional_profile: 'Optional (hilft uns, dein Erlebnis zu personalisieren)',
    birthday: 'Geburtstag',
    gender: 'Geschlecht',
    gender_placeholder: 'Keine Angabe',
    gender_female: 'Weiblich',
    gender_male: 'Männlich',
    gender_other: 'Divers'
  },
  'fr.json': {
    optional_profile: 'Facultatif (nous aide à personnaliser votre expérience)',
    birthday: 'Date de naissance',
    gender: 'Genre',
    gender_placeholder: 'Préfère ne pas dire',
    gender_female: 'Femme',
    gender_male: 'Homme',
    gender_other: 'Autre'
  },
  'fi.json': {
    optional_profile: 'Valinnainen (auttaa meitä personoimaan kokemuksesi)',
    birthday: 'Syntymäpäivä',
    gender: 'Sukupuoli',
    gender_placeholder: 'En halua kertoa',
    gender_female: 'Nainen',
    gender_male: 'Mies',
    gender_other: 'Muu'
  },
  'nb.json': {
    optional_profile: 'Valgfritt (hjelper oss å tilpasse opplevelsen din)',
    birthday: 'Fødselsdag',
    gender: 'Kjønn',
    gender_placeholder: 'Foretrekker å ikke si',
    gender_female: 'Kvinne',
    gender_male: 'Mann',
    gender_other: 'Annet'
  },
  'sv.json': {
    optional_profile: 'Valfritt (hjälper oss att personalisera din upplevelse)',
    birthday: 'Födelsedag',
    gender: 'Kön',
    gender_placeholder: 'Vill inte säga',
    gender_female: 'Kvinna',
    gender_male: 'Man',
    gender_other: 'Annat'
  },
  'da.json': {
    optional_profile: 'Valgfrit (hjælper os med at personalisere din oplevelse)',
    birthday: 'Fødselsdag',
    gender: 'Køn',
    gender_placeholder: 'Foretrækker ikke at sige',
    gender_female: 'Kvinde',
    gender_male: 'Mand',
    gender_other: 'Andet'
  }
};

const localesDir = path.resolve(__dirname, '..', 'locales');

for (const [file, keys] of Object.entries(TRANSLATIONS)) {
  const fullPath = path.join(localesDir, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] ${file} - not found`);
    continue;
  }

  const raw = fs.readFileSync(fullPath, 'utf8');

  // Shopify locale files may carry a leading /* ... */ comment header. Preserve it.
  let header = '';
  let body = raw;
  const cm = raw.match(/^(\s*\/\*[\s\S]*?\*\/\s*)/);
  if (cm) {
    header = cm[1];
    body = raw.slice(cm[1].length);
  }

  const data = JSON.parse(body);
  if (!data.customer) data.customer = {};
  if (!data.customer.register) data.customer.register = {};

  let added = 0;
  for (const [k, v] of Object.entries(keys)) {
    if (data.customer.register[k] == null) {
      data.customer.register[k] = v;
      added++;
    }
  }

  if (added > 0) {
    fs.writeFileSync(fullPath, header + JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`[OK] ${file} - added ${added} keys`);
  } else {
    console.log(`[SKIP] ${file} - all keys present`);
  }
}
