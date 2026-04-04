/**
 * Ad Optimization Logger — structured logging for all ad optimization events.
 *
 * Redis keys:
 *   ad_actions_log:{date}         → JSON array  TTL 30d
 *   ad_optimization_state:{date}  → JSON         TTL 14d
 */
var store = require('./store');
var dates = require('./dates');

var TTL_LOG = 30 * 86400;
var TTL_STATE = 14 * 86400;

function today() { return dates.todayKey(); }

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

async function appendLog(entry) {
  var dateStr = today();
  var key = 'ad_actions_log:' + dateStr;
  var log = (await getJSON(key)) || [];
  log.push(entry);
  await setJSON(key, log, TTL_LOG);
}

/**
 * Log a rule evaluation (even if no action was taken).
 */
async function logEvaluation(proposal, outcome) {
  await appendLog({
    type: 'evaluation',
    action: proposal.action,
    rule: proposal.rule,
    entityId: proposal.entityId,
    entityName: proposal.entityName,
    reason: proposal.reason,
    outcome: outcome,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log that a proposal was queued for approval.
 */
async function logQueued(proposal, queueItemId) {
  await appendLog({
    type: 'queued',
    action: proposal.action,
    rule: proposal.rule,
    entityId: proposal.entityId,
    entityName: proposal.entityName,
    reason: proposal.reason,
    queueItemId: queueItemId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log an executed action with result.
 */
async function logExecution(proposal, result, context) {
  await appendLog({
    type: 'execution',
    action: proposal.action,
    rule: proposal.rule,
    entityId: proposal.entityId,
    entityName: proposal.entityName,
    reason: proposal.reason,
    context: context || 'auto',
    success: result && result.ok,
    dryRun: result && result.dryRun,
    error: result && !result.ok ? (result.error || null) : null,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log a budget change for an adset.
 */
async function logBudgetChange(adsetId, adsetName, oldBudget, newBudget, reason) {
  var key = 'ad_budget_changes:' + adsetId;
  var history = (await getJSON(key)) || [];
  var entry = {
    oldBudget: oldBudget,
    newBudget: newBudget,
    reason: reason,
    timestamp: new Date().toISOString()
  };
  history.push(entry);
  // Keep last 20 entries
  if (history.length > 20) history = history.slice(-20);
  await setJSON(key, history, TTL_LOG);

  await appendLog({
    type: 'budget_change',
    entityId: adsetId,
    entityName: adsetName,
    oldBudget: oldBudget,
    newBudget: newBudget,
    reason: reason,
    timestamp: new Date().toISOString()
  });
}

/**
 * Save daily optimization state snapshot.
 */
async function saveOptimizationState(dateStr, state) {
  return setJSON('ad_optimization_state:' + (dateStr || today()), state, TTL_STATE);
}

/**
 * Get daily optimization state.
 */
async function getOptimizationState(dateStr) {
  return getJSON('ad_optimization_state:' + (dateStr || today()));
}

/**
 * Get action log for a date.
 */
async function getActionLog(dateStr) {
  return (await getJSON('ad_actions_log:' + (dateStr || today()))) || [];
}

/**
 * Get budget change history for an adset.
 */
async function getBudgetHistory(adsetId) {
  return (await getJSON('ad_budget_changes:' + adsetId)) || [];
}

/**
 * Get all budget change histories (for rules engine).
 * Returns { adsetId: { timestamp, ... } } with most recent change per adset.
 */
async function getAllBudgetHistories(adsetIds) {
  var result = {};
  for (var i = 0; i < adsetIds.length; i++) {
    var history = await getBudgetHistory(adsetIds[i]);
    if (history.length > 0) {
      result[adsetIds[i]] = history[history.length - 1];
    }
  }
  return result;
}

module.exports = {
  logEvaluation: logEvaluation,
  logQueued: logQueued,
  logExecution: logExecution,
  logBudgetChange: logBudgetChange,
  saveOptimizationState: saveOptimizationState,
  getOptimizationState: getOptimizationState,
  getActionLog: getActionLog,
  getBudgetHistory: getBudgetHistory,
  getAllBudgetHistories: getAllBudgetHistories
};
