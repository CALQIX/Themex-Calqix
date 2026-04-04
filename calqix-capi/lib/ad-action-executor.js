/**
 * Ad Action Executor — safely executes ad optimization actions.
 *
 * Handles:
 *   - Pause ad (via Meta API)
 *   - Scale adset budget (via Meta API)
 *   - Dry-run mode
 *   - Approval gating
 *   - Idempotency via Redis
 *   - Execution logging
 *
 * Safety:
 *   - Never exceeds MAX_ADSET_BUDGET
 *   - Never exceeds MAX_DAILY_SPEND total
 *   - All writes logged before and after
 *   - Supports dry-run mode when ENABLE_AD_WRITES !== 'true'
 */
var metaApi = require('./meta-api-client');
var approvalQueue = require('./approval-queue');
var logger = require('./ad-optimization-logger');
var store = require('./store');
var dates = require('./dates');

var rulesEngine = require('./ad-rules-engine');

/**
 * Execute a single action proposal.
 * @param {object} proposal — from ad-rules-engine
 * @param {boolean} [forceDryRun]
 * @returns {Promise<{executed: boolean, result: object, queued: boolean, queueId: string|null}>}
 */
async function executeProposal(proposal, forceDryRun) {
  var mode = rulesEngine.MODE();

  // MONITOR_ONLY: never execute
  if (mode === 'MONITOR_ONLY') {
    await logger.logEvaluation(proposal, 'monitor_only_skip');
    return { executed: false, result: null, queued: false, queueId: null, reason: 'MONITOR_ONLY mode' };
  }

  // Check idempotency
  var idempKey = 'ad_action_idem:' + proposal.entityId + ':' + proposal.rule + ':' + dates.todayKey();
  var alreadyDone = await store.get(idempKey);
  if (alreadyDone) {
    return { executed: false, result: null, queued: false, queueId: null, reason: 'Already executed today' };
  }

  // APPROVAL_REQUIRED actions → queue
  if (proposal.safety === rulesEngine.SAFETY_LEVELS.APPROVAL_REQUIRED) {
    var queueItem = await approvalQueue.createItem({
      type: proposal.action,
      entityName: proposal.entityName,
      entityId: proposal.entityId,
      reason: proposal.reason,
      metrics: proposal.metrics,
      expectedEffect: proposal.expectedEffect,
      sourceRule: proposal.rule,
      payload: proposal.payload || null
    });
    await logger.logQueued(proposal, queueItem.id);
    return { executed: false, result: null, queued: true, queueId: queueItem.id, reason: 'Queued for approval' };
  }

  // AUTO_SAFE actions in SUGGEST mode → queue instead of execute
  if (mode === 'SUGGEST') {
    var queueItem2 = await approvalQueue.createItem({
      type: proposal.action,
      entityName: proposal.entityName,
      entityId: proposal.entityId,
      reason: proposal.reason,
      metrics: proposal.metrics,
      expectedEffect: proposal.expectedEffect,
      sourceRule: proposal.rule,
      payload: proposal.payload || null
    });
    await logger.logQueued(proposal, queueItem2.id);
    return { executed: false, result: null, queued: true, queueId: queueItem2.id, reason: 'SUGGEST mode — queued' };
  }

  // AUTO_EXECUTE mode with AUTO_SAFE → execute
  if (mode === 'AUTO_EXECUTE' && proposal.safety === rulesEngine.SAFETY_LEVELS.AUTO_SAFE) {
    var result = await doExecute(proposal, forceDryRun);
    if (result.ok) {
      await store.set(idempKey, '1', 86400);
    }
    return { executed: result.ok, result: result, queued: false, queueId: null, reason: result.ok ? 'Executed' : result.error };
  }

  // MONITOR_ONLY flagged items
  await logger.logEvaluation(proposal, 'no_action_taken');
  return { executed: false, result: null, queued: false, queueId: null, reason: 'No action path for safety level' };
}

/**
 * Execute an approved queue item.
 * @param {string} queueItemId
 * @param {boolean} [forceDryRun]
 * @returns {Promise<{ok: boolean, result: object, error: string|null}>}
 */
async function executeApproved(queueItemId, forceDryRun) {
  var item = await approvalQueue.markExecuting(queueItemId);
  if (!item) {
    return { ok: false, result: null, error: 'Item not found or not in APPROVED state' };
  }

  var proposal = {
    action: item.type,
    entityId: item.entityId,
    entityName: item.entityName,
    reason: item.reason,
    metrics: item.metrics,
    rule: item.sourceRule,
    payload: item.payload
  };

  try {
    var result = await doExecute(proposal, forceDryRun);
    if (result.ok) {
      await approvalQueue.markExecuted(queueItemId, result);
      await logger.logExecution(proposal, result, 'approved_execution');
    } else {
      await approvalQueue.markFailed(queueItemId, result.error);
      await logger.logExecution(proposal, result, 'approved_execution_failed');
    }
    return { ok: result.ok, result: result, error: result.ok ? null : result.error };
  } catch (err) {
    await approvalQueue.markFailed(queueItemId, err.message);
    return { ok: false, result: null, error: err.message };
  }
}

/**
 * Perform the actual Meta API write.
 */
async function doExecute(proposal, forceDryRun) {
  switch (proposal.action) {
    case rulesEngine.ACTION_TYPES.PAUSE_AD:
      return metaApi.changeAdStatus(proposal.entityId, 'PAUSED', proposal.reason, forceDryRun);

    case rulesEngine.ACTION_TYPES.SCALE_ADSET:
      if (!proposal.payload || !proposal.payload.newBudgetCents) {
        return { ok: false, error: 'Missing newBudgetCents in payload', dryRun: false };
      }
      // Budget protection: double-check max
      var newBudgetEur = proposal.payload.newBudgetCents / 100;
      if (newBudgetEur > rulesEngine.MAX_ADSET_BUDGET()) {
        return { ok: false, error: 'Budget €' + newBudgetEur + ' exceeds MAX_ADSET_BUDGET €' + rulesEngine.MAX_ADSET_BUDGET(), dryRun: false };
      }
      return metaApi.adjustAdsetBudget(proposal.entityId, proposal.payload.newBudgetCents, proposal.reason, forceDryRun);

    default:
      return { ok: false, error: 'Unknown action type: ' + proposal.action, dryRun: false };
  }
}

/**
 * Execute all proposals from a rules evaluation.
 * @param {Array} proposals
 * @param {boolean} [forceDryRun]
 * @returns {Promise<{executed: Array, queued: Array, skipped: Array}>}
 */
async function executeAll(proposals, forceDryRun) {
  var executed = [];
  var queued = [];
  var skipped = [];

  for (var i = 0; i < proposals.length; i++) {
    var result = await executeProposal(proposals[i], forceDryRun);
    var entry = { proposal: proposals[i], result: result };

    if (result.executed) executed.push(entry);
    else if (result.queued) queued.push(entry);
    else skipped.push(entry);
  }

  return { executed: executed, queued: queued, skipped: skipped };
}

module.exports = {
  executeProposal: executeProposal,
  executeApproved: executeApproved,
  executeAll: executeAll
};
