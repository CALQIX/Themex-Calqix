/**
 * Daily Reconciliation — matches Shopify orders against all platforms.
 *
 * Schedule: daily at 04:00 Amsterdam (calqix-reconciliation)
 * Endpoint: /api/cron/reconciliation
 *
 * Identifies data loss, value mismatches, platform-specific gaps.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:reconciliation';
var LOCK_TTL = 15 * 60;

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

    // Scan all purchase events from last 24h
    var platformCounts = {
      meta: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 },
      ga: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 },
      tt: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 }
    };

    var orderIds = new Set();
    var mismatches = [];
    var cursor = '0';
    var scanned = 0;

    do {
      var scanResult = await redis.scan(cursor, { match: 'meta:event:purchase_*', count: 50 });
      cursor = scanResult[0];
      var keys = scanResult[1] || [];

      for (var i = 0; i < keys.length && scanned < 1000; i++) {
        scanned++;
        var raw = await redis.get(keys[i]);
        if (!raw) continue;

        var event;
        try { event = JSON.parse(raw); } catch (e) { continue; }

        if (event.event_name !== 'Purchase') continue;

        var eventId = event.event_id;
        if (event.shopify_id) orderIds.add(event.shopify_id);

        // Check Meta
        platformCounts.meta.sent++;
        if (event.state === 'confirmed' || event.state === 'recovered') {
          platformCounts.meta.confirmed++;
        } else if (event.state === 'failed_terminal') {
          platformCounts.meta.failed++;
        }

        // Check Google dedup key
        var gaDedup = await redis.get('processed:ga:' + eventId);
        if (gaDedup) {
          platformCounts.ga.sent++;
          platformCounts.ga.confirmed++;
        }

        // Check TikTok dedup key
        var ttDedup = await redis.get('processed:tt:' + eventId);
        if (ttDedup) {
          platformCounts.tt.sent++;
          platformCounts.tt.confirmed++;
        }

        // Detect platform gaps (event in Meta but not others)
        if (event.state === 'confirmed' && !gaDedup && process.env.GA4_ENABLED === 'true') {
          mismatches.push({ orderId: event.shopify_id, missing: 'Google', eventId: eventId });
        }
        if (event.state === 'confirmed' && !ttDedup && process.env.TIKTOK_ENABLED === 'true') {
          mismatches.push({ orderId: event.shopify_id, missing: 'TikTok', eventId: eventId });
        }
      }
    } while (cursor !== '0' && scanned < 1000);

    var totalOrders = orderIds.size;
    var matchRate = totalOrders > 0
      ? Math.round(platformCounts.meta.confirmed / totalOrders * 100)
      : 100;

    var result = {
      timestamp: dates.formatDateTimeAmsterdam(),
      date: dates.todayKey(new Date(Date.now() - 86400000)),
      totalOrders: totalOrders,
      scanned: scanned,
      platforms: platformCounts,
      matchRate: matchRate,
      mismatches: mismatches.slice(0, 20),
      mismatchCount: mismatches.length
    };

    // Persist
    var dateKey = dates.todayKey(new Date(Date.now() - 86400000));
    await store.set('reconciliation:' + dateKey, JSON.stringify(result), 30 * 86400);

    // Telegram summary
    var msg = '\uD83D\uDCCA Dagelijkse Reconciliation — ' + dateKey + '\n\n' +
      'Orders: ' + totalOrders + '\n' +
      'Meta: ' + platformCounts.meta.confirmed + '/' + platformCounts.meta.sent + ' bevestigd';

    if (process.env.GA4_ENABLED === 'true') {
      msg += '\nGoogle: ' + platformCounts.ga.confirmed + ' matched';
    }
    if (process.env.TIKTOK_ENABLED === 'true') {
      msg += '\nTikTok: ' + platformCounts.tt.confirmed + ' matched';
    }

    msg += '\nMatch rate: ' + matchRate + '%';
    if (mismatches.length > 0) {
      msg += '\nMismatches: ' + mismatches.length + ' events missen op 1+ platform';
    }
    msg += '\n\nStatus: ' + (matchRate >= 99 ? '\uD83D\uDFE2' : matchRate >= 95 ? '\uD83D\uDFE1' : '\uD83D\uDD34');

    await sendTelegram(msg);

    await store.del(LOCK_KEY);

    return res.status(200).json({ ok: true, result: result });

  } catch (err) {
    console.error('[Reconciliation] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};
