/**
 * Webhook Delivery Audit — checks for missed Shopify webhook deliveries.
 *
 * Schedule: every 30 min at :05,:35 (calqix-webhook-audit)
 * Endpoint: /api/cron/webhook-audit
 *
 * Compares Shopify webhook deliveries with Redis event keys.
 * Auto-triggers reprocessing for missed deliveries.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

function bucketCount(value) {
  var n = Math.max(0, Math.round(Number(value) || 0));
  if (n >= 100) return '100plus';
  if (n >= 50) return '50plus';
  if (n >= 20) return '20plus';
  if (n >= 10) return '10plus';
  return '5plus';
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

    // Count events by state in last hour
    var states = { confirmed: 0, retry_pending: 0, failed_terminal: 0, received: 0, sent: 0, recovered: 0 };
    var staleEvents = [];
    var now = Date.now();
    var cursor = '0';
    var scanned = 0;

    do {
      var scanResult = await redis.scan(cursor, { match: 'meta:event:*', count: 100 });
      cursor = scanResult[0];
      var keys = scanResult[1] || [];

      for (var i = 0; i < keys.length && scanned < 500; i++) {
        scanned++;
        var raw = await redis.get(keys[i]);
        if (!raw) continue;

        var event = store.parseJsonValue(raw, null);
        if (!event) continue;

        if (states[event.state] !== undefined) {
          states[event.state]++;
        }

        // Detect stale "sent" events (stuck for > 5 min)
        if (event.state === 'sent') {
          var lastAttempt = new Date(event.last_attempt || event.updated_at || 0).getTime();
          if (now - lastAttempt > 5 * 60 * 1000) {
            staleEvents.push(event.event_id);
          }
        }

        // Detect stale "received" events (never sent, > 10 min old)
        if (event.state === 'received') {
          var createdAt = new Date(event.created_at || 0).getTime();
          if (now - createdAt > 10 * 60 * 1000) {
            staleEvents.push(event.event_id);
          }
        }
      }
    } while (cursor !== '0' && scanned < 500);

    // Push stale events to recovery queue
    var requeuedCount = 0;
    for (var s = 0; s < staleEvents.length && s < 20; s++) {
      try {
        await redis.lpush('recovery:queue', staleEvents[s]);
        requeuedCount++;
      } catch (e) { /* skip */ }
    }

    // Calculate health metrics
    var totalProcessed = states.confirmed + states.recovered;
    var totalFailed = states.failed_terminal;
    var successRate = (totalProcessed + totalFailed) > 0
      ? Math.round(totalProcessed / (totalProcessed + totalFailed) * 100)
      : 100;

    // Alert on failures
    if (states.failed_terminal > 5) {
      var priority = states.failed_terminal > 20 ? 'P1' : 'P2';
      var alertResult = await alertDedup.shouldAlert(
        'webhook-audit', 'system', '*', 'failed_terminal_' + bucketCount(states.failed_terminal) + '_' + priority.toLowerCase(), priority
      );
      if (alertResult.send) {
        var msg = alertDedup.formatAlertPrefix(priority, alertResult.suppressed) +
          ' Webhook Audit\n\n' +
          'Failed terminal: ' + states.failed_terminal + ' events\n' +
          'Stale events herverwerkt: ' + requeuedCount + '\n' +
          'Success rate: ' + successRate + '%\n' +
          'Tijdstip: ' + dates.formatDateTimeAmsterdam();
        await sendTelegram(msg);
      }
    }

    // Store audit result
    var hourKey = new Date().toISOString().slice(0, 13) + '-' + (new Date().getMinutes() < 30 ? '00' : '30');
    await store.set('webhook:audit:' + hourKey, JSON.stringify({
      timestamp: dates.formatDateTimeAmsterdam(),
      scanned: scanned,
      states: states,
      staleRequeued: requeuedCount,
      successRate: successRate
    }), 8 * 86400);

    return res.status(200).json({
      ok: true,
      scanned: scanned,
      states: states,
      staleRequeued: requeuedCount,
      successRate: successRate
    });

  } catch (err) {
    console.error('[WebhookAudit] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
