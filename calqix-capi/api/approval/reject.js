/**
 * Rejection Endpoint — rejects a queued action item.
 *
 * Usage: GET /api/approval/reject?id={queueItemId}&secret={CRON_SECRET}&reason={reason}
 *        POST /api/approval/reject (body: { id, reason })
 */
var { verifyCronSecret } = require('../../lib/qstash-verify');
var approvalQueue = require('../../lib/approval-queue');
var memory = require('../../lib/content-memory');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var id = (req.query && req.query.id) || (req.body && req.body.id);
    var reason = (req.query && req.query.reason) || (req.body && req.body.reason) || '';

    if (!id) {
      return res.status(400).json({ error: 'Missing id parameter' });
    }

    var item = await approvalQueue.rejectItem(id, 'operator', reason);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Record rejection in content memory if content-related
    if (item.type === 'content_publish') {
      await memory.recordRejection(id, reason || 'Operator rejected');
    }

    return res.status(200).json({
      ok: true,
      id: id,
      state: item.state,
      type: item.type,
      entityName: item.entityName,
      reason: reason
    });
  } catch (err) {
    console.error('[Reject] Error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
