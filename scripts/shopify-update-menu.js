#!/usr/bin/env node
/**
 * CALQIX — Update Shopify navigation menu via Admin GraphQL API
 * Adds the new nHA blog as first item under "Elena writes" dropdown
 */

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET env vars');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  if (!res.ok) throw new Error('Token failed: ' + res.status);
  const data = await res.json();
  return data.access_token;
}

async function gql(token, query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors, null, 2));
  return data.data;
}

function fullUrl(url) {
  if (!url || url === '#') return 'https://www.calqix.com';
  if (url.startsWith('http')) return url;
  return 'https://www.calqix.com' + url;
}

function buildItemInput(item) {
  const input = {
    title: item.title,
    type: 'HTTP',
    url: fullUrl(item.url)
  };
  if (item.id) input.id = item.id;
  if (item.items && item.items.length) {
    input.items = item.items.map(buildItemInput);
  }
  return input;
}

async function main() {
  console.log('🔑 Getting token...');
  const token = await getToken();

  console.log('📋 Fetching current main menu...');
  const menuData = await gql(token, `
    query($id: ID!) {
      menu(id: $id) {
        id title
        items { id title url items { id title url } }
      }
    }
  `, { id: 'gid://shopify/Menu/302487273801' });

  const menu = menuData.menu;
  console.log(`   Menu: ${menu.title}`);
  menu.items.forEach(item => {
    console.log(`   [${item.title}] ${item.url}`);
    if (item.items) item.items.forEach(sub => console.log(`     - ${sub.title}`));
  });

  // Find "Elena writes" and inject new blog as first child
  const newBlogItem = {
    title: 'Nano-Hydroxyapatite: The Fluoride Alternative',
    url: '/blogs/calqix-elena-writes/nano-hydroxyapatite-the-fluoride-alternative'
  };

  const updatedItems = menu.items.map(item => {
    if (item.title.toLowerCase().includes('elena')) {
      // Check if already added
      const alreadyExists = (item.items || []).some(sub =>
        sub.url && sub.url.includes('nano-hydroxyapatite')
      );
      if (alreadyExists) {
        console.log('\n⚠️  New blog already exists in Elena writes menu — skipping');
        return item;
      }
      console.log('\n📌 Adding new blog as first item under Elena writes');
      return {
        ...item,
        items: [newBlogItem, ...(item.items || [])]
      };
    }
    return item;
  });

  const itemsInput = updatedItems.map(buildItemInput);

  console.log('\n📤 Updating menu...');
  const result = await gql(token, `
    mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, items: $items) {
        menu {
          id
          items { id title url items { id title url } }
        }
        userErrors { field message }
      }
    }
  `, {
    id: menu.id,
    title: menu.title,
    items: itemsInput
  });

  if (result.menuUpdate.userErrors && result.menuUpdate.userErrors.length) {
    console.error('❌ Errors:', JSON.stringify(result.menuUpdate.userErrors, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Menu updated successfully!');
  const updated = result.menuUpdate.menu;
  updated.items.forEach(item => {
    console.log(`   [${item.title}] ${item.url}`);
    if (item.items) item.items.forEach(sub => console.log(`     - ${sub.title} → ${sub.url}`));
  });
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
