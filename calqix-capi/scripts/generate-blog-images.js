var path = require('path');
var fs = require('fs');
var dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

var { generateImage, downloadImage } = require('../lib/image-generator');

var blogImages = [
  {
    id: 'nha-hero',
    description: 'Cross-section of a human tooth showing enamel layer with microscopic nano-hydroxyapatite particles integrating into micro-lesions. Scientific 3D render. Dark navy background with subtle blue glow highlighting the mineral particles.',
    size: '1792x1024',
    placement: 'Hero image / header'
  },
  {
    id: 'nha-comparison',
    description: 'Split-screen scientific comparison. Left side: damaged tooth enamel surface under electron microscope showing pores and erosion. Right side: same enamel surface after nano-hydroxyapatite treatment showing smooth, repaired mineral structure. Clean, clinical aesthetic.',
    size: '1792x1024',
    placement: 'Section: How Nano-HA Repairs Enamel'
  },
  {
    id: 'nha-vs-fluoride',
    description: 'Scientific diagram showing two mechanisms side by side. Left: fluoride creating a coating layer ON TOP of tooth enamel (fluorapatite). Right: nano-hydroxyapatite particles filling INTO the enamel structure. Schematic style, clean lines, navy and white color scheme.',
    size: '1792x1024',
    placement: 'Section: Nano-HA vs Fluoride'
  },
  {
    id: 'nha-routine',
    description: 'Minimalist flat lay on white marble surface showing a premium oral care routine: a sleek toothbrush, a small glass container with white tablets, and a subtle 30-minute timer icon. Navy blue accents. Premium lifestyle photography aesthetic.',
    size: '1792x1024',
    placement: 'Section: How to Use Nano-HA Effectively'
  },
  {
    id: 'nha-sensitivity',
    description: '3D medical illustration of dentine tubuli (microscopic channels in tooth dentin) being sealed by nano-hydroxyapatite particles. Show the tubuli as small tunnels, with n-HA particles plugging them. Cross-section view. Scientific, clean, navy background.',
    size: '1024x1024',
    placement: 'Section: The Sensitivity Solution'
  }
];

var OUTPUT_DIR = path.resolve(__dirname, '..', 'generated-images', 'blog');

async function run() {
  // Parse CLI args: --only=nha-hero to generate just one
  var onlyId = null;
  process.argv.forEach(function (arg) {
    if (arg.startsWith('--only=')) onlyId = arg.split('=')[1];
  });

  var images = onlyId
    ? blogImages.filter(function (img) { return img.id === onlyId; })
    : blogImages;

  if (!images.length) {
    console.error('No images matched. Available IDs:', blogImages.map(function (i) { return i.id; }).join(', '));
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  var manifest = {
    generated_at: new Date().toISOString(),
    images: []
  };

  console.log('Generating ' + images.length + ' blog image(s)...\n');

  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    console.log('[' + (i + 1) + '/' + images.length + '] Generating: ' + img.id + ' (' + img.size + ')');

    try {
      var result = await generateImage(img.description, { size: img.size });
      console.log('  Prompt revised: ' + result.revised_prompt.substring(0, 100) + '...');

      // Download the image
      console.log('  Downloading...');
      var buffer = await downloadImage(result.url);
      var filename = img.id + '.png';
      var filePath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      console.log('  Saved: ' + filePath + ' (' + (buffer.length / 1024).toFixed(0) + ' KB)\n');

      manifest.images.push({
        id: img.id,
        local_path: 'generated-images/blog/' + filename,
        original_prompt: img.description,
        revised_prompt: result.revised_prompt,
        placement: img.placement,
        size_bytes: buffer.length,
        upload_to: 'Shopify Admin > Content > Files, then update blog article'
      });
    } catch (err) {
      console.error('  ERROR: ' + err.message + '\n');
      manifest.images.push({
        id: img.id,
        error: err.message,
        placement: img.placement
      });
    }

    // Rate limit: wait 2s between requests
    if (i < images.length - 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    }
  }

  // Write manifest
  var manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest saved: ' + manifestPath);

  var successCount = manifest.images.filter(function (img) { return !img.error; }).length;
  console.log('\n=== RESULTAAT ===');
  console.log(successCount + '/' + images.length + ' afbeeldingen gegenereerd in ' + OUTPUT_DIR);
  console.log('\nUpload ze handmatig naar Shopify Admin > Content > Files.');
  console.log('Kopieer de Shopify CDN URLs en vervang de placeholders in de blog article.');
}

run().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
