#!/usr/bin/env node
/**
 * CALQIX — Fix broken menu URLs and restore correct navigation
 * This script hardcodes the correct full URLs to repair the menu
 */

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) { console.error('❌ Set env vars'); process.exit(1); }

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  return (await res.json()).access_token;
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

async function main() {
  const token = await getToken();
  console.log('🔑 Token obtained');

  // Fetch current menu to get item IDs
  const menuData = await gql(token, `
    query($id: ID!) {
      menu(id: $id) {
        id title
        items { id title url items { id title url } }
      }
    }
  `, { id: 'gid://shopify/Menu/302487273801' });

  const menu = menuData.menu;
  console.log('📋 Current broken menu:');
  menu.items.forEach(item => {
    console.log(`  [${item.title}] ${item.url}`);
    (item.items || []).forEach(sub => console.log(`    - ${sub.title} → ${sub.url}`));
  });

  // Build the corrected menu with full absolute URLs
  const BASE = 'https://www.calqix.com';
  const BLOG = `${BASE}/blogs/calqix-elena-writes`;

  // Map current IDs to correct URLs
  const productsItem = menu.items.find(i => i.title === 'Products');
  const elenaItem = menu.items.find(i => i.title.toLowerCase().includes('elena'));
  const aboutItem = menu.items.find(i => i.title.toLowerCase().includes('about'));
  const contactItem = menu.items.find(i => i.title.toLowerCase().includes('contact'));

  if (!productsItem || !elenaItem || !aboutItem || !contactItem) {
    throw new Error('Could not find all top-level menu items');
  }

  // Build corrected items array
  const correctedItems = [
    {
      id: productsItem.id,
      title: 'Products',
      type: 'HTTP',
      url: BASE,
      items: [
        { id: productsItem.items[0]?.id, title: 'OralBiome Pro', type: 'HTTP', url: `${BASE}/products/oralbiome-pro-freshmint` },
        { id: productsItem.items[1]?.id, title: 'Cordless Oral Irrigator', type: 'HTTP', url: `${BASE}/collections/water-flosser` },
        { id: productsItem.items[2]?.id, title: 'Add-ons', type: 'HTTP', url: `${BASE}/collections/add-ons` }
      ].filter(i => i.id)
    },
    {
      id: elenaItem.id,
      title: 'Elena writes',
      type: 'HTTP',
      url: BLOG,
      items: [
        // New blog first (find its ID if it exists, otherwise create)
        ...(elenaItem.items.filter(i => i.title.includes('Nano-Hydroxyapatite')).map(i => ({
          id: i.id,
          title: 'Nano-Hydroxyapatite: The Fluoride Alternative',
          type: 'HTTP',
          url: `${BLOG}/nano-hydroxyapatite-the-fluoride-alternative`
        }))),
        // If new blog doesn't exist yet, add it
        ...(elenaItem.items.some(i => i.title.includes('Nano-Hydroxyapatite')) ? [] : [{
          title: 'Nano-Hydroxyapatite: The Fluoride Alternative',
          type: 'HTTP',
          url: `${BLOG}/nano-hydroxyapatite-the-fluoride-alternative`
        }]),
        // Existing items in order
        ...elenaItem.items.filter(i => !i.title.includes('Nano-Hydroxyapatite')).map((i, idx) => {
          const urls = [
            `${BLOG}/the-science-of-your-oral-microbiome-why-most-oral-care-gets-it-wrong`,
            `${BLOG}/bleeding-gums-properly-explained`,
            `${BLOG}/teeth-sensitivity`,
            `${BLOG}/transform-your-smile`
          ];
          return {
            id: i.id,
            title: i.title,
            type: 'HTTP',
            url: urls[idx] || `${BLOG}`
          };
        })
      ]
    },
    {
      id: aboutItem.id,
      title: 'About us',
      type: 'HTTP',
      url: `${BASE}/pages/about-us`
    },
    {
      id: contactItem.id,
      title: 'Contact',
      type: 'HTTP',
      url: `${BASE}/pages/contact`
    }
  ];

  console.log('\n📤 Fixing menu with correct URLs...');
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
    items: correctedItems
  });

  if (result.menuUpdate.userErrors?.length) {
    console.error('❌ Errors:', JSON.stringify(result.menuUpdate.userErrors, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Menu fixed successfully!');
  result.menuUpdate.menu.items.forEach(item => {
    console.log(`  [${item.title}] ${item.url}`);
    (item.items || []).forEach(sub => console.log(`    - ${sub.title} → ${sub.url}`));
  });
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
