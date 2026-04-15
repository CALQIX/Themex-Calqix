/**
 * AI Strategic Optimizer — daily deep analysis at 06:00.
 *
 * Schedule: daily 06:00 Amsterdam (calqix-ai-strategic)
 * Endpoint: /api/cron/ai-strategic
 *
 * ~30K input tokens. Integrated into Morning Report at 07:00.
 * Output: "Wat het model deze nacht heeft gezien" with top 3 insights.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var aiOptimizer = require('../../lib/ai-system-optimizer');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:ai-strategic';
var LOCK_TTL = 10 * 60;

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

    var context = await buildStrategicContext();
    var result = await aiOptimizer.run('strategic', context);

    if (!result.ok) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, error: result.error, tokensUsed: result.tokensUsed });
    }

    var parsed = result.result;
    var processed = { autoApplied: [], queued: [], skipped: [] };

    if (parsed.recommendations && parsed.recommendations.length > 0) {
      processed = await aiOptimizer.processRecommendations(parsed.recommendations, 'strategic');
    }

    // Update policy memory
    await aiOptimizer.updatePolicyMemory('Strategic analyse: ' + (parsed.summary_nl || ''));

    // Store for Morning Report integration
    await store.set('ai:strategic:latest', JSON.stringify({
      timestamp: dates.formatDateTimeAmsterdam(),
      healthScore: parsed.system_health_score,
      summary: parsed.summary_nl,
      recommendations: parsed.recommendations ? parsed.recommendations.length : 0,
      autoApplied: processed.autoApplied.length,
      queued: processed.queued.length,
      nextFocus: parsed.next_focus_area,
      topInsights: parsed.recommendations ? parsed.recommendations.slice(0, 3).map(function (r) {
        return r.hypothesis_nl;
      }) : []
    }), 2 * 86400);

    // Telegram summary
    var msg = '\uD83E\uDD16 AI Strategische Analyse — ' + dates.formatDateTimeAmsterdam() + '\n\n' +
      'Systeem health: ' + parsed.system_health_score + '/100\n' +
      parsed.summary_nl + '\n';

    if (parsed.recommendations && parsed.recommendations.length > 0) {
      msg += '\nTop inzichten:\n';
      for (var i = 0; i < Math.min(3, parsed.recommendations.length); i++) {
        var rec = parsed.recommendations[i];
        msg += (i + 1) + '. [' + rec.priority + '] ' + rec.hypothesis_nl + '\n';
      }
    }

    if (processed.autoApplied.length > 0) {
      msg += '\n\u2705 ' + processed.autoApplied.length + ' threshold tunes auto-applied';
    }
    if (processed.queued.length > 0) {
      msg += '\n\u23F3 ' + processed.queued.length + ' aanbevelingen in approval queue';
    }

    msg += '\n\nTokens: ' + result.tokensUsed;
    await sendTelegram(msg);

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
    console.error('[AI-Strategic] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function buildStrategicContext() {
  var redis = store._getRedis();
  var context = {
    timestamp: dates.formatDateTimeAmsterdam(),
    mode: 'strategic',
    window: '24h'
  };

  if (!redis) return context;

  // 24h EMQ trend
  try {
    var emqHistory = [];
    for (var h = 0; h < 24; h++) {
      var checkDate = new Date(Date.now() - h * 3600000);
      var hourKey = 'emq_hourly:' + checkDate.toISOString().slice(0, 13).replace('T', '-');
      var raw = await redis.get(hourKey);
      if (raw) {
        try { emqHistory.push(JSON.parse(raw)); } catch (e) { /* skip */ }
      }
    }
    context.emqHistory = emqHistory;
  } catch (e) { /* skip */ }

  // Reconciliation results (last 7 days)
  try {
    var reconHistory = [];
    for (var d = 0; d < 7; d++) {
      var pastDate = new Date(Date.now() - d * 86400000);
      var dateKey = dates.todayKey(pastDate);
      var reconRaw = await redis.get('reconciliation:' + dateKey);
      if (reconRaw) {
        try { reconHistory.push(JSON.parse(reconRaw)); } catch (e) { /* skip */ }
      }
    }
    context.reconciliationHistory = reconHistory;
  } catch (e) { /* skip */ }

  // Today's alerts
  try {
    var alertDedup = require('../../lib/alert-dedup');
    context.todayAlerts = await alertDedup.getTodayAlerts();
  } catch (e) { /* skip */ }

  // Identity backfill stats
  try {
    var backfillKey = 'backfill:run:' + dates.formatDateTimeAmsterdam().replace(/[\s:]/g, '-').slice(0, 13);
    var backfillRaw = await redis.get(backfillKey);
    if (backfillRaw) context.lastBackfill = JSON.parse(backfillRaw);
  } catch (e) { /* skip */ }

  // Dedup audit
  try {
    var dedupKey = 'dedup:audit:' + new Date().toISOString().slice(0, 13);
    var dedupRaw = await redis.get(dedupKey);
    if (dedupRaw) context.dedupAudit = JSON.parse(dedupRaw);
  } catch (e) { /* skip */ }

  return context;
}
