/**
 * Approval Endpoint — approves a queued action item.
 *
 * Usage: GET /api/approval/approve?id={queueItemId}&secret={CRON_SECRET}
 *        POST /api/approval/approve (body: { id, execute })
 *
 * Optionally executes the action immediately if execute=true.
 */
var { verifyCronSecret } = require('../../lib/qstash-verify');
var approvalQueue = require('../../lib/approval-queue');
var actionExecutor = require('../../lib/ad-action-executor');
var publisher = require('../../lib/publisher');
var telegramReview = require('../../lib/telegram-content-review');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var id = (req.query && req.query.id) || (req.body && req.body.id);
    var execute = (req.query && req.query.execute === 'true') || (req.body && req.body.execute);

    if (!id) {
      return res.status(400).json({ error: 'Missing id parameter' });
    }

    var item = await approvalQueue.approveItem(id, 'operator');
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.state !== approvalQueue.STATES.APPROVED) {
      return res.status(200).json({ ok: true, id: id, state: item.state, message: 'Item was not in PENDING state' });
    }

    var execResult = null;
    if (execute) {
      if (item.type === 'content_publish') {
        execResult = await publisher.publishApproved(id);
      } else if (item.type === 'pause_ad' || item.type === 'scale_adset' || item.type === 'adjust_adset_budget' || item.type === 'scale_campaign') {
        execResult = await actionExecutor.executeApproved(id);
        if (execResult.ok) {
          await telegramReview.sendActionConfirmation(item, execResult);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      id: id,
      state: 'approved',
      executed: execute ? Boolean(execResult && execResult.ok) : false,
      executionResult: execResult || null,
      type: item.type,
      entityName: item.entityName
    });
  } catch (err) {
    console.error('[Approve] Error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
