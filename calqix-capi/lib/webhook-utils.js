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

function readRequestStream(req) {
  if (!req || typeof req.on !== 'function') {
    return Promise.resolve(null);
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

async function readRawBodyDetails(req) {
  const directRawBody = toBuffer(req && req.rawBody);
  if (directRawBody) {
    return {
      buffer: directRawBody,
      source: 'req.rawBody'
    };
  }

  const directBody = toBuffer(req && req.body);
  if (directBody) {
    return {
      buffer: directBody,
      source: 'req.body'
    };
  }

  const streamedBody = await readRequestStream(req);
  if (streamedBody && streamedBody.length > 0) {
    return {
      buffer: streamedBody,
      source: 'stream'
    };
  }

  const reconstructedBody = reconstructJsonBody(req && req.body);
  if (reconstructedBody) {
    return {
      buffer: reconstructedBody,
      source: 'reconstructed_json'
    };
  }

  return {
    buffer: null,
    source: 'missing'
  };
}

async function readRawBody(req) {
  const result = await readRawBodyDetails(req);
  return result.buffer;
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
  const rawBodyDetails = await readRawBodyDetails(req);
  const rawBody = rawBodyDetails.buffer;
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
    console.warn('[Webhook verification] invalid_hmac', {
      bodySource: rawBodyDetails.source,
      bodyLength: rawBody.length,
      contentType: getHeader(req, 'content-type'),
      contentLength: getHeader(req, 'content-length'),
      hasParsedBodyObject: Boolean(req && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))
    });

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

/**
 * Returns every catalog identifier we can extract from a Shopify line item,
 * in the order Meta Commerce is most likely to match (most specific first).
 *
 * The CALQIX Meta Commerce catalog (id 1549301396145400) uses variant-level
 * `retailer_id`s — about half are raw Shopify variant_ids (e.g. `54065091346761`)
 * and half are manually-set SKUs (e.g. `CALQIX-OBP-30-CM`). Neither format
 * matches the Shopify parent `product_id`, which is why sending product_id
 * alone produced the `pixel_has_low_event_source_match_rate = failed` finding
 * in `/{pixel}/da_checks` on 2026-04-23.
 *
 * We therefore emit variant_id + sku (both `type: 'product'`) and keep
 * product_id as a last-resort fallback. Meta deduplicates against catalog
 * retailer_id, so adding extra candidates only helps match rate — it never
 * double-counts.
 *
 * @returns {Array<{id: string, type: 'product' | 'product_group'}>}
 */
function getCatalogItemReferences(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }

  const refs = [];

  const variantId = item.variant_id;
  if (variantId !== undefined && variantId !== null && variantId !== '') {
    refs.push({ id: String(variantId), type: 'product' });
  }

  const sku = item.sku;
  if (sku !== undefined && sku !== null && sku !== '') {
    refs.push({ id: String(sku), type: 'product' });
  }

  // Only include product_id if we have no variant-level signal at all.
  if (refs.length === 0) {
    const productId = item.product_id;
    if (productId !== undefined && productId !== null && productId !== '') {
      refs.push({ id: String(productId), type: 'product_group' });
    }
  }

  return refs;
}

// Back-compat alias — some callers expect a single reference.
function getCatalogItemReference(item) {
  const refs = getCatalogItemReferences(item);
  return refs.length > 0 ? refs[0] : null;
}

function extractContentIds(lineItems = []) {
  const ids = [];
  const seen = new Set();
  lineItems.forEach((item) => {
    getCatalogItemReferences(item).forEach((ref) => {
      if (!seen.has(ref.id)) {
        seen.add(ref.id);
        ids.push(ref.id);
      }
    });
  });
  return ids;
}

function resolveContentType(lineItems = []) {
  const allRefs = lineItems.reduce((acc, item) => acc.concat(getCatalogItemReferences(item)), []);

  if (allRefs.length === 0) {
    return 'product';
  }

  // Mixed arrays are not allowed by Meta. Prefer 'product' (variant-level)
  // since the CALQIX catalog stores variant-level items. Only fall back to
  // 'product_group' if EVERY ref is product_group (i.e. no variant data at all).
  return allRefs.every((ref) => ref.type === 'product_group') ? 'product_group' : 'product';
}

function buildContents(lineItems = [], getItemPrice) {
  return lineItems
    .map((item) => {
      const refs = getCatalogItemReferences(item);

      if (refs.length === 0) {
        return null;
      }

      // One contents entry per line item — use the most specific (first) ref.
      const primary = refs[0];
      const quantity = Number.parseInt(item.quantity, 10);
      const itemPrice = getItemPrice ? getItemPrice(item) : toMoney(item.price);

      return {
        id: primary.id,
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

function getNoteAttribute(noteAttributes, name) {
  if (!Array.isArray(noteAttributes)) return undefined;

  const entry = noteAttributes.find(
    (attr) => attr && attr.name === name
  );

  return entry && entry.value ? entry.value : undefined;
}

function extractMetaBrowserIds(payload) {
  if (!payload || typeof payload !== 'object') return {};

  const noteAttributes =
    payload.note_attributes || payload.attributes || [];

  const fbc = getNoteAttribute(noteAttributes, '_meta_fbc');
  const fbp = getNoteAttribute(noteAttributes, '_meta_fbp');

  const result = {};
  if (fbc) result.fbc = fbc;
  if (fbp) result.fbp = fbp;
  return result;
}

function extractExternalId(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const customerId =
    (payload.customer && payload.customer.id) || payload.customer_id;

  return customerId ? String(customerId) : undefined;
}

module.exports = {
  buildContents,
  centsToMoney,
  countItems,
  extractContentIds,
  extractExternalId,
  extractMetaBrowserIds,
  getClientIp,
  getUserAgent,
  mergeCustomerData,
  parseAndVerifyWebhook,
  readRawBody,
  respondOk,
  resolveContentType,
  toMoney
};
