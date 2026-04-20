/**
 * Adds/updates the `homepage_sections` namespace across every locale JSON in
 * /locales. Primary locales (en/nl/de/fr/fi/nb/sv/da) get brand-voice
 * translations. Secondary locales get the English fallback so Shopify never
 * renders a raw translation key.
 *
 * Run:
 *   node scripts/add-homepage-sections-locales.js
 *
 * Idempotent: running twice just overwrites with the same values. No
 * existing non-`homepage_sections` keys are touched.
 *
 * Locale files in this repo are JSON with a top-level C-style comment block.
 * This script preserves that header verbatim.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// ---------------------------------------------------------------
// Translations
// ---------------------------------------------------------------

// English is the canonical source. Secondary locales fall back to this.
const EN = {
  rebuild_kit: {
    eyebrow: 'The Rebuild Kit. Two-step protocol.',
    heading_line_1: 'Deep-clean.',
    heading_line_2: 'Then rebuild.',
    subheading:
      'The complete enamel protocol. FlowCore removes what blocks remineralisation. OralBiome Pro rebuilds the surface with nano-hydroxyapatite. Peer-reviewed science, in one routine.',
    trust_shipping: 'Free shipping',
    trust_returns: '30-day returns',
    trust_cancel: 'Cancel anytime',
    bundle_title: 'Your two-step enamel protocol',
    bundle_meta: 'Includes FlowCore + OralBiome Pro.',
    save_badge: 'Save {{ percent }}%',
    step_1: 'Step 1. Deep-clean.',
    step_2: 'Step 2. Rebuild.',
    you_save: 'You save {{ amount }}',
    cta_primary: 'Add Rebuild Kit to cart',
    cta_subscribe: 'Subscribe and save {{ percent }}% more',
    error_config: 'Bundle not configured. Please pick two products in Theme Editor.',
    error_generic: 'We could not add the Rebuild Kit. Please try again.',
    error_network: 'Network error. Please check your connection and retry.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Five clinical flavors.',
    heading_line_1: 'One formula.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Five',
    heading_line_2_suffix: 'experiences.',
    subheading:
      'Nano-hydroxyapatite lozenges with clinically studied probiotic strains. Every flavor delivers the same active ingredients. Pick the taste that keeps you consistent.',
    cta_primary: 'Add to cart',
    cta_subscribe: 'Subscribe',
    save_badge: 'Save {{ percent }}%',
    error_generic: 'We could not add this flavor. Please try again.',
    flavors: {
      freshmint: {
        name: 'Fresh Mint',
        description: 'Cool, crisp, classic. The familiar clean that works for every routine.',
      },
      grape: {
        name: 'Grape',
        description: 'Soft, round, lightly sweet. Evening-friendly without any sugar.',
      },
      peach: {
        name: 'Peach',
        description: 'Warm stone-fruit notes. Balanced, comforting, rarely found in oral care.',
      },
      citrus_orange: {
        name: 'Citrus Orange',
        description: 'Bright zest with a clean finish. Morning routine, lifted.',
      },
      cool_mint: {
        name: 'Cool Mint',
        description: 'Ice-clear menthol. Deeper cooling for the post-meal reset.',
      },
    },
  },
};

const NL = {
  rebuild_kit: {
    eyebrow: 'De Rebuild Kit. Tweestappen protocol.',
    heading_line_1: 'Grondig reinigen.',
    heading_line_2: 'Dan opbouwen.',
    subheading:
      'Het complete glazuurprotocol. FlowCore verwijdert wat remineralisatie belemmert. OralBiome Pro bouwt het oppervlak op met nano-hydroxyapatiet. Peer-reviewed wetenschap, in één routine.',
    trust_shipping: 'Gratis verzending',
    trust_returns: '30 dagen retour',
    trust_cancel: 'Altijd opzegbaar',
    bundle_title: 'Jouw tweestappen glazuurprotocol',
    bundle_meta: 'Inclusief FlowCore + OralBiome Pro.',
    save_badge: 'Bespaar {{ percent }}%',
    step_1: 'Stap 1. Grondig reinigen.',
    step_2: 'Stap 2. Opbouwen.',
    you_save: 'Jij bespaart {{ amount }}',
    cta_primary: 'Voeg Rebuild Kit toe',
    cta_subscribe: 'Abonneer en bespaar nog {{ percent }}%',
    error_config: 'Bundel niet geconfigureerd. Kies twee producten in Theme Editor.',
    error_generic: 'Toevoegen is niet gelukt. Probeer het opnieuw.',
    error_network: 'Netwerkfout. Controleer je verbinding en probeer opnieuw.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Vijf klinische smaken.',
    heading_line_1: 'Eén formule.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Vijf',
    heading_line_2_suffix: 'ervaringen.',
    subheading:
      'Nano-hydroxyapatiet zuigtabletten met klinisch bestudeerde probiotische stammen. Elke smaak levert dezelfde actieve ingrediënten. Kies de smaak die je consistent houdt.',
    cta_primary: 'Toevoegen aan winkelmand',
    cta_subscribe: 'Abonneren',
    save_badge: 'Bespaar {{ percent }}%',
    error_generic: 'Toevoegen is niet gelukt. Probeer het opnieuw.',
    flavors: {
      freshmint: {
        name: 'Fresh Mint',
        description: 'Fris, helder, klassiek. De vertrouwde schoonheidservaring die bij elke routine past.',
      },
      grape: {
        name: 'Grape',
        description: 'Zacht, rond, licht zoet. Prima voor de avond, zonder suiker.',
      },
      peach: {
        name: 'Peach',
        description: 'Warme tonen van steenfruit. Gebalanceerd, aangenaam, zelden in mondverzorging.',
      },
      citrus_orange: {
        name: 'Citrus Orange',
        description: 'Heldere citruszesten met een schone afdronk. De ochtendroutine, verhoogd.',
      },
      cool_mint: {
        name: 'Cool Mint',
        description: 'IJshelder menthol. Dieper koelend voor de reset na een maaltijd.',
      },
    },
  },
};

const DE = {
  rebuild_kit: {
    eyebrow: 'Das Rebuild Kit. Zwei-Schritt-Protokoll.',
    heading_line_1: 'Tief reinigen.',
    heading_line_2: 'Dann aufbauen.',
    subheading:
      'Das komplette Zahnschmelz-Protokoll. FlowCore entfernt, was die Remineralisierung blockiert. OralBiome Pro baut die Oberfläche mit Nano-Hydroxylapatit wieder auf. Peer-reviewed Wissenschaft, in einer Routine.',
    trust_shipping: 'Kostenloser Versand',
    trust_returns: '30 Tage Rückgabe',
    trust_cancel: 'Jederzeit kündbar',
    bundle_title: 'Ihr zweistufiges Zahnschmelz-Protokoll',
    bundle_meta: 'Enthält FlowCore + OralBiome Pro.',
    save_badge: '{{ percent }}% sparen',
    step_1: 'Schritt 1. Tief reinigen.',
    step_2: 'Schritt 2. Aufbauen.',
    you_save: 'Sie sparen {{ amount }}',
    cta_primary: 'Rebuild Kit hinzufügen',
    cta_subscribe: 'Abonnieren und {{ percent }}% mehr sparen',
    error_config: 'Bundle nicht konfiguriert. Bitte zwei Produkte im Theme-Editor wählen.',
    error_generic: 'Hinzufügen nicht möglich. Bitte versuchen Sie es erneut.',
    error_network: 'Netzwerkfehler. Bitte Verbindung prüfen und erneut versuchen.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Fünf klinische Geschmacksrichtungen.',
    heading_line_1: 'Eine Formel.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Fünf',
    heading_line_2_suffix: 'Erfahrungen.',
    subheading:
      'Nano-Hydroxylapatit-Lutschtabletten mit klinisch untersuchten probiotischen Stämmen. Jeder Geschmack liefert dieselben Wirkstoffe. Wählen Sie den Geschmack, bei dem Sie konsequent bleiben.',
    cta_primary: 'In den Warenkorb',
    cta_subscribe: 'Abonnieren',
    save_badge: '{{ percent }}% sparen',
    error_generic: 'Hinzufügen nicht möglich. Bitte versuchen Sie es erneut.',
    flavors: {
      freshmint: {
        name: 'Fresh Mint',
        description: 'Kühl, klar, klassisch. Die vertraute Sauberkeit für jede Routine.',
      },
      grape: {
        name: 'Grape',
        description: 'Weich, rund, leicht süß. Abend-tauglich, ohne Zucker.',
      },
      peach: {
        name: 'Peach',
        description: 'Warme Steinfrucht-Noten. Ausgewogen, angenehm, selten in der Mundpflege.',
      },
      citrus_orange: {
        name: 'Citrus Orange',
        description: 'Helle Zitrusnoten mit klarem Abgang. Die Morgenroutine, gehoben.',
      },
      cool_mint: {
        name: 'Cool Mint',
        description: 'Eisklares Menthol. Tiefere Kühlung für den Reset nach dem Essen.',
      },
    },
  },
};

const FR = {
  rebuild_kit: {
    eyebrow: 'Le Rebuild Kit. Protocole en deux étapes.',
    heading_line_1: 'Nettoyer en profondeur.',
    heading_line_2: 'Puis reconstruire.',
    subheading:
      "Le protocole complet d'émail. FlowCore élimine ce qui bloque la reminéralisation. OralBiome Pro reconstruit la surface avec de la nano-hydroxyapatite. Science évaluée par les pairs, dans une seule routine.",
    trust_shipping: 'Livraison gratuite',
    trust_returns: 'Retours 30 jours',
    trust_cancel: 'Annulable à tout moment',
    bundle_title: "Votre protocole d'émail en deux étapes",
    bundle_meta: 'Comprend FlowCore + OralBiome Pro.',
    save_badge: 'Économisez {{ percent }}%',
    step_1: 'Étape 1. Nettoyer en profondeur.',
    step_2: 'Étape 2. Reconstruire.',
    you_save: 'Vous économisez {{ amount }}',
    cta_primary: 'Ajouter le Rebuild Kit',
    cta_subscribe: 'Abonnez-vous et économisez {{ percent }}% de plus',
    error_config: 'Bundle non configuré. Choisissez deux produits dans le Theme Editor.',
    error_generic: "Impossible d'ajouter le Rebuild Kit. Réessayez s'il vous plaît.",
    error_network: 'Erreur réseau. Vérifiez votre connexion et réessayez.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Cinq saveurs cliniques.',
    heading_line_1: 'Une formule.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Cinq',
    heading_line_2_suffix: 'expériences.',
    subheading:
      "Pastilles à la nano-hydroxyapatite avec des souches probiotiques étudiées cliniquement. Chaque saveur délivre les mêmes ingrédients actifs. Choisissez le goût qui vous fait rester constant.",
    cta_primary: 'Ajouter au panier',
    cta_subscribe: 'Abonner',
    save_badge: 'Économisez {{ percent }}%',
    error_generic: "Impossible d'ajouter cette saveur. Réessayez s'il vous plaît.",
    flavors: {
      freshmint: {
        name: 'Fresh Mint',
        description: 'Frais, net, classique. La propreté familière qui convient à toute routine.',
      },
      grape: {
        name: 'Grape',
        description: 'Doux, rond, légèrement sucré. Adapté au soir, sans sucre.',
      },
      peach: {
        name: 'Peach',
        description: 'Notes chaudes de fruit à noyau. Équilibré, réconfortant, rare en soin bucco-dentaire.',
      },
      citrus_orange: {
        name: 'Citrus Orange',
        description: 'Zeste vif avec une finale nette. La routine du matin, rehaussée.',
      },
      cool_mint: {
        name: 'Cool Mint',
        description: 'Menthol glacé. Rafraîchissement plus profond pour la remise à zéro après un repas.',
      },
    },
  },
};

// Nordic translations: best-effort based on EN source. Flagged for native QA.
// Uses the same structure as EN/NL/DE/FR. Fresh Mint / Grape / Peach /
// Citrus Orange / Cool Mint kept in English (they are product SKU names).

const FI = {
  rebuild_kit: {
    eyebrow: 'Rebuild Kit. Kaksivaiheinen protokolla.',
    heading_line_1: 'Syväpuhdista.',
    heading_line_2: 'Sitten rakenna uudelleen.',
    subheading:
      'Täydellinen kiilleprotokolla. FlowCore poistaa remineralisaation esteet. OralBiome Pro rakentaa pinnan uudelleen nano-hydroksiapatiitilla. Vertaisarvioitua tiedettä yhdessä rutiinissa.',
    trust_shipping: 'Ilmainen toimitus',
    trust_returns: '30 päivän palautus',
    trust_cancel: 'Peru milloin tahansa',
    bundle_title: 'Kaksivaiheinen kiilleprotokollasi',
    bundle_meta: 'Sisältää FlowCoren + OralBiome Pron.',
    save_badge: 'Säästä {{ percent }}%',
    step_1: 'Vaihe 1. Syväpuhdista.',
    step_2: 'Vaihe 2. Rakenna uudelleen.',
    you_save: 'Säästät {{ amount }}',
    cta_primary: 'Lisää Rebuild Kit ostoskoriin',
    cta_subscribe: 'Tilaa ja säästä vielä {{ percent }}%',
    error_config: 'Pakettia ei ole määritetty. Valitse kaksi tuotetta Theme Editorissa.',
    error_generic: 'Lisääminen ei onnistunut. Yritä uudelleen.',
    error_network: 'Verkkovirhe. Tarkista yhteys ja yritä uudelleen.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Viisi kliinistä makua.',
    heading_line_1: 'Yksi kaava.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Viisi',
    heading_line_2_suffix: 'kokemusta.',
    subheading:
      'Nano-hydroksiapatiitti-imeskelytabletit kliinisesti tutkituilla probioottikannoilla. Jokainen maku sisältää samat vaikuttavat aineet. Valitse maku, joka pitää sinut johdonmukaisena.',
    cta_primary: 'Lisää ostoskoriin',
    cta_subscribe: 'Tilaa',
    save_badge: 'Säästä {{ percent }}%',
    error_generic: 'Lisääminen ei onnistunut. Yritä uudelleen.',
    flavors: {
      freshmint: { name: 'Fresh Mint', description: 'Viileä, raikas, klassinen. Tuttu puhtauden tunne jokaiseen rutiiniin.' },
      grape: { name: 'Grape', description: 'Pehmeä, pyöreä, hieman makea. Illaksi sopiva, ilman sokeria.' },
      peach: { name: 'Peach', description: 'Lämpimiä kivihedelmän sävyjä. Tasapainoinen, miellyttävä, harvinainen suunhoidossa.' },
      citrus_orange: { name: 'Citrus Orange', description: 'Kirkkaat sitruksen sävyt ja puhdas jälkimaku. Aamurutiini kohotettuna.' },
      cool_mint: { name: 'Cool Mint', description: 'Jäinen mentoli. Syvempi viilennys aterian jälkeiseen palautumiseen.' },
    },
  },
};

const NB = {
  rebuild_kit: {
    eyebrow: 'Rebuild Kit. To-trinns protokoll.',
    heading_line_1: 'Dyprens.',
    heading_line_2: 'Så gjenoppbygg.',
    subheading:
      'Den komplette emaljeprotokollen. FlowCore fjerner det som blokkerer remineralisering. OralBiome Pro gjenoppbygger overflaten med nano-hydroksyapatitt. Fagfellevurdert vitenskap i én rutine.',
    trust_shipping: 'Gratis frakt',
    trust_returns: '30 dagers retur',
    trust_cancel: 'Si opp når som helst',
    bundle_title: 'Din to-trinns emaljeprotokoll',
    bundle_meta: 'Inkluderer FlowCore + OralBiome Pro.',
    save_badge: 'Spar {{ percent }}%',
    step_1: 'Trinn 1. Dyprens.',
    step_2: 'Trinn 2. Gjenoppbygg.',
    you_save: 'Du sparer {{ amount }}',
    cta_primary: 'Legg Rebuild Kit i handlekurv',
    cta_subscribe: 'Abonner og spar ytterligere {{ percent }}%',
    error_config: 'Pakke ikke konfigurert. Velg to produkter i Theme Editor.',
    error_generic: 'Kunne ikke legges til. Prøv igjen.',
    error_network: 'Nettverksfeil. Sjekk tilkoblingen og prøv igjen.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Fem kliniske smaker.',
    heading_line_1: 'Én formel.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Fem',
    heading_line_2_suffix: 'opplevelser.',
    subheading:
      'Nano-hydroksyapatitt pastiller med klinisk studerte probiotiske stammer. Hver smak gir de samme aktive ingrediensene. Velg smaken som holder deg konsekvent.',
    cta_primary: 'Legg i handlekurv',
    cta_subscribe: 'Abonner',
    save_badge: 'Spar {{ percent }}%',
    error_generic: 'Kunne ikke legges til. Prøv igjen.',
    flavors: {
      freshmint: { name: 'Fresh Mint', description: 'Kjølig, frisk, klassisk. Den kjente renheten som passer enhver rutine.' },
      grape: { name: 'Grape', description: 'Mykt, rundt, lett søtt. Kveldsvennlig, uten sukker.' },
      peach: { name: 'Peach', description: 'Varme toner av steinfrukt. Balansert, behagelig, sjelden i munnpleie.' },
      citrus_orange: { name: 'Citrus Orange', description: 'Lys sitrusaroma med ren ettersmak. Morgenrutinen, løftet.' },
      cool_mint: { name: 'Cool Mint', description: 'Isklar mentol. Dypere kjøling for restart etter måltid.' },
    },
  },
};

const SV = {
  rebuild_kit: {
    eyebrow: 'Rebuild Kit. Tvåstegs protokoll.',
    heading_line_1: 'Djuprengör.',
    heading_line_2: 'Sedan återuppbygg.',
    subheading:
      'Det kompletta emaljprotokollet. FlowCore avlägsnar det som blockerar remineralisering. OralBiome Pro återuppbygger ytan med nano-hydroxiapatit. Peer-reviewed vetenskap i en rutin.',
    trust_shipping: 'Fri frakt',
    trust_returns: '30 dagars retur',
    trust_cancel: 'Avsluta när du vill',
    bundle_title: 'Ditt tvåstegs emaljprotokoll',
    bundle_meta: 'Inkluderar FlowCore + OralBiome Pro.',
    save_badge: 'Spara {{ percent }}%',
    step_1: 'Steg 1. Djuprengör.',
    step_2: 'Steg 2. Återuppbygg.',
    you_save: 'Du sparar {{ amount }}',
    cta_primary: 'Lägg Rebuild Kit i varukorg',
    cta_subscribe: 'Prenumerera och spara ytterligare {{ percent }}%',
    error_config: 'Paketet är inte konfigurerat. Välj två produkter i Theme Editor.',
    error_generic: 'Gick inte att lägga till. Försök igen.',
    error_network: 'Nätverksfel. Kontrollera anslutningen och försök igen.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Fem kliniska smaker.',
    heading_line_1: 'En formel.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Fem',
    heading_line_2_suffix: 'upplevelser.',
    subheading:
      'Nano-hydroxiapatit-sugtabletter med kliniskt studerade probiotiska stammar. Varje smak ger samma aktiva ingredienser. Välj smaken som håller dig konsekvent.',
    cta_primary: 'Lägg i varukorg',
    cta_subscribe: 'Prenumerera',
    save_badge: 'Spara {{ percent }}%',
    error_generic: 'Gick inte att lägga till. Försök igen.',
    flavors: {
      freshmint: { name: 'Fresh Mint', description: 'Svalt, friskt, klassiskt. Den välbekanta renheten som passar varje rutin.' },
      grape: { name: 'Grape', description: 'Mjukt, runt, lätt sött. Kvällsvänligt, utan socker.' },
      peach: { name: 'Peach', description: 'Varma toner av stenfrukt. Balanserat, behagligt, ovanligt i munvård.' },
      citrus_orange: { name: 'Citrus Orange', description: 'Klar citruszest med ren eftersmak. Morgonrutinen, lyft.' },
      cool_mint: { name: 'Cool Mint', description: 'Isklar mentol. Djupare kylning för omstart efter måltid.' },
    },
  },
};

const DA = {
  rebuild_kit: {
    eyebrow: 'Rebuild Kit. To-trins protokol.',
    heading_line_1: 'Dybderens.',
    heading_line_2: 'Så genopbyg.',
    subheading:
      'Den komplette emaljeprotokol. FlowCore fjerner det, der blokerer remineralisering. OralBiome Pro genopbygger overfladen med nano-hydroxyapatit. Peer-reviewed videnskab i én rutine.',
    trust_shipping: 'Gratis fragt',
    trust_returns: '30 dages retur',
    trust_cancel: 'Opsig når som helst',
    bundle_title: 'Din to-trins emaljeprotokol',
    bundle_meta: 'Inkluderer FlowCore + OralBiome Pro.',
    save_badge: 'Spar {{ percent }}%',
    step_1: 'Trin 1. Dybderens.',
    step_2: 'Trin 2. Genopbyg.',
    you_save: 'Du sparer {{ amount }}',
    cta_primary: 'Læg Rebuild Kit i kurv',
    cta_subscribe: 'Abonner og spar yderligere {{ percent }}%',
    error_config: 'Bundle er ikke konfigureret. Vælg to produkter i Theme Editor.',
    error_generic: 'Kunne ikke tilføjes. Prøv igen.',
    error_network: 'Netværksfejl. Tjek forbindelsen og prøv igen.',
  },
  flavor_banner: {
    eyebrow: 'OralBiome Pro. Fem kliniske smagsvarianter.',
    heading_line_1: 'Én formel.',
    heading_line_2_prefix: '',
    heading_line_2_accent: 'Fem',
    heading_line_2_suffix: 'oplevelser.',
    subheading:
      'Nano-hydroxyapatit sugetabletter med klinisk studerede probiotiske stammer. Hver smag leverer de samme aktive ingredienser. Vælg smagen, der holder dig konsekvent.',
    cta_primary: 'Læg i kurv',
    cta_subscribe: 'Abonner',
    save_badge: 'Spar {{ percent }}%',
    error_generic: 'Kunne ikke tilføjes. Prøv igen.',
    flavors: {
      freshmint: { name: 'Fresh Mint', description: 'Kølig, frisk, klassisk. Den velkendte renhed til enhver rutine.' },
      grape: { name: 'Grape', description: 'Blødt, rundt, let sødt. Aftenvenligt, uden sukker.' },
      peach: { name: 'Peach', description: 'Varme toner af stenfrugt. Balanceret, behageligt, sjældent i mundpleje.' },
      citrus_orange: { name: 'Citrus Orange', description: 'Klare citrustoner med ren eftersmag. Morgenrutinen, løftet.' },
      cool_mint: { name: 'Cool Mint', description: 'Isklar mentol. Dybere køling til genstart efter måltid.' },
    },
  },
};

const TRANSLATIONS = {
  'en.default': EN,
  nl: NL,
  de: DE,
  fr: FR,
  fi: FI,
  nb: NB,
  sv: SV,
  da: DA,
};

// ---------------------------------------------------------------
// File processing
// ---------------------------------------------------------------

function stripLeadingCommentBlock(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('/*')) {
    const end = trimmed.indexOf('*/');
    if (end !== -1) {
      return {
        header: text.substring(0, text.indexOf(trimmed)) + trimmed.substring(0, end + 2),
        body: trimmed.substring(end + 2).trimStart(),
      };
    }
  }
  return { header: '', body: text };
}

function upsertNamespace(filePath, translations) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { header, body } = stripLeadingCommentBlock(raw);

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    console.error('  SKIP ' + path.basename(filePath) + ': JSON parse failed — ' + e.message);
    return { changed: false };
  }

  data.homepage_sections = translations;

  const newBody = JSON.stringify(data, null, 2);
  const output = header ? header + '\n' + newBody + '\n' : newBody + '\n';
  fs.writeFileSync(filePath, output, 'utf8');
  return { changed: true };
}

function main() {
  const files = fs.readdirSync(LOCALES_DIR).filter(function (f) {
    // Only customer-facing locale files, not schema
    return f.endsWith('.json') && !f.endsWith('.schema.json');
  });

  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const full = path.join(LOCALES_DIR, file);
    const key = file.replace(/\.json$/, '');
    const translation = TRANSLATIONS[key] || EN;
    const source = TRANSLATIONS[key] ? key : 'en (fallback)';
    process.stdout.write('  ' + file.padEnd(22) + ' <- ' + source.padEnd(16));
    const res = upsertNamespace(full, translation);
    if (res.changed) {
      console.log(' OK');
      updated++;
    } else {
      console.log(' SKIPPED');
      skipped++;
    }
  }

  console.log('\nUpdated: ' + updated + ', skipped: ' + skipped + ', total: ' + files.length);
}

main();
