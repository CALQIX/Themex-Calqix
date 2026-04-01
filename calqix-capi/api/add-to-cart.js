// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');

const DEFAULT_SOURCE_URL = 'https://calqix.com/cart';

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://calqix.com');
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

    const contentIds = Array.isArray(body.content_ids) ? body.content_ids : [];
    const contentType = body.content_type || 'product_group';
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const value = body.value !== undefined ? Number(parseFloat(body.value).toFixed(2)) : undefined;
    const currency = body.currency || 'EUR';

    if (contentIds.length === 0) {
      return res.status(400).json({ error: 'content_ids required' });
    }

    const eventId = body.event_id || ('atc_' + contentIds[0] + '_' + Date.now());
    const sourceUrl = body.source_url || DEFAULT_SOURCE_URL;

    const customerData = {};
    if (body.fbc) customerData.fbc = body.fbc;
    if (body.fbp) customerData.fbp = body.fbp;
    if (body.email) customerData.email = body.email;
    if (body.external_id) customerData.external_id = body.external_id;

    const clientIp =
      (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
      (req.socket && req.socket.remoteAddress) ||
      undefined;
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      undefined;

    const userData = formatUserData(customerData, clientIp, clientUserAgent);

    const customData = {
      content_ids: contentIds,
      content_type: contentType,
      contents: contents.length > 0 ? contents : undefined,
      value: Number.isFinite(value) ? value : undefined,
      currency: Number.isFinite(value) ? currency : undefined,
      num_items: contents.reduce(function (sum, c) { return sum + (c.quantity || 1); }, 0) || contentIds.length
    };

    const hasUserSignals = Boolean(userData.fbc || userData.fbp || userData.em || userData.ph);

    console.log('[AddToCart] browser-side event', {
      eventId: eventId,
      contentIds: contentIds.length,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent),
      hasExternalId: Boolean(userData.external_id)
    });

    const result = await sendEvent('AddToCart', eventId, sourceUrl, userData, customData);

    return res.status(200).json({
      received: true,
      processed: Boolean(result && result.ok),
      event: 'AddToCart',
      eventId: eventId,
      match_keys: {
        fbc: Boolean(userData.fbc),
        fbp: Boolean(userData.fbp),
        em: Boolean(userData.em),
        ip: Boolean(userData.client_ip_address),
        ua: Boolean(userData.client_user_agent)
      }
    });
  } catch (error) {
    console.error('[AddToCart] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false });
  }
}

module.exports = handler;
