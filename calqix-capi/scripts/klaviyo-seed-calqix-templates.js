#!/usr/bin/env node
/**
 * Seed 26 CALQIX-branded email templates into Klaviyo (Pakket C: EN + NL + DE).
 *
 * Templates seeded (idempotent — skips any matching name):
 *   Welcome #1-4 (EN, NL, DE)               = 12
 *   Abandoned Cart T+2h/+24h/+72h (EN/NL/DE) = 9
 *   Post-Purchase Day 0 (EN, NL, DE)         = 3
 *   Post-Purchase Day 7 (EN only)            = 1
 *   Post-Purchase Day 28 (EN only)           = 1
 *                                            ─────
 *                                             26
 *
 * Brand voice: scientific, accessible, clinical, premium, minimalist.
 *   Navy  #1A3B5C      Cream #F7F5F0    White #FFFFFF
 *   Georgia serif headings, sans-serif body, pill CTA, max 560px
 *
 * Dynamic vars used:
 *   {{ first_name|default:"there" }}   — profile first name, fallback
 *   {{ event.extra.checkout_url|default:"https://calqix.com/cart" }} — AC link
 *   {% unsubscribe %}                  — Klaviyo one-click unsub tag
 *
 * Usage:
 *   node scripts/klaviyo-seed-calqix-templates.js            # dry-run (preview)
 *   node scripts/klaviyo-seed-calqix-templates.js --apply    # create in Klaviyo
 *   node scripts/klaviyo-seed-calqix-templates.js --apply --force  # recreate if name exists
 */

require('dotenv').config();
const klaviyo = require('../lib/klaviyo');

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

/* ───────────────────────── Brand styling ───────────────────────── */

function buildTemplateHtml({ locale, preheader, heading, body, ctaLabel, ctaUrl, secondaryCta }) {
  const paragraphs = body
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1A3B5C;">${p}</p>`)
    .join('');
  const secondaryHtml = secondaryCta
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5A6B7C;"><a href="${secondaryCta.url}" style="color:#1A3B5C;text-decoration:underline;">${secondaryCta.label}</a></p>`
    : '';

  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CALQIX</title>
</head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:32px 32px 8px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:2px;color:#1A3B5C;font-weight:400;">CALQIX</div>
        <div style="margin-top:4px;font-size:11px;letter-spacing:1px;color:#5A6B7C;text-transform:uppercase;">Precision Oral Care.</div>
      </td></tr>
      <tr><td style="padding:24px 32px 24px;">
        <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:26px;line-height:1.25;color:#1A3B5C;font-weight:400;">${heading}</h1>
        ${paragraphs}
        <p style="margin:28px 0 0;"><a href="${ctaUrl}" style="display:inline-block;background:#1A3B5C;color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:0.3px;">${ctaLabel}</a></p>
        ${secondaryHtml}
      </td></tr>
      <tr><td style="padding:24px 32px 32px;border-top:1px solid #EDE7DA;">
        <p style="margin:0;font-size:11px;line-height:1.6;color:#8A8577;">CALQIX B.V. · <a href="https://calqix.com" style="color:#8A8577;text-decoration:none;">calqix.com</a></p>
        <p style="margin:8px 0 0;font-size:11px;line-height:1.6;color:#8A8577;">You are receiving this because you signed up via calqix.com. <a href="{% unsubscribe %}" style="color:#8A8577;">Unsubscribe</a>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/* ───────────────────────── Template blueprints ───────────────────────── */

const CTA_ALL = {
  en: 'https://calqix.com/collections/all',
  nl: 'https://calqix.com/nl/collections/all',
  de: 'https://calqix.com/de/collections/all'
};
const CTA_CART = '{{ event.extra.checkout_url|default:"https://calqix.com/cart" }}';
const CTA_WELCOME = {
  en: 'https://calqix.com/collections/all?discount=WELCOME10',
  nl: 'https://calqix.com/nl/collections/all?discount=WELCOME10',
  de: 'https://calqix.com/de/collections/all?discount=WELCOME10'
};
const CTA_SCIENCE = {
  en: 'https://calqix.com/blogs/the-science-journal',
  nl: 'https://calqix.com/nl/blogs/the-science-journal',
  de: 'https://calqix.com/de/blogs/the-science-journal'
};
const CTA_FLOWCORE = {
  en: 'https://calqix.com/products/flowcore',
  nl: 'https://calqix.com/nl/products/flowcore',
  de: 'https://calqix.com/de/products/flowcore'
};

/* ── Welcome #1 — brand intro + 10% code ── */
const WELCOME_1 = {
  en: {
    name: 'CALQIX — Welcome #1 (EN)',
    subject: 'Welcome to CALQIX — your Clean Science Routine starts here',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Clinical care you use every day.',
      heading: 'Welcome, {{ first_name|default:"there" }}.',
      body: [
        'Thank you for joining CALQIX. Over the next week we share the science behind nano-hydroxyapatite, how our OralBiome Pro formula works, and the routine that delivers professional results at home.',
        'As a welcome, enjoy <strong>10% off your first order</strong> with code <strong>WELCOME10</strong> — valid for 7 days.'
      ],
      ctaLabel: 'Shop the collection',
      ctaUrl: CTA_WELCOME.en
    })
  },
  nl: {
    name: 'CALQIX — Welcome #1 (NL)',
    subject: 'Welkom bij CALQIX — jouw Clean Science Routine begint hier',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Klinische verzorging voor dagelijks gebruik.',
      heading: 'Welkom, {{ first_name|default:"daar" }}.',
      body: [
        'Bedankt dat je je hebt aangemeld bij CALQIX. In de komende week delen we de wetenschap achter nano-hydroxyapatite, hoe onze OralBiome Pro formule werkt, en de routine die thuis professionele resultaten oplevert.',
        'Als welkom krijg je <strong>10% korting op je eerste bestelling</strong> met code <strong>WELCOME10</strong> — 7 dagen geldig.'
      ],
      ctaLabel: 'Bekijk de collectie',
      ctaUrl: CTA_WELCOME.nl
    })
  },
  de: {
    name: 'CALQIX — Welcome #1 (DE)',
    subject: 'Willkommen bei CALQIX — deine Clean Science Routine beginnt hier',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'Klinische Pflege für jeden Tag.',
      heading: 'Willkommen, {{ first_name|default:"bei uns" }}.',
      body: [
        'Danke, dass du dich bei CALQIX angemeldet hast. In den nächsten Tagen teilen wir die Wissenschaft hinter Nano-Hydroxylapatit, wie unsere OralBiome Pro Formel wirkt und die Routine, die zuhause professionelle Ergebnisse liefert.',
        'Als Willkommen: <strong>10% Rabatt auf deine erste Bestellung</strong> mit dem Code <strong>WELCOME10</strong> — 7 Tage gültig.'
      ],
      ctaLabel: 'Kollektion ansehen',
      ctaUrl: CTA_WELCOME.de
    })
  }
};

/* ── Welcome #2 — science first ── */
const WELCOME_2 = {
  en: {
    name: 'CALQIX — Welcome #2 (EN)',
    subject: 'The mineral in your enamel, made accessible',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'How nano-hydroxyapatite works.',
      heading: 'Science first. Claims second.',
      body: [
        'Nano-hydroxyapatite is a naturally occurring mineral found in tooth enamel. It was first developed for space missions, where astronauts could not rely on standard dental care. Today, we formulate it into a daily routine you can use at home.',
        'In our Science Journal you will find the studies we reference, how our formulas are built, and what we choose to leave out — fluoride, SLS, and synthetic sweeteners.'
      ],
      ctaLabel: 'Read the research',
      ctaUrl: CTA_SCIENCE.en
    })
  },
  nl: {
    name: 'CALQIX — Welcome #2 (NL)',
    subject: 'Het mineraal uit je glazuur, nu voor thuisgebruik',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Hoe nano-hydroxyapatite werkt.',
      heading: 'Wetenschap eerst. Beloftes daarna.',
      body: [
        'Nano-hydroxyapatite is een natuurlijk mineraal dat in je tandglazuur voorkomt. Het werd oorspronkelijk ontwikkeld voor ruimtemissies, waar astronauten geen gebruikelijke tandheelkunde konden gebruiken. Wij verwerken het nu in een dagelijkse routine voor thuis.',
        'In onze Science Journal vind je de onderzoeken waarnaar we verwijzen, hoe onze formules zijn opgebouwd, en wat we bewust weglaten — fluoride, SLS en synthetische zoetstoffen.'
      ],
      ctaLabel: 'Lees het onderzoek',
      ctaUrl: CTA_SCIENCE.nl
    })
  },
  de: {
    name: 'CALQIX — Welcome #2 (DE)',
    subject: 'Das Mineral deines Zahnschmelzes — jetzt für zuhause',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'So wirkt Nano-Hydroxylapatit.',
      heading: 'Wissenschaft zuerst. Versprechen danach.',
      body: [
        'Nano-Hydroxylapatit ist ein natürlich vorkommendes Mineral deines Zahnschmelzes. Ursprünglich für Raumfahrtmissionen entwickelt, wo Astronauten auf übliche Zahnpflege verzichten mussten. Heute formulieren wir es für die tägliche Routine zuhause.',
        'In unserem Science Journal findest du die Studien, auf die wir uns stützen, wie unsere Formeln aufgebaut sind und was wir bewusst weglassen — Fluorid, SLS und synthetische Süßstoffe.'
      ],
      ctaLabel: 'Forschung lesen',
      ctaUrl: CTA_SCIENCE.de
    })
  }
};

/* ── Welcome #3 — meet FlowCore ── */
const WELCOME_3 = {
  en: {
    name: 'CALQIX — Welcome #3 (EN)',
    subject: 'FlowCore — professional clean, anywhere',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: '3 pressure modes. Cordless. IPX7.',
      heading: 'Meet FlowCore.',
      body: [
        'Most water flossers are noisy, bulky, or tethered to a wall. FlowCore is different: three pressure modes (gentle, normal, deep clean), a 300ml tank, USB-C charging, and IPX7 waterproof rating — use it in the shower if you like.',
        '1400 pulses per minute, cordless, fits in a carry-on. Built for the routine you actually maintain.'
      ],
      ctaLabel: 'Discover FlowCore',
      ctaUrl: CTA_FLOWCORE.en
    })
  },
  nl: {
    name: 'CALQIX — Welcome #3 (NL)',
    subject: 'FlowCore — professionele reiniging, overal',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: '3 drukstanden. Draadloos. IPX7.',
      heading: 'Maak kennis met FlowCore.',
      body: [
        'De meeste waterflossers zijn luidruchtig, log of aan de muur gebonden. FlowCore doet het anders: drie drukstanden (gentle, normal, deep clean), een 300ml tank, USB-C opladen en IPX7 waterdicht — gebruik hem desgewenst onder de douche.',
        '1400 pulsen per minuut, draadloos, past in handbagage. Gebouwd voor de routine die je echt volhoudt.'
      ],
      ctaLabel: 'Ontdek FlowCore',
      ctaUrl: CTA_FLOWCORE.nl
    })
  },
  de: {
    name: 'CALQIX — Welcome #3 (DE)',
    subject: 'FlowCore — professionelle Reinigung, überall',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: '3 Druckstufen. Kabellos. IPX7.',
      heading: 'Das ist FlowCore.',
      body: [
        'Die meisten Munddusche-Geräte sind laut, sperrig oder kabelgebunden. FlowCore macht es anders: drei Druckstufen (gentle, normal, deep clean), 300ml Tank, USB-C Laden und IPX7 wasserdicht — auch unter der Dusche nutzbar.',
        '1400 Pulse pro Minute, kabellos, passt ins Handgepäck. Entwickelt für die Routine, die du wirklich durchhältst.'
      ],
      ctaLabel: 'FlowCore entdecken',
      ctaUrl: CTA_FLOWCORE.de
    })
  }
};

/* ── Welcome #4 — last chance code ── */
const WELCOME_4 = {
  en: {
    name: 'CALQIX — Welcome #4 (EN)',
    subject: 'Your WELCOME10 code expires tomorrow',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: '10% off your first order — final reminder.',
      heading: '24 hours left.',
      body: [
        'Your welcome code <strong>WELCOME10</strong> expires in 24 hours. It gives you 10% off your first CALQIX order — whether you start with our nano-hydroxyapatite toothpaste tablets, FlowCore water flosser, or the full OralBiome Pro routine.',
        'We do not run loud sales, so this is the one time we send a direct reminder. After this, we will only write when the science is worth reading.'
      ],
      ctaLabel: 'Use my code',
      ctaUrl: CTA_WELCOME.en
    })
  },
  nl: {
    name: 'CALQIX — Welcome #4 (NL)',
    subject: 'Je WELCOME10-code verloopt morgen',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: '10% korting op je eerste bestelling — laatste herinnering.',
      heading: 'Nog 24 uur.',
      body: [
        'Je welkomstcode <strong>WELCOME10</strong> verloopt over 24 uur. Hij geeft je 10% korting op je eerste CALQIX bestelling — of je nu begint met onze nano-hydroxyapatite tandpastatabletten, FlowCore waterflosser, of de volledige OralBiome Pro routine.',
        'We draaien geen luide uitverkopen, dus dit is de enige keer dat we een directe herinnering sturen. Daarna schrijven we alleen als de wetenschap het waard is.'
      ],
      ctaLabel: 'Gebruik mijn code',
      ctaUrl: CTA_WELCOME.nl
    })
  },
  de: {
    name: 'CALQIX — Welcome #4 (DE)',
    subject: 'Dein WELCOME10-Code läuft morgen ab',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: '10% Rabatt auf die erste Bestellung — letzte Erinnerung.',
      heading: 'Noch 24 Stunden.',
      body: [
        'Dein Willkommens-Code <strong>WELCOME10</strong> läuft in 24 Stunden ab. Er gibt dir 10% Rabatt auf deine erste CALQIX Bestellung — egal ob du mit unseren Nano-Hydroxylapatit Zahnpasta-Tabletten, FlowCore Munddusche oder der kompletten OralBiome Pro Routine beginnst.',
        'Wir machen keine lauten Angebote, deshalb ist dies die einzige direkte Erinnerung. Danach schreiben wir nur, wenn die Wissenschaft es wert ist.'
      ],
      ctaLabel: 'Code verwenden',
      ctaUrl: CTA_WELCOME.de
    })
  }
};

/* ── Abandoned Cart T+2h ── */
const AC_1 = {
  en: {
    name: 'CALQIX — Abandoned Cart T+2h (EN)',
    subject: 'Your CALQIX routine is waiting',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Complete your order in one click.',
      heading: 'Your cart is still here.',
      body: [
        'You were a step away from starting your CALQIX routine. We saved your cart — one click and you are back where you left off.',
        'Free EU shipping over €40. 60-day money-back if it is not right for you. No questions, no forms.'
      ],
      ctaLabel: 'Return to my cart',
      ctaUrl: CTA_CART
    })
  },
  nl: {
    name: 'CALQIX — Abandoned Cart T+2h (NL)',
    subject: 'Je CALQIX routine wacht op je',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Rond je bestelling af met één klik.',
      heading: 'Je winkelmand staat nog klaar.',
      body: [
        'Je was één stap van het starten van je CALQIX routine. We hebben je winkelmand bewaard — één klik en je bent terug waar je was.',
        'Gratis EU-verzending vanaf €40. 60 dagen geld-terug als het niks voor jou is. Geen vragen, geen formulieren.'
      ],
      ctaLabel: 'Terug naar mijn winkelmand',
      ctaUrl: CTA_CART
    })
  },
  de: {
    name: 'CALQIX — Abandoned Cart T+2h (DE)',
    subject: 'Deine CALQIX Routine wartet auf dich',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'Schließe deine Bestellung mit einem Klick ab.',
      heading: 'Dein Warenkorb wartet noch.',
      body: [
        'Du warst einen Schritt vom Start deiner CALQIX Routine entfernt. Wir haben deinen Warenkorb gespeichert — ein Klick und du bist, wo du aufgehört hast.',
        'Kostenloser EU-Versand ab €40. 60 Tage Geld-zurück-Garantie, falls es nicht zu dir passt. Keine Fragen, keine Formulare.'
      ],
      ctaLabel: 'Zurück zum Warenkorb',
      ctaUrl: CTA_CART
    })
  }
};

/* ── Abandoned Cart T+24h ── */
const AC_2 = {
  en: {
    name: 'CALQIX — Abandoned Cart T+24h (EN)',
    subject: 'Before you decide — what customers say',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Reviews, ingredients, next steps.',
      heading: 'Science you can feel.',
      body: [
        'Our customers describe the first two weeks as "different, but in a good way" — less morning film, cleaner aftertaste, calmer gums. The formula is vegan, fluoride-free, cruelty-free, and made with nano-hydroxyapatite.',
        'We include the ingredient list on every product page. No hidden synthetics, no fragrance fillers.'
      ],
      ctaLabel: 'Return to my cart',
      ctaUrl: CTA_CART,
      secondaryCta: { label: 'Read full ingredient list →', url: 'https://calqix.com/pages/ingredients' }
    })
  },
  nl: {
    name: 'CALQIX — Abandoned Cart T+24h (NL)',
    subject: 'Voor je besluit — wat klanten zeggen',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Reviews, ingrediënten, volgende stap.',
      heading: 'Wetenschap die je voelt.',
      body: [
        'Onze klanten beschrijven de eerste twee weken als "anders, maar op een goede manier" — minder ochtendfilm, schonere nasmaak, rustigere tandvlees. De formule is vegan, fluoride-vrij, dierproefvrij en gemaakt met nano-hydroxyapatite.',
        'De complete ingrediëntenlijst staat op elke productpagina. Geen verborgen synthetica, geen geurvullingen.'
      ],
      ctaLabel: 'Terug naar mijn winkelmand',
      ctaUrl: CTA_CART,
      secondaryCta: { label: 'Bekijk volledige ingrediëntenlijst →', url: 'https://calqix.com/nl/pages/ingredients' }
    })
  },
  de: {
    name: 'CALQIX — Abandoned Cart T+24h (DE)',
    subject: 'Bevor du entscheidest — was Kunden sagen',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'Bewertungen, Inhaltsstoffe, nächster Schritt.',
      heading: 'Wissenschaft, die du spürst.',
      body: [
        'Unsere Kunden beschreiben die ersten zwei Wochen als „anders, aber positiv" — weniger Morgenfilm, saubererer Nachgeschmack, ruhigeres Zahnfleisch. Die Formel ist vegan, fluoridfrei, tierversuchsfrei und enthält Nano-Hydroxylapatit.',
        'Die vollständige Zutatenliste steht auf jeder Produktseite. Keine versteckten Synthetika, keine Duftfüllstoffe.'
      ],
      ctaLabel: 'Zurück zum Warenkorb',
      ctaUrl: CTA_CART,
      secondaryCta: { label: 'Vollständige Zutatenliste ansehen →', url: 'https://calqix.com/de/pages/ingredients' }
    })
  }
};

/* ── Abandoned Cart T+72h — 10% recovery ── */
const AC_3 = {
  en: {
    name: 'CALQIX — Abandoned Cart T+72h (EN)',
    subject: '10% off, as a thank you for considering us',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'WELCOME10 — 7 days valid.',
      heading: 'We would love to have you.',
      body: [
        'We do not discount often — our margins go into the formula, not the price tag. But we want you to have a fair first experience.',
        'Use <strong>WELCOME10</strong> at checkout for 10% off your order. Valid for 7 days.'
      ],
      ctaLabel: 'Complete my order',
      ctaUrl: CTA_CART
    })
  },
  nl: {
    name: 'CALQIX — Abandoned Cart T+72h (NL)',
    subject: '10% korting, als dank voor je interesse',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'WELCOME10 — 7 dagen geldig.',
      heading: 'We zien je graag komen.',
      body: [
        'We geven niet snel korting — onze marges zitten in de formule, niet in het prijskaartje. Maar we willen dat je een eerlijke eerste ervaring hebt.',
        'Gebruik <strong>WELCOME10</strong> bij afrekenen voor 10% korting. 7 dagen geldig.'
      ],
      ctaLabel: 'Rond bestelling af',
      ctaUrl: CTA_CART
    })
  },
  de: {
    name: 'CALQIX — Abandoned Cart T+72h (DE)',
    subject: '10% Rabatt, als Dank für dein Interesse',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'WELCOME10 — 7 Tage gültig.',
      heading: 'Wir freuen uns, wenn du bleibst.',
      body: [
        'Wir rabattieren selten — unsere Marge fließt in die Formel, nicht in den Preis. Aber wir möchten dir eine faire erste Erfahrung geben.',
        'Nutze <strong>WELCOME10</strong> beim Checkout für 10% Rabatt. 7 Tage gültig.'
      ],
      ctaLabel: 'Bestellung abschließen',
      ctaUrl: CTA_CART
    })
  }
};

/* ── Post-Purchase Day 0 ── */
const PP_0 = {
  en: {
    name: 'CALQIX — Post-Purchase Day 0 (EN)',
    subject: 'Thank you — here is what happens next',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Your order is confirmed.',
      heading: 'Thank you for your order.',
      body: [
        'Your CALQIX package is on its way. Shipping confirmation with tracking will arrive in the next 1-2 days.',
        'In the meantime, our Science Journal explains why nano-hydroxyapatite behaves differently from fluoride, how to build the routine, and what to expect in week one.'
      ],
      ctaLabel: 'Read the science',
      ctaUrl: CTA_SCIENCE.en
    })
  },
  nl: {
    name: 'CALQIX — Post-Purchase Day 0 (NL)',
    subject: 'Bedankt — dit is wat er volgt',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Je bestelling is bevestigd.',
      heading: 'Bedankt voor je bestelling.',
      body: [
        'Je CALQIX pakket is onderweg. Verzendbevestiging met track & trace volgt in 1-2 dagen.',
        'Ondertussen legt onze Science Journal uit waarom nano-hydroxyapatite anders werkt dan fluoride, hoe je de routine opbouwt, en wat je de eerste week kunt verwachten.'
      ],
      ctaLabel: 'Lees de wetenschap',
      ctaUrl: CTA_SCIENCE.nl
    })
  },
  de: {
    name: 'CALQIX — Post-Purchase Day 0 (DE)',
    subject: 'Danke — so geht es weiter',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'Deine Bestellung ist bestätigt.',
      heading: 'Danke für deine Bestellung.',
      body: [
        'Dein CALQIX Paket ist unterwegs. Die Versandbestätigung mit Tracking folgt in 1-2 Tagen.',
        'In der Zwischenzeit erklärt unser Science Journal, warum Nano-Hydroxylapatit anders wirkt als Fluorid, wie du die Routine aufbaust und was du in der ersten Woche erwarten kannst.'
      ],
      ctaLabel: 'Wissenschaft lesen',
      ctaUrl: CTA_SCIENCE.de
    })
  }
};

/* ── Post-Purchase Day 7 — routine guide (EN only) ── */
const PP_7 = {
  en: {
    name: 'CALQIX — Post-Purchase Day 7 (EN)',
    subject: 'How to unlock the full hydroxyapatite effect',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Your daily routine, optimized.',
      heading: 'The routine that works.',
      body: [
        'Nano-hydroxyapatite builds on your enamel the longer it stays in contact. That is why we built the routine around three moments: <strong>morning</strong> (2 minutes, brush then hold), <strong>evening</strong> (FlowCore first, then paste), and <strong>weekly</strong> (OralBiome Pro rinse).',
        'Small changes, compounded over 30 days. No gimmicks, no extra steps.'
      ],
      ctaLabel: 'View the routine guide',
      ctaUrl: 'https://calqix.com/pages/routine'
    })
  }
};

/* ── Post-Purchase Day 28 — month-1 checkpoint + review (EN only) ── */
const PP_28 = {
  en: {
    name: 'CALQIX — Post-Purchase Day 28 (EN)',
    subject: 'Your enamel month-1 checkpoint',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: '30 days in. Let us check in.',
      heading: 'How did your first month go?',
      body: [
        'By now you have run the routine for about 30 days. Most people notice less morning film, a calmer bite, and a more consistent mouth-feel throughout the day.',
        'If it is working for you, we would appreciate a short review — it helps other people decide. If something is off, reply to this email and we will help.'
      ],
      ctaLabel: 'Share your experience',
      ctaUrl: 'https://calqix.com/pages/review'
    })
  }
};

const TEMPLATES = [
  WELCOME_1.en, WELCOME_1.nl, WELCOME_1.de,
  WELCOME_2.en, WELCOME_2.nl, WELCOME_2.de,
  WELCOME_3.en, WELCOME_3.nl, WELCOME_3.de,
  WELCOME_4.en, WELCOME_4.nl, WELCOME_4.de,
  AC_1.en,      AC_1.nl,      AC_1.de,
  AC_2.en,      AC_2.nl,      AC_2.de,
  AC_3.en,      AC_3.nl,      AC_3.de,
  PP_0.en,      PP_0.nl,      PP_0.de,
  PP_7.en,
  PP_28.en
];

/* ───────────────────────── Idempotent upsert ───────────────────────── */

async function listExistingTemplates() {
  const fetch = require('node-fetch');
  const H = {
    Authorization: 'Klaviyo-API-Key ' + process.env.KLAVIYO_PRIVATE_API_KEY,
    revision: '2024-10-15',
    accept: 'application/vnd.api+json'
  };
  const r = await fetch('https://a.klaviyo.com/api/templates/', { headers: H });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Failed to list templates:', JSON.stringify(j).slice(0, 200));
    return new Map();
  }
  const map = new Map();
  (j.data || []).forEach((t) => {
    map.set(t.attributes.name, t.id);
  });
  return map;
}

async function main() {
  console.log('CALQIX Klaviyo template seeder');
  console.log('  mode:', APPLY ? (FORCE ? 'APPLY --force' : 'APPLY') : 'dry-run');
  console.log('  total templates:', TEMPLATES.length);
  console.log('');

  if (!APPLY) {
    TEMPLATES.forEach((t, i) => {
      const size = Math.round(t.html.length / 1024);
      console.log('  [' + String(i + 1).padStart(2) + '] ' + t.name + ' · subject: ' + t.subject + ' (' + size + 'kb)');
    });
    console.log('\nDry-run. To apply, re-run with --apply');
    return;
  }

  const existing = await listExistingTemplates();

  let created = 0, skipped = 0, updated = 0, failed = 0;

  for (const tpl of TEMPLATES) {
    const existingId = existing.get(tpl.name);

    if (existingId && !FORCE) {
      console.log('· SKIP  ' + tpl.name + ' → id=' + existingId + ' (already exists)');
      skipped += 1;
      continue;
    }

    if (existingId && FORCE) {
      const res = await klaviyo.updateTemplate(existingId, { name: tpl.name, html: tpl.html });
      if (res.ok) {
        console.log('↻ UPDATE ' + tpl.name + ' → id=' + existingId);
        updated += 1;
      } else {
        console.error('✗ FAIL   ' + tpl.name, res.status, JSON.stringify(res.error).slice(0, 200));
        failed += 1;
      }
      continue;
    }

    const res = await klaviyo.createTemplate({ name: tpl.name, html: tpl.html });
    if (res.ok) {
      const id = res.data && res.data.data && res.data.data.id;
      console.log('+ CREATE ' + tpl.name + ' → id=' + id);
      created += 1;
    } else {
      console.error('✗ FAIL   ' + tpl.name, res.status, JSON.stringify(res.error).slice(0, 200));
      failed += 1;
    }

    await new Promise((resolve) => setTimeout(resolve, 120)); // 8 rps cap
  }

  console.log('\nDone. Created=' + created + ' Updated=' + updated + ' Skipped=' + skipped + ' Failed=' + failed);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
