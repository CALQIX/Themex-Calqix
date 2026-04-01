var { generateImage } = require('../../lib/image-generator');
var { createPost } = require('../../lib/predis');
var { sendTelegram } = require('../../lib/telegram');
var { authDiagnostics } = require('../../lib/meta-ads');

// Import content suggestions from pipeline
var contentPipelineHandler = require('../ads/content-pipeline');

function authDual(req) {
  if (!authDiagnostics(req)) return false;
  var actionKey = process.env.ADS_ACTION_KEY;
  if (!actionKey) return false;
  var provided = (req.query && req.query.action_key) ||
    (req.headers && req.headers['x-action-key']) ||
    (req.body && req.body.action_key);
  return provided === actionKey;
}

// Helper to get suggestions from the pipeline module
function getSuggestions() {
  // We call the pipeline handler with a mock req/res to extract suggestions
  // Instead, we just require the data directly from the pipeline module
  // Since the module exports a handler, we need to extract suggestions differently
  // For now, we make an internal fetch-like approach
  return new Promise(function (resolve) {
    var suggestions = [];
    var mockRes = {
      status: function () {
        return {
          json: function (data) {
            suggestions = data.suggestions || [];
          }
        };
      }
    };
    var mockReq = {
      method: 'GET',
      query: { key: process.env.DIAGNOSTICS_KEY, type: 'static_ad' },
      headers: {}
    };
    contentPipelineHandler(mockReq, mockRes);
    resolve(suggestions);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDual(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide diagnostics key + action_key (dual auth)' });
  }

  var body = req.body || {};
  var includeAiImages = body.include_ai_images !== false;

  try {
    var suggestions = await getSuggestions();
    var predisAds = suggestions.filter(function (s) {
      return s.platform === 'Predis.ai' && s.auto_create_body;
    });

    if (!predisAds.length) {
      return res.status(200).json({ status: 'OK', message: 'Geen Predis.ai suggesties gevonden', created: 0 });
    }

    var results = [];
    console.log('[bulk-create-ads] Creating ' + predisAds.length + ' ads...');

    for (var i = 0; i < predisAds.length; i++) {
      var ad = predisAds[i];
      var autoBody = ad.auto_create_body;
      var result = { angle: ad.angle, hook: ad.hook };

      try {
        var imageUrl = null;

        // Step 1: Generate AI image if requested
        if (includeAiImages && autoBody.include_ai_image && autoBody.ai_image_prompt) {
          console.log('[bulk-create-ads] [' + (i + 1) + '/' + predisAds.length + '] Generating AI image for: ' + ad.angle);
          var imageResult = await generateImage(autoBody.ai_image_prompt, {
            size: '1024x1024',
            quality: 'standard'
          });
          imageUrl = imageResult.url;
        }

        // Step 2: Create Predis post
        var predisOptions = {
          text: autoBody.suggestion.hook + '\n\n' + (autoBody.suggestion.product_description || ''),
          media_type: 'single_image',
          color_palette_type: 'brand'
        };

        if (imageUrl) {
          predisOptions.media_urls = [imageUrl];
        }

        console.log('[bulk-create-ads] [' + (i + 1) + '/' + predisAds.length + '] Creating Predis post for: ' + ad.angle);
        var predisResult = await createPost(predisOptions);

        result.predis = predisResult;
        result.ai_image_generated = !!imageUrl;
        result.status = predisResult.success ? 'OK' : 'ERROR';
      } catch (err) {
        result.status = 'ERROR';
        result.error = err.message;
      }

      results.push(result);

      // Rate limit: wait 5 seconds between Predis requests
      if (i < predisAds.length - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, 5000); });
      }
    }

    var successCount = results.filter(function (r) { return r.status === 'OK'; }).length;

    // Send Telegram summary
    var msg = '<b>Bulk Ad Creation Complete</b>\n\n' +
      'Totaal: ' + results.length + '\n' +
      'Succesvol: ' + successCount + '\n' +
      'Mislukt: ' + (results.length - successCount) + '\n\n';

    results.forEach(function (r) {
      var icon = r.status === 'OK' ? '✅' : '❌';
      msg += icon + ' ' + r.angle + ': ' + r.hook.substring(0, 50) + '...\n';
      if (r.predis && r.predis.post_ids) {
        msg += '   IDs: ' + r.predis.post_ids.join(', ') + '\n';
      }
      if (r.error) {
        msg += '   Error: ' + r.error + '\n';
      }
    });

    await sendTelegram(msg);

    return res.status(200).json({
      status: 'OK',
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results: results
    });
  } catch (err) {
    console.error('[bulk-create-ads] Fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
