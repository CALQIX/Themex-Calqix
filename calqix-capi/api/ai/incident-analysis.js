/**
 * AI Incident Analysis — triggered by P0/P1 alerts, not a cron.
 *
 * Endpoint: POST /api/ai/incident-analysis
 *
 * Delivers root cause hypothesis + immediate action recommendation within 30 sec.
 * Rate limited: max 1 analysis per 5 min per incident type.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var aiOptimizer = require('../../lib/ai-system-optimizer');
var { sendTelegram } = require('../../lib/telegram');

module.exports = async function (req, res) {
  try {
    // Auth
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!aiOptimizer.ENABLED()) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'AI optimizer uitgeschakeld' });
    }

    var body = req.body || {};
    var incidentType = body.incident_type || body.type || 'unknown';
    var incidentContext = body.context || {};
    var priority = body.priority || 'P1';

    // Rate limit check
    var rateLimited = await aiOptimizer.isIncidentRateLimited(incidentType);
    if (rateLimited) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Rate limited (max 1 per 5 min per type)' });
    }

    await aiOptimizer.setIncidentRateLimit(incidentType);

    // Build incident context
    var context = {
      timestamp: dates.formatDateTimeAmsterdam(),
      mode: 'incident',
      trigger: incidentType,
      priority: priority,
      incidentData: incidentContext
    };

    // Add recent related telemetry (last 6 hours)
    var redis = store._getRedis();
    if (redis) {
      try {
        // Recent alerts
        var alertDedup = require('../../lib/alert-dedup');
        var alerts = await alertDedup.getTodayAlerts();
        context.recentAlerts = alerts.slice(-30);
      } catch (e) { /* skip */ }

      // Recovery queue size
      try {
        context.recoveryQueueLength = await redis.llen('recovery:queue') || 0;
      } catch (e) { /* skip */ }
    }

    var result = await aiOptimizer.run('incident', context);

    if (!result.ok) {
      return res.status(200).json({ ok: false, error: result.error, tokensUsed: result.tokensUsed });
    }

    var parsed = result.result;

    // Process any recommendations
    if (parsed.recommendations && parsed.recommendations.length > 0) {
      await aiOptimizer.processRecommendations(parsed.recommendations, 'incident');
    }

    // Append to original alert thread in Telegram
    var msg = '\uD83E\uDD16 AI Incident Analyse — ' + incidentType + '\n\n' +
      'Health: ' + parsed.system_health_score + '/100\n' +
      (parsed.summary_nl || 'Geen samenvatting') + '\n';

    if (parsed.recommendations && parsed.recommendations.length > 0) {
      msg += '\nDirecte aanbevelingen:\n';
      for (var i = 0; i < parsed.recommendations.length; i++) {
        var rec = parsed.recommendations[i];
        msg += '• [' + rec.priority + '] ' + rec.proposed_action_nl + '\n';
      }
    }

    await sendTelegram(msg);

    return res.status(200).json({
      ok: true,
      healthScore: parsed.system_health_score,
      summary: parsed.summary_nl,
      recommendations: parsed.recommendations ? parsed.recommendations.length : 0,
      tokensUsed: result.tokensUsed
    });

  } catch (err) {
    console.error('[AI-Incident] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
