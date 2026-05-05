var store = require('../lib/store');

var TTL = 14 * 86400;

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function incr(key) {
  var redis = store._getRedis();
  if (redis) {
    await redis.incr(key);
    await redis.expire(key, TTL);
    return;
  }
  var current = parseInt(await store.get(key), 10) || 0;
  await store.set(key, String(current + 1), TTL);
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var body = req.body || {};
    var eventType = String(body.event_type || 'unknown').slice(0, 80);
    var eventId = String(body.shopify_event_id || body.event_id || Date.now()).slice(0, 160);
    var day = todayKey();
    var last = {
      received_at: new Date().toISOString(),
      event_type: eventType,
      shopify_event_id: eventId,
      source_url: body.source_url || null,
      pixel_id: body.pixel_id || null,
      web_pixel_version: body.web_pixel_version || null,
      has_fbp: Boolean(body.fbp),
      has_fbc: Boolean(body.fbc),
      has_external_id: Boolean(body.external_id),
      has_checkout_token: Boolean(body.checkout_token),
      has_email: Boolean(body.email),
      has_phone: Boolean(body.phone)
    };

    await store.set('shopify:web_pixel:last', JSON.stringify(last), TTL);
    await store.set('shopify:web_pixel:last:' + eventType, JSON.stringify(last), TTL);
    await incr('shopify:web_pixel:count:' + day + ':' + eventType);

    return res.status(200).json({ ok: true, received: true });
  } catch (err) {
    console.error('[ShopifyWebPixel] Error:', err.message);
    return res.status(200).json({ ok: false, received: true, error: err.message });
  }
};
