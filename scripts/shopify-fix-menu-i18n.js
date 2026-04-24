#!/usr/bin/env node
/**
 * CALQIX — Main menu i18n fix.
 *
 * Problem:
 *   Main menu items were stored as type=HTTP with absolute EN URLs, so Shopify
 *   never prefixed /nl/, /de/, /fr/ etc. nor rewrote to translated handles.
 *   Result on Dutch: /products/oralbiome-pro-freshmint instead of
 *   /nl/products/oralbiome-pro-verse-munt.
 *
 *   Additionally some top-level link titles (Products, About us, Contact)
 *   and child link titles had no translations registered in Shopify
 *   (Translate & Adapt), showing EN text on every storefront locale.
 *
 * Fix:
 *   1. Rebuild Main menu items using DYNAMIC resource references
 *      (type: PRODUCT / COLLECTION / PAGE / BLOG / ARTICLE, resourceId: gid://...).
 *      Shopify then auto-computes locale-prefixed + translated-handle URLs.
 *   2. Register missing LINK (menu item) title translations for every
 *      non-primary storefront locale.
 *
 * Safety:
 *   - Keeps existing menu item IDs (update, not recreate) so Theme Editor
 *     references remain stable.
 *   - Leaves "OralBiome Pro" brand name untranslated (brand constant).
 *   - Leaves Science Journal LINK translation alone (already present).
 *   - Leaves article LINK titles EN only for this pass (Shopify will resolve
 *     translated article URLs regardless; article title translation in the
 *     menu dropdown is a cosmetic follow-up).
 *
 * Run:
 *   node scripts/shopify-fix-menu-i18n.js          # dry run (no writes)
 *   node scripts/shopify-fix-menu-i18n.js --apply  # perform writes
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', 'calqix-capi', '.env') });
const fetchFn = global.fetch || require('node-fetch');

const STORE = (process.env.SHOPIFY_STORE_DOMAIN || 'calqix.myshopify.com').trim();
const TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const API_VERSION = '2024-10';
const MAIN_MENU_ID = 'gid://shopify/Menu/302487273801';
const BLOG_HANDLE = 'the-science-journal';

const APPLY = process.argv.includes('--apply');

if (!TOKEN) { console.error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN in calqix-capi/.env'); process.exit(1); }

// ---------- Link title translations ----------
// Keyed by exact EN link title (as currently stored). Missing = don't translate
// (brand names, article titles left as EN for this pass).
const LINK_TITLE_TRANSLATIONS = {
  'Products': {
    nl: 'Producten', de: 'Produkte', fr: 'Produits',
    sv: 'Produkter', nb: 'Produkter', da: 'Produkter', fi: 'Tuotteet'
  },
  'Cordless Oral Irrigator': {
    nl: 'Draadloze monddouche',
    de: 'Kabellose Munddusche',
    fr: 'Hydropulseur sans fil',
    sv: 'Trådlös munddusch',
    nb: 'Trådløs munndusj',
    da: 'Trådløs mundskyller',
    fi: 'Langaton suuhuuhtelulaite'
  },
  'Add-ons': {
    nl: 'Accessoires',
    de: 'Zubehör',
    fr: 'Accessoires',
    sv: 'Tillbehör',
    nb: 'Tilbehør',
    da: 'Tilbehør',
    fi: 'Lisävarusteet'
  },
  'About us': {
    nl: 'Over ons', de: 'Über uns', fr: 'À propos',
    sv: 'Om oss', nb: 'Om oss', da: 'Om os', fi: 'Tietoa meistä'
  },
  'Contact': {
    nl: 'Contact', de: 'Kontakt', fr: 'Contact',
    sv: 'Kontakt', nb: 'Kontakt', da: 'Kontakt', fi: 'Yhteystiedot'
  }
};

// ---------- HTTP helper ----------
async function gql(query, variables) {
  const res = await fetchFn(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error('GraphQL error: ' + JSON.stringify(data.errors, null, 2));
  return data.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- Inspection ----------
async function fetchCurrentMenu() {
  const d = await gql(`
    query($id: ID!) {
      menu(id: $id) {
        id title handle
        items { id title url type resourceId items { id title url type resourceId } }
      }
    }`, { id: MAIN_MENU_ID });
  return d.menu;
}

async function fetchLocales() {
  const d = await gql(`{ shopLocales { locale primary published } }`);
  return d.shopLocales;
}

async function fetchArticlesInBlog(blogHandle) {
  const d = await gql(`{
    blogs(first: 20) { edges { node { id handle title } } }
  }`);
  const blog = d.blogs.edges.map(e => e.node).find(b => b.handle === blogHandle);
  if (!blog) throw new Error(`Blog not found: ${blogHandle}`);
  const d2 = await gql(`
    query($id: ID!) {
      blog(id: $id) {
        id
        articles(first: 50) { edges { node { id title handle } } }
      }
    }`, { id: blog.id });
  return {
    blogId: blog.id,
    articles: d2.blog.articles.edges.map(e => e.node)
  };
}

async function fetchResources() {
  const [p1, c1, c2, pg1, pg2, blog] = await Promise.all([
    gql(`query($h:String!){ productByHandle(handle:$h){ id title handle } }`, { h: 'oralbiome-pro-freshmint' }),
    gql(`query($h:String!){ collectionByHandle(handle:$h){ id title handle } }`, { h: 'water-flosser' }),
    gql(`query($h:String!){ collectionByHandle(handle:$h){ id title handle } }`, { h: 'add-ons' }),
    gql(`{ pages(first: 50) { edges { node { id handle title } } } }`),
    null,
    fetchArticlesInBlog(BLOG_HANDLE)
  ]);
  const pages = pg1.pages.edges.map(e => e.node);
  return {
    oralbiomePro: p1.productByHandle,
    waterFlosser: c1.collectionByHandle,
    addOns: c2.collectionByHandle,
    aboutUsPage: pages.find(p => p.handle === 'about-us'),
    contactPage: pages.find(p => p.handle === 'contact'),
    blog
  };
}

// ---------- Build new menu items ----------
function buildMenuItems(current, res) {
  const productsTop = current.items.find(i => i.title === 'Products');
  const scienceTop = current.items.find(i => i.title === 'Science Journal' || /science journal|wetenschap|elena/i.test(i.title));
  const aboutTop = current.items.find(i => /^about/i.test(i.title));
  const contactTop = current.items.find(i => /^contact/i.test(i.title));

  if (!productsTop || !scienceTop || !aboutTop || !contactTop) {
    throw new Error('Could not locate all top-level menu items by title');
  }

  const productsChildren = productsTop.items || [];
  const obpChild = productsChildren.find(c => /oralbiome/i.test(c.title));
  const irrigatorChild = productsChildren.find(c => /irrigator|flosser/i.test(c.title));
  const addonsChild = productsChildren.find(c => /^add-?ons?$/i.test(c.title));

  const scienceChildren = scienceTop.items || [];

  // Map existing article children to ARTICLE resources by URL slug match.
  const articleByHandle = Object.fromEntries(res.blog.articles.map(a => [a.handle, a]));
  const childArticleItems = scienceChildren.map(child => {
    const urlSlug = (child.url || '').split('/').filter(Boolean).pop();
    const art = articleByHandle[urlSlug];
    if (!art) {
      console.warn(`  ! child "${child.title}" url=${child.url} — article handle "${urlSlug}" not found, keeping HTTP`);
      return { id: child.id, title: child.title, type: 'HTTP', url: child.url };
    }
    return { id: child.id, title: child.title, type: 'ARTICLE', resourceId: art.id };
  });

  const items = [
    {
      id: productsTop.id,
      title: productsTop.title,
      type: 'HTTP',
      url: 'https://www.calqix.com/',
      items: [
        obpChild && res.oralbiomePro
          ? { id: obpChild.id, title: obpChild.title, type: 'PRODUCT', resourceId: res.oralbiomePro.id }
          : null,
        irrigatorChild && res.waterFlosser
          ? { id: irrigatorChild.id, title: irrigatorChild.title, type: 'COLLECTION', resourceId: res.waterFlosser.id }
          : null,
        addonsChild && res.addOns
          ? { id: addonsChild.id, title: addonsChild.title, type: 'COLLECTION', resourceId: res.addOns.id }
          : null
      ].filter(Boolean)
    },
    {
      id: scienceTop.id,
      title: scienceTop.title,
      type: 'BLOG',
      resourceId: res.blog.blogId,
      items: childArticleItems
    },
    res.aboutUsPage
      ? { id: aboutTop.id, title: aboutTop.title, type: 'PAGE', resourceId: res.aboutUsPage.id }
      : { id: aboutTop.id, title: aboutTop.title, type: 'HTTP', url: aboutTop.url },
    res.contactPage
      ? { id: contactTop.id, title: contactTop.title, type: 'PAGE', resourceId: res.contactPage.id }
      : { id: contactTop.id, title: contactTop.title, type: 'HTTP', url: contactTop.url }
  ];

  return items;
}

// ---------- Menu update ----------
async function updateMenu(current, newItems) {
  const r = await gql(`
    mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, items: $items) {
        menu { id items { id title url type resourceId items { id title url type resourceId } } }
        userErrors { field message }
      }
    }`, { id: current.id, title: current.title, items: newItems });
  if (r.menuUpdate.userErrors && r.menuUpdate.userErrors.length) {
    throw new Error('menuUpdate errors: ' + JSON.stringify(r.menuUpdate.userErrors, null, 2));
  }
  return r.menuUpdate.menu;
}

// ---------- LINK translation registration ----------
// Each MenuItem corresponds to a Link translatable resource with the same numeric id:
//   MenuItem gid://shopify/MenuItem/746921099593  <->  LINK gid://shopify/Link/746921099593
// We look up the digest for the 'title' key on that specific LINK to avoid matching
// unrelated links with the same title (e.g. footer menu items).
function menuItemIdToLinkId(menuItemGid) {
  const numeric = String(menuItemGid).split('/').pop();
  return `gid://shopify/Link/${numeric}`;
}

async function fetchLinkDigest(linkResourceId) {
  const d = await gql(`
    query($id: ID!) {
      translatableResource(resourceId: $id) {
        resourceId
        translatableContent { key value digest locale }
      }
    }`, { id: linkResourceId });
  const tr = d.translatableResource;
  if (!tr) return null;
  const tc = (tr.translatableContent || []).find(c => c.key === 'title');
  return tc ? { resourceId: tr.resourceId, currentTitle: tc.value, digest: tc.digest } : null;
}

async function registerLinkTranslations(locales, current) {
  const nonPrimary = locales.filter(l => !l.primary && l.published).map(l => l.locale);

  // Collect all menu items (top + children) whose title needs translation.
  const allItems = [];
  for (const it of current.items) {
    allItems.push(it);
    (it.items || []).forEach(si => allItems.push(si));
  }

  const targets = allItems.filter(it => LINK_TITLE_TRANSLATIONS[it.title]);

  let registered = 0;
  const perLocale = {};
  nonPrimary.forEach(lc => { perLocale[lc] = 0; });

  for (const it of targets) {
    const linkId = menuItemIdToLinkId(it.id);
    const info = await fetchLinkDigest(linkId);
    if (!info) { console.warn(`  ! no digest for ${linkId} (${it.title})`); continue; }

    const trMap = LINK_TITLE_TRANSLATIONS[it.title];
    const batch = [];
    for (const lc of nonPrimary) {
      const value = trMap[lc];
      if (!value) continue;
      batch.push({
        key: 'title',
        value: value,
        locale: lc,
        translatableContentDigest: info.digest
      });
    }
    if (batch.length === 0) continue;

    if (!APPLY) {
      console.log(`  [dry-run] ${batch.length} translations for "${it.title}" (${linkId})`);
      batch.forEach(t => console.log(`            ${t.locale}: ${t.value}`));
      continue;
    }

    const r = await gql(`
      mutation($id: ID!, $t: [TranslationInput!]!) {
        translationsRegister(resourceId: $id, translations: $t) {
          translations { locale key value }
          userErrors { field message }
        }
      }`, { id: linkId, t: batch });

    const errs = r.translationsRegister.userErrors || [];
    if (errs.length) {
      console.error(`  ! translation errors for "${it.title}":`, errs);
    } else {
      const done = (r.translationsRegister.translations || []).length;
      registered += done;
      batch.forEach(t => { perLocale[t.locale]++; });
      console.log(`  ✓ "${it.title}" — registered ${done} translations`);
    }
    await sleep(300);
  }

  return { registered, perLocale };
}

// ---------- Main ----------
(async () => {
  console.log('CALQIX — Main menu i18n fix');
  console.log('  store:', STORE);
  console.log('  mode :', APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)');

  const [locales, current, res] = await Promise.all([
    fetchLocales(), fetchCurrentMenu(), fetchResources()
  ]);

  console.log('\nEnabled locales:', locales.map(l => l.locale + (l.primary ? '*' : '')).join(' '));

  console.log('\nCurrent top-level menu items:');
  current.items.forEach(it => console.log(`  [${it.title}] ${it.type} -> ${it.url}`));

  console.log('\nResolved resources:');
  console.log('  OralBiome Pro product  :', res.oralbiomePro && res.oralbiomePro.id);
  console.log('  Water flosser collection:', res.waterFlosser && res.waterFlosser.id);
  console.log('  Add-ons collection      :', res.addOns && res.addOns.id);
  console.log('  About us page           :', res.aboutUsPage && res.aboutUsPage.id);
  console.log('  Contact page            :', res.contactPage && res.contactPage.id);
  console.log('  Science Journal blog    :', res.blog.blogId);
  console.log('  Articles in blog        :', res.blog.articles.length);

  console.log('\nBuilding new menu items...');
  const newItems = buildMenuItems(current, res);
  console.log(JSON.stringify(newItems, null, 2));

  if (APPLY) {
    console.log('\nApplying menuUpdate...');
    const updated = await updateMenu(current, newItems);
    console.log('Menu updated:');
    updated.items.forEach(it => {
      console.log(`  [${it.title}] ${it.type} -> ${it.url || '(auto)'}${it.resourceId ? ' res=' + it.resourceId : ''}`);
      (it.items || []).forEach(si => console.log(`    - ${si.title} ${si.type} ${si.url || '(auto)'}`));
    });
  } else {
    console.log('\n[dry-run] menuUpdate skipped');
  }

  console.log('\nRegistering LINK title translations...');
  const outcome = await registerLinkTranslations(locales, current);
  console.log(`  total: ${outcome.registered}`);
  for (const lc of Object.keys(outcome.perLocale)) {
    console.log(`  ${lc}: ${outcome.perLocale[lc]}`);
  }

  console.log('\nDone.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
