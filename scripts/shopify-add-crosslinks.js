#!/usr/bin/env node
/**
 * CALQIX — Add cross-links between microbiome blog and nHA blog
 */

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) { console.error('❌ Set env vars'); process.exit(1); }

const BLOG_ID = 123272659273;
const MICROBIOME_ID = 615191675209;
const NHA_ID = 615270777161;

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  return (await res.json()).access_token;
}

async function getArticle(token, id) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${id}.json?fields=id,title,body_html`, {
    headers: { 'X-Shopify-Access-Token': token }
  });
  return (await res.json()).article;
}

async function updateArticle(token, id, body_html) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${id}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ article: { id, body_html } })
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
  return (await res.json()).article;
}

const CROSSLINK_TO_NHA = `
<div style="background: linear-gradient(135deg, #f8f9fc 0%, #eef1f7 100%); border-left: 4px solid #1B2A4A; border-radius: 0 12px 12px 0; padding: 24px 28px; margin: 40px 0;">
  <p style="margin: 0 0 8px 0; font-weight: 600; color: #1B2A4A; font-size: 1.05em;">Continue reading</p>
  <p style="margin: 0; color: #444; line-height: 1.6;">Want to understand how nano-hydroxyapatite rebuilds enamel at the molecular level? Our latest article explains the 40-year science behind the fluoride alternative used in OralBiome Pro.</p>
  <a href="/blogs/calqix-elena-writes/nano-hydroxyapatite-the-fluoride-alternative" style="display: inline-block; margin-top: 16px; color: #1B2A4A; font-weight: 600; text-decoration: none; border-bottom: 2px solid #1B2A4A; padding-bottom: 2px; transition: opacity 0.2s;">Read: Nano-Hydroxyapatite &rarr;</a>
</div>`;

const BACKLINK_TO_MICROBIOME = `<p><em>New to oral microbiome science? Start with our foundational article: <a href="/blogs/calqix-elena-writes/the-science-of-your-oral-microbiome-why-most-oral-care-gets-it-wrong">The Science of Your Oral Microbiome: Why Most Oral Care Gets It Wrong</a>.</em></p>`;

async function main() {
  const token = await getToken();
  console.log('🔑 Token obtained\n');

  // ═══════════════════════════════════════════════
  // PART A: Add cross-link in MICROBIOME blog
  // ═══════════════════════════════════════════════
  console.log('📝 MICROBIOME BLOG — Adding cross-link to nHA article...');
  const micro = await getArticle(token, MICROBIOME_ID);

  if (micro.body_html.includes('nano-hydroxyapatite-the-fluoride-alternative')) {
    console.log('   ⚠️  Cross-link already exists — skipping');
  } else {
    // Insert before <h2 id="the-oral-systemic-connection">
    const marker = '<h2 id="the-oral-systemic-connection">';
    const idx = micro.body_html.indexOf(marker);
    if (idx === -1) {
      console.error('   ❌ Could not find "the-oral-systemic-connection" heading');
    } else {
      const updated = micro.body_html.slice(0, idx) + CROSSLINK_TO_NHA + '\n' + micro.body_html.slice(idx);
      await updateArticle(token, MICROBIOME_ID, updated);
      console.log('   ✅ Cross-link inserted before "The oral-systemic connection"');
    }
  }

  // ═══════════════════════════════════════════════
  // PART C: Add backlink in NHA blog
  // ═══════════════════════════════════════════════
  console.log('\n📝 NHA BLOG — Checking for backlink to microbiome article...');
  const nha = await getArticle(token, NHA_ID);

  if (nha.body_html.includes('the-science-of-your-oral-microbiome')) {
    console.log('   ⚠️  Backlink already exists — skipping');
  } else {
    // Find the last h2 heading or the end of content to insert before it
    const marker = '<h2 id="the-oral-systemic-connection-revisited">';
    let idx = nha.body_html.indexOf(marker);
    if (idx === -1) {
      // Try finding any "oral-systemic" or "conclusion" heading
      const altMarkers = ['<h2 id="conclusion">', '<h2 id="the-research-continues">', '<h2 id="references">'];
      for (const alt of altMarkers) {
        idx = nha.body_html.indexOf(alt);
        if (idx !== -1) break;
      }
    }
    if (idx === -1) {
      // Insert at the very end
      const updated = nha.body_html + '\n' + BACKLINK_TO_MICROBIOME;
      await updateArticle(token, NHA_ID, updated);
      console.log('   ✅ Backlink appended at end of article');
    } else {
      const updated = nha.body_html.slice(0, idx) + BACKLINK_TO_MICROBIOME + '\n' + nha.body_html.slice(idx);
      await updateArticle(token, NHA_ID, updated);
      console.log('   ✅ Backlink inserted before closing section');
    }
  }

  console.log('\n🎉 Cross-links complete!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
