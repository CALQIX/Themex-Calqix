const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');

const SOURCE_URL_BASE = 'https://calqix.com/products/';
const ALLOWED_ORIGINS = ['https://calqix.com', 'https://www.calqix.com'];

async function handler(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : 'https://www.calqix.com'
  );
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    const productId = body.product_id;
    const productHandle = body.product_handle || '';
    const productTitle = body.product_title || '';
    const variantId = body.variant_id;
    const price = body.price;
    const currency = body.currency || 'EUR';

    if (!productId && !variantId) {
      return res.status(400).json({ error: 'product_id or variant_id required' });
    }

    const eventId = body.event_id || ('vc_' + (productId || variantId) + '_' + Date.now());
    const sourceUrl = productHandle
      ? SOURCE_URL_BASE + productHandle
      : SOURCE_URL_BASE;

    const customerData = {};
    if (body.fbc) customerData.fbc = body.fbc;
    if (body.fbp) customerData.fbp = body.fbp;
    if (body.email) customerData.email = body.email;
    if (body.phone) customerData.phone = body.phone;
    if (body.external_id) customerData.external_id = body.external_id;
    if (body.country_code) customerData.country_code = body.country_code;

    const clientIp =
      (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
      (req.socket && req.socket.remoteAddress) ||
      undefined;
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      undefined;

    const userData = formatUserData(customerData, clientIp, clientUserAgent);

    console.log('[ViewContent] browser-side event', {
      eventId,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasCountry: Boolean(userData.country)
    });

    const contentId = String(productId || variantId);
    const contentType = productId ? 'product_group' : 'product';

    const customData = {
      content_ids: [contentId],
      content_type: contentType,
      content_name: productTitle || undefined,
      value: price !== undefined ? Number(parseFloat(price).toFixed(2)) : undefined,
      currency: price !== undefined ? currency : undefined
    };

    const result = await sendEvent('ViewContent', eventId, sourceUrl, userData, customData);

    return res.status(200).json({
      received: true,
      processed: Boolean(result && result.ok),
      event: 'ViewContent',
      eventId
    });
  } catch (error) {
    console.error('[ViewContent] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false });
  }
}

module.exports = handler;
