/**
 * Ad Daily Close Cron — 21:00 Amsterdam
 *
 * Day-end summary: full action recap, fatigue recap, top/worst ads,
 * approval queue recap, archived state snapshot.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var fatigueTracker = require('../../lib/ad-fatigue-tracker');
var optLogger = require('../../lib/ad-optimization-logger');
var approvalQueue = require('../../lib/approval-queue');
var telegramReview = require('../../lib/telegram-content-review');
var memory = require('../../lib/content-memory');
var jobStore = require('../../lib/predis-job-store');
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var adAdvisor = require('../../lib/ad-advisor');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-daily-close');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:ad-daily-close';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = dates.todayKey();

    // Get action log
    var actionLog = await optLogger.getActionLog(dateStr);

    // Get fatigue data for all ads
    var snapshot = await insightsFetcher.fetchOptimizationSnapshot();
    var adIds = snapshot.adRows.map(function (a) { return a.ad_id; }).filter(Boolean);
    var fatigueData = await fatigueTracker.getFatiguedAds(adIds);
    var fatigueSummary = Object.keys(fatigueData).map(function (id) { return fatigueData[id]; });

    // Top and worst ads by ROAS
    var sortedByRoas = snapshot.adRows.slice().sort(function (a, b) { return b.roas - a.roas; });
    var topAds = sortedByRoas.filter(function (a) { return a.spend > 5; }).slice(0, 3);
    var worstAds = sortedByRoas.filter(function (a) { return a.spend > 5; }).reverse().slice(0, 3);

    // Queue summary
    var queueSummary = await approvalQueue.getQueueSummary(dateStr);

    // Content summary
    var contentSummary = { planExists: false };
    try {
      var plan = await memory.getDailyPlan(dateStr);
      if (plan) {
        contentSummary.planExists = true;
        contentSummary.anglesUsed = [];
        if (plan.posts) {
          ['post1', 'post2'].forEach(function (s) {
            if (plan.posts[s] && plan.posts[s].angle) contentSummary.anglesUsed.push(plan.posts[s].angle);
          });
        }
        var predisJobs = await jobStore.getDailySummary(dateStr);
        contentSummary.predisCompleted = predisJobs.completed;
        contentSummary.predisFailed = predisJobs.failed;
        var reviewsRaw = await store.get('content:reviews:' + dateStr);
        contentSummary.reviews = [];
        if (reviewsRaw) {
          try {
            var revs = typeof reviewsRaw === 'string' ? JSON.parse(reviewsRaw) : reviewsRaw;
            contentSummary.reviews = revs.map(function (r) { return { slot: r.slot, score: r.score || 0 }; });
          } catch (e) { /* ignore */ }
        }
        var pubLog = await memory.getPublishLog(10);
        contentSummary.publishCount = pubLog.filter(function (p) { return p.date === dateStr; }).length;
      }
    } catch (e) {
      console.warn('[AdDailyClose] Content summary error:', e.message);
    }

    // Send daily close Telegram
    await telegramReview.sendDailyCloseSummary(dateStr, actionLog, fatigueSummary, topAds, worstAds, queueSummary, contentSummary);

    // Archive state snapshot
    await optLogger.saveOptimizationState(dateStr + ':close', {
      actionLog: actionLog.length,
      fatiguedAds: fatigueSummary.length,
      topAds: topAds.map(function (a) { return { name: a.ad_name, roas: a.roas, spend: a.spend }; }),
      worstAds: worstAds.map(function (a) { return { name: a.ad_name, roas: a.roas, spend: a.spend }; }),
      queueSummary: queueSummary,
      closedAt: new Date().toISOString()
    });

    // AI Advisory (evening)
    var advisoryResult = { ok: false };
    try {
      advisoryResult = await adAdvisor.runAdvisory('evening');
    } catch (advErr) {
      console.error('[AdDailyClose] Advisory error:', advErr.message);
    }

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      actionLogEntries: actionLog.length,
      fatiguedAds: fatigueSummary.length,
      topAds: topAds.length,
      queueSummary: queueSummary,
      advisory: advisoryResult.ok,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[AdDailyClose] Error:', err.message);
    await store.del('cron:lock:ad-daily-close');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
