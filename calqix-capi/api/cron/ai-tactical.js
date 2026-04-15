/**
 * AI Tactical Optimizer — quick health scan every 30 min.
 *
 * Schedule: every 30 min, 06:00-23:30 Amsterdam (calqix-ai-tactical)
 * Endpoint: /api/cron/ai-tactical
 *
 * ~5K input tokens. Telegram only if health < 70 or new P0/P1 recommendations.
 * Auto-applies safe threshold tunes.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var aiOptimizer = require('../../lib/ai-system-optimizer');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:ai-tactical';
var LOCK_TTL = 5 * 60;

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!aiOptimizer.ENABLED()) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'AI optimizer uitgeschakeld' });
    }

    var locked = await store.set(LOCK_KEY, '1', LOCK_TTL, true);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }

    // Build tactical context (~5K tokens)
    var context = await buildTacticalContext();

    var result = await aiOptimizer.run('tactical', context);

    if (!result.ok) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, error: result.error, tokensUsed: result.tokensUsed });
    }

    var parsed = result.result;
    var processed = { autoApplied: [], queued: [], skipped: [] };

    if (parsed.recommendations && parsed.recommendations.length > 0) {
      processed = await aiOptimizer.processRecommendations(parsed.recommendations, 'tactical');
    }

    // Update policy memory
    if (parsed.next_focus_area) {
      await aiOptimizer.updatePolicyMemory('Tactical scan: ' + parsed.next_focus_area);
    }

    // Telegram only if health < 70 or new P0/P1
    var hasHighPriority = false;
    if (parsed.recommendations) {
      for (var i = 0; i < parsed.recommendations.length; i++) {
        if (parsed.recommendations[i].priority === 'P0' || parsed.recommendations[i].priority === 'P1') {
          hasHighPriority = true;
          break;
        }
      }
    }

    if (parsed.system_health_score < 70 || hasHighPriority) {
      var msg = '\uD83E\uDD16 AI Tactical Scan — ' + dates.formatDateTimeAmsterdam() + '\n\n' +
        'Health: ' + parsed.system_health_score + '/100\n' +
        parsed.summary_nl + '\n\n';

      if (processed.autoApplied.length > 0) {
        msg += 'Auto-applied: ' + processed.autoApplied.length + ' threshold tunes\n';
      }
      if (processed.queued.length > 0) {
        msg += 'In approval queue: ' + processed.queued.length + ' aanbevelingen\n';
      }

      await sendTelegram(msg);
    }

    await store.del(LOCK_KEY);

    return res.status(200).json({
      ok: true,
      healthScore: parsed.system_health_score,
      recommendations: parsed.recommendations ? parsed.recommendations.length : 0,
      autoApplied: processed.autoApplied.length,
      queued: processed.queued.length,
      tokensUsed: result.tokensUsed
    });

  } catch (err) {
    console.error('[AI-Tactical] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function buildTacticalContext() {
  var redis = store._getRedis();
  var context = {
    timestamp: dates.formatDateTimeAmsterdam(),
    mode: 'tactical',
    window: '30 min'
  };

  if (!redis) return context;

  // Recent alerts
  try {
    var alertDedup = require('../../lib/alert-dedup');
    context.todayAlerts = await alertDedup.getTodayAlerts();
    context.todayAlerts = context.todayAlerts.slice(-20);
  } catch (e) { /* skip */ }

  // Last EMQ deep result
  try {
    var hourKey = 'emq_hourly:' + dates.formatDateTimeAmsterdam().replace(/[\s:]/g, '-').slice(0, 13);
    var emqRaw = await redis.get(hourKey);
    if (emqRaw) context.lastEMQ = JSON.parse(emqRaw);
  } catch (e) { /* skip */ }

  // Bridge health
  try {
    var bridgeKey = 'bridge:health:' + new Date().toISOString().slice(0, 13);
    var bridgeRaw = await redis.get(bridgeKey);
    if (bridgeRaw) context.bridgeHealth = JSON.parse(bridgeRaw);
  } catch (e) { /* skip */ }

  // Last webhook audit
  try {
    var hourKey2 = new Date().toISOString().slice(0, 13) + '-' + (new Date().getMinutes() < 30 ? '00' : '30');
    var webhookRaw = await redis.get('webhook:audit:' + hourKey2);
    if (webhookRaw) context.webhookAudit = JSON.parse(webhookRaw);
  } catch (e) { /* skip */ }

  // Recovery queue length
  try {
    context.recoveryQueueLength = await redis.llen('recovery:queue') || 0;
  } catch (e) { /* skip */ }

  return context;
}
