/**
 * Approval Status Endpoint — view queue status and individual items.
 *
 * Usage: GET /api/approval/status?secret={CRON_SECRET}
 *        GET /api/approval/status?id={itemId}&secret={CRON_SECRET}
 *        GET /api/approval/status?date={YYYY-MM-DD}&secret={CRON_SECRET}
 */
var { verifyCronSecret } = require('../../lib/qstash-verify');
var approvalQueue = require('../../lib/approval-queue');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var id = req.query && req.query.id;
    var date = req.query && req.query.date;

    // Single item lookup
    if (id) {
      var item = await approvalQueue.getItem(id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      return res.status(200).json({ ok: true, item: item });
    }

    // Queue summary for date
    var dateStr = date || new Date().toISOString().split('T')[0];
    var summary = await approvalQueue.getQueueSummary(dateStr);
    var pendingItems = await approvalQueue.getPendingItems(dateStr);
    var approvedItems = await approvalQueue.getApprovedItems(dateStr);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      summary: summary,
      pending: pendingItems.map(function (i) {
        return { id: i.id, type: i.type, entityName: i.entityName, reason: i.reason, createdAt: i.createdAt };
      }),
      approved: approvedItems.map(function (i) {
        return { id: i.id, type: i.type, entityName: i.entityName, approvedBy: i.approvedBy };
      })
    });
  } catch (err) {
    console.error('[ApprovalStatus] Error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
