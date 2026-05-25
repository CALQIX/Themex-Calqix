var qualityLedger = require('../lib/meta-quality-ledger');

function json(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    var body = req.body || {};
    var expectedPixelId = (process.env.META_PIXEL_ID || '').trim();
    var providedPixelId = body.pixel_id ? String(body.pixel_id).trim() : '';
    if (expectedPixelId && providedPixelId && providedPixelId !== expectedPixelId) {
      return json(res, 400, { ok: false, error: 'pixel_id_mismatch' });
    }

    var result = await qualityLedger.recordBrowserEvent({
      event_name: body.event_name,
      event_id: body.event_id,
      event_time: body.event_time || body.eventTime || body.timestamp,
      source: body.source || 'browser_pixel',
      pixel_id: providedPixelId || undefined,
      source_url: body.source_url || body.page_url || body.url,
      identity_flags: body.identity_flags || {},
      custom_data_flags: body.custom_data_flags || {}
    });

    return json(res, result.ok ? 200 : 422, {
      ok: result.ok,
      received: true,
      event_name: result.event_name,
      event_id: result.event_id,
      day: result.day,
      prefix_ok: result.prefix_ok,
      error: result.error
    });
  } catch (err) {
    console.error('[MetaBrowserEvent] failed', { message: err.message });
    return json(res, 500, { ok: false, error: 'internal_error' });
  }
};
