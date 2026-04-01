var fetch = require('node-fetch');

var dotenv = require('dotenv');
dotenv.config();

async function generateImage(prompt, options) {
  options = options || {};
  var size = options.size || '1792x1024';
  var quality = options.quality || 'standard';
  var style = options.style || 'natural';

  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY niet ingesteld');

  var response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: buildCalqixPrompt(prompt),
      n: 1,
      size: size,
      quality: quality,
      style: style,
      response_format: 'url'
    })
  });

  var data = await response.json();

  if (data.error) {
    throw new Error('OpenAI API error: ' + data.error.message);
  }

  return {
    url: data.data[0].url,
    revised_prompt: data.data[0].revised_prompt,
    expires: 'URL geldig voor 60 minuten - download direct'
  };
}

function buildCalqixPrompt(userPrompt) {
  return 'Professional scientific illustration for a premium oral care brand called CALQIX. ' +
    'Style: Clean, clinical, modern. Color palette: dark navy (#1B2A4A), white, subtle light blue accents. ' +
    'No text or typography in the image. No logos. Photorealistic or high-quality 3D render. ' +
    'Medical/dental/scientific aesthetic. Premium feel, like a peer-reviewed journal illustration.\n\n' +
    'Subject: ' + userPrompt + '\n\n' +
    'Important: The image should feel authoritative and trustworthy, suitable for a science-backed health blog. ' +
    'No cartoonish elements. No stock photo cliches. Clean backgrounds.';
}

async function downloadImage(imageUrl) {
  var response = await fetch(imageUrl);
  if (!response.ok) throw new Error('Download failed: HTTP ' + response.status);
  var buffer = await response.buffer();
  return buffer;
}

module.exports = { generateImage, buildCalqixPrompt, downloadImage };
