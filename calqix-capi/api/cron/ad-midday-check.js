/**
 * Ad Midday Check Cron — 15:00 Amsterdam
 *
 * Read-only check for notable changes. Reports spend pacing and any anomalies.
 * Does NOT execute writes unless explicitly approved pending actions are due.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var approvalQueue = require('../../lib/approval-queue');
var actionExecutor = require('../../lib/ad-action-executor');
var telegramReview = require('../../lib/telegram-content-review');
var rulesEngine = require('../../lib/ad-rules-engine');
var store = require('../../lib/store');
var { sendTelegram } = require('../../lib/telegram');
var adAdvisor = require('../../lib/ad-advisor');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-midday-check');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:ad-midday-check';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = new Date().toISOString().split('T')[0];

    // Fetch today-only performance
    var todayAds = await insightsFetcher.fetchTodayPerformance('ad');
    var todayAdsets = await insightsFetcher.fetchTodayPerformance('adset');

    var todaySpend = 0;
    var todayPurchases = 0;
    var todayRevenue = 0;
    (todayAdsets.rows || []).forEach(function (r) {
      todaySpend += r.spend;
      todayPurchases += r.purchases;
      todayRevenue += r.revenue;
    });

    var roas = todaySpend > 0 ? todayRevenue / todaySpend : 0;

    // Check for approved pending actions
    var approvedItems = await approvalQueue.getApprovedItems(dateStr);
    var executedApprovals = [];
    for (var i = 0; i < approvedItems.length; i++) {
      var item = approvedItems[i];
      if (item.type === 'pause_ad' || item.type === 'scale_adset') {
        var result = await actionExecutor.executeApproved(item.id);
        executedApprovals.push({ id: item.id, type: item.type, entity: item.entityName, ok: result.ok });
        if (result.ok) {
          await telegramReview.sendActionConfirmation(item, result);
        }
      }
    }

    // Send midday summary
    var lines = [
      '\u2600\ufe0f <b>CALQIX Midday Check — ' + dateStr + '</b>\n',
      '\ud83d\udcb0 <b>Today so far:</b>',
      '\u2022 Spend: \u20ac' + todaySpend.toFixed(2),
      '\u2022 Purchases: ' + todayPurchases,
      '\u2022 Revenue: \u20ac' + todayRevenue.toFixed(2),
      '\u2022 ROAS: ' + roas.toFixed(2) + 'x',
      '\u2022 Active ads: ' + (todayAds.rows || []).length
    ];

    if (executedApprovals.length > 0) {
      lines.push('\n\u2705 <b>Approved actions executed:</b>');
      executedApprovals.forEach(function (e) {
        lines.push('\u2022 ' + e.type + ': ' + e.entity + ' — ' + (e.ok ? 'Success' : 'Failed'));
      });
    }

    var queueSummary = await approvalQueue.getQueueSummary(dateStr);
    if (queueSummary.pending > 0) {
      lines.push('\n\u23f3 ' + queueSummary.pending + ' actions still pending approval');
    }

    lines.push('\n\u2699\ufe0f Mode: ' + rulesEngine.MODE());

    await sendTelegram(lines.join('\n'));

    // AI Advisory
    var advisoryResult = { ok: false };
    try {
      advisoryResult = await adAdvisor.runAdvisory('midday');
    } catch (advErr) {
      console.error('[AdMidday] Advisory error:', advErr.message);
    }

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      todaySpend: todaySpend,
      todayPurchases: todayPurchases,
      todayRoas: roas,
      executedApprovals: executedApprovals.length,
      pendingApprovals: queueSummary.pending,
      advisory: advisoryResult.ok,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[AdMidday] Error:', err.message);
    await store.del('cron:lock:ad-midday-check');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
