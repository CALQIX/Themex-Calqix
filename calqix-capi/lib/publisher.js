/**
 * Publisher & QA Agent — validates, deduplicates, and publishes content.
 *
 * Modes:
 *   DRAFT_ONLY          — generate only, no publishing
 *   APPROVAL_REQUIRED   — publish only after approval flag
 *   LIVE                — publish after passing brand/compliance checks, log everything
 *   AUTO_PUBLISH        — only for high-confidence content when enabled
 *
 * Env vars:
 *   CONTENT_AUTOMATION_MODE                   — DRAFT_ONLY | APPROVAL_REQUIRED | LIVE | AUTO_PUBLISH
 *   CONTENT_AUTO_PUBLISH_CONFIDENCE_THRESHOLD — min confidence for auto-publish (default: 75)
 *   ENABLE_CONTENT_PUBLISH                    — 'true' to allow actual publishing
 */
var memory = require('./content-memory');
var compliance = require('./compliance-checker');
var approvalQueue = require('./approval-queue');
var store = require('./store');

var MODE = function () { return process.env.CONTENT_AUTOMATION_MODE || 'DRAFT_ONLY'; };
var CONFIDENCE_THRESHOLD = function () { return parseInt(process.env.CONTENT_AUTO_PUBLISH_CONFIDENCE_THRESHOLD || '75', 10); };
var PUBLISH_ENABLED = function () { return process.env.ENABLE_CONTENT_PUBLISH === 'true'; };

/**
 * Attempt to publish a content brief.
 * Validates, checks mode, and either publishes, queues, or skips.
 *
 * @param {object} brief — from creative-brief-builder
 * @param {object} [assets] — from predis-job-store (generated assets)
 * @returns {Promise<{published: boolean, queued: boolean, reason: string, queueId: string|null}>}
 */
async function publish(brief, assets) {
  var mode = MODE();

  // 1. Compliance check
  var complianceResult = await compliance.check(brief);
  if (!complianceResult.approved) {
    console.log('[Publisher] Compliance rejected:', complianceResult.violations);
    return { published: false, queued: false, reason: 'Compliance rejected: ' + complianceResult.violations.join('; '), queueId: null };
  }

  // 2. Deduplication — check if already published today for this slot
  var dedupKey = 'publish_dedup:' + brief.date + ':' + brief.slot;
  var alreadyPublished = await store.get(dedupKey);
  if (alreadyPublished) {
    return { published: false, queued: false, reason: 'Already published for slot ' + brief.slot + ' on ' + brief.date, queueId: null };
  }

  // 3. Mode-based decision
  if (mode === 'DRAFT_ONLY') {
    return { published: false, queued: false, reason: 'DRAFT_ONLY mode — no publishing', queueId: null };
  }

  if (mode === 'APPROVAL_REQUIRED') {
    var queueItem = await approvalQueue.createItem({
      type: 'content_publish',
      entityName: brief.slot + ' — ' + brief.angle + '/' + brief.pillar,
      entityId: brief.date + ':' + brief.slot,
      reason: 'Content ready for publishing — requires approval',
      metrics: { confidence: brief.confidence, metaBacked: brief.metaBacked },
      expectedEffect: 'Publish ' + brief.slot + ' to ' + brief.platform,
      payload: { brief: brief, assets: assets }
    });
    return { published: false, queued: true, reason: 'Queued for approval', queueId: queueItem.id };
  }

  if (mode === 'LIVE') {
    // LIVE mode: publish after brand/compliance check (already done above)
    // Always requires ENABLE_CONTENT_PUBLISH to be true
    if (!PUBLISH_ENABLED()) {
      return { published: false, queued: false, reason: 'LIVE mode maar ENABLE_CONTENT_PUBLISH niet ingesteld', queueId: null };
    }

    var publishResult = await doPublish(brief, assets);
    if (publishResult.ok) {
      await store.set(dedupKey, '1', 86400);
      await recordPublishMemory(brief);
      // Log publish to Redis for tracking
      await logPublish(brief, publishResult, 'live');
      // Telegram notification
      try {
        var telegram = require('./telegram');
        await telegram.sendTelegram(
          '\uD83D\uDCE4 Content Live Gepubliceerd\n\n' +
          'Slot: ' + brief.slot + '\n' +
          'Hoek: ' + brief.angle + '/' + brief.pillar + '\n' +
          'Platform: ' + (brief.platform || 'instagram') + '\n' +
          'Confidence: ' + (brief.confidence || 'n/a') + '\n' +
          'Tijdstip: ' + new Date().toISOString().slice(0, 16).replace('T', ' ')
        );
      } catch (e) { /* non-critical */ }
    } else {
      await logPublish(brief, publishResult, 'live_failed');
    }
    return { published: publishResult.ok, queued: false, reason: publishResult.ok ? 'LIVE gepubliceerd' : publishResult.error, queueId: null };
  }

  if (mode === 'AUTO_PUBLISH') {
    if (brief.confidence < CONFIDENCE_THRESHOLD()) {
      // Low confidence → queue for approval instead
      var queueItem2 = await approvalQueue.createItem({
        type: 'content_publish',
        entityName: brief.slot + ' — ' + brief.angle + '/' + brief.pillar,
        entityId: brief.date + ':' + brief.slot,
        reason: 'Confidence ' + brief.confidence + ' below threshold ' + CONFIDENCE_THRESHOLD(),
        metrics: { confidence: brief.confidence },
        payload: { brief: brief, assets: assets }
      });
      return { published: false, queued: true, reason: 'Low confidence — queued for approval', queueId: queueItem2.id };
    }

    if (!PUBLISH_ENABLED()) {
      return { published: false, queued: false, reason: 'ENABLE_CONTENT_PUBLISH not set', queueId: null };
    }

    // Actually publish
    var publishResult = await doPublish(brief, assets);
    if (publishResult.ok) {
      await store.set(dedupKey, '1', 86400);
      await memory.recordPublish(brief.date + ':' + brief.slot, {
        angle: brief.angle, pillar: brief.pillar, product: brief.product, confidence: brief.confidence
      });
      await memory.recordPostedTopic(brief.angle + '/' + brief.pillar, {
        pillar: brief.pillar, angle: brief.angle, product: brief.product
      });
      await memory.recordPostedHook(brief.hook, { angle: brief.angle });
      await memory.recordPostedCTA(brief.cta, { pillar: brief.pillar });
      await memory.recordAngleUsage(brief.angle);
      await memory.recordProductUsage(brief.product);
    }
    return { published: publishResult.ok, queued: false, reason: publishResult.ok ? 'Published' : publishResult.error, queueId: null };
  }

  return { published: false, queued: false, reason: 'Unknown mode: ' + mode, queueId: null };
}

/**
 * Execute an approved content publish from the queue.
 */
async function publishApproved(queueItemId) {
  var item = await approvalQueue.markExecuting(queueItemId);
  if (!item || !item.payload) {
    return { ok: false, error: 'Item not found or missing payload' };
  }

  var brief = item.payload.brief;
  var assets = item.payload.assets;

  if (!PUBLISH_ENABLED()) {
    await approvalQueue.markFailed(queueItemId, 'ENABLE_CONTENT_PUBLISH not set');
    return { ok: false, error: 'ENABLE_CONTENT_PUBLISH not set' };
  }

  var result = await doPublish(brief, assets);
  if (result.ok) {
    await approvalQueue.markExecuted(queueItemId, result);
    var dedupKey = 'publish_dedup:' + brief.date + ':' + brief.slot;
    await store.set(dedupKey, '1', 86400);
    await memory.recordPublish(brief.date + ':' + brief.slot, {
      angle: brief.angle, pillar: brief.pillar, product: brief.product
    });
    await memory.recordPostedTopic(brief.angle + '/' + brief.pillar, { pillar: brief.pillar });
    await memory.recordPostedHook(brief.hook, { angle: brief.angle });
    await memory.recordAngleUsage(brief.angle);
    await memory.recordProductUsage(brief.product);
    await memory.recordApproval(queueItemId, 'Published via approval');
  } else {
    await approvalQueue.markFailed(queueItemId, result.error);
  }

  return result;
}

/**
 * Actual publishing logic — placeholder for Meta/Instagram API integration.
 *
 * NOT IMPLEMENTED. Previously returned `{ ok: true }` without calling any API,
 * which caused `publishApproved()` and LIVE mode to mark content as "executed"
 * even though nothing was posted. Now fails closed with an explicit error so
 * the approval queue records `failed` instead of a false success.
 *
 * To implement:
 *   - Instagram Content Publish API (graph.facebook.com/{ig_user_id}/media)
 *   - Meta Pages API (graph.facebook.com/{page_id}/feed)
 *   - Honor brief.platform to route to the correct surface
 *   - Return `{ ok: true, platform, publishedAt, remoteId }` on success
 */
async function doPublish(brief, assets) {
  console.warn('[Publisher] doPublish is NOT IMPLEMENTED — publishing blocked', {
    slot: brief.slot,
    date: brief.date,
    platform: brief.platform,
    angle: brief.angle,
    pillar: brief.pillar,
    hasAssets: Boolean(assets && assets.length > 0)
  });

  return {
    ok: false,
    error: 'doPublish not implemented: Meta Pages / Instagram Content Publish API integration pending. Manual publishing required until implemented.',
    platform: brief.platform
  };
}

/**
 * Record publish in content memory.
 */
async function recordPublishMemory(brief) {
  try {
    await memory.recordPublish(brief.date + ':' + brief.slot, {
      angle: brief.angle, pillar: brief.pillar, product: brief.product, confidence: brief.confidence
    });
    await memory.recordPostedTopic(brief.angle + '/' + brief.pillar, {
      pillar: brief.pillar, angle: brief.angle, product: brief.product
    });
    await memory.recordPostedHook(brief.hook, { angle: brief.angle });
    await memory.recordPostedCTA(brief.cta, { pillar: brief.pillar });
    await memory.recordAngleUsage(brief.angle);
    await memory.recordProductUsage(brief.product);
  } catch (e) {
    console.warn('[Publisher] Memory recording mislukt:', e.message);
  }
}

/**
 * Log a publish action to Redis for audit trail.
 */
async function logPublish(brief, result, mode) {
  try {
    var logKey = 'publish:log:' + (brief.date || new Date().toISOString().slice(0, 10));
    var existing = await store.get(logKey);
    var log = existing ? JSON.parse(existing) : [];
    log.push({
      slot: brief.slot,
      angle: brief.angle,
      pillar: brief.pillar,
      platform: brief.platform,
      mode: mode,
      ok: result.ok,
      error: result.error || null,
      timestamp: new Date().toISOString()
    });
    await store.set(logKey, JSON.stringify(log), 30 * 86400);
  } catch (e) { /* non-critical */ }
}

/**
 * Rollback a published post (mark as retracted in Redis).
 * Actual platform unpublish depends on platform API support.
 */
async function rollbackPublish(briefDateSlot, reason) {
  try {
    var logKey = 'publish:rollback:' + briefDateSlot;
    await store.set(logKey, JSON.stringify({
      reason: reason || 'operator_rollback',
      timestamp: new Date().toISOString()
    }), 30 * 86400);
    // Clear the dedup key so it could be re-published
    await store.del('publish_dedup:' + briefDateSlot.replace(':', ':'));
    console.log('[Publisher] Rollback uitgevoerd voor:', briefDateSlot);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  publish: publish,
  publishApproved: publishApproved,
  rollbackPublish: rollbackPublish,
  MODE: MODE,
  CONFIDENCE_THRESHOLD: CONFIDENCE_THRESHOLD
};
