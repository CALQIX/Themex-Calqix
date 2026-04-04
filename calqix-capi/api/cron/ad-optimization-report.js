/**
 * Ad Optimization Report Cron — 09:20 Amsterdam
 *
 * Sends Telegram summary of ad optimization results including
 * executed, proposed, flagged, and blocked actions.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var optLogger = require('../../lib/ad-optimization-logger');
var approvalQueue = require('../../lib/approval-queue');
var telegramReview = require('../../lib/telegram-content-review');
var rulesEngine = require('../../lib/ad-rules-engine');
var store = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-optimization-report');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:ad-optimization-report';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = new Date().toISOString().split('T')[0];
    var mode = rulesEngine.MODE();

    // Get today's action log
    var actionLog = await optLogger.getActionLog(dateStr);

    // Reconstruct results from log
    var executed = actionLog.filter(function (a) { return a.type === 'execution' && a.success; });
    var queued = actionLog.filter(function (a) { return a.type === 'queued'; });
    var skipped = actionLog.filter(function (a) { return a.type === 'evaluation'; });

    // Get snapshot for top ads
    var snapshot = await insightsFetcher.fetchOptimizationSnapshot();

    // Sort ads by ROAS for top performers
    var sortedAds = (snapshot.adRows || []).slice().sort(function (a, b) { return b.roas - a.roas; });

    // Build results structure for Telegram
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

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      mode: mode,
      executed: executed.length,
      queued: queued.length,
      flagged: skipped.length,
      telegramSent: telegramResult ? telegramResult.sent : false,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[AdOptReport] Error:', err.message);
    await store.del('cron:lock:ad-optimization-report');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
