/**
 * Content Publish Cron — 08:30 and 18:30 Amsterdam
 *
 * In DRAFT_ONLY mode: sends Telegram notification with approved content ready for manual posting.
 * In APPROVAL_REQUIRED/AUTO_PUBLISH mode: executes approved publishes.
 * If no approved content exists for a slot: does nothing (no error, no message).
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var memory = require('../../lib/content-memory');
var briefBuilder = require('../../lib/creative-brief-builder');
var publisher = require('../../lib/publisher');
var jobStore = require('../../lib/predis-job-store');
var approvalQueue = require('../../lib/approval-queue');
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

  var auth = await authenticate(req, rawBody, '/api/cron/content-publish');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var slot = 'post1';
    // Allow forcing a specific slot via query param
    if (req.query && req.query.slot) {
      slot = req.query.slot;
    } else {
      var amHour = dates.getAmsterdamHour();
      slot = amHour <= 12 ? 'post1' : 'post2';
    }

    var lockKey = 'cron:lock:content-publish:' + slot;
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active for ' + slot });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = dates.todayKey();
    var plan = await memory.getDailyPlan(dateStr);
    if (!plan || !plan.posts || !plan.posts[slot]) {
      await store.del(lockKey);
      return res.status(200).json({ ok: true, slot: slot, reason: 'No plan or slot data for ' + dateStr });
    }

    // Check for auto-approved content from review step
    var approvedRaw = await store.get('content:approved:' + dateStr + ':' + slot);
    var approvedData = null;
    if (approvedRaw) {
      try { approvedData = typeof approvedRaw === 'string' ? JSON.parse(approvedRaw) : approvedRaw; } catch (e) { /* ignore */ }
    }

    // Also check approval queue
    var approvedItems = [];
    try { approvedItems = await approvalQueue.getApprovedItems(dateStr); } catch (e) { /* ignore */ }
    var approvedPublish = approvedItems.find(function (item) {
      return item.type === 'content_publish' && item.entityId === dateStr + ':' + slot;
    });

    // Build brief
    var brief = await briefBuilder.buildBrief(plan.posts[slot], dateStr);

    // Get Predis job for this slot
    var dailyJobs = await jobStore.getDailyJobs(dateStr);
    var slotJob = dailyJobs.find(function (j) { return j.slot === slot; });
    var predisId = slotJob ? slotJob.jobId : null;

    var mode = publisher.MODE();
    var result;

    if (mode === 'DRAFT_ONLY') {
      // In DRAFT_ONLY: if we have approved content, notify Telegram for manual posting
      if (approvedData || approvedPublish) {
        var tgLines = [
          '<b>CALQIX Publish Ready</b> - ' + slot + '\n',
          '<b>Product:</b> ' + (brief.product || 'unknown'),
          '<b>Angle:</b> ' + (brief.angle || 'unknown'),
          '<b>Text:</b> "' + (brief.caption || brief.hook || brief.body || '').substring(0, 200) + '"',
          '<b>Predis post ID:</b> ' + (predisId || 'n/a'),
          '',
          'Ready for manual posting. Open Predis to publish.'
        ];
        await sendTelegram(tgLines.join('\n'));
        result = { published: false, queued: false, reason: 'DRAFT_ONLY - Telegram notification sent', notified: true };
      } else {
        // No approved content for this slot - do nothing silently
        result = { published: false, queued: false, reason: 'DRAFT_ONLY - no approved content for ' + slot, notified: false };
      }
    } else if (approvedPublish) {
      result = await publisher.publishApproved(approvedPublish.id);
      result.source = 'approval_queue';
    } else {
      var assets = slotJob && slotJob.assets ? slotJob.assets : null;
      result = await publisher.publish(brief, assets);
      result.source = 'auto';
    }

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      slot: slot,
      published: result.published || false,
      queued: result.queued || false,
      reason: result.reason,
      notified: result.notified || false,
      mode: mode,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentPublish] Error:', err.message);
    await store.del('cron:lock:content-publish:post1');
    await store.del('cron:lock:content-publish:post2');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
