/**
 * Approval Queue — manages approval items for content and ad actions.
 *
 * Redis keys:
 *   aq:item:{id}          → JSON  TTL 7d   (individual approval item)
 *   aq:pending:{date}     → JSON  TTL 14d  (list of pending item IDs for date)
 *   aq:executed:{date}    → JSON  TTL 14d  (list of executed item IDs)
 *   aq:rejected:{date}    → JSON  TTL 14d  (list of rejected item IDs)
 *
 * Item states: pending → approved → executing → executed | failed
 *              pending → rejected
 */
var store = require('./store');
var dates = require('./dates');
var crypto = require('crypto');

var TTL_ITEM = 7 * 86400;
var TTL_LIST = 14 * 86400;

var STATES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  EXECUTED: 'executed',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

function generateId() {
  return 'aq_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function today() { return dates.todayKey(); }

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

/**
 * Create a new approval queue item.
 * @param {object} opts
 * @param {string} opts.type - 'content_publish' | 'ad_pause' | 'ad_scale' | 'ad_budget' | 'content_regenerate'
 * @param {string} opts.entityName - human-readable target name
 * @param {string} [opts.entityId] - Meta entity ID or content job ID
 * @param {string} opts.reason - why this action is proposed
 * @param {object} [opts.metrics] - metric snapshot at time of proposal
 * @param {string} [opts.expectedEffect] - what the action would do
 * @param {string} [opts.sourceRule] - which rule generated this
 * @param {object} [opts.payload] - data needed to execute the action
 * @returns {Promise<object>} the created item
 */
async function createItem(opts) {
  var id = generateId();
  var dateStr = today();
  var item = {
    id: id,
    type: opts.type,
    entityName: opts.entityName || '',
    entityId: opts.entityId || null,
    reason: opts.reason || '',
    metrics: opts.metrics || null,
    expectedEffect: opts.expectedEffect || '',
    sourceRule: opts.sourceRule || '',
    payload: opts.payload || null,
    state: STATES.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedBy: null,
    rejectedBy: null,
    executionResult: null,
    executionError: null
  };

  await setJSON('aq:item:' + id, item, TTL_ITEM);

  // Add to pending list for today
  var pending = (await getJSON('aq:pending:' + dateStr)) || [];
  pending.push(id);
  await setJSON('aq:pending:' + dateStr, pending, TTL_LIST);

  console.log('[ApprovalQueue] Created item', { id: id, type: opts.type, entity: opts.entityName });
  return item;
}

/**
 * Get an approval item by ID.
 */
async function getItem(id) {
  return getJSON('aq:item:' + id);
}

/**
 * Approve an item. Does NOT execute it — just marks it approved.
 * @param {string} id
 * @param {string} [approvedBy] - operator identifier
 * @returns {Promise<object|null>}
 */
async function approveItem(id, approvedBy) {
  var item = await getItem(id);
  if (!item) return null;
  if (item.state !== STATES.PENDING) {
    console.warn('[ApprovalQueue] Cannot approve item in state:', item.state);
    return item;
  }
  item.state = STATES.APPROVED;
  item.approvedBy = approvedBy || 'operator';
  item.updatedAt = new Date().toISOString();
  await setJSON('aq:item:' + id, item, TTL_ITEM);
  console.log('[ApprovalQueue] Approved', { id: id, type: item.type });
  return item;
}

/**
 * Reject an item.
 */
async function rejectItem(id, rejectedBy, reason) {
  var item = await getItem(id);
  if (!item) return null;
  if (item.state !== STATES.PENDING) {
    console.warn('[ApprovalQueue] Cannot reject item in state:', item.state);
    return item;
  }
  item.state = STATES.REJECTED;
  item.rejectedBy = rejectedBy || 'operator';
  item.rejectionReason = reason || '';
  item.updatedAt = new Date().toISOString();
  await setJSON('aq:item:' + id, item, TTL_ITEM);

  var dateStr = today();
  var rejected = (await getJSON('aq:rejected:' + dateStr)) || [];
  rejected.push(id);
  await setJSON('aq:rejected:' + dateStr, rejected, TTL_LIST);

  console.log('[ApprovalQueue] Rejected', { id: id, type: item.type });
  return item;
}

/**
 * Mark item as executing (lock before execution).
 */
async function markExecuting(id) {
  var item = await getItem(id);
  if (!item) return null;
  if (item.state !== STATES.APPROVED) return null;
  item.state = STATES.EXECUTING;
  item.updatedAt = new Date().toISOString();
  await setJSON('aq:item:' + id, item, TTL_ITEM);
  return item;
}

/**
 * Mark item as executed with result.
 */
async function markExecuted(id, result) {
  var item = await getItem(id);
  if (!item) return null;
  item.state = STATES.EXECUTED;
  item.executionResult = result || null;
  item.updatedAt = new Date().toISOString();
  await setJSON('aq:item:' + id, item, TTL_ITEM);

  var dateStr = today();
  var executed = (await getJSON('aq:executed:' + dateStr)) || [];
  executed.push(id);
  await setJSON('aq:executed:' + dateStr, executed, TTL_LIST);

  console.log('[ApprovalQueue] Executed', { id: id, type: item.type });
  return item;
}

/**
 * Mark item as failed.
 */
async function markFailed(id, error) {
  var item = await getItem(id);
  if (!item) return null;
  item.state = STATES.FAILED;
  item.executionError = error || 'unknown';
  item.updatedAt = new Date().toISOString();
  await setJSON('aq:item:' + id, item, TTL_ITEM);
  return item;
}

/**
 * Get all pending items for a date.
 */
async function getPendingItems(dateStr) {
  var ids = (await getJSON('aq:pending:' + (dateStr || today()))) || [];
  var items = [];
  for (var i = 0; i < ids.length; i++) {
    var item = await getItem(ids[i]);
    if (item && item.state === STATES.PENDING) items.push(item);
  }
  return items;
}

/**
 * Get all approved (ready to execute) items for a date.
 */
async function getApprovedItems(dateStr) {
  var ids = (await getJSON('aq:pending:' + (dateStr || today()))) || [];
  var items = [];
  for (var i = 0; i < ids.length; i++) {
    var item = await getItem(ids[i]);
    if (item && item.state === STATES.APPROVED) items.push(item);
  }
  return items;
}

/**
 * Get full queue summary for a date.
 */
async function getQueueSummary(dateStr) {
  var d = dateStr || today();
  var pendingIds = (await getJSON('aq:pending:' + d)) || [];
  var executedIds = (await getJSON('aq:executed:' + d)) || [];
  var rejectedIds = (await getJSON('aq:rejected:' + d)) || [];

  var pending = 0, approved = 0, executing = 0, executed = 0, failed = 0, rejected = 0;
  for (var i = 0; i < pendingIds.length; i++) {
    var item = await getItem(pendingIds[i]);
    if (!item) continue;
    switch (item.state) {
      case STATES.PENDING: pending++; break;
      case STATES.APPROVED: approved++; break;
      case STATES.EXECUTING: executing++; break;
      case STATES.EXECUTED: executed++; break;
      case STATES.FAILED: failed++; break;
      case STATES.REJECTED: rejected++; break;
    }
  }

  return {
    date: d,
    pending: pending,
    approved: approved,
    executing: executing,
    executed: executed + executedIds.length,
    failed: failed,
    rejected: rejected + rejectedIds.length,
    total: pendingIds.length
  };
}

module.exports = {
  STATES: STATES,
  createItem: createItem,
  getItem: getItem,
  approveItem: approveItem,
  rejectItem: rejectItem,
  markExecuting: markExecuting,
  markExecuted: markExecuted,
  markFailed: markFailed,
  getPendingItems: getPendingItems,
  getApprovedItems: getApprovedItems,
  getQueueSummary: getQueueSummary
};
