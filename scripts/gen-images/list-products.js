const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const STORE = process.env.SHOPIFY_STORE_DOMAIN || 'calqix.myshopify.com';
if (!TOKEN) {
  console.error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN env var. Export it or source calqix-capi/.env.local first.');
  process.exit(1);
}

const query = `query {
  products(first: 20) {
    edges {
      node {
        id
        handle
        title
        status
      }
    }
  }
}`;

const res = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
  method: 'POST',
  headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
const data = await res.json();
if (data.errors) {
  console.error(JSON.stringify(data.errors));
  process.exit(1);
}
data.data.products.edges.forEach(e => {
  console.log(`${e.node.handle.padEnd(40)} ${e.node.status.padEnd(10)} ${e.node.title}  [${e.node.id}]`);
});
