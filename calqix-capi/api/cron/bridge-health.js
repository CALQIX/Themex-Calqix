/**
 * Bridge Health Monitor — detects browser bridge capture drops.
 *
 * Schedule: every 10 min (calqix-bridge-health)
 * Endpoint: /api/cron/bridge-health
 *
 * Compares current identity capture traffic with 7-day baseline.
 * >30% drop = P1 alert. >50% drop = P0 alert + AI incident trigger.
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

    var now = new Date();
    var currentHourKey = now.toISOString().slice(0, 13);

    // Get current hour capture count
    var currentCount = parseInt(await redis.get('identity:capture:count:' + currentHourKey) || '0', 10);

    // Build 7-day baseline for same hour
    var baselineCounts = [];
    for (var d = 1; d <= 7; d++) {
      var pastDate = new Date(now.getTime() - d * 86400000);
      var pastKey = pastDate.toISOString().slice(0, 13);
      var pastCount = parseInt(await redis.get('identity:capture:count:' + pastKey) || '0', 10);
      if (pastCount > 0) baselineCounts.push(pastCount);
    }

    var baseline = baselineCounts.length > 0
      ? baselineCounts.reduce(function (a, b) { return a + b; }, 0) / baselineCounts.length
      : 0;

    var dropPct = baseline > 0 ? ((baseline - currentCount) / baseline) * 100 : 0;
    var status = 'healthy';
    var priority = null;

    if (dropPct > 50 && baseline > 5) {
      status = 'critical';
      priority = 'P0';
    } else if (dropPct > 30 && baseline > 5) {
      status = 'degraded';
      priority = 'P1';
    }

    // Store health metric
    await store.set('bridge:health:' + currentHourKey, JSON.stringify({
      current: currentCount,
      baseline: Math.round(baseline),
      dropPct: Math.round(dropPct),
      status: status,
      timestamp: dates.formatDateTimeAmsterdam()
    }), 8 * 86400);

    // Alert if needed
    if (priority) {
      var alertResult = await alertDedup.shouldAlert('bridge-health', 'system', 'capture', 'drop_' + Math.round(dropPct) + 'pct', priority);
      if (alertResult.send) {
        var msg = alertDedup.formatAlertPrefix(priority, alertResult.suppressed) +
          ' Bridge Health\n\n' +
          'Capture volume ' + Math.round(dropPct) + '% lager dan 7-daags gemiddelde\n' +
          'Huidig uur: ' + currentCount + ' captures\n' +
          'Baseline: ' + Math.round(baseline) + ' captures\n' +
          'Tijdstip: ' + dates.formatDateTimeAmsterdam();

        await sendTelegram(msg);

        // Trigger AI incident analysis for P0/P1
        if (alertDedup.shouldTriggerIncidentAnalysis(priority)) {
          try {
            var aiOptimizer = require('../../lib/ai-system-optimizer');
            var rateLimited = await aiOptimizer.isIncidentRateLimited('bridge_health');
            if (!rateLimited) {
              await aiOptimizer.setIncidentRateLimit('bridge_health');
              var aiResult = await aiOptimizer.run('incident', {
                trigger: 'bridge_health_drop',
                priority: priority,
                current: currentCount,
                baseline: Math.round(baseline),
                dropPct: Math.round(dropPct),
                recentHours: baselineCounts
              });
              if (aiResult.ok && aiResult.result) {
                await sendTelegram('\uD83E\uDD16 AI Incident Analyse:\n' + (aiResult.result.summary_nl || 'Geen samenvatting'));
                if (aiResult.result.recommendations) {
                  await aiOptimizer.processRecommendations(aiResult.result.recommendations, 'incident');
                }
              }
            }
          } catch (e) {
            console.warn('[BridgeHealth] AI incident analyse mislukt:', e.message);
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      current: currentCount,
      baseline: Math.round(baseline),
      dropPct: Math.round(dropPct),
      status: status
    });

  } catch (err) {
    console.error('[BridgeHealth] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
