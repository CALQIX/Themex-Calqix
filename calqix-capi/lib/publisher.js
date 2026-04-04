/**
 * Publisher & QA Agent — validates, deduplicates, and publishes content.
 *
 * Modes:
 *   DRAFT_ONLY          — generate only, no publishing
 *   APPROVAL_REQUIRED   — publish only after approval flag
 *   AUTO_PUBLISH        — only for high-confidence content when enabled
 *
 * Env vars:
 *   CONTENT_AUTOMATION_MODE                   — DRAFT_ONLY | APPROVAL_REQUIRED | AUTO_PUBLISH
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
 * Currently logs the publish action. Actual API integration will use
 * Meta Pages/Instagram Content Publish API.
 */
async function doPublish(brief, assets) {
  // TODO: Implement actual Meta Pages API / Instagram Content Publish API
  // For now, this is a structured placeholder that logs the action
  console.log('[Publisher] Publishing content', {
    slot: brief.slot,
    date: brief.date,
    platform: brief.platform,
    angle: brief.angle,
    pillar: brief.pillar,
    hasAssets: Boolean(assets && assets.length > 0)
  });

  // Placeholder — in production this would call Meta's API
  return { ok: true, platform: brief.platform, publishedAt: new Date().toISOString() };
}

module.exports = {
  publish: publish,
  publishApproved: publishApproved,
  MODE: MODE,
  CONFIDENCE_THRESHOLD: CONFIDENCE_THRESHOLD
};
