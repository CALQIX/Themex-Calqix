const crypto = require('crypto');

function toSecretCandidates(secret) {
  const normalizedSecret = typeof secret === 'string' ? secret.trim() : secret;
  const candidates = [];

  if (!normalizedSecret) {
    return candidates;
  }

  candidates.push(
    Buffer.isBuffer(normalizedSecret) ? normalizedSecret : Buffer.from(normalizedSecret, 'utf8')
  );

  if (
    typeof normalizedSecret === 'string' &&
    normalizedSecret.length % 2 === 0 &&
    /^[a-f0-9]+$/i.test(normalizedSecret)
  ) {
    candidates.push(Buffer.from(normalizedSecret, 'hex'));
  }

  return candidates;
}

function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) {
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const headerBuffer = Buffer.from(hmacHeader, 'utf8');
  const secretCandidates = toSecretCandidates(secret);

  return secretCandidates.some((candidate) => {
    const generatedHash = crypto.createHmac('sha256', candidate).update(bodyBuffer).digest('base64');
    const generatedBuffer = Buffer.from(generatedHash, 'utf8');

    if (generatedBuffer.length !== headerBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
  });
}

module.exports = { verifyShopifyWebhook };
