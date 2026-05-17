#!/usr/bin/env node
/**
 * CALQIX - Create a draft Shopify blog article from a local HTML body.
 *
 * Usage:
 *   node scripts/shopify-create-blog-draft.js
 *
 * This script is intentionally narrow for the current OralBiome Pro packaging
 * update. It creates a draft article in The Science Journal and uploads the
 * generated images to Shopify Files before replacing IMAGE markers.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
loadEnv(path.join(ROOT, '.env.local'));

const STORE = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE || 'calqix.myshopify.com';
const shopify = require(path.join(ROOT, 'calqix-capi', 'lib', 'shopify-admin'));

const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  const message = args.join(' ');
  if (message.includes('[ShopifyAdmin] Token refreshed')) {
    originalConsoleLog('[ShopifyAdmin] Token refreshed');
    return;
  }
  originalConsoleLog(...args);
};

const BLOG_HANDLE = 'the-science-journal';
const SOURCE_HTML = path.join(ROOT, 'blog-content', 'oralbiome-pro-60-count-aluminium-blister.html');
const IMAGE_DIR = path.join(ROOT, 'output', 'imagegen', 'oralbiome-60-pack');

const ARTICLE = {
  title: '60 Evenings, Clearly Counted: A New OralBiome Pro Pack Is Coming',
  handle: 'oralbiome-pro-60-count-aluminium-blister',
  author: 'CALQIX Science Team',
  tags: 'Research, OralBiome Pro, Routine, Packaging',
  template_suffix: 'calqix-research',
  published: false,
  summary_html:
    'OralBiome Pro is getting a 60-count aluminium push-through format with a back-of-pack progress counter, designed to make the daily oral microbiome ritual clearer and easier to repeat.'
};

const IMAGES = [
  {
    marker: '<!-- IMAGE: hero -->',
    key: 'hero',
    file: 'oralbiome-60-hero.png',
    width: 1536,
    height: 1024,
    alt: 'OralBiome Pro 60-count aluminium blister packaging with front and back progress counter',
    caption: 'The upcoming 60-count format turns the daily ritual into something visible.'
  },
  {
    marker: '<!-- IMAGE: counter -->',
    key: 'counter',
    file: 'oralbiome-60-counter.png',
    width: 1536,
    height: 1024,
    alt: 'Close-up of the OralBiome Pro aluminium blister progress counter',
    caption: 'A back-of-pack counter helps customers see where they are in the routine.'
  },
  {
    marker: '<!-- IMAGE: ritual -->',
    key: 'ritual',
    file: 'oralbiome-60-ritual.png',
    width: 1536,
    height: 1024,
    alt: 'Evening OralBiome Pro ritual with a single lozenge pushed from an aluminium blister card',
    caption: 'One evening, one lozenge, one visible step forward.'
  }
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function assertConfig() {
  if (!STORE) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN in environment or .env.local');
  }
  if (!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET)) {
    throw new Error('Missing Shopify Admin token or OAuth app credentials in environment or .env.local');
  }
  if (!fs.existsSync(SOURCE_HTML)) {
    throw new Error(`Missing source HTML: ${SOURCE_HTML}`);
  }
}

async function rest(method, endpoint, body) {
  const data = await shopify.rest(endpoint, method, body);
  if (data && data.errors) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function graphql(query, variables) {
  return shopify.graphql(query, variables || {});
}

async function findBlog() {
  const data = await rest('GET', 'blogs.json?limit=250');
  const blog = data.blogs.find((item) => item.handle === BLOG_HANDLE);
  if (!blog) {
    throw new Error(`Blog handle not found: ${BLOG_HANDLE}. Available: ${data.blogs.map((b) => b.handle).join(', ')}`);
  }
  return blog;
}

async function stagedUpload(filename, fileSize, mimeType) {
  const query = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;
  const variables = {
    input: [{
      resource: 'FILE',
      filename,
      mimeType,
      httpMethod: 'POST',
      fileSize: String(fileSize)
    }]
  };
  const data = await graphql(query, variables);
  const result = data.stagedUploadsCreate;
  if (result.userErrors.length) {
    throw new Error(`Staged upload error: ${JSON.stringify(result.userErrors)}`);
  }
  return result.stagedTargets[0];
}

async function uploadToStaged(target, filePath, mimeType) {
  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  const buffer = fs.readFileSync(filePath);
  form.append('file', new Blob([buffer], { type: mimeType }), path.basename(filePath));
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`Staged upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return target.resourceUrl;
}

async function createFile(resourceUrl, filename, alt) {
  const query = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id alt ... on MediaImage { image { url } fileStatus } }
      userErrors { field message }
    }
  }`;
  const variables = {
    files: [{
      alt,
      contentType: 'IMAGE',
      originalSource: resourceUrl,
      filename
    }]
  };
  const data = await graphql(query, variables);
  const result = data.fileCreate;
  if (result.userErrors.length) {
    throw new Error(`File create error: ${JSON.stringify(result.userErrors)}`);
  }
  return result.files[0];
}

async function waitForFile(fileId) {
  const query = `query getFile($id: ID!) {
    node(id: $id) {
      ... on MediaImage { id fileStatus image { url } }
    }
  }`;
  const start = Date.now();
  while (Date.now() - start < 45000) {
    const data = await graphql(query, { id: fileId });
    const node = data.node;
    if (node && node.fileStatus === 'READY' && node.image && node.image.url) return node.image.url;
    if (node && node.fileStatus === 'FAILED') throw new Error(`File processing failed: ${fileId}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for Shopify file: ${fileId}`);
}

function imageFigure(image, url, eager) {
  return [
    `<figure class="blog-image blog-image--${image.key}">`,
    `<img src="${url}" alt="${escapeHtml(image.alt)}" loading="${eager ? 'eager' : 'lazy'}" width="${image.width}" height="${image.height}" style="width:100%;height:auto;border-radius:12px;">`,
    `<figcaption>${escapeHtml(image.caption)}</figcaption>`,
    `</figure>`
  ].join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function uploadImages() {
  const uploaded = {};
  for (const image of IMAGES) {
    const filePath = path.join(IMAGE_DIR, image.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing generated image: ${filePath}`);
    }
    const filename = `calqix-${path.basename(image.file)}`;
    const fileSize = fs.statSync(filePath).size;
    const target = await stagedUpload(filename, fileSize, 'image/png');
    const resourceUrl = await uploadToStaged(target, filePath, 'image/png');
    const file = await createFile(resourceUrl, filename, image.alt);
    uploaded[image.key] = await waitForFile(file.id);
    console.log(`Uploaded ${image.key}: ${uploaded[image.key]}`);
  }
  return uploaded;
}

function buildBody(uploaded) {
  let html = fs.readFileSync(SOURCE_HTML, 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
  for (const image of IMAGES) {
    const url = uploaded[image.key];
    html = html.replace(image.marker, imageFigure(image, url, image.key === 'hero'));
  }
  return html;
}

async function createDraftArticle(blog, bodyHtml, uploaded) {
  const payload = {
    article: {
      ...ARTICLE,
      body_html: bodyHtml,
      image: {
        src: uploaded.hero,
        alt: IMAGES[0].alt
      }
    }
  };
  const data = await rest('POST', `blogs/${blog.id}/articles.json`, payload);
  return data.article;
}

async function main() {
  assertConfig();
  const blog = await findBlog();
  console.log(`Blog: ${blog.title} (${blog.handle})`);
  const uploaded = await uploadImages();
  const bodyHtml = buildBody(uploaded);
  const article = await createDraftArticle(blog, bodyHtml, uploaded);
  console.log('Draft article created.');
  console.log(`ID: ${article.id}`);
  console.log(`Admin draft URL: https://${STORE}/admin/articles/${article.id}`);
  console.log(`Handle: ${article.handle}`);
  console.log(`Published: ${article.published_at ? 'yes' : 'no'}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
