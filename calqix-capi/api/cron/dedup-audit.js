/**
 * Cross-Platform Dedup Audit — monitors dedup rates across platforms.
 *
 * Schedule: every 30 min (calqix-dedup-audit)
 * Endpoint: /api/cron/dedup-audit
 *
 * Calculates dedup rate per platform and cross-platform delta.
 * >10% delta = alert. >20% delta = auto-pause degrading platform.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var redis = store._getRedis();
    if (!redis) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Redis niet beschikbaar' });
    }

    // Count dedup hits and total sends per platform in last 30 min
    var platforms = ['meta', 'ga', 'tt'];
    var platformLabels = { meta: 'Meta', ga: 'Google', tt: 'TikTok' };
    var stats = {};

    for (var p = 0; p < platforms.length; p++) {
      var platform = platforms[p];
      var prefix = 'processed:' + platform + ':';

      // Count keys (approximate via scan)
      var count = 0;
      var cursor = '0';
      do {
        var scanResult = await redis.scan(cursor, { match: prefix + '*', count: 100 });
        cursor = scanResult[0];
        count += (scanResult[1] || []).length;
      } while (cursor !== '0' && count < 10000);

      stats[platform] = {
        dedupKeys: count,
        label: platformLabels[platform]
      };
    }

    // Calculate cross-platform delta (Meta as reference)
    var metaCount = stats.meta ? stats.meta.dedupKeys : 0;
    var deltas = {};

    for (var pp = 0; pp < platforms.length; pp++) {
      if (platforms[pp] === 'meta') continue;
      var pCount = stats[platforms[pp]] ? stats[platforms[pp]].dedupKeys : 0;
      var delta = metaCount > 0 ? Math.abs(metaCount - pCount) / metaCount * 100 : 0;
      deltas[platforms[pp]] = Math.round(delta);
    }

    // Store audit result
    var hourKey = new Date().toISOString().slice(0, 13);
    await store.set('dedup:audit:' + hourKey, JSON.stringify({
      timestamp: dates.formatDateTimeAmsterdam(),
      stats: stats,
      deltas: deltas
    }), 8 * 86400);

    // Alert on high deltas
    var maxDelta = 0;
    var worstPlatform = null;
    var deltaKeys = Object.keys(deltas);
    for (var d = 0; d < deltaKeys.length; d++) {
      if (deltas[deltaKeys[d]] > maxDelta) {
        maxDelta = deltas[deltaKeys[d]];
        worstPlatform = deltaKeys[d];
      }
    }

    if (maxDelta > 10 && metaCount > 10) {
      var priority = maxDelta > 20 ? 'P1' : 'P2';
      var alertResult = await alertDedup.shouldAlert('dedup-audit', worstPlatform, '*', 'delta_' + maxDelta + 'pct', priority);

      if (alertResult.send) {
        var msg = alertDedup.formatAlertPrefix(priority, alertResult.suppressed) +
          ' Dedup Audit\n\n' +
          'Cross-platform dedup delta: ' + maxDelta + '%\n' +
          'Platform: ' + (platformLabels[worstPlatform] || worstPlatform) + '\n' +
          'Meta dedup keys: ' + metaCount + '\n' +
          'Tijdstip: ' + dates.formatDateTimeAmsterdam();

        await sendTelegram(msg);
      }
    }

    return res.status(200).json({
      ok: true,
      stats: stats,
      deltas: deltas,
      maxDelta: maxDelta
    });

  } catch (err) {
    console.error('[DedupAudit] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
