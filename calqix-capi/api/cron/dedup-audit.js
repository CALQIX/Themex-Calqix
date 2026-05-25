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

function bucketPercent(value, step) {
  var n = Math.max(0, Math.round(Number(value) || 0));
  var size = step || 10;
  return Math.floor(n / size) * size;
}

function isEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

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
    var platforms = ['meta'];
    if (isEnabled(process.env.GA4_ENABLED) || isEnabled(process.env.GOOGLE_ENABLED)) {
      platforms.push('ga');
    }
    if (isEnabled(process.env.TIKTOK_ENABLED)) {
      platforms.push('tt');
    }
    var platformLabels = { meta: 'Meta', ga: 'Google', tt: 'TikTok' };
    var stats = {};

    for (var p = 0; p < platforms.length; p++) {
      var platform = platforms[p];
      var count = platform === 'meta'
        ? await countConfirmedMetaEvents(redis)
        : await countProcessedKeys(redis, 'processed:' + platform + ':');

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
      var issueBucket = 'delta_' + bucketPercent(maxDelta, 10) + 'pct_' + priority.toLowerCase();
      var alertResult = await alertDedup.shouldAlert('dedup-audit', worstPlatform, '*', issueBucket, priority);

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

async function countProcessedKeys(redis, prefix) {
  var count = 0;
  var cursor = '0';
  do {
    var scanResult = await redis.scan(cursor, { match: prefix + '*', count: 100 });
    cursor = scanResult[0];
    count += (scanResult[1] || []).length;
  } while (cursor !== '0' && count < 10000);
  return count;
}

async function countConfirmedMetaEvents(redis) {
  var count = 0;
  var cursor = '0';
  var scanned = 0;
  do {
    var scanResult = await redis.scan(cursor, { match: 'meta:event:*', count: 100 });
    cursor = scanResult[0];
    var keys = scanResult[1] || [];
    for (var i = 0; i < keys.length && scanned < 10000; i++) {
      scanned++;
      var raw = await redis.get(keys[i]);
      if (!raw) continue;
      var event;
      try { event = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { continue; }
      if (event.state === 'confirmed' || event.state === 'recovered') count++;
    }
  } while (cursor !== '0' && scanned < 10000);
  return count;
}
