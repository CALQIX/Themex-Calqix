const dotenv = require('dotenv');
const { verifyShopifyWebhook } = require('./verify-webhook');

dotenv.config();

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return null;
}

function getHeader(req, headerName) {
  const headers = req && req.headers ? req.headers : {};
  const normalizedHeaderName = String(headerName || '').toLowerCase();
  const matchingKey = Object.keys(headers).find(
    (key) => String(key || '').toLowerCase() === normalizedHeaderName
  );
  const value = matchingKey ? headers[matchingKey] : undefined;

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function reconstructJsonBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  try {
    return Buffer.from(JSON.stringify(body), 'utf8');
  } catch (error) {
    return null;
  }
}

async function readRawBody(req) {
  const rawBody = toBuffer(req && req.rawBody) || toBuffer(req && req.body);
  if (rawBody) {
    return rawBody;
  }

  const reconstructedBody = reconstructJsonBody(req && req.body);
  if (reconstructedBody) {
    return reconstructedBody;
  }

  if (!req || typeof req.on !== 'function') {
    return null;
  }

  if (req.body && typeof req.body === 'object') {
    return null;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

function getClientIp(req) {
  const forwardedFor = getHeader(req, 'x-forwarded-for');

  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : undefined;
}

function getUserAgent(req) {
  return getHeader(req, 'user-agent');
}

async function parseAndVerifyWebhook(req) {
  const rawBody = await readRawBody(req);
  const hmacHeader = getHeader(req, 'x-shopify-hmac-sha256');
  const secret =
    typeof process.env.SHOPIFY_WEBHOOK_SECRET === 'string'
      ? process.env.SHOPIFY_WEBHOOK_SECRET.trim()
      : process.env.SHOPIFY_WEBHOOK_SECRET;
  const clientIp = getClientIp(req);
  const userAgent = getUserAgent(req);

  if (!rawBody || rawBody.length === 0) {
    return {
      ok: false,
      reason: 'missing_raw_body',
      clientIp,
      userAgent
    };
  }

  if (!hmacHeader) {
    return {
      ok: false,
      reason: 'missing_hmac_header',
      clientIp,
      userAgent
    };
  }

  if (!secret) {
    return {
      ok: false,
      reason: 'missing_secret',
      clientIp,
      userAgent
    };
  }

  if (!verifyShopifyWebhook(rawBody, hmacHeader, secret)) {
    return {
      ok: false,
      reason: 'invalid_hmac',
      clientIp,
      userAgent
    };
  }

  try {
    return {
      ok: true,
      payload: JSON.parse(rawBody.toString('utf8')),
      clientIp,
      userAgent,
      topic: getHeader(req, 'x-shopify-topic'),
      shop: getHeader(req, 'x-shopify-shop-domain')
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_json',
      clientIp,
      userAgent
    };
  }
}

function mergeCustomerData(...sources) {
  return sources.reduce((accumulator, source) => {
    if (!source || typeof source !== 'object') {
      return accumulator;
    }

    Object.entries(source).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        accumulator[key] = value;
      }
    });

    return accumulator;
  }, {});
}

function toMoney(value) {
  const numericValue = Number.parseFloat(value);

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Number(numericValue.toFixed(2));
}

function centsToMoney(value) {
  const numericValue = Number.parseFloat(value);

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Number((numericValue / 100).toFixed(2));
}

function extractVariantIds(lineItems = []) {
  return lineItems
    .map((item) => item && item.variant_id)
    .filter((variantId) => variantId !== undefined && variantId !== null && variantId !== '')
    .map((variantId) => String(variantId));
}

function buildContents(lineItems = [], getItemPrice) {
  return lineItems
    .map((item) => {
      if (!item || item.variant_id === undefined || item.variant_id === null || item.variant_id === '') {
        return null;
      }

      const quantity = Number.parseInt(item.quantity, 10);
      const itemPrice = getItemPrice ? getItemPrice(item) : toMoney(item.price);

      return {
        id: String(item.variant_id),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        item_price: itemPrice
      };
    })
    .filter(Boolean);
}

function countItems(lineItems = []) {
  return lineItems.reduce((total, item) => {
    const quantity = Number.parseInt(item && item.quantity, 10);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
}

function respondOk(res, payload = { received: true }) {
  return res.status(200).json(payload);
}

module.exports = {
  buildContents,
  centsToMoney,
  countItems,
  extractVariantIds,
  getClientIp,
  getUserAgent,
  mergeCustomerData,
  parseAndVerifyWebhook,
  readRawBody,
  respondOk,
  toMoney
};
