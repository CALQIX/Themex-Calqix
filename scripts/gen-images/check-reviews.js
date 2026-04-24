import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const STORE = process.env.SHOPIFY_STORE_DOMAIN || 'calqix.myshopify.com';
if (!TOKEN) {
  console.error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN env var. Export it or source calqix-capi/.env.local first.');
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

const query = `query {
  productByHandle(handle: "oralbiome") {
    id
    title
    metafield(namespace: "calqix", key: "ob_extra_reviews") {
      value
      updatedAt
      type
    }
  }
}`;

const data = await gql(query);
const p = data.productByHandle;
if (!p) {
  console.log('Product oralbiome NOT FOUND');
  process.exit(0);
}

console.log('Product:', p.title, '(' + p.id + ')');
const mf = p.metafield;
if (!mf) {
  console.log('Metafield calqix.ob_extra_reviews: MISSING (cron never successfully wrote)');
  process.exit(0);
}

console.log('Metafield updatedAt:', mf.updatedAt);
console.log('Metafield type:', mf.type);

try {
  const arr = JSON.parse(mf.value);
  console.log('Total entries:', arr.length);

  // Group by date
  const byDate = {};
  arr.forEach(e => { byDate[e.d || 'unknown'] = (byDate[e.d || 'unknown'] || 0) + 1; });
  const dates = Object.keys(byDate).sort().reverse();

  console.log('\nRecent additions by date:');
  dates.slice(0, 10).forEach(d => console.log(`  ${d}: ${byDate[d]} reviews`));

  console.log('\nFirst 3 entries (most recent):');
  arr.slice(0, 3).forEach(e => {
    console.log(`  id=${e.id} d=${e.d} cc=${e.cc} r=${e.r} "${e.t}" — ${e.n}`);
  });

  console.log('\nLast 3 entries (oldest):');
  arr.slice(-3).forEach(e => {
    console.log(`  id=${e.id} d=${e.d} cc=${e.cc} r=${e.r} "${e.t}" — ${e.n}`);
  });
} catch (e) {
  console.error('Parse error:', e.message);
  console.log('Raw value head:', mf.value.substring(0, 200));
}
