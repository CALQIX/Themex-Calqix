/**
 * Ad Optimization Engine Cron — 09:15 Amsterdam
 *
 * Evaluates rules against performance data, generates proposals,
 * executes allowed actions, queues approval-required actions.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var rulesEngine = require('../../lib/ad-rules-engine');
var actionExecutor = require('../../lib/ad-action-executor');
var fatigueTracker = require('../../lib/ad-fatigue-tracker');
var optLogger = require('../../lib/ad-optimization-logger');
var store = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-optimization-engine');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:ad-optimization-engine';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 600);

    var mode = rulesEngine.MODE();
    console.log('[AdOptEngine] Running in mode:', mode);

    // Fetch snapshot
    var snapshot = await insightsFetcher.fetchOptimizationSnapshot();

    // Get fatigue data
    var adIds = snapshot.adRows.map(function (a) { return a.ad_id; }).filter(Boolean);
    var fatigueData = await fatigueTracker.getFatiguedAds(adIds);

    // Get budget history for scale rules
    var adsetIds = snapshot.adsetRows.map(function (a) { return a.adset_id; }).filter(Boolean);
    var budgetHistory = await optLogger.getAllBudgetHistories(adsetIds);

    // Evaluate rules
    var evaluation = rulesEngine.evaluate(snapshot, fatigueData, budgetHistory);
    console.log('[AdOptEngine] Evaluated', evaluation.evaluated, 'entities,', evaluation.proposals.length, 'proposals');

    // Execute proposals
    var execResults = await actionExecutor.executeAll(evaluation.proposals);

    // Save optimization state
    var dateStr = new Date().toISOString().split('T')[0];
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

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      mode: mode,
      evaluated: evaluation.evaluated,
      proposals: evaluation.proposals.length,
      rulePlanItems: evaluation.rulePlan ? evaluation.rulePlan.length : 0,
      executed: execResults.executed.length,
      queued: execResults.queued.length,
      skipped: execResults.skipped.length,
      apiErrors: snapshot.errors.length,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[AdOptEngine] Error:', err.message);
    await store.del('cron:lock:ad-optimization-engine');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
