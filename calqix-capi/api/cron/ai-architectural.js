/**
 * AI Architectural Review — weekly deep analysis on Sunday 06:00.
 *
 * Schedule: weekly Sunday 06:00 Amsterdam (calqix-ai-architectural)
 * Endpoint: /api/cron/ai-architectural
 *
 * ~60K input tokens. Strategic review with possible refactor suggestions.
 * Output: detailed report in Telegram + persisted to reports/.
 * No auto-apply, everything via approval queue.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var aiOptimizer = require('../../lib/ai-system-optimizer');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:ai-architectural';
var LOCK_TTL = 15 * 60;

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

    var context = await buildArchitecturalContext();
    var result = await aiOptimizer.run('architectural', context);

    if (!result.ok) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, error: result.error, tokensUsed: result.tokensUsed });
    }

    var parsed = result.result;

    // ALL recommendations go to approval queue (no auto-apply for architectural)
    var processed = { autoApplied: [], queued: [], skipped: [] };
    if (parsed.recommendations && parsed.recommendations.length > 0) {
      // Force all to approval queue by setting auto_apply_safe = false
      for (var i = 0; i < parsed.recommendations.length; i++) {
        parsed.recommendations[i].auto_apply_safe = false;
      }
      processed = await aiOptimizer.processRecommendations(parsed.recommendations, 'architectural');
    }

    // Update policy memory with weekly summary
    await aiOptimizer.updatePolicyMemory('Wekelijkse architectuur review: ' + (parsed.summary_nl || ''));

    // List all auto-applied changes from past week for sanity check
    var autoAppliedThisWeek = [];
    for (var d = 0; d < 7; d++) {
      var pastDate = new Date(Date.now() - d * 86400000);
      var dateKey = dates.todayKey(pastDate);
      var raw = await store.get('ai:auto_applied:' + dateKey);
      if (raw) {
        try {
          var dayApplied = JSON.parse(raw);
          autoAppliedThisWeek = autoAppliedThisWeek.concat(dayApplied);
        } catch (e) { /* skip */ }
      }
    }

    // Store report
    var reportData = {
      timestamp: dates.formatDateTimeAmsterdam(),
      healthScore: parsed.system_health_score,
      summary: parsed.summary_nl,
      recommendations: parsed.recommendations || [],
      autoAppliedThisWeek: autoAppliedThisWeek,
      nextFocus: parsed.next_focus_area,
      tokensUsed: result.tokensUsed
    };

    await store.set('ai:architectural:latest', JSON.stringify(reportData), 14 * 86400);

    // Telegram report
    var msg = '\uD83C\uDFD7\uFE0F AI Architectuur Review — ' + dates.formatDateTimeAmsterdam() + '\n\n' +
      'Systeem health: ' + parsed.system_health_score + '/100\n' +
      parsed.summary_nl + '\n';

    if (parsed.recommendations && parsed.recommendations.length > 0) {
      msg += '\nAanbevelingen (' + parsed.recommendations.length + '):\n';
      for (var r = 0; r < parsed.recommendations.length; r++) {
        var rec = parsed.recommendations[r];
        msg += '\n' + (r + 1) + '. [' + rec.priority + '/' + rec.category + '] ' + rec.hypothesis_nl;
        msg += '\n   \u27A1\uFE0F ' + rec.proposed_action_nl;
      }
    }

    if (autoAppliedThisWeek.length > 0) {
      msg += '\n\n\uD83D\uDD04 Auto-applied deze week: ' + autoAppliedThisWeek.length + ' wijzigingen';
      for (var a = 0; a < Math.min(5, autoAppliedThisWeek.length); a++) {
        msg += '\n  - ' + autoAppliedThisWeek[a].rec_id + ': ' + JSON.stringify(autoAppliedThisWeek[a].config_change);
      }
    }

    msg += '\n\nTokens: ' + result.tokensUsed;

    // Split long messages (Telegram max 4096 chars)
    if (msg.length > 4000) {
      await sendTelegram(msg.substring(0, 4000) + '\n\n(afgekapt, volledig rapport in Redis)');
    } else {
      await sendTelegram(msg);
    }

    await store.del(LOCK_KEY);

    return res.status(200).json({
      ok: true,
      healthScore: parsed.system_health_score,
      recommendations: parsed.recommendations ? parsed.recommendations.length : 0,
      queued: processed.queued.length,
      autoAppliedThisWeek: autoAppliedThisWeek.length,
      tokensUsed: result.tokensUsed
    });

  } catch (err) {
    console.error('[AI-Architectural] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function buildArchitecturalContext() {
  var redis = store._getRedis();
  var context = {
    timestamp: dates.formatDateTimeAmsterdam(),
    mode: 'architectural',
    window: '7d'
  };

  if (!redis) return context;

  // 7-day EMQ trend (daily)
  try {
    var emqDailyTrend = [];
    for (var d = 0; d < 7; d++) {
      var pastDate = new Date(Date.now() - d * 86400000);
      // Sample from noon each day
      var noonDate = new Date(pastDate);
      noonDate.setHours(12, 0, 0, 0);
      var hourKey = 'emq_hourly:' + noonDate.toISOString().slice(0, 13).replace('T', '-');
      var raw = await redis.get(hourKey);
      if (raw) {
        try { emqDailyTrend.push(JSON.parse(raw)); } catch (e) { /* skip */ }
      }
    }
    context.emqDailyTrend = emqDailyTrend;
  } catch (e) { /* skip */ }

  // All recommendations from past week
  try {
    var weekRecs = [];
    for (var h = 0; h < 168; h++) { // 7 * 24 hours
      var checkDate = new Date(Date.now() - h * 3600000);
      var hourKey2 = checkDate.toISOString().slice(0, 13).replace('T', '-');

      var appliedRaw = await redis.get('ai:recommendations:applied:' + hourKey2);
      if (appliedRaw) {
        try { weekRecs.push({ hour: hourKey2, type: 'applied', data: JSON.parse(appliedRaw) }); } catch (e) { /* skip */ }
      }

      var rejectedRaw = await redis.get('ai:recommendations:rejected:' + hourKey2);
      if (rejectedRaw) {
        try { weekRecs.push({ hour: hourKey2, type: 'rejected', data: JSON.parse(rejectedRaw) }); } catch (e) { /* skip */ }
      }

      // Stop if we have enough context
      if (weekRecs.length > 50) break;
    }
    context.weekRecommendations = weekRecs;
  } catch (e) { /* skip */ }

  // Reconciliation history
  try {
    var reconHistory = [];
    for (var rd = 0; rd < 7; rd++) {
      var reconDate = new Date(Date.now() - rd * 86400000);
      var dateKey = dates.todayKey(reconDate);
      var reconRaw = await redis.get('reconciliation:' + dateKey);
      if (reconRaw) {
        try { reconHistory.push(JSON.parse(reconRaw)); } catch (e) { /* skip */ }
      }
    }
    context.reconciliationHistory = reconHistory;
  } catch (e) { /* skip */ }

  // Identity cleanup stats
  try {
    var cleanupRaw = await redis.get('identity:cleanup:' + dates.todayKey());
    if (cleanupRaw) context.identityCleanup = JSON.parse(cleanupRaw);
  } catch (e) { /* skip */ }

  return context;
}
