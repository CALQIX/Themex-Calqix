/**
 * Real-Time Anomaly Detector — z-score based event monitoring.
 *
 * Schedule: every 5 min, 09-23 Amsterdam (calqix-anomaly-watch)
 * Endpoint: /api/cron/anomaly-watch
 *
 * Computes z-score per event type against 7-day median.
 * |z| > 3.0 on Purchase = P0 alert within 5 min.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

var EVENT_TYPES = ['Purchase', 'InitiateCheckout', 'AddToCart', 'ViewContent', 'Lead'];

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
    var currentSlot = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm (5 min granularity)
    var anomalies = [];
    var results = {};

    for (var e = 0; e < EVENT_TYPES.length; e++) {
      var eventType = EVENT_TYPES[e];

      // Get current count (last 5 min)
      var currentKey = 'event:count:' + eventType + ':' + currentSlot;
      var current = parseInt(await redis.get(currentKey) || '0', 10);

      // Build 7-day baseline for same time-of-day slot
      var historicalCounts = [];
      for (var d = 1; d <= 7; d++) {
        var pastDate = new Date(now.getTime() - d * 86400000);
        var pastSlot = pastDate.toISOString().slice(0, 16);
        var pastKey = 'event:count:' + eventType + ':' + pastSlot;
        var pastCount = parseInt(await redis.get(pastKey) || '0', 10);
        if (pastCount > 0) historicalCounts.push(pastCount);
      }

      if (historicalCounts.length < 3) {
        results[eventType] = { current: current, baseline: 0, zScore: 0, status: 'insufficient_data' };
        continue;
      }

      // Calculate median and MAD (median absolute deviation) for robust z-score
      historicalCounts.sort(function (a, b) { return a - b; });
      var median = historicalCounts[Math.floor(historicalCounts.length / 2)];
      var mad = calculateMAD(historicalCounts, median);
      var zScore = mad > 0 ? (current - median) / (1.4826 * mad) : 0;

      results[eventType] = {
        current: current,
        median: median,
        mad: mad,
        zScore: Math.round(zScore * 100) / 100,
        status: Math.abs(zScore) > 3.0 ? 'anomaly' : 'normal'
      };

      // Alert on anomalies
      if (Math.abs(zScore) > 3.0 && median > 0) {
        var priority = eventType === 'Purchase' ? 'P0' : 'P1';
        anomalies.push({
          eventType: eventType,
          current: current,
          median: median,
          zScore: Math.round(zScore * 100) / 100,
          priority: priority
        });
      }
    }

    // Send alerts
    for (var a = 0; a < anomalies.length; a++) {
      var anomaly = anomalies[a];
      var alertResult = await alertDedup.shouldAlert(
        'anomaly-watch', 'meta', anomaly.eventType,
        'zscore_' + (anomaly.zScore > 0 ? 'high' : 'low'),
        anomaly.priority
      );

      if (alertResult.send) {
        var direction = anomaly.zScore > 0 ? 'hoger' : 'lager';
        var msg = alertDedup.formatAlertPrefix(anomaly.priority, alertResult.suppressed) +
          ' Anomalie Detectie\n\n' +
          'Event: ' + anomaly.eventType + '\n' +
          'Huidig: ' + anomaly.current + ' (z=' + anomaly.zScore + ')\n' +
          '7-daags mediaan: ' + anomaly.median + '\n' +
          'Significant ' + direction + ' dan verwacht\n' +
          'Tijdstip: ' + dates.formatDateTimeAmsterdam();

        await sendTelegram(msg);

        // Trigger AI incident analysis for P0/P1
        if (alertDedup.shouldTriggerIncidentAnalysis(anomaly.priority)) {
          try {
            var aiOptimizer = require('../../lib/ai-system-optimizer');
            var rateLimited = await aiOptimizer.isIncidentRateLimited('anomaly_' + anomaly.eventType);
            if (!rateLimited) {
              await aiOptimizer.setIncidentRateLimit('anomaly_' + anomaly.eventType);
              var aiResult = await aiOptimizer.run('incident', {
                trigger: 'anomaly_detected',
                eventType: anomaly.eventType,
                current: anomaly.current,
                median: anomaly.median,
                zScore: anomaly.zScore,
                priority: anomaly.priority,
                allResults: results
              });
              if (aiResult.ok && aiResult.result) {
                await sendTelegram('\uD83E\uDD16 AI Incident Analyse:\n' + (aiResult.result.summary_nl || 'Geen samenvatting'));
                if (aiResult.result.recommendations) {
                  await aiOptimizer.processRecommendations(aiResult.result.recommendations, 'incident');
                }
              }
            }
          } catch (ie) {
            console.warn('[AnomalyWatch] AI incident analyse mislukt:', ie.message);
          }
        }
      }
    }

    // Store result for trending
    await store.set('anomaly:result:' + currentSlot, JSON.stringify({
      timestamp: dates.formatDateTimeAmsterdam(),
      results: results,
      anomalyCount: anomalies.length
    }), 8 * 86400);

    return res.status(200).json({
      ok: true,
      results: results,
      anomalies: anomalies.length
    });

  } catch (err) {
    console.error('[AnomalyWatch] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

function calculateMAD(sortedValues, median) {
  var deviations = sortedValues.map(function (v) { return Math.abs(v - median); });
  deviations.sort(function (a, b) { return a - b; });
  return deviations[Math.floor(deviations.length / 2)] || 0;
}
