/**
 * Upload generated blog images to Shopify Files API and update the nHA blog article
 */
const fs = require('fs');
const path = require('path');

const STORE = 'calqix.myshopify.com';
const API_VERSION = '2025-01';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) { console.error('Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET env vars'); process.exit(1); }

const BLOG_ID = 123272659273;
const NHA_ID = 615270777161;

const IMAGE_DIR = path.resolve(__dirname, '..', 'calqix-capi', 'generated-images', 'blog');

const IMAGES = [
  { id: 'nha-hero', file: 'nha-hero.png', alt: 'Cross-section of tooth showing nano-hydroxyapatite particles integrating into enamel', placement: 'hero' },
  { id: 'nha-comparison', file: 'nha-comparison.png', alt: 'Before and after comparison of tooth enamel treated with nano-hydroxyapatite', placement: 'how-nha-repairs' },
  { id: 'nha-vs-fluoride', file: 'nha-vs-fluoride.png', alt: 'Scientific comparison of fluoride coating vs nano-hydroxyapatite integration mechanisms', placement: 'nha-vs-fluoride' },
  { id: 'nha-routine', file: 'nha-routine.png', alt: 'Premium oral care routine with toothbrush tablets and timer', placement: 'how-to-use' },
  { id: 'nha-sensitivity', file: 'nha-sensitivity.png', alt: 'Dentine tubuli being sealed by nano-hydroxyapatite particles', placement: 'sensitivity' }
];

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  return (await res.json()).access_token;
}

async function graphql(token, query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function stagedUpload(token, filename, fileSize, mimeType) {
  const query = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }`;
  const variables = {
    input: [{
      resource: 'FILE',
      filename: filename,
      mimeType: mimeType,
      httpMethod: 'POST',
      fileSize: String(fileSize)
    }]
  };
  const data = await graphql(token, query, variables);
  if (data.data.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error('Staged upload error: ' + JSON.stringify(data.data.stagedUploadsCreate.userErrors));
  }
  return data.data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToStaged(target, filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();

  // Add all parameters from staged target
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }

  // Add the file last as a Blob (native in Node 18+)
  const blob = new Blob([fileBuffer], { type: 'image/png' });
  form.append('file', blob, fileName);

  const res = await fetch(target.url, {
    method: 'POST',
    body: form
  });

  if (!res.ok && res.status !== 201 && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text.substring(0, 200)}`);
  }
  return target.resourceUrl;
}

async function createFile(token, resourceUrl, filename, alt) {
  const query = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        ... on MediaImage {
          image { url }
        }
      }
      userErrors { field message }
    }
  }`;
  const variables = {
    files: [{
      alt: alt,
      contentType: 'IMAGE',
      originalSource: resourceUrl,
      filename: filename
    }]
  };
  const data = await graphql(token, query, variables);
  if (data.data.fileCreate.userErrors.length > 0) {
    throw new Error('File create error: ' + JSON.stringify(data.data.fileCreate.userErrors));
  }
  return data.data.fileCreate.files[0];
}

async function waitForFile(token, fileId, maxWait) {
  maxWait = maxWait || 30000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const query = `query getFile($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          id
          image { url }
          fileStatus
        }
      }
    }`;
    const data = await graphql(token, query, { id: fileId });
    const node = data.data.node;
    if (node && node.fileStatus === 'READY' && node.image && node.image.url) {
      return node.image.url;
    }
    if (node && node.fileStatus === 'FAILED') {
      throw new Error('File processing failed for ' + fileId);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout waiting for file ' + fileId);
}

async function getArticle(token) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${NHA_ID}.json?fields=id,title,body_html,image`, {
    headers: { 'X-Shopify-Access-Token': token }
  });
  return (await res.json()).article;
}

async function updateArticle(token, bodyHtml, imageUrl) {
  const payload = { article: { id: NHA_ID, body_html: bodyHtml } };
  if (imageUrl) {
    payload.article.image = { src: imageUrl, alt: 'Nano-hydroxyapatite tooth enamel repair — scientific illustration' };
  }
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/blogs/${BLOG_ID}/articles/${NHA_ID}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function run() {
  console.log('=== Shopify Blog Image Upload ===\n');
  
  const token = await getToken();
  console.log('Token obtained.\n');
  
  // Step 1: Upload all images to Shopify Files
  const uploadedUrls = {};
  
  for (const img of IMAGES) {
    const filePath = path.join(IMAGE_DIR, img.file);
    if (!fs.existsSync(filePath)) {
      console.error(`SKIP: ${img.file} not found`);
      continue;
    }
    
    const fileSize = fs.statSync(filePath).size;
    console.log(`[${img.id}] Uploading ${img.file} (${(fileSize / 1024).toFixed(0)} KB)...`);
    
    try {
      // Create staged upload
      const target = await stagedUpload(token, 'calqix-blog-' + img.id + '.png', fileSize, 'image/png');
      console.log(`  Staged upload created`);
      
      // Upload file to staged URL
      const resourceUrl = await uploadToStaged(target, filePath);
      console.log(`  File uploaded to staging`);
      
      // Create file in Shopify
      const file = await createFile(token, resourceUrl, 'calqix-blog-' + img.id + '.png', img.alt);
      console.log(`  File created: ${file.id}`);
      
      // Wait for processing
      console.log(`  Waiting for processing...`);
      const cdnUrl = await waitForFile(token, file.id);
      console.log(`  CDN URL: ${cdnUrl}\n`);
      
      uploadedUrls[img.id] = cdnUrl;
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
    }
    
    // Brief pause between uploads
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('=== Upload Summary ===');
  Object.keys(uploadedUrls).forEach(id => console.log(`  ${id}: ${uploadedUrls[id]}`));
  console.log('');
  
  // Step 2: Get current article and inject images
  console.log('Fetching current article...');
  const article = await getArticle(token);
  console.log(`  Title: ${article.title}`);
  console.log(`  Body length: ${article.body_html.length} chars\n`);
  
  let html = article.body_html;
  
  // Insert images at appropriate locations in the article
  // Strategy: find headings and insert images after them
  
  // nha-hero: Set as the article featured image (via image field)
  // Also insert at the very beginning of body_html
  if (uploadedUrls['nha-hero']) {
    const heroImg = `<figure class="blog-image blog-image--hero"><img src="${uploadedUrls['nha-hero']}" alt="${IMAGES[0].alt}" loading="eager" width="1792" height="1024" style="width:100%;height:auto;border-radius:12px;"><figcaption>Nano-hydroxyapatite particles integrating into tooth enamel micro-lesions</figcaption></figure>\n`;
    // Insert after opening or at the start
    if (html.indexOf('<h2') !== -1) {
      // Insert before the first h2
      html = heroImg + html;
    } else {
      html = heroImg + html;
    }
    console.log('  Inserted hero image at top');
  }
  
  // nha-comparison: after "How does nano-hydroxyapatite actually repair" or similar heading
  if (uploadedUrls['nha-comparison']) {
    const compImg = `<figure class="blog-image"><img src="${uploadedUrls['nha-comparison']}" alt="${IMAGES[1].alt}" loading="lazy" width="1792" height="1024" style="width:100%;height:auto;border-radius:12px;margin:2rem 0;"><figcaption>Left: damaged enamel with micro-lesions. Right: enamel repaired by nano-hydroxyapatite</figcaption></figure>`;
    html = insertAfterHeading(html, ['how nano-ha repairs enamel'], compImg);
    console.log('  Inserted comparison image');
  }
  
  // nha-vs-fluoride: after fluoride comparison heading
  if (uploadedUrls['nha-vs-fluoride']) {
    const flImg = `<figure class="blog-image"><img src="${uploadedUrls['nha-vs-fluoride']}" alt="${IMAGES[2].alt}" loading="lazy" width="1792" height="1024" style="width:100%;height:auto;border-radius:12px;margin:2rem 0;"><figcaption>Fluoride forms a surface coating (fluorapatite) vs. nano-HA integrates into the enamel structure</figcaption></figure>`;
    html = insertAfterHeading(html, ['nano-ha vs fluoride'], flImg);
    console.log('  Inserted vs-fluoride image');
  }
  
  // nha-routine: after "how to use" heading
  if (uploadedUrls['nha-routine']) {
    const rtImg = `<figure class="blog-image"><img src="${uploadedUrls['nha-routine']}" alt="${IMAGES[3].alt}" loading="lazy" width="1792" height="1024" style="width:100%;height:auto;border-radius:12px;margin:2rem 0;"><figcaption>A complete nano-hydroxyapatite oral care routine</figcaption></figure>`;
    html = insertAfterHeading(html, ['how to use nano-ha'], rtImg);
    console.log('  Inserted routine image');
  }
  
  // nha-sensitivity: after sensitivity heading
  if (uploadedUrls['nha-sensitivity']) {
    const senImg = `<figure class="blog-image"><img src="${uploadedUrls['nha-sensitivity']}" alt="${IMAGES[4].alt}" loading="lazy" width="1024" height="1024" style="width:100%;max-width:600px;height:auto;border-radius:12px;margin:2rem auto;display:block;"><figcaption>Nano-hydroxyapatite particles sealing exposed dentine tubuli to reduce sensitivity</figcaption></figure>`;
    html = insertAfterHeading(html, ['the sensitivity solution'], senImg);
    console.log('  Inserted sensitivity image');
  }
  
  // Step 3: Update the article
  console.log('\nUpdating article...');
  const heroUrl = uploadedUrls['nha-hero'] || null;
  const result = await updateArticle(token, html, heroUrl);
  if (result.article) {
    console.log(`  Article updated! New body length: ${result.article.body_html.length} chars`);
    if (result.article.image) {
      console.log(`  Featured image set: ${result.article.image.src}`);
    }
  } else {
    console.error('  Update failed:', JSON.stringify(result));
  }
  
  console.log('\n=== DONE ===');
  console.log('Blog: https://www.calqix.com/blogs/calqix-elena-writes/nano-hydroxyapatite-the-fluoride-alternative');
}

function insertAfterHeading(html, searchTerms, insertHtml) {
  // Find h2 or h3 heading containing any of the search terms, insert image after the closing paragraph that follows
  const headingRegex = /<h[23][^>]*>([^<]*)<\/h[23]>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const headingText = match[1].toLowerCase();
    const found = searchTerms.some(term => headingText.includes(term.toLowerCase()));
    if (found) {
      // Find the end of this heading
      const insertPos = match.index + match[0].length;
      // Find the next paragraph end after this heading
      const nextPEnd = html.indexOf('</p>', insertPos);
      if (nextPEnd !== -1) {
        const pos = nextPEnd + 4;
        html = html.substring(0, pos) + '\n' + insertHtml + '\n' + html.substring(pos);
        return html;
      }
      // If no paragraph found, insert right after the heading
      html = html.substring(0, insertPos) + '\n' + insertHtml + '\n' + html.substring(insertPos);
      return html;
    }
  }
  // If no matching heading found, try id-based lookup
  for (const term of searchTerms) {
    const idSearch = term.replace(/\s+/g, '-').toLowerCase();
    const idx = html.toLowerCase().indexOf('id="' + idSearch);
    if (idx !== -1) {
      const closingTag = html.indexOf('>', idx);
      if (closingTag !== -1) {
        const afterHeading = html.indexOf('</', closingTag);
        if (afterHeading !== -1) {
          const endTag = html.indexOf('>', afterHeading);
          if (endTag !== -1) {
            const pos = endTag + 1;
            html = html.substring(0, pos) + '\n' + insertHtml + '\n' + html.substring(pos);
            return html;
          }
        }
      }
    }
  }
  console.warn(`  WARNING: No heading found for terms: ${searchTerms.join(', ')}. Image not inserted.`);
  return html;
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
