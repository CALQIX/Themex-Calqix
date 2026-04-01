var path = require('path');
var fs = require('fs');
var dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

var { generateImage, downloadImage } = require('../lib/image-generator');

var adImages = [
  {
    id: 'ad-product-hero-square',
    description: 'Premium product photography of white toothpaste tablets spilling from a minimalist container onto a dark navy surface. Soft directional lighting. One tablet in focus in the foreground. Clean, luxury aesthetic. No text.',
    size: '1024x1024',
    usage: 'Meta/Instagram feed ad'
  },
  {
    id: 'ad-product-hero-story',
    description: 'Same concept as above but vertical composition. White toothpaste tablets arranged on a dark navy surface. Premium product photography. Soft lighting from above. Space at top and bottom for text overlay.',
    size: '1024x1792',
    usage: 'Meta/Instagram story ad'
  },
  {
    id: 'ad-before-after',
    description: 'Scientific split-screen showing tooth enamel surface. Left side labeled area: rough, porous enamel with visible micro-lesions under microscope. Right side: smooth, restored enamel after treatment. Clinical, clean look. No text in image.',
    size: '1024x1024',
    usage: 'Before/after ad concept'
  },
  {
    id: 'ad-routine-lifestyle',
    description: 'Modern bathroom countertop scene. A persons hand placing a small white tablet on their tongue. Soft morning light through a window. Minimalist bathroom. Premium, aspirational lifestyle. No face visible, just hand and mouth area.',
    size: '1024x1024',
    usage: 'Lifestyle/routine ad concept'
  },
  {
    id: 'ad-science-closeup',
    description: 'Extreme macro photography of nano-hydroxyapatite crystals. Hexagonal crystal structure visible. Soft blue/white glow. Scientific, futuristic feel. Dark background. Like an electron microscope image but stylized and premium.',
    size: '1024x1024',
    usage: 'Science/authority ad concept'
  }
];

var OUTPUT_DIR = path.resolve(__dirname, '..', 'generated-images', 'ads');

async function run() {
  var onlyId = null;
  process.argv.forEach(function (arg) {
    if (arg.startsWith('--only=')) onlyId = arg.split('=')[1];
  });

  var images = onlyId
    ? adImages.filter(function (img) { return img.id === onlyId; })
    : adImages;

  if (!images.length) {
    console.error('No images matched. Available IDs:', adImages.map(function (i) { return i.id; }).join(', '));
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  var manifest = {
    generated_at: new Date().toISOString(),
    note: 'Deze afbeeldingen zijn startpunten. Bewerk ze in Predis.ai of een editor voor logo, tekst overlay, etc.',
    images: []
  };

  console.log('Generating ' + images.length + ' ad image(s)...\n');

  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    console.log('[' + (i + 1) + '/' + images.length + '] Generating: ' + img.id + ' (' + img.size + ')');

    try {
      var result = await generateImage(img.description, { size: img.size });
      console.log('  Prompt revised: ' + result.revised_prompt.substring(0, 100) + '...');

      console.log('  Downloading...');
      var buffer = await downloadImage(result.url);
      var filename = img.id + '.png';
      var filePath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      console.log('  Saved: ' + filePath + ' (' + (buffer.length / 1024).toFixed(0) + ' KB)\n');

      manifest.images.push({
        id: img.id,
        local_path: 'generated-images/ads/' + filename,
        original_prompt: img.description,
        revised_prompt: result.revised_prompt,
        usage: img.usage,
        size: img.size,
        size_bytes: buffer.length,
        next_step: 'Upload naar Predis.ai of bewerk handmatig voor logo + tekst overlay'
      });
    } catch (err) {
      console.error('  ERROR: ' + err.message + '\n');
      manifest.images.push({
        id: img.id,
        error: err.message,
        usage: img.usage
      });
    }

    if (i < images.length - 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    }
  }

  var manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest saved: ' + manifestPath);

  var successCount = manifest.images.filter(function (img) { return !img.error; }).length;
  console.log('\n=== RESULTAAT ===');
  console.log(successCount + '/' + images.length + ' ad afbeeldingen gegenereerd in ' + OUTPUT_DIR);
  console.log('\nDeze afbeeldingen zijn basis-visuals. Gebruik Predis.ai of een editor om:');
  console.log('- Logo toe te voegen');
  console.log('- Tekst overlay te plaatsen');
  console.log('- Formaat aan te passen voor specifieke plaatsingen');
}

run().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
