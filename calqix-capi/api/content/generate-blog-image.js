var { generateImage, downloadImage } = require('../../lib/image-generator');
var { authDiagnostics } = require('../../lib/meta-ads');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var body = req.body || {};
  var description = body.description;
  if (!description) {
    return res.status(400).json({ error: 'Missing required field: description' });
  }

  var size = body.size || '1792x1024';
  var quality = body.quality || 'standard';
  var style = body.style || 'natural';
  var returnBase64 = body.return_base64 === true;

  try {
    var result = await generateImage(description, { size: size, quality: quality, style: style });

    var response = {
      status: 'OK',
      image_url: result.url,
      revised_prompt: result.revised_prompt,
      size: size,
      quality: quality,
      download_instructions: 'URL is geldig voor 60 minuten. Download de afbeelding direct en upload naar Shopify Admin > Content > Files.'
    };

    if (returnBase64) {
      var buffer = await downloadImage(result.url);
      response.base64 = buffer.toString('base64');
      response.mime_type = 'image/png';
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('[generate-blog-image] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
