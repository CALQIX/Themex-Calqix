/**
 * Identity Store Cleanup — Redis hygiene cron.
 *
 * Schedule: daily at 03:00 Amsterdam (calqix-identity-cleanup)
 * Endpoint: /api/cron/identity-cleanup
 *
 * First 30 days: logging only (no deletion).
 * After 30 days: cleanup expired/orphaned keys.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');

var CLEANUP_START_DATE = '2026-05-15'; // 30 days from deployment
var LOCK_KEY = 'cron:lock:identity-cleanup';
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

    var redis = store._getRedis();
    if (!redis) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: true, skipped: true, reason: 'Redis niet beschikbaar' });
    }

    var isLoggingOnly = new Date() < new Date(CLEANUP_START_DATE);
    var mode = isLoggingOnly ? 'logging_only' : 'active';

    // Scan identity namespaces and count
    var namespaces = ['identity:cart:', 'identity:email:', 'identity:anon:', 'identity:order:', 'identity:link:'];
    var counts = {};
    var expiredCount = 0;

    for (var n = 0; n < namespaces.length; n++) {
      var ns = namespaces[n];
      var count = 0;
      var cursor = '0';

      do {
        var scanResult = await redis.scan(cursor, { match: ns + '*', count: 100 });
        cursor = scanResult[0];
        count += (scanResult[1] || []).length;
      } while (cursor !== '0' && count < 50000);

      counts[ns.replace(/:/g, '_').slice(0, -1)] = count;
    }

    // Count other tracking-related namespaces
    var otherNamespaces = ['meta:event:', 'meta:payload:', 'meta:pending:', 'meta:failed:',
      'processed:meta:', 'processed:ga:', 'processed:tt:',
      'dedup:', 'backfill:', 'alert:', 'ai:'];
    for (var o = 0; o < otherNamespaces.length; o++) {
      var ons = otherNamespaces[o];
      var ocount = 0;
      var ocursor = '0';
      do {
        var oscanResult = await redis.scan(ocursor, { match: ons + '*', count: 100 });
        ocursor = oscanResult[0];
        ocount += (oscanResult[1] || []).length;
      } while (ocursor !== '0' && ocount < 50000);
      counts[ons.replace(/:/g, '_').slice(0, -1)] = ocount;
    }

    // Total Redis key count
    var totalKeys = 0;
    var values = Object.values(counts);
    for (var v = 0; v < values.length; v++) totalKeys += values[v];

    var result = {
      timestamp: dates.formatDateTimeAmsterdam(),
      mode: mode,
      namespaceCounts: counts,
      totalTrackedKeys: totalKeys,
      expiredCleaned: expiredCount,
      cleanupStartDate: CLEANUP_START_DATE
    };

    // Persist daily snapshot
    await store.set('identity:cleanup:' + dates.todayKey(), JSON.stringify(result), 30 * 86400);

    await store.del(LOCK_KEY);

    return res.status(200).json({ ok: true, result: result });

  } catch (err) {
    console.error('[IdentityCleanup] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};
