#!/usr/bin/env node
/*
 * Klaviyo idempotent setup — lists + baseline templates.
 *
 * Usage:
 *   node scripts/klaviyo-setup.js ping
 *   node scripts/klaviyo-setup.js lists          # list existing lists
 *   node scripts/klaviyo-setup.js ensure-lists   # create CALQIX lists if missing
 *   node scripts/klaviyo-setup.js flows          # list existing flows
 *   node scripts/klaviyo-setup.js templates      # list existing templates
 *   node scripts/klaviyo-setup.js ensure-templates  # create baseline templates if missing
 *   node scripts/klaviyo-setup.js all            # ping + ensure-lists + ensure-templates
 *
 * Required env: KLAVIYO_PRIVATE_API_KEY.
 * Safe to re-run: looks up existing names before creating anything.
 */

require('dotenv').config();
const klaviyo = require('../lib/klaviyo');

/* List blueprint — one master list per language + a combined master. */
const CALQIX_LISTS = [
  { name: 'CALQIX Newsletter – Master', slug: 'master', locale: 'multi' },
  { name: 'CALQIX Newsletter – NL', slug: 'nl', locale: 'nl' },
  { name: 'CALQIX Newsletter – EN', slug: 'en', locale: 'en' },
  { name: 'CALQIX Newsletter – DE', slug: 'de', locale: 'de' },
  { name: 'CALQIX Newsletter – FR', slug: 'fr', locale: 'fr' }
];

/* Baseline template blueprint — minimal, brand-aligned placeholders.
 * Each flow step in Klaviyo UI can reference these via template id. We only
 * seed content; the flow graph (trigger, delays, filters) is configured in
 * the Klaviyo UI by the operator per docs/klaviyo-setup.md. */
const CALQIX_TEMPLATES = [
  {
    name: 'CALQIX – Welcome #1 (NL)',
    slug: 'welcome-nl-1',
    subject: 'Welkom bij CALQIX — jouw Clean Science Routine begint hier',
    html: buildTemplateHtml({
      locale: 'nl',
      preheader: 'Clinical care, dagelijks bruikbaar.',
      heading: 'Welkom bij CALQIX',
      body: [
        'Bedankt voor je aanmelding. De komende dagen delen we de wetenschap achter hydroxyapatite, onze OralBiome Pro formule, en hoe jij thuis professionele resultaten bereikt.',
        'Als welkom krijg je <strong>10% korting</strong> op je eerste bestelling met code <strong>WELCOME10</strong>.'
      ],
      ctaLabel: 'Shop nu',
      ctaUrl: 'https://calqix.com/collections/all'
    })
  },
  {
    name: 'CALQIX – Welcome #1 (EN)',
    slug: 'welcome-en-1',
    subject: 'Welcome to CALQIX — your Clean Science Routine starts here',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Clinical care you use every day.',
      heading: 'Welcome to CALQIX',
      body: [
        'Thank you for signing up. Over the next few days we will share the science behind hydroxyapatite, our OralBiome Pro formula, and how you achieve professional results at home.',
        'As a welcome gift, enjoy <strong>10% off</strong> your first order with code <strong>WELCOME10</strong>.'
      ],
      ctaLabel: 'Shop now',
      ctaUrl: 'https://calqix.com/collections/all'
    })
  },
  {
    name: 'CALQIX – Welcome #1 (DE)',
    slug: 'welcome-de-1',
    subject: 'Willkommen bei CALQIX — deine Clean Science Routine beginnt hier',
    html: buildTemplateHtml({
      locale: 'de',
      preheader: 'Klinische Pflege für jeden Tag.',
      heading: 'Willkommen bei CALQIX',
      body: [
        'Vielen Dank für deine Anmeldung. In den nächsten Tagen teilen wir die Wissenschaft hinter Hydroxylapatit, unsere OralBiome Pro Formel und wie du zuhause professionelle Ergebnisse erzielst.',
        'Als Willkommensgeschenk erhältst du <strong>10% Rabatt</strong> auf deine erste Bestellung mit dem Code <strong>WELCOME10</strong>.'
      ],
      ctaLabel: 'Jetzt einkaufen',
      ctaUrl: 'https://calqix.com/collections/all'
    })
  },
  {
    name: 'CALQIX – Welcome #1 (FR)',
    slug: 'welcome-fr-1',
    subject: 'Bienvenue chez CALQIX — votre Clean Science Routine commence ici',
    html: buildTemplateHtml({
      locale: 'fr',
      preheader: 'Des soins cliniques pour chaque jour.',
      heading: 'Bienvenue chez CALQIX',
      body: [
        'Merci pour votre inscription. Dans les prochains jours, nous partagerons la science derrière l’hydroxyapatite, notre formule OralBiome Pro, et comment obtenir des résultats professionnels à la maison.',
        'Pour vous accueillir, profitez de <strong>10% de réduction</strong> sur votre première commande avec le code <strong>WELCOME10</strong>.'
      ],
      ctaLabel: 'Acheter maintenant',
      ctaUrl: 'https://calqix.com/collections/all'
    })
  },
  {
    name: 'CALQIX – Abandoned Cart (EN)',
    slug: 'abandoned-cart-en',
    subject: 'Your CALQIX routine is waiting',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Complete your order in a single click.',
      heading: 'Your cart is still here',
      body: [
        'You left a few items in your cart. Secure checkout, free EU shipping over €40, and a 60-day money-back guarantee.'
      ],
      ctaLabel: 'Return to my cart',
      ctaUrl: '{{ event.extra.checkout_url|default:"https://calqix.com/cart" }}'
    })
  },
  {
    name: 'CALQIX – Post-Purchase Thank You (EN)',
    slug: 'post-purchase-en',
    subject: 'Thank you — here is what is next',
    html: buildTemplateHtml({
      locale: 'en',
      preheader: 'Your order is confirmed.',
      heading: 'Thank you for your order',
      body: [
        'Your CALQIX package is on its way. While you wait, learn the routine that unlocks the full hydroxyapatite effect — used by dentists, now available to you.'
      ],
      ctaLabel: 'Read the science',
      ctaUrl: 'https://calqix.com/blogs/the-science-journal'
    })
  }
];

function buildTemplateHtml({ locale, preheader, heading, body, ctaLabel, ctaUrl }) {
  const paragraphs = body.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1A3B5C;">${p}</p>`).join('');
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CALQIX</title>
</head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:32px 32px 8px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:2px;color:#1A3B5C;">CALQIX</div>
      </td></tr>
      <tr><td style="padding:8px 32px 24px;">
        <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:1.2;color:#1A3B5C;">${heading}</h1>
        ${paragraphs}
        <p style="margin:24px 0 0;"><a href="${ctaUrl}" style="display:inline-block;background:#1A3B5C;color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:0.3px;">${ctaLabel}</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px 32px;border-top:1px solid #EDE7DA;">
        <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:#8A8577;">CALQIX B.V. · calqix.com · <a href="{% unsubscribe %}" style="color:#8A8577;">unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/* ───────────────────────── Commands ───────────────────────── */

async function cmdPing() {
  const res = await klaviyo.ping();
  log('ping', res);
}

async function cmdListLists() {
  const res = await klaviyo.listLists({ pageSize: 100 });
  if (!res.ok) return log('listLists', res);
  const items = (res.data && res.data.data) || [];
  console.log(`\nLists (${items.length}):`);
  items.forEach((l) => console.log(`  [${l.id}] ${l.attributes.name}`));
}

async function cmdEnsureLists() {
  const existing = await klaviyo.listLists({ pageSize: 100 });
  if (!existing.ok) return log('ensure-lists: listLists failed', existing);
  const byName = new Map(
    ((existing.data && existing.data.data) || []).map((l) => [l.attributes.name, l.id])
  );

  for (const blueprint of CALQIX_LISTS) {
    const existingId = byName.get(blueprint.name);
    if (existingId) {
      console.log(`✓ list exists: ${blueprint.name} → ${existingId}`);
      continue;
    }
    const created = await klaviyo.createList(blueprint.name);
    if (created.ok) {
      const id = created.data && created.data.data && created.data.data.id;
      console.log(`+ list created: ${blueprint.name} → ${id}`);
    } else {
      console.log(`✗ list create failed: ${blueprint.name}`, created.error);
    }
  }
}

async function cmdListFlows() {
  const res = await klaviyo.listFlows({ pageSize: 100 });
  if (!res.ok) return log('listFlows', res);
  const items = (res.data && res.data.data) || [];
  console.log(`\nFlows (${items.length}):`);
  items.forEach((f) =>
    console.log(
      `  [${f.id}] ${f.attributes.name} · status=${f.attributes.status} · trigger=${f.attributes.trigger_type}`
    )
  );
}

async function cmdListTemplates() {
  const res = await klaviyo.listTemplates({ pageSize: 200 });
  if (!res.ok) return log('listTemplates', res);
  const items = (res.data && res.data.data) || [];
  console.log(`\nTemplates (${items.length}):`);
  items.forEach((t) =>
    console.log(`  [${t.id}] ${t.attributes.name} · editor=${t.attributes.editor_type}`)
  );
}

async function cmdEnsureTemplates() {
  const existing = await klaviyo.listTemplates({ pageSize: 200 });
  if (!existing.ok) return log('ensure-templates: listTemplates failed', existing);
  const byName = new Map(
    ((existing.data && existing.data.data) || []).map((t) => [t.attributes.name, t.id])
  );

  for (const tpl of CALQIX_TEMPLATES) {
    const existingId = byName.get(tpl.name);
    if (existingId) {
      console.log(`✓ template exists: ${tpl.name} → ${existingId}`);
      continue;
    }
    const created = await klaviyo.createTemplate({ name: tpl.name, html: tpl.html });
    if (created.ok) {
      const id = created.data && created.data.data && created.data.data.id;
      console.log(`+ template created: ${tpl.name} → ${id}`);
    } else {
      console.log(`✗ template create failed: ${tpl.name}`, created.error);
    }
  }
}

function log(label, res) {
  if (res && res.ok) {
    console.log(`✓ ${label}: status=${res.status}${res.skipped ? ' (skipped)' : ''}`);
  } else {
    console.log(`✗ ${label}: status=${res && res.status} error=${JSON.stringify(res && res.error)}`);
  }
}

async function main() {
  const cmd = (process.argv[2] || '').toLowerCase();
  if (!cmd) {
    console.log(
      'Usage: node scripts/klaviyo-setup.js <ping|lists|ensure-lists|flows|templates|ensure-templates|all>'
    );
    process.exit(0);
  }

  if (cmd === 'ping') return cmdPing();
  if (cmd === 'lists') return cmdListLists();
  if (cmd === 'ensure-lists') return cmdEnsureLists();
  if (cmd === 'flows') return cmdListFlows();
  if (cmd === 'templates') return cmdListTemplates();
  if (cmd === 'ensure-templates') return cmdEnsureTemplates();
  if (cmd === 'all') {
    await cmdPing();
    await cmdEnsureLists();
    await cmdEnsureTemplates();
    await cmdListFlows();
    return;
  }
  console.log(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[klaviyo-setup] fatal', err);
  process.exit(1);
});
