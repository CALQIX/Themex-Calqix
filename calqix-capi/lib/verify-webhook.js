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

function normalizeBase64(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().replace(/-/g, '+').replace(/_/g, '/');

  if (!normalizedValue) {
    return null;
  }

  const paddedLength = Math.ceil(normalizedValue.length / 4) * 4;
  return normalizedValue.padEnd(paddedLength, '=');
}

function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) {
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const normalizedHeader = normalizeBase64(hmacHeader);
  const headerBuffer = normalizedHeader ? Buffer.from(normalizedHeader, 'base64') : null;
  const secretCandidates = toSecretCandidates(secret);

  if (!headerBuffer || headerBuffer.length === 0) {
    return false;
  }

  return secretCandidates.some((candidate) => {
    const generatedBuffer = crypto.createHmac('sha256', candidate).update(bodyBuffer).digest();

    if (generatedBuffer.length !== headerBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
  });
}

module.exports = { verifyShopifyWebhook };
