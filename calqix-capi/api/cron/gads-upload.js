/**
 * Google Ads Batch Upload — flushes queued conversions to Google Ads API.
 *
 * Schedule: every 15 min (calqix-gads-upload)
 * Endpoint: /api/cron/gads-upload
 *
 * Reads conversion batches from Redis, uploads via Google Ads REST API v17.
 * Failed uploads are re-queued for next cycle.
 */
var googleAds = require('../../lib/google-ads-oci');
var { sendTelegram } = require('../../lib/telegram');
var store = require('../../lib/store');

var LOCK_KEY = 'cron:lock:gads-upload';
var LOCK_TTL = 10 * 60;

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var locked = await store.set(LOCK_KEY, '1', LOCK_TTL, true);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }

    var result = await googleAds.flushBatch();

    console.log('[GAds-Upload] Resultaat:', {
      uploaded: result.uploaded,
      failed: result.failed,
      batches: result.batches
    });

    // Send Telegram alert on failures
    if (result.failed > 0) {
      try {
        await sendTelegram(
          '⚠️ Google Ads Upload\n\n' +
          'Geüpload: ' + result.uploaded + '\n' +
          'Mislukt: ' + result.failed + '\n' +
          'Fouten: ' + (result.errors.slice(0, 3).join('; ') || 'geen details')
        );
      } catch (e) {}
    }

    // Clean up lock
    try { var redis = store._getRedis(); if (redis) await redis.del(LOCK_KEY); } catch (e) {}

    return res.status(200).json({
      ok: result.ok,
      uploaded: result.uploaded,
      failed: result.failed,
      batches: result.batches,
      errors: result.errors.slice(0, 5)
    });
  } catch (error) {
    console.error('[GAds-Upload] Fout:', error.message);
    try { var redis = store._getRedis(); if (redis) await redis.del(LOCK_KEY); } catch (e) {}
    return res.status(200).json({ ok: false, error: error.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
