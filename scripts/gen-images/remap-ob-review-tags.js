/**
 * One-time remap of existing cron-added review tags into the 4-bucket
 * taxonomy the reviews section filters on (gum_health, fresh_breath,
 * subscription, general).
 *
 * The Anthropic generator now emits only canonical tags, but any entries
 * written before that fix was deployed still carry the old free-form tags
 * (e.g. "breath", "coffee", "gums") — those would otherwise slip through
 * the `all` tab but be invisible in every category tab.
 *
 * Heuristic (keyword → canonical tag):
 *   gum_health   : gum, gums, plaque, bleeding, sensitivity, gingivitis, dental
 *   fresh_breath : breath, halitosis, morning, confidence
 *   subscription : subscription, refill, abo, month, delivery, value, price
 *   general      : everything else
 */
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const STORE = process.env.SHOPIFY_STORE_DOMAIN || 'calqix.myshopify.com';
if (!TOKEN) {
  console.error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN env var. Export it or source calqix-capi/.env.local first.');
  process.exit(1);
}
const HANDLES = [
  'oralbiome-pro-freshmint',
  'oralbiome-pro-cool-mint',
  'oralbiome-pro-citrus-orange',
  'oralbiome-pro-peach',
  'oralbiome-pro-grape'
];

const CANON = ['gum_health', 'fresh_breath', 'subscription', 'general'];

const KEYWORDS = {
  // Stick to strong, content-bearing keywords. Generic time words like
  // "morning"/"evening" are routine markers, not category signals.
  gum_health:   ['gum', 'plaque', 'bleed', 'gingiv', 'sensitiv', 'whiten'],
  fresh_breath: ['breath', 'halitos', 'confidence', 'ochtendadem', 'mundgeruch', 'mondgeur', 'atem', 'haleine'],
  subscription: ['subscription', 'refill', 'abo', 'auto-deliver']
};

function remapTags(tags, body) {
  if (!Array.isArray(tags)) tags = [];
  const lower = tags.map(t => String(t).toLowerCase());
  // If already canonical, keep as-is
  const alreadyCanon = lower.filter(t => CANON.indexOf(t) !== -1);
  if (alreadyCanon.length) {
    return Array.from(new Set(alreadyCanon)).slice(0, 2);
  }

  const hay = (lower.join(' ') + ' ' + String(body || '')).toLowerCase();
  const scored = [];
  for (const [canon, kws] of Object.entries(KEYWORDS)) {
    let hits = 0;
    for (const kw of kws) { if (hay.includes(kw)) hits++; }
    if (hits > 0) scored.push([canon, hits]);
  }
  if (scored.length === 0) return ['general'];
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 2).map(([c]) => c);
}

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}

const dry = process.argv.includes('--dry');

for (const h of HANDLES) {
  const q = `query($h: String!) {
    productByHandle(handle: $h) {
      id handle
      metafield(namespace: "calqix", key: "ob_extra_reviews") { value }
    }
  }`;
  const d = await gql(q, { h });
  const p = d.productByHandle;
  if (!p) { console.log(`${h}: not found`); continue; }
  const mf = p.metafield;
  if (!mf || !mf.value) { console.log(`${h}: no metafield`); continue; }
  let arr = [];
  try { arr = JSON.parse(mf.value); } catch { console.log(`${h}: invalid json`); continue; }
  if (!Array.isArray(arr)) { console.log(`${h}: not array`); continue; }

  let changed = 0;
  const remapped = arr.map(e => {
    if (!e || !Array.isArray(e.tg)) return e;
    const before = e.tg.slice();
    const after = remapTags(e.tg, e.b);
    const same = before.length === after.length && before.every(t => after.indexOf(t) !== -1);
    if (!same) {
      changed++;
      console.log(`  ${h} id=${e.id}: [${before.join(', ')}] → [${after.join(', ')}]`);
      return Object.assign({}, e, { tg: after });
    }
    return e;
  });

  if (changed === 0) {
    console.log(`${h}: nothing to remap (${arr.length} entries)`);
    continue;
  }

  if (dry) {
    console.log(`${h}: DRY — would remap ${changed}/${arr.length}`);
    continue;
  }

  const mutation = `mutation($m: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } }
  }`;
  const vars = {
    m: [{
      ownerId: p.id,
      namespace: 'calqix',
      key: 'ob_extra_reviews',
      type: 'json_string',
      value: JSON.stringify(remapped)
    }]
  };
  const r = await gql(mutation, vars);
  const errs = r.metafieldsSet && r.metafieldsSet.userErrors || [];
  if (errs.length) {
    console.log(`${h}: write errors`, errs);
  } else {
    console.log(`${h}: wrote ${changed}/${arr.length} remapped entries ✓`);
  }
}
