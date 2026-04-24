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

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

const query = `query($h: String!) {
  productByHandle(handle: $h) {
    handle
    title
    metafield(namespace: "calqix", key: "ob_extra_reviews") { value updatedAt }
  }
}`;

for (const h of HANDLES) {
  const r = await gql(query, { h });
  const p = r.data && r.data.productByHandle;
  if (!p) { console.log(`${h}: product missing`); continue; }
  const mf = p.metafield;
  if (!mf) { console.log(`${h}: NO metafield`); continue; }
  let arr = [];
  try { arr = JSON.parse(mf.value); } catch { arr = []; }
  const today = arr.filter(e => e.d === '2026-04-23');
  console.log(`\n=== ${h} (${p.title}) ===`);
  console.log(`   total=${arr.length}  updatedAt=${mf.updatedAt}`);
  console.log(`   today (2026-04-23): ${today.length} reviews`);
  today.forEach(e => {
    console.log(`     id=${e.id} ${'★'.repeat(e.r)} [${e.cc}] ${e.n}: "${e.t}"`);
    console.log(`       ${e.b.substring(0, 140)}${e.b.length > 140 ? '…' : ''}`);
  });
}
