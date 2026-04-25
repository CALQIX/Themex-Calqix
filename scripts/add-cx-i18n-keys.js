/**
 * Adds sections.cx_announcement.* and sections.cx_bottom_bar.* keys to the
 * 8 published front-end locales used by CALQIX:
 *   en.default, nl, de, fr, sv, nb, da, fi
 *
 * Preserves the auto-generated header comment block found at the top of
 * every CALQIX locale file. Writes UTF-8 WITHOUT BOM (Shopify silently
 * rejects BOM JSON, see incident memo 2026-04-24).
 *
 * Idempotent — re-running merges keys without overwriting existing values.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// All 4 known cx-announcement block ids (see sections/header-group.json)
// + the 5 cx-bottom-bar labels. Keys per locale:
const TRANSLATIONS = {
  'en.default': {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Save 30% on the two-step enamel protocol',
      announce_shipping: 'Free shipping on orders over €80, ships within 2 business days',
      announce_guarantee: '30-day money-back guarantee, try it completely risk-free',
      announce_reviews: 'Clinically tested · 4.9★ · Verified customer reviews'
    },
    cx_bottom_bar: {
      label_home: 'Home',
      label_shop: 'Shop',
      label_account: 'Account',
      label_cart: 'Cart',
      aria_label: 'Primary navigation'
    }
  },
  nl: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Bespaar 30% op het tweestaps-glazuurprotocol',
      announce_shipping: 'Gratis verzending vanaf € 80, verzonden binnen 2 werkdagen',
      announce_guarantee: '30 dagen niet-goed-geld-terug, probeer het zonder risico',
      announce_reviews: 'Klinisch getest · 4,9★ · Geverifieerde klantbeoordelingen'
    },
    cx_bottom_bar: {
      label_home: 'Home',
      label_shop: 'Shop',
      label_account: 'Account',
      label_cart: 'Winkelwagen',
      aria_label: 'Primaire navigatie'
    }
  },
  de: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · 30 % Rabatt auf das Zwei-Stufen-Zahnschmelz-Protokoll',
      announce_shipping: 'Kostenloser Versand ab 80 €, Versand innerhalb von 2 Werktagen',
      announce_guarantee: '30 Tage Geld-zurück-Garantie, völlig risikofrei testen',
      announce_reviews: 'Klinisch getestet · 4,9★ · Verifizierte Kundenbewertungen'
    },
    cx_bottom_bar: {
      label_home: 'Start',
      label_shop: 'Shop',
      label_account: 'Konto',
      label_cart: 'Warenkorb',
      aria_label: 'Hauptnavigation'
    }
  },
  fr: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · -30 % sur le protocole en deux étapes pour l’émail',
      announce_shipping: 'Livraison gratuite dès 80 €, expédié sous 2 jours ouvrés',
      announce_guarantee: 'Satisfait ou remboursé sous 30 jours, sans risque',
      announce_reviews: 'Cliniquement testé · 4,9★ · Avis clients vérifiés'
    },
    cx_bottom_bar: {
      label_home: 'Accueil',
      label_shop: 'Boutique',
      label_account: 'Compte',
      label_cart: 'Panier',
      aria_label: 'Navigation principale'
    }
  },
  sv: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Spara 30 % på tvåstegsprotokollet för emalj',
      announce_shipping: 'Fri frakt över 80 €, skickas inom 2 arbetsdagar',
      announce_guarantee: '30 dagars öppet köp, helt riskfritt',
      announce_reviews: 'Kliniskt testad · 4,9★ · Verifierade kundrecensioner'
    },
    cx_bottom_bar: {
      label_home: 'Hem',
      label_shop: 'Butik',
      label_account: 'Konto',
      label_cart: 'Varukorg',
      aria_label: 'Huvudnavigering'
    }
  },
  nb: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Spar 30 % på totrinns-protokollet for emalje',
      announce_shipping: 'Gratis frakt over 80 €, sendes innen 2 virkedager',
      announce_guarantee: '30 dagers åpent kjøp, helt risikofritt',
      announce_reviews: 'Klinisk testet · 4,9★ · Verifiserte kundeomtaler'
    },
    cx_bottom_bar: {
      label_home: 'Hjem',
      label_shop: 'Butikk',
      label_account: 'Konto',
      label_cart: 'Handlekurv',
      aria_label: 'Hovednavigasjon'
    }
  },
  da: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Spar 30 % på totrinsprotokollet til emalje',
      announce_shipping: 'Gratis fragt over 80 €, sendes inden for 2 hverdage',
      announce_guarantee: '30 dages pengene-retur, helt risikofrit',
      announce_reviews: 'Klinisk testet · 4,9★ · Verificerede kundeanmeldelser'
    },
    cx_bottom_bar: {
      label_home: 'Hjem',
      label_shop: 'Shop',
      label_account: 'Konto',
      label_cart: 'Kurv',
      aria_label: 'Hovednavigation'
    }
  },
  fi: {
    cx_announcement: {
      announce_rebuild_kit: 'Rebuild Kit · Säästä 30 % kaksivaiheisesta kiilteen suojaussarjasta',
      announce_shipping: 'Ilmainen toimitus yli 80 € tilauksiin, 2 arkipäivän sisällä',
      announce_guarantee: '30 päivän rahat takaisin -takuu, riskittömästi',
      announce_reviews: 'Kliinisesti testattu · 4,9★ · Vahvistetut asiakasarvostelut'
    },
    cx_bottom_bar: {
      label_home: 'Etusivu',
      label_shop: 'Kauppa',
      label_account: 'Tili',
      label_cart: 'Ostoskori',
      aria_label: 'Päänavigointi'
    }
  }
};

function splitHeader(raw) {
  // Match a leading C-style comment block, optionally surrounded by whitespace.
  const match = raw.match(/^(\s*\/\*[\s\S]*?\*\/\s*)/);
  if (match) {
    return { header: match[1], body: raw.slice(match[1].length) };
  }
  return { header: '', body: raw };
}

function deepMerge(target, source) {
  // Only adds keys that are missing — never overwrites existing translations.
  for (const key of Object.keys(source)) {
    if (
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key]) &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      deepMerge(target[key], source[key]);
    } else if (!(key in target)) {
      target[key] = source[key];
    }
  }
  return target;
}

function processLocale(slug, additions) {
  const filename = path.join(LOCALES_DIR, slug + '.json');
  if (!fs.existsSync(filename)) {
    console.warn('SKIP: missing', filename);
    return { slug, status: 'missing' };
  }
  const raw = fs.readFileSync(filename, 'utf8');
  const { header, body } = splitHeader(raw);
  const data = JSON.parse(body);
  if (!data.sections || typeof data.sections !== 'object') {
    data.sections = {};
  }
  const beforeJson = JSON.stringify(data.sections);
  deepMerge(data.sections, additions);
  const afterJson = JSON.stringify(data.sections);
  const changed = beforeJson !== afterJson;

  if (!changed) return { slug, status: 'unchanged' };

  const out = header + JSON.stringify(data, null, 2) + '\n';
  // UTF-8 NO BOM — critical so Shopify accepts the JSON.
  fs.writeFileSync(filename, out, { encoding: 'utf8' });
  return { slug, status: 'updated' };
}

function main() {
  const results = [];
  for (const [slug, additions] of Object.entries(TRANSLATIONS)) {
    results.push(processLocale(slug, additions));
  }
  console.table(results);
}

main();
