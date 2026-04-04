/**
 * Content Reflect Cron — 21:30 Amsterdam
 *
 * End-of-day reflection:
 * 1. Record angle usage from today's plan
 * 2. Update angle wins/fatigue from Meta performance
 * 3. Decay all fatigue scores
 * 4. Send Telegram reflection summary
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var performanceLoop = require('../../lib/content-performance-loop');
var memory = require('../../lib/content-memory');
var jobStore = require('../../lib/predis-job-store');
var { sendTelegram } = require('../../lib/telegram');
var store = require('../../lib/store');
var dates = require('../../lib/dates');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/content-reflect');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:content-reflect';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = dates.todayKey();

    // 1. Record angle usage from today's plan
    var plan = await memory.getDailyPlan(dateStr);
    var anglesUsed = [];
    if (plan && plan.posts) {
      var slots = ['post1', 'post2'];
      for (var i = 0; i < slots.length; i++) {
        var post = plan.posts[slots[i]];
        if (post && post.angle) {
          await memory.recordAngleUsage(post.angle);
          anglesUsed.push(post.angle);
        }
        if (post && post.product) {
          await memory.recordProductUsage(post.product);
        }
      }
    }

    // 2. Reflect on Meta performance — update angle wins/fatigue
    await performanceLoop.reflectOnPerformance();

    // 3. Get daily summary data
    var predisJobs = await jobStore.getDailySummary(dateStr);
    var angleScores = await memory.getAngleScores();
    var publishLog = await memory.getPublishLog(5);

    // 4. Load reviews for today
    var reviewsRaw = await store.get('content:reviews:' + dateStr);
    var reviews = [];
    if (reviewsRaw) {
      try { reviews = typeof reviewsRaw === 'string' ? JSON.parse(reviewsRaw) : reviewsRaw; } catch (e) { /* ignore */ }
    }

    // Update plan status
    if (plan) {
      plan.status = 'reflected';
      plan.reflection = {
        timestamp: new Date().toISOString(),
        predisJobs: predisJobs,
        angleScoresSnapshot: Object.keys(angleScores).length,
        anglesUsed: anglesUsed
      };
      await memory.setDailyPlan(dateStr, plan);
    }

    // 5. Send Telegram reflection summary
    var tgLines = ['<b>CALQIX Content Reflect</b> - ' + dateStr + '\n'];
    tgLines.push('<b>Angles used today:</b> ' + (anglesUsed.length > 0 ? anglesUsed.join(', ') : 'none'));
    tgLines.push('<b>Predis jobs:</b> ' + predisJobs.completed + ' completed, ' + predisJobs.failed + ' failed, ' + predisJobs.draftOnly + ' draft-only');
    tgLines.push('<b>Publishes today:</b> ' + publishLog.filter(function (p) { return p.date === dateStr; }).length);

    if (reviews.length > 0) {
      tgLines.push('');
      tgLines.push('<b>Review scores:</b>');
      reviews.forEach(function (rv) {
        tgLines.push('  ' + rv.slot + ': ' + rv.score + '/25 (' + rv.decision + ')');
      });
    }

    // Top angle scores
    var topScored = Object.keys(angleScores).sort(function (a, b) {
      return (angleScores[b].wins || 0) - (angleScores[a].wins || 0);
    }).slice(0, 5);
    if (topScored.length > 0) {
      tgLines.push('');
      tgLines.push('<b>Top angles (wins):</b>');
      topScored.forEach(function (a) {
        var s = angleScores[a];
        tgLines.push('  ' + a + ': ' + s.wins + ' wins, fatigue ' + s.fatigue);
      });
    }

    await sendTelegram(tgLines.join('\n'));

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      reflected: true,
      anglesUsed: anglesUsed,
      predisJobs: predisJobs,
      angleScoresCount: Object.keys(angleScores).length,
      recentPublishes: publishLog.length,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentReflect] Error:', err.message);
    await store.del('cron:lock:content-reflect');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
