import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const API_VERSION = '2025-10';

function loadEnv() {
  for (const file of ['.env.local', '.env.vercel.tmp', '.env']) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

const STORE = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
const CLIENT_ID = (process.env.SHOPIFY_API_KEY || '').trim();
const CLIENT_SECRET = (process.env.SHOPIFY_API_SECRET || '').trim();
let adminToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();

function assertConfig() {
  if (!STORE) throw new Error('SHOPIFY_STORE_DOMAIN ontbreekt');
  if (!adminToken && (!CLIENT_ID || !CLIENT_SECRET)) {
    throw new Error('Shopify Admin token of client credentials ontbreken');
  }
}

async function mintToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Kan geen Shopify token minten zonder SHOPIFY_API_KEY en SHOPIFY_API_SECRET');
  }
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  if (!res.ok) {
    throw new Error(`Shopify token mint failed ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }
  const data = await res.json();
  adminToken = data.access_token;
  return adminToken;
}

async function getToken() {
  if (!adminToken) return mintToken();
  const ok = await rawGraphql(adminToken, '{ shop { name } }').then(() => true).catch(() => false);
  if (ok) return adminToken;
  return mintToken();
}

async function rawGraphql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(data.errors || data).slice(0, 600)}`);
  }
  return data.data;
}

async function graphql(query, variables = {}) {
  return rawGraphql(await getToken(), query, variables);
}

async function rest(endpoint, method = 'GET', body = null) {
  const token = await getToken();
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`REST ${method} ${endpoint} failed ${res.status}: ${JSON.stringify(data).slice(0, 600)}`);
  }
  return data;
}

function readJsonWithComment(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\*[\s\S]*?\*\//, '').trim());
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function sectionFileForType(type) {
  const liquid = path.join(ROOT, 'sections', `${type}.liquid`);
  const json = path.join(ROOT, 'sections', `${type}.json`);
  if (fs.existsSync(liquid)) return liquid;
  if (fs.existsSync(json)) return json;
  return null;
}

async function snapshotReference() {
  const productResponse = await rest('products.json?handle=oralbiome-pro-freshmint');
  const product = productResponse.products && productResponse.products[0];
  if (!product) throw new Error('Referentieproduct oralbiome-pro-freshmint niet gevonden');

  const metafields = await rest(`products/${product.id}/metafields.json`);
  const suffix = product.template_suffix || '';
  const templateFile = path.join(ROOT, 'templates', suffix ? `product.${suffix}.json` : 'product.json');
  if (!fs.existsSync(templateFile)) throw new Error(`Referentietemplate ontbreekt: ${templateFile}`);

  const templateRaw = fs.readFileSync(templateFile, 'utf8');
  const template = readJsonWithComment(templateFile);
  const sectionTypes = [...new Set(Object.values(template.sections || {}).map((section) => section.type).filter(Boolean))];
  const sections = {};
  for (const type of sectionTypes) {
    const sectionPath = sectionFileForType(type);
    sections[type] = sectionPath ? {
      path: path.relative(ROOT, sectionPath).replace(/\\/g, '/'),
      source: fs.readFileSync(sectionPath, 'utf8')
    } : {
      path: null,
      source: null
    };
  }

  const combined = JSON.stringify({ product, metafields, template }, null, 2) + templateRaw + Object.values(sections).map((s) => s.source || '').join('\n');
  const metaobjectIds = [...new Set([...combined.matchAll(/gid:\/\/shopify\/Metaobject\/[0-9]+/g)].map((m) => m[0]))];
  const metaobjects = [];
  if (metaobjectIds.length) {
    const data = await graphql(
      `query Nodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Metaobject {
            type
            handle
            fields { key value type }
          }
        }
      }`,
      { ids: metaobjectIds }
    );
    metaobjects.push(...(data.nodes || []));
  }

  const output = {
    captured_at: new Date().toISOString(),
    api_version: API_VERSION,
    reference_handle: product.handle,
    template_suffix: suffix,
    product,
    metafields: metafields.metafields || [],
    template_path: path.relative(ROOT, templateFile).replace(/\\/g, '/'),
    template,
    sections,
    metaobjects
  };

  const outDir = path.join(ROOT, 'references');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'oralbiome-pro-freshmint.json');
  writeJson(outFile, output);
  console.log(`Snapshot opgeslagen: ${path.relative(ROOT, outFile)}`);
}

function cloneTemplate(pageVariant) {
  const template = readJsonWithComment(path.join(ROOT, 'templates', 'product.pap-white.json'));
  const main = template.sections.main;
  const blocks = main.blocks || {};

  if (blocks.calqix_badge_ob01) {
    blocks.calqix_badge_ob01.settings.text = 'Step 4 of the CALQIX Routine';
  }
  if (blocks.calqix_subtitle_ob01) {
    blocks.calqix_subtitle_ob01.settings.subtitle = pageVariant === 'refill'
      ? '<p>Keep your whitening protocol stocked with the same PAP+ gel and nHAp recovery serum. Same formula, no extra hardware needed.</p>'
      : '<p>Peroxide-free PAP+ whitening, supported by nano-hydroxyapatite to remineralise enamel and reduce sensitivity. Up to 8 VITA shades brighter in 14 days, fully EU compliant.</p>';
  }
  if (blocks.calqix_usps_inline_ob01) {
    blocks.calqix_usps_inline_ob01.disabled = true;
    blocks.calqix_usps_inline_ob01.settings.usp_1_icon = 'microbiome';
    blocks.calqix_usps_inline_ob01.settings.usp_1_title = 'Clinically backed';
    blocks.calqix_usps_inline_ob01.settings.usp_1_subtitle = 'PAP+ and nHAp';
    blocks.calqix_usps_inline_ob01.settings.usp_2_icon = 'breath-target';
    blocks.calqix_usps_inline_ob01.settings.usp_2_title = 'Peroxide-free';
    blocks.calqix_usps_inline_ob01.settings.usp_2_subtitle = 'EU home-use compliant';
    blocks.calqix_usps_inline_ob01.settings.usp_3_icon = 'breath-target';
    blocks.calqix_usps_inline_ob01.settings.usp_3_title = 'Enamel-safe support';
    blocks.calqix_usps_inline_ob01.settings.usp_3_subtitle = 'With nHAp recovery';
    blocks.calqix_usps_inline_ob01.settings.usp_4_icon = 'calendar-30';
    blocks.calqix_usps_inline_ob01.settings.usp_4_title = pageVariant === 'refill' ? 'Refill-ready' : '14-day protocol';
    blocks.calqix_usps_inline_ob01.settings.usp_4_subtitle = pageVariant === 'refill' ? 'No extra hardware' : '10 minutes daily';
  }
  if (blocks.calqix_colour_switcher_LDTXY9) blocks.calqix_colour_switcher_LDTXY9.disabled = true;
  if (blocks.calqix_bundle_ob01) blocks.calqix_bundle_ob01.disabled = true;
  if (blocks.seal_subscriptions_subscription_widget_PeJpN4) {
    blocks.seal_subscriptions_subscription_widget_PeJpN4.disabled = pageVariant !== 'refill';
  }
  if (blocks.calqix_cert_badges_ob01) {
    blocks.calqix_cert_badges_ob01.settings.show_toxicology = false;
    blocks.calqix_cert_badges_ob01.settings.show_iso22000 = false;
    blocks.calqix_cert_badges_ob01.settings.show_made_in_nl = false;
    blocks.calqix_cert_badges_ob01.settings.show_cpnp = true;
    blocks.calqix_cert_badges_ob01.settings.show_vegan = true;
  }
  if (blocks.calqix_compliance_note_ob01) {
    blocks.calqix_compliance_note_ob01.settings.text = 'Cosmetic whitening product for adults. Contains PAP+ and nano-hydroxyapatite. Not for use under 18. Full INCI follows on pack and product details.';
  }
  if (blocks.calqix_trust_badges_ob01) {
    blocks.calqix_trust_badges_ob01.settings.shipping_text = 'Free shipping over EUR 50. Stocked in the EU for fast delivery.';
  }

  template.sections = {
    breadcrumbs: template.sections.breadcrumbs,
    main,
    'glow-pro-content': {
      type: 'glow-pro-content',
      settings: {
        page_variant: pageVariant
      }
    }
  };
  template.order = ['breadcrumbs', 'main', 'glow-pro-content'];
  return template;
}

function writeTemplates() {
  const kit = cloneTemplate('kit');
  const refill = cloneTemplate('refill');
  writeJson(path.join(ROOT, 'templates', 'product.glow-pro.json'), kit);
  writeJson(path.join(ROOT, 'templates', 'product.glow-pro-refill.json'), refill);
  console.log('Templates geschreven: product.glow-pro.json, product.glow-pro-refill.json');
}

const products = {
  kit: {
    title: 'CALQIX Glow Pro - 14-Day Whitening System',
    handle: 'glow-pro',
    template_suffix: 'glow-pro',
    vendor: 'CALQIX',
    product_type: 'Oral care',
    tags: ['whitening', 'peroxide-free', 'pap-plus', 'nhap', 'step-4', 'kit'],
    sku: 'CLQ-GLW-KIT-001',
    price: '69.95',
    compare_at_price: '99.95',
    weight: 380,
    description: 'A peroxide-free 14-day whitening protocol with PAP+ gel, nano-hydroxyapatite recovery serum and LED activation. Designed for adults who want visible brightening with enamel-conscious support.',
    metafields: {
      step_in_routine: { type: 'single_line_text_field', value: '4' },
      ingredient_highlights: { type: 'list.single_line_text_field', value: JSON.stringify(['PAP+', 'nano-Hydroxyapatite', 'Xylitol', 'Zinc Citrate']) },
      treatment_duration: { type: 'single_line_text_field', value: '14 days' },
      shade_improvement: { type: 'single_line_text_field', value: 'Up to 8 VITA shades' },
      peroxide_free: { type: 'boolean', value: 'true' },
      eu_compliant: { type: 'boolean', value: 'true' },
      inci_full: { type: 'multi_line_text_field', value: 'INCI placeholder. Replace with final approved INCI before publishing.' },
      pap_concentration: { type: 'single_line_text_field', value: '12%' },
      nhap_concentration: { type: 'single_line_text_field', value: '10%' },
      age_restriction: { type: 'single_line_text_field', value: 'Not for use under 18' }
    }
  },
  refill: {
    title: 'CALQIX Glow Pro - Refill',
    handle: 'glow-pro-refill',
    template_suffix: 'glow-pro-refill',
    vendor: 'CALQIX',
    product_type: 'Oral care',
    tags: ['whitening', 'peroxide-free', 'pap-plus', 'nhap', 'step-4', 'refill', 'subscription-eligible'],
    sku: 'CLQ-GLW-REF-001',
    price: '29.95',
    compare_at_price: '34.95',
    weight: 80,
    description: 'The same PAP+ gel and nano-hydroxyapatite recovery serum from the CALQIX Glow Pro kit. Use it to keep your 14-day protocol stocked without buying extra hardware.',
    metafields: {
      step_in_routine: { type: 'single_line_text_field', value: '4' },
      ingredient_highlights: { type: 'list.single_line_text_field', value: JSON.stringify(['PAP+', 'nano-Hydroxyapatite', 'Xylitol', 'Zinc Citrate']) },
      treatment_duration: { type: 'single_line_text_field', value: '14 days' },
      shade_improvement: { type: 'single_line_text_field', value: 'Up to 8 VITA shades' },
      peroxide_free: { type: 'boolean', value: 'true' },
      eu_compliant: { type: 'boolean', value: 'true' },
      inci_full: { type: 'multi_line_text_field', value: 'INCI placeholder. Replace with final approved INCI before publishing.' },
      pap_concentration: { type: 'single_line_text_field', value: '12%' },
      nhap_concentration: { type: 'single_line_text_field', value: '10%' },
      age_restriction: { type: 'single_line_text_field', value: 'Not for use under 18' },
      is_refill: { type: 'boolean', value: 'true' },
      parent_product_handle: { type: 'single_line_text_field', value: 'glow-pro' }
    }
  }
};

async function findProduct(handle) {
  const data = await rest(`products.json?handle=${encodeURIComponent(handle)}`);
  return data.products && data.products[0] ? data.products[0] : null;
}

async function ensureProduct(config) {
  const existing = await findProduct(config.handle);
  const variant = existing && existing.variants && existing.variants[0] ? existing.variants[0] : null;
  const payload = {
    product: {
      title: config.title,
      handle: config.handle,
      vendor: config.vendor,
      product_type: config.product_type,
      tags: config.tags.join(', '),
      status: 'draft',
      template_suffix: config.template_suffix,
      body_html: `<p>${config.description}</p>`,
      variants: [{
        id: variant ? variant.id : undefined,
        option1: 'Default Title',
        sku: config.sku,
        price: config.price,
        compare_at_price: config.compare_at_price,
        weight: config.weight,
        weight_unit: 'g',
        requires_shipping: true,
        inventory_management: 'shopify',
        inventory_policy: 'deny'
      }]
    }
  };

  const response = existing
    ? await rest(`products/${existing.id}.json`, 'PUT', { product: { id: existing.id, ...payload.product } })
    : await rest('products.json', 'POST', payload);
  const product = response.product;
  const updatedVariant = product.variants && product.variants[0];
  if (updatedVariant && updatedVariant.inventory_item_id) {
    await setInventoryZero(updatedVariant.inventory_item_id);
  }
  await upsertMetafields(product.id, config.metafields);
  console.log(`Product bijgewerkt: ${config.handle} (${product.id})`);
  return product;
}

async function setInventoryZero(inventoryItemId) {
  const locationsData = await rest('locations.json');
  const location = (locationsData.locations || []).find((item) => item.active) || (locationsData.locations || [])[0];
  if (!location) {
    console.warn('Geen Shopify locatie gevonden voor inventory reset');
    return;
  }
  await rest('inventory_levels/set.json', 'POST', {
    location_id: location.id,
    inventory_item_id: inventoryItemId,
    available: 0
  });
}

async function upsertMetafields(productId, entries) {
  const existingData = await rest(`products/${productId}/metafields.json`);
  const existing = existingData.metafields || [];
  for (const [key, meta] of Object.entries(entries)) {
    const current = existing.find((item) => item.namespace === 'calqix' && item.key === key);
    const payload = {
      metafield: {
        namespace: 'calqix',
        key,
        type: meta.type,
        value: meta.value
      }
    };
    if (current) {
      await rest(`metafields/${current.id}.json`, 'PUT', { metafield: { id: current.id, ...payload.metafield } });
    } else {
      await rest(`products/${productId}/metafields.json`, 'POST', payload);
    }
  }
}

async function updateProducts() {
  await ensureProduct(products.kit);
  await ensureProduct(products.refill);
}

async function verifyShop() {
  const data = await graphql('{ shop { name primaryDomain { host } } }');
  console.log(`Shopify verbonden: ${data.shop.name} (${data.shop.primaryDomain.host})`);
}

async function main() {
  assertConfig();
  const cmd = process.argv[2] || 'all';
  if (cmd === 'verify') {
    await verifyShop();
    return;
  }
  if (cmd === 'templates' || cmd === 'all') writeTemplates();
  if (cmd === 'snapshot' || cmd === 'all') await snapshotReference();
  if (cmd === 'products' || cmd === 'all') await updateProducts();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
