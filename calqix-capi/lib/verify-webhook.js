const crypto = require('crypto');

function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) {
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const generatedHash = crypto.createHmac('sha256', secret).update(bodyBuffer).digest('base64');
  const generatedBuffer = Buffer.from(generatedHash, 'utf8');
  const headerBuffer = Buffer.from(hmacHeader, 'utf8');

  if (generatedBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
}

module.exports = { verifyShopifyWebhook };
