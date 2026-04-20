/**
 * One-off locale populator for Task 5 (protocol) + Task 8 (final_cta).
 *
 * Adds `homepage_sections.protocol.*` and `homepage_sections.final_cta.*`
 * keys to the 8 primary locales. Idempotent: if a key already exists,
 * it is left untouched. Never overwrites existing translations.
 *
 * Run: node scripts/add-protocol-finalcta-locales.js
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Customer-facing copy per locale.
// Tone: clinical, premium, evidence-based. No em dashes (brand rule).
const COPY = {
  'en.default.json': {
    protocol: {
      eyebrow: 'The CALQIX protocol',
      heading_prefix: 'Two steps.',
      heading_accent: 'One',
      heading_suffix: 'outcome.',
      intro: 'FlowCore clears the way. OralBiome Pro rebuilds the surface. The protocol only works when both steps work together.',
      step_tag: 'Step {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Rebuild your ',
      heading_accent: 'enamel',
      heading_suffix: '.',
      subheading: 'Start the two-step protocol today. Peer-reviewed science, one daily routine, visible results within 30 days.',
      cta_label: 'Add Rebuild Kit to cart',
      trust_shipping: 'Free shipping over €80',
      trust_returns: '30-day returns',
      trust_cancel: 'Cancel anytime',
      error_config: 'Bundle not configured. Please pick two products in Theme Editor.',
      error_generic: 'We could not add the Rebuild Kit. Please try again.',
    },
  },

  'nl.json': {
    protocol: {
      eyebrow: 'Het CALQIX protocol',
      heading_prefix: 'Twee stappen.',
      heading_accent: 'Eén',
      heading_suffix: 'resultaat.',
      intro: 'FlowCore maakt de weg vrij. OralBiome Pro herstelt het oppervlak. Het protocol werkt alleen als beide stappen samenwerken.',
      step_tag: 'Stap {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Herstel je ',
      heading_accent: 'glazuur',
      heading_suffix: '.',
      subheading: 'Start vandaag met het tweestappen protocol. Peer-reviewed wetenschap, één dagelijkse routine, zichtbare resultaten binnen 30 dagen.',
      cta_label: 'Rebuild Kit toevoegen',
      trust_shipping: 'Gratis verzending boven €80',
      trust_returns: '30 dagen retour',
      trust_cancel: 'Altijd opzegbaar',
      error_config: 'Bundle niet geconfigureerd. Kies twee producten in de Theme Editor.',
      error_generic: 'We konden de Rebuild Kit niet toevoegen. Probeer het opnieuw.',
    },
  },

  'de.json': {
    protocol: {
      eyebrow: 'Das CALQIX Protokoll',
      heading_prefix: 'Zwei Schritte.',
      heading_accent: 'Ein',
      heading_suffix: 'Ergebnis.',
      intro: 'FlowCore macht den Weg frei. OralBiome Pro baut die Oberfläche wieder auf. Das Protokoll funktioniert nur, wenn beide Schritte zusammenwirken.',
      step_tag: 'Schritt {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Bauen Sie Ihren ',
      heading_accent: 'Zahnschmelz',
      heading_suffix: ' wieder auf.',
      subheading: 'Starten Sie heute mit dem zweistufigen Protokoll. Peer-reviewed Wissenschaft, eine tägliche Routine, sichtbare Ergebnisse innerhalb von 30 Tagen.',
      cta_label: 'Rebuild Kit hinzufügen',
      trust_shipping: 'Kostenloser Versand ab €80',
      trust_returns: '30 Tage Rückgabe',
      trust_cancel: 'Jederzeit kündbar',
      error_config: 'Bundle nicht konfiguriert. Bitte wählen Sie zwei Produkte im Theme Editor.',
      error_generic: 'Das Rebuild Kit konnte nicht hinzugefügt werden. Bitte versuchen Sie es erneut.',
    },
  },

  'fr.json': {
    protocol: {
      eyebrow: 'Le protocole CALQIX',
      heading_prefix: 'Deux étapes.',
      heading_accent: 'Un',
      heading_suffix: 'résultat.',
      intro: 'FlowCore libère le terrain. OralBiome Pro reconstruit la surface. Le protocole ne fonctionne que si les deux étapes agissent ensemble.',
      step_tag: 'Étape {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Reconstruisez votre ',
      heading_accent: 'émail',
      heading_suffix: '.',
      subheading: 'Commencez le protocole en deux étapes aujourd\'hui. Science évaluée par les pairs, une routine quotidienne, résultats visibles sous 30 jours.',
      cta_label: 'Ajouter le Rebuild Kit',
      trust_shipping: 'Livraison gratuite dès €80',
      trust_returns: 'Retours 30 jours',
      trust_cancel: 'Annulable à tout moment',
      error_config: 'Bundle non configuré. Veuillez choisir deux produits dans le Theme Editor.',
      error_generic: 'Impossible d\'ajouter le Rebuild Kit. Veuillez réessayer.',
    },
  },

  'fi.json': {
    protocol: {
      eyebrow: 'CALQIX protokolla',
      heading_prefix: 'Kaksi vaihetta.',
      heading_accent: 'Yksi',
      heading_suffix: 'tulos.',
      intro: 'FlowCore raivaa tien. OralBiome Pro rakentaa pinnan uudelleen. Protokolla toimii vain, kun molemmat vaiheet toimivat yhdessä.',
      step_tag: 'Vaihe {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Rakenna ',
      heading_accent: 'kiille',
      heading_suffix: ' uudelleen.',
      subheading: 'Aloita kaksivaiheinen protokolla tänään. Vertaisarvioitua tiedettä, yksi päivittäinen rutiini, näkyviä tuloksia 30 päivässä.',
      cta_label: 'Lisää Rebuild Kit',
      trust_shipping: 'Ilmainen toimitus yli €80',
      trust_returns: '30 päivän palautus',
      trust_cancel: 'Peru milloin tahansa',
      error_config: 'Pakettia ei ole määritetty. Valitse kaksi tuotetta Theme Editorissa.',
      error_generic: 'Rebuild Kitin lisääminen ei onnistunut. Yritä uudelleen.',
    },
  },

  'nb.json': {
    protocol: {
      eyebrow: 'CALQIX-protokollen',
      heading_prefix: 'To trinn.',
      heading_accent: 'Ett',
      heading_suffix: 'resultat.',
      intro: 'FlowCore rydder vei. OralBiome Pro gjenoppbygger overflaten. Protokollen virker bare når begge trinnene virker sammen.',
      step_tag: 'Trinn {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Gjenoppbygg ',
      heading_accent: 'emaljen',
      heading_suffix: '.',
      subheading: 'Start den to-trinns protokollen i dag. Fagfellevurdert vitenskap, én daglig rutine, synlige resultater innen 30 dager.',
      cta_label: 'Legg til Rebuild Kit',
      trust_shipping: 'Gratis frakt over €80',
      trust_returns: '30 dagers retur',
      trust_cancel: 'Si opp når som helst',
      error_config: 'Pakken er ikke konfigurert. Velg to produkter i Theme Editor.',
      error_generic: 'Kunne ikke legge til Rebuild Kit. Prøv igjen.',
    },
  },

  'sv.json': {
    protocol: {
      eyebrow: 'CALQIX-protokollet',
      heading_prefix: 'Två steg.',
      heading_accent: 'Ett',
      heading_suffix: 'resultat.',
      intro: 'FlowCore rensar vägen. OralBiome Pro bygger upp ytan igen. Protokollet fungerar bara när båda stegen samverkar.',
      step_tag: 'Steg {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Bygg upp din ',
      heading_accent: 'emalj',
      heading_suffix: ' igen.',
      subheading: 'Starta tvåstegsprotokollet idag. Peer-reviewed vetenskap, en daglig rutin, synliga resultat inom 30 dagar.',
      cta_label: 'Lägg till Rebuild Kit',
      trust_shipping: 'Fri frakt över €80',
      trust_returns: '30 dagars retur',
      trust_cancel: 'Avsluta när du vill',
      error_config: 'Paketet är inte konfigurerat. Välj två produkter i Theme Editor.',
      error_generic: 'Kunde inte lägga till Rebuild Kit. Försök igen.',
    },
  },

  'da.json': {
    protocol: {
      eyebrow: 'CALQIX-protokollen',
      heading_prefix: 'To trin.',
      heading_accent: 'Ét',
      heading_suffix: 'resultat.',
      intro: 'FlowCore rydder vejen. OralBiome Pro genopbygger overfladen. Protokollen virker kun, når begge trin arbejder sammen.',
      step_tag: 'Trin {{ num }}',
    },
    final_cta: {
      heading_prefix: 'Genopbyg din ',
      heading_accent: 'emalje',
      heading_suffix: '.',
      subheading: 'Start det to-trins protokol i dag. Peer-reviewed videnskab, én daglig rutine, synlige resultater inden for 30 dage.',
      cta_label: 'Tilføj Rebuild Kit',
      trust_shipping: 'Gratis fragt over €80',
      trust_returns: '30 dages retur',
      trust_cancel: 'Opsig når som helst',
      error_config: 'Pakken er ikke konfigureret. Vælg to produkter i Theme Editor.',
      error_generic: 'Kunne ikke tilføje Rebuild Kit. Prøv igen.',
    },
  },
};

function deepMerge(target, source) {
  // Only add missing keys. Never overwrite existing values.
  let added = 0;
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      target[key] = source[key];
      added++;
    } else if (
      typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key]) &&
      typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])
    ) {
      added += deepMerge(target[key], source[key]);
    }
    // If key exists at a leaf level, do nothing (preserve operator edits).
  }
  return added;
}

let totalAdded = 0;

for (const [filename, copy] of Object.entries(COPY)) {
  const filePath = path.join(LOCALES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP: ${filename} not found`);
    continue;
  }

  // Preserve JSON comment header if present (some Shopify themes ship a block).
  const raw = fs.readFileSync(filePath, 'utf8');
  let jsonStart = raw.indexOf('{');
  if (jsonStart === -1) {
    console.error(`  ERROR: ${filename} has no JSON`);
    continue;
  }
  const preamble = raw.slice(0, jsonStart);
  const jsonText = raw.slice(jsonStart);

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    console.error(`  ERROR: ${filename} JSON parse failed: ${e.message}`);
    continue;
  }

  // Ensure homepage_sections path exists.
  if (!data.homepage_sections || typeof data.homepage_sections !== 'object') {
    data.homepage_sections = {};
  }

  const before = JSON.stringify(data.homepage_sections);
  const added = deepMerge(data.homepage_sections, copy);
  const after = JSON.stringify(data.homepage_sections);

  if (before === after) {
    console.log(`  ${filename}: already up to date (0 keys added)`);
    continue;
  }

  const formatted = preamble + JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, formatted, 'utf8');
  totalAdded += added;
  console.log(`  ${filename}: +${added} sub-trees added`);
}

console.log(`\nDone. Total sub-trees added: ${totalAdded}`);
