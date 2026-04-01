var { generateImage } = require('../../lib/image-generator');
var { createPost } = require('../../lib/predis');
var { authDiagnostics } = require('../../lib/meta-ads');

function authDual(req) {
  if (!authDiagnostics(req)) return false;
  var actionKey = process.env.ADS_ACTION_KEY;
  if (!actionKey) return false;
  var provided = (req.query && req.query.action_key) ||
    (req.headers && req.headers['x-action-key']) ||
    (req.body && req.body.action_key);
  return provided === actionKey;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDual(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide diagnostics key + action_key (dual auth)' });
  }

  var body = req.body || {};
  var suggestion = body.suggestion;
  if (!suggestion || !suggestion.hook) {
    return res.status(400).json({ error: 'Missing required field: suggestion.hook' });
  }

  var includeAiImage = body.include_ai_image === true;
  var aiImagePrompt = body.ai_image_prompt || null;

  try {
    var imageUrl = null;

    // Step 1: Generate AI image if requested
    if (includeAiImage && aiImagePrompt) {
      console.log('[create-predis-ad] Generating AI image...');
      var imageResult = await generateImage(aiImagePrompt, {
        size: '1024x1024',
        quality: 'standard'
      });
      imageUrl = imageResult.url;
      console.log('[create-predis-ad] AI image generated:', imageUrl.substring(0, 80) + '...');
    }

    // Step 2: Build ad text for Predis
    var adText = suggestion.hook;
    if (suggestion.product_description) {
      adText += '\n\n' + suggestion.product_description;
    }

    // Step 3: Create post in Predis
    var predisOptions = {
      text: adText,
      media_type: 'single_image',
      color_palette_type: 'brand'
    };

    if (suggestion.output_language) {
      predisOptions.output_language = suggestion.output_language;
    }

    if (imageUrl) {
      predisOptions.media_urls = [imageUrl];
    }

    var predisResult = await createPost(predisOptions);

    return res.status(200).json({
      status: predisResult.success ? 'OK' : 'ERROR',
      ai_image: includeAiImage ? {
        generated: !!imageUrl,
        url: imageUrl,
        note: imageUrl ? 'URL geldig voor 60 minuten' : null
      } : null,
      predis: predisResult,
      suggestion: {
        angle: suggestion.angle,
        hook: suggestion.hook,
        format: suggestion.format || 'square',
        ad_concept: suggestion.ad_concept
      }
    });
  } catch (err) {
    console.error('[create-predis-ad] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
