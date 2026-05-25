/**
 * Ad Midday Check Cron — 15:00 Amsterdam
 *
 * Read-only check for notable changes. Reports spend pacing and any anomalies.
 * Does NOT execute writes unless explicitly approved pending actions are due.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsSource = require('../../lib/meta-insights-source');
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

    var now = new Date();
    var dateStr = now.toISOString().split('T')[0];

    // Use the same fetchFullSnapshot as the monitor for consistent data
    var snap = await insightsSource.fetchFullSnapshot(now);
    var apiErrors = snap.errors || [];
    var tf = snap.today || { spend: 0, purchases: 0, revenue: 0, impressions: 0, clicks: 0, roas: 0 };
    var d3 = snap.threeDays || { spend: 0, purchases: 0, revenue: 0, impressions: 0, clicks: 0, roas: 0 };
    var activeAdsets = snap.activeAdsets || [];
    var activeAds = snap.ads || [];

    var todaySpend = tf.spend || 0;
    var todayPurchases = tf.purchases || 0;
    var todayRevenue = tf.revenue || 0;
    var roas = tf.roas || 0;

    // Check for approved pending actions
    var approvedItems = await approvalQueue.getApprovedItems(dateStr);
    var executedApprovals = [];
    for (var i = 0; i < approvedItems.length; i++) {
      var item = approvedItems[i];
      if (item.type === 'pause_ad' || item.type === 'scale_adset' || item.type === 'adjust_adset_budget') {
        var result = await actionExecutor.executeApproved(item.id);
        executedApprovals.push({ id: item.id, type: item.type, entity: item.entityName, ok: result.ok });
        if (result.ok) {
          await telegramReview.sendActionConfirmation(item, result);
        }
      }
    }

    // Send midday summary
    var lines = [
      '\u2600\ufe0f <b>CALQIX Midday Check \u2014 ' + dateStr + '</b>\n',
      '\ud83d\udcb0 <b>Today so far:</b>',
      '\u2022 Spend: \u20ac' + todaySpend.toFixed(2),
      '\u2022 Purchases: ' + todayPurchases,
      '\u2022 Revenue: \u20ac' + todayRevenue.toFixed(2),
      '\u2022 ROAS: ' + roas.toFixed(2) + 'x',
      '\u2022 Active ads: ' + activeAds.length,
      '\u2022 Active ad sets: ' + activeAdsets.length
    ];

    // Warning if today data is empty but campaigns should be active
    if (todaySpend === 0 && activeAdsets.length > 0) {
      lines.push('\n\u26a0\ufe0f <i>Meta API returned \u20ac0 spend with ' + activeAdsets.length + ' active ad sets. Data may be delayed (Meta reporting lag can be 1-3h).</i>');
    }

    // Show 3-day rolling context when today is empty or for trend context
    if (todaySpend === 0 || todayPurchases === 0) {
      var d3Roas = d3.roas || 0;
      lines.push('\n\ud83d\udcc8 <b>Rolling 3-day context:</b>');
      lines.push('\u2022 Spend: \u20ac' + (d3.spend || 0).toFixed(2));
      lines.push('\u2022 Purchases: ' + (d3.purchases || 0));
      lines.push('\u2022 Revenue: \u20ac' + (d3.revenue || 0).toFixed(2));
      lines.push('\u2022 ROAS: ' + d3Roas.toFixed(2) + 'x');
    }

    // API error indicators
    if (apiErrors.length > 0) {
      lines.push('\n\ud83d\udee0 <b>API issues (' + apiErrors.length + '):</b>');
      apiErrors.slice(0, 3).forEach(function (e) {
        lines.push('\u2022 ' + e.substring(0, 80));
      });
    }

    if (executedApprovals.length > 0) {
      lines.push('\n\u2705 <b>Approved actions executed:</b>');
      executedApprovals.forEach(function (e) {
        lines.push('\u2022 ' + e.type + ': ' + e.entity + ' \u2014 ' + (e.ok ? 'Success' : 'Failed'));
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
      activeAds: activeAds.length,
      activeAdsets: activeAdsets.length,
      apiErrors: apiErrors.length,
      todayDataEmpty: todaySpend === 0,
      threeDaySpend: d3.spend || 0,
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
