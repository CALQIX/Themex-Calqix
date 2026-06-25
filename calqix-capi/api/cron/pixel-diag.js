/**
 * Pixel Diagnostic Puller — pulls diagnostics from platform APIs.
 *
 * Schedule: hourly at :15 (calqix-pixel-diag)
 * Endpoint: /api/cron/pixel-diag
 *
 * Queries Meta, Google, and TikTok diagnostic endpoints.
 * Alerts on new issue types.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var rlFetch = require('../../lib/rate-limited-fetch');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

function sanitizeMetaStats(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    data: Array.isArray(data.data) ? data.data : []
  };
}

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var results = {};

    // Meta Pixel diagnostics
    var pixelId = process.env.META_PIXEL_ID;
    var accessToken = process.env.META_ACCESS_TOKEN;
    var apiVersion = process.env.META_API_VERSION || 'v22.0';

    if (pixelId && accessToken) {
      try {
        var metaUrl = 'https://graph.facebook.com/' + apiVersion + '/' + pixelId +
          '/stats?access_token=' + encodeURIComponent(accessToken);
        var metaResult = await rlFetch(metaUrl, {
          method: 'GET',
          label: 'PixelDiag-Meta',
          timeout: 15000,
          maxRetries: 1
        });

        results.meta = {
          ok: metaResult.ok,
          status: metaResult.status,
          data: sanitizeMetaStats(metaResult.data)
        };
      } catch (e) {
        results.meta = { ok: false, error: e.message };
      }
    } else {
      results.meta = { ok: false, error: 'not_configured' };
    }

    // Store results
    var hourKey = new Date().toISOString().slice(0, 13);
    await store.set('pixel:diag:' + hourKey, JSON.stringify({
      timestamp: dates.formatDateTimeAmsterdam(),
      results: results
    }), 8 * 86400);

    // Check for new issues
    if (results.meta && results.meta.data && results.meta.data.data) {
      var metaData = results.meta.data.data;
      if (Array.isArray(metaData)) {
        for (var i = 0; i < metaData.length; i++) {
          var stat = metaData[i];
          if (stat.error_count && stat.error_count > 0) {
            var alertResult = await alertDedup.shouldAlert(
              'pixel-diag', 'meta', stat.event || '*',
              'pixel_error_' + (stat.error_type || 'unknown'), 'P2'
            );
            // P2 alerts are bundled, no immediate send
          }
        }
      }
    }

    return res.status(200).json({ ok: true, results: results });

  } catch (err) {
    console.error('[PixelDiag] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
