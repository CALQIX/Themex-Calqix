/**
 * Ad Morning Chain — 09:00 Amsterdam
 *
 * Consolidates 3 sequential cron jobs into 1 QStash schedule:
 *   1. Ad Performance Sync — fetch + cache Meta ad data, update fatigue
 *   2. Ad Optimization Engine — evaluate rules, execute/queue proposals
 *   3. Ad Optimization Report — send Telegram summary
 *
 * Individual endpoints remain available for manual/debug use.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var fatigueTracker = require('../../lib/ad-fatigue-tracker');
var rulesEngine = require('../../lib/ad-rules-engine');
var actionExecutor = require('../../lib/ad-action-executor');
var optLogger = require('../../lib/ad-optimization-logger');
var approvalQueue = require('../../lib/approval-queue');
var telegramReview = require('../../lib/telegram-content-review');
var store = require('../../lib/store');
var adAdvisor = require('../../lib/ad-advisor');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-morning');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var lockKey = 'cron:lock:ad-morning';
  try {
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 600);

    var dateStr = new Date().toISOString().split('T')[0];
    var mode = rulesEngine.MODE();
    var output = { ok: true, date: dateStr, mode: mode, steps: {}, auth_source: auth.source };

    // Pre-load Redis budget limits
    await rulesEngine.initLimits();

    // --- Step 1: Ad Performance Sync ---
    console.log('[AdMorning] Step 1/3: Performance sync...');
    var snapshot;
    try {
      snapshot = await insightsFetcher.fetchOptimizationSnapshot();

      var fatigueResults = {};
      if (snapshot.adRows.length > 0) {
        fatigueResults = await fatigueTracker.bulkUpdate(snapshot.adRows);
      }

      var fatiguedCount = Object.keys(fatigueResults).filter(function (k) {
        return fatigueResults[k] && fatigueResults[k].fatigued;
      }).length;

      await store.set('ad_perf_sync:' + dateStr, JSON.stringify({
        fetchedAt: snapshot.fetchedAt,
        adCount: snapshot.adRows.length,
        adsetCount: snapshot.adsetRows.length,
        campaignCount: snapshot.campaignRows.length,
        errors: snapshot.errors,
        fatiguedAds: fatiguedCount
      }), 86400);

      output.steps.sync = {
        ok: true,
        ads: snapshot.adRows.length,
        adsets: snapshot.adsetRows.length,
        campaigns: snapshot.campaignRows.length,
        fatiguedAds: fatiguedCount
      };
      console.log('[AdMorning] Sync done —', snapshot.adRows.length, 'ads,', fatiguedCount, 'fatigued');
    } catch (err) {
      console.error('[AdMorning] Sync error:', err.message);
      output.steps.sync = { ok: false, error: err.message };
    }

    // --- Step 2: Ad Optimization Engine ---
    console.log('[AdMorning] Step 2/3: Optimization engine (mode:', mode + ')...');
    var execResults;
    try {
      if (!snapshot) {
        snapshot = await insightsFetcher.fetchOptimizationSnapshot();
      }

      var adIds = snapshot.adRows.map(function (a) { return a.ad_id; }).filter(Boolean);
      var fatigueData = await fatigueTracker.getFatiguedAds(adIds);

      var adsetIds = snapshot.adsetRows.map(function (a) { return a.adset_id; }).filter(Boolean);
      var budgetHistory = await optLogger.getAllBudgetHistories(adsetIds);

      var evaluation = rulesEngine.evaluate(snapshot, fatigueData, budgetHistory);
      console.log('[AdMorning] Evaluated', evaluation.evaluated, 'entities,', evaluation.proposals.length, 'proposals');

      execResults = await actionExecutor.executeAll(evaluation.proposals);

      await optLogger.saveOptimizationState(dateStr, {
        mode: mode,
        evaluated: evaluation.evaluated,
        proposals: evaluation.proposals.length,
        rulePlan: evaluation.rulePlan || [],
        rulePlanItems: evaluation.rulePlan ? evaluation.rulePlan.length : 0,
        executed: execResults.executed.length,
        queued: execResults.queued.length,
        skipped: execResults.skipped.length,
        errors: evaluation.errors,
        timestamp: new Date().toISOString()
      });

      output.steps.engine = {
        ok: true,
        evaluated: evaluation.evaluated,
        proposals: evaluation.proposals.length,
        rulePlanItems: evaluation.rulePlan ? evaluation.rulePlan.length : 0,
        executed: execResults.executed.length,
        queued: execResults.queued.length,
        skipped: execResults.skipped.length
      };
      console.log('[AdMorning] Engine done — exec:', execResults.executed.length, 'queued:', execResults.queued.length);
    } catch (err) {
      console.error('[AdMorning] Engine error:', err.message);
      output.steps.engine = { ok: false, error: err.message };
    }

    // --- Step 3: Ad Optimization Report ---
    console.log('[AdMorning] Step 3/3: Telegram report...');
    try {
      var actionLog = await optLogger.getActionLog(dateStr);
      var executed = actionLog.filter(function (a) { return a.type === 'execution' && a.success; });
      var queued = actionLog.filter(function (a) { return a.type === 'queued'; });
      var skipped = actionLog.filter(function (a) { return a.type === 'evaluation'; });

      if (!snapshot) {
        snapshot = await insightsFetcher.fetchOptimizationSnapshot();
      }

      var sortedAds = (snapshot.adRows || []).slice().sort(function (a, b) { return b.roas - a.roas; });

      var results = {
        executed: executed.map(function (e) { return { proposal: e }; }),
        queued: queued.map(function (q) { return { proposal: q, result: { queueId: q.queueItemId } }; }),
        skipped: skipped.map(function (s) { return { proposal: s }; })
      };

      var reportSnapshot = {
        adRows: sortedAds.slice(0, 5),
        todayAdsetRows: snapshot.todayAdsetRows || []
      };

      var telegramResult = await telegramReview.sendAdOptimizationReport(results, reportSnapshot, mode);

      output.steps.report = {
        ok: true,
        telegramSent: telegramResult ? telegramResult.sent : false,
        executed: executed.length,
        queued: queued.length,
        flagged: skipped.length
      };
      console.log('[AdMorning] Report sent');
    } catch (err) {
      console.error('[AdMorning] Report error:', err.message);
      output.steps.report = { ok: false, error: err.message };
    }

    // --- Step 4: AI Advisory ---
    console.log('[AdMorning] Step 4/4: AI Advisory...');
    try {
      var advisoryResult = await adAdvisor.runAdvisory('morning');
      output.steps.advisory = { ok: advisoryResult.ok, sent: advisoryResult.sent, noAds: advisoryResult.noAds };
      console.log('[AdMorning] Advisory done');
    } catch (err) {
      console.error('[AdMorning] Advisory error:', err.message);
      output.steps.advisory = { ok: false, error: err.message };
    }

    await store.del(lockKey);
    return res.status(200).json(output);
  } catch (err) {
    console.error('[AdMorning] Fatal error:', err.message);
    await store.del(lockKey);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
