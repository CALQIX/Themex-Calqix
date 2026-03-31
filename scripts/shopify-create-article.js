#!/usr/bin/env node
/**
 * CALQIX — Create Shopify blog article via Admin API
 *
 * Usage:
 *   node scripts/shopify-create-article.js
 *
 * Requires:
 *   - SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET env vars (or falls back to hardcoded app creds)
 *   - The custom app must have `read_content` + `write_content` scopes
 *
 * What it does:
 *   1. Obtains a fresh access token via client_credentials grant
 *   2. Finds the "calqix-elena-writes" blog
 *   3. Creates the Nano-Hydroxyapatite article with full HTML body
 *   4. Assigns the article.calqix-research template
 */

const fs = require('fs');
const path = require('path');

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing env vars SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
  console.error('   Set them before running, e.g.:');
  console.error('   $env:SHOPIFY_CLIENT_ID="your_id"; $env:SHOPIFY_CLIENT_SECRET="your_secret"');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error('Token request failed: ' + res.status + ' ' + await res.text());
  const data = await res.json();
  console.log('✅ Token obtained — scopes:', data.scope);
  return data.access_token;
}

async function api(token, method, endpoint, body) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/${endpoint}`;
  const opts = {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${method} ${endpoint} failed: ${res.status}\n${err}`);
  }
  return res.json();
}

async function findBlog(token, handle) {
  const data = await api(token, 'GET', 'blogs.json');
  const blog = data.blogs.find(b => b.handle === handle);
  if (!blog) {
    console.log('Available blogs:', data.blogs.map(b => b.handle).join(', '));
    throw new Error(`Blog "${handle}" not found`);
  }
  return blog;
}

async function createArticle(token, blogId, article) {
  const data = await api(token, 'POST', `blogs/${blogId}/articles.json`, { article });
  return data.article;
}

async function main() {
  console.log('🔑 Obtaining access token...');
  const token = await getToken();

  console.log('📝 Finding blog "calqix-elena-writes"...');
  const blog = await findBlog(token, 'calqix-elena-writes');
  console.log(`   Found blog: ${blog.title} (ID: ${blog.id})`);

  // Read HTML content
  const htmlPath = path.join(__dirname, '..', 'blog-content', 'nano-hydroxyapatite-the-fluoride-alternative.html');
  let bodyHtml = fs.readFileSync(htmlPath, 'utf-8');
  // Strip the HTML comment block at the top
  bodyHtml = bodyHtml.replace(/^<!--[\s\S]*?-->\s*/, '');

  const article = {
    title: 'Nano-Hydroxyapatite: The Fluoride Alternative Backed by 40 Years of Research',
    author: 'Dr. Elena Hartwell',
    body_html: bodyHtml,
    tags: 'Research',
    published: true,
    published_at: '2026-04-01T00:00:00+02:00',
    handle: 'nano-hydroxyapatite-the-fluoride-alternative',
    template_suffix: 'calqix-research',
    summary_html: 'Every day, your teeth lose minerals. Nano-hydroxyapatite, the same mineral that makes up 97% of enamel, offers a biomimetic alternative to fluoride — backed by 40+ years of clinical research.'
  };

  console.log('📤 Creating article...');
  const created = await createArticle(token, blog.id, article);
  console.log(`\n✅ Article created successfully!`);
  console.log(`   ID:     ${created.id}`);
  console.log(`   Title:  ${created.title}`);
  console.log(`   URL:    https://${STORE}/blogs/${blog.handle}/${created.handle}`);
  console.log(`   Handle: ${created.handle}`);
  console.log(`   Template: article.${created.template_suffix || '(default)'}`);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
