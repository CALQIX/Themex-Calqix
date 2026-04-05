/**
 * Brief Store — Redis-backed persistence for content review briefs.
 *
 * Redis keys:
 *   brief:{brief_id}        → JSON  TTL 7d   (individual brief with all review data)
 *   briefs:daily:{date}     → JSON  TTL 14d  (list of brief_ids for a given date)
 *
 * Brief ID format: brf_{base36timestamp}_{4-byte-hex}
 */
var store = require('./store');
var crypto = require('crypto');

var TTL_BRIEF = 7 * 86400;
var TTL_LIST = 14 * 86400;

var BRIEF_STATES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVISION_REQUESTED: 'revision_requested',
  AUTO_APPROVED: 'auto_approved',
  AUTO_REJECTED: 'auto_rejected'
};

/**
 * Generate a short unique brief ID.
 * Format: brf_{base36timestamp}_{4-byte-hex}
 */
function generateBriefId() {
  return 'brf_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Create and persist a new brief.
 * @param {object} opts
 * @param {string} opts.dateStr - date key (DD-MM-YYYY)
 * @param {string} opts.slot - post1, post2, reserve
 * @param {string} opts.product
 * @param {string} opts.angle
 * @param {string} [opts.headline]
 * @param {string} [opts.primary_text]
 * @param {string} [opts.hook]
 * @param {string} [opts.cta]
 * @param {string} [opts.market]
 * @param {number} [opts.score]
 * @param {string} [opts.verdict]
 * @param {Array}  [opts.issues]
 * @param {Array}  [opts.fixes]
 * @param {object} [opts.scores]
 * @param {string} [opts.decision]
 * @param {string} [opts.claude_status] - 'success' | 'failed' | 'skipped'
 * @param {string} [opts.claude_review_summary]
 * @param {string} [opts.approval_queue_id] - linked aq:item ID
 * @param {object} [opts.raw_brief] - original brief from planner
 * @returns {Promise<object>}
 */
async function createBrief(opts) {
  var briefId = generateBriefId();

  var brief = {
    brief_id: briefId,
    date: opts.dateStr || '',
    slot: opts.slot || '',
    product: opts.product || '',
    angle: opts.angle || '',
    headline: opts.headline || '',
    primary_text: opts.primary_text || '',
    hook: opts.hook || '',
    cta: opts.cta || '',
    market: opts.market || 'NL',
    score: opts.score || 0,
    verdict: opts.verdict || 'PENDING',
    scores: opts.scores || {},
    issues: opts.issues || [],
    fixes: opts.fixes || [],
    suggested_fixes: opts.fixes || [],
    claude_status: opts.claude_status || 'pending',
    claude_review_summary: opts.claude_review_summary || '',
    decision: opts.decision || 'needs_approval',
    status: BRIEF_STATES.PENDING,
    approval_queue_id: opts.approval_queue_id || null,
    raw_brief: opts.raw_brief || null,
    created_at: new Date().toISOString(),
    reviewed_at: null,
    reviewed_action: null,
    reviewer_source: null,
    reviewer_telegram_user_id: null
  };

  // Auto-set status based on decision
  if (opts.decision === 'auto_approved') {
    brief.status = BRIEF_STATES.AUTO_APPROVED;
    brief.reviewed_at = new Date().toISOString();
    brief.reviewed_action = 'auto_approved';
    brief.reviewer_source = 'claude';
  } else if (opts.decision === 'auto_rejected') {
    brief.status = BRIEF_STATES.AUTO_REJECTED;
    brief.reviewed_at = new Date().toISOString();
    brief.reviewed_action = 'auto_rejected';
    brief.reviewer_source = 'claude';
  }

  await store.set('brief:' + briefId, JSON.stringify(brief), TTL_BRIEF);

  // Add to daily list
  var listKey = 'briefs:daily:' + (opts.dateStr || '');
  var existingRaw = await store.get(listKey);
  var ids = [];
  if (existingRaw) {
    try { ids = JSON.parse(existingRaw); } catch (e) { ids = []; }
  }
  ids.push(briefId);
  await store.set(listKey, JSON.stringify(ids), TTL_LIST);

  console.log('[BriefStore] Created brief', { brief_id: briefId, slot: brief.slot, product: brief.product, decision: brief.decision });
  return brief;
}

/**
 * Get a brief by ID.
 */
async function getBrief(briefId) {
  if (!briefId) {
    console.error('[BriefStore] getBrief called with empty briefId');
    return null;
  }
  var raw = await store.get('brief:' + briefId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * Update a brief in Redis.
 */
async function updateBrief(briefId, updates) {
  var brief = await getBrief(briefId);
  if (!brief) return null;

  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) {
    brief[keys[i]] = updates[keys[i]];
  }

  await store.set('brief:' + briefId, JSON.stringify(brief), TTL_BRIEF);
  return brief;
}

/**
 * Approve a brief. Idempotent — returns current state if already processed.
 * @param {string} briefId
 * @param {string} [telegramUserId]
 * @returns {Promise<{brief: object, alreadyProcessed: boolean}>}
 */
async function approveBrief(briefId, telegramUserId) {
  var brief = await getBrief(briefId);
  if (!brief) return { brief: null, alreadyProcessed: false };

  if (brief.status === BRIEF_STATES.APPROVED ||
      brief.status === BRIEF_STATES.REJECTED ||
      brief.status === BRIEF_STATES.REVISION_REQUESTED ||
      brief.status === BRIEF_STATES.AUTO_APPROVED ||
      brief.status === BRIEF_STATES.AUTO_REJECTED) {
    console.log('[BriefStore] Brief already processed', { brief_id: briefId, status: brief.status });
    return { brief: brief, alreadyProcessed: true };
  }

  brief.status = BRIEF_STATES.APPROVED;
  brief.reviewed_at = new Date().toISOString();
  brief.reviewed_action = 'approved';
  brief.reviewer_source = 'telegram';
  brief.reviewer_telegram_user_id = telegramUserId || null;

  await store.set('brief:' + briefId, JSON.stringify(brief), TTL_BRIEF);
  console.log('[BriefStore] Approved brief', { brief_id: briefId });
  return { brief: brief, alreadyProcessed: false };
}

/**
 * Reject a brief. Idempotent.
 */
async function rejectBrief(briefId, telegramUserId) {
  var brief = await getBrief(briefId);
  if (!brief) return { brief: null, alreadyProcessed: false };

  if (brief.status === BRIEF_STATES.APPROVED ||
      brief.status === BRIEF_STATES.REJECTED ||
      brief.status === BRIEF_STATES.REVISION_REQUESTED ||
      brief.status === BRIEF_STATES.AUTO_APPROVED ||
      brief.status === BRIEF_STATES.AUTO_REJECTED) {
    return { brief: brief, alreadyProcessed: true };
  }

  brief.status = BRIEF_STATES.REJECTED;
  brief.reviewed_at = new Date().toISOString();
  brief.reviewed_action = 'rejected';
  brief.reviewer_source = 'telegram';
  brief.reviewer_telegram_user_id = telegramUserId || null;

  await store.set('brief:' + briefId, JSON.stringify(brief), TTL_BRIEF);
  console.log('[BriefStore] Rejected brief', { brief_id: briefId });
  return { brief: brief, alreadyProcessed: false };
}

/**
 * Request revision for a brief. Idempotent.
 */
async function reviseBrief(briefId, telegramUserId) {
  var brief = await getBrief(briefId);
  if (!brief) return { brief: null, alreadyProcessed: false };

  if (brief.status === BRIEF_STATES.APPROVED ||
      brief.status === BRIEF_STATES.REJECTED ||
      brief.status === BRIEF_STATES.REVISION_REQUESTED ||
      brief.status === BRIEF_STATES.AUTO_APPROVED ||
      brief.status === BRIEF_STATES.AUTO_REJECTED) {
    return { brief: brief, alreadyProcessed: true };
  }

  brief.status = BRIEF_STATES.REVISION_REQUESTED;
  brief.reviewed_at = new Date().toISOString();
  brief.reviewed_action = 'revision_requested';
  brief.reviewer_source = 'telegram';
  brief.reviewer_telegram_user_id = telegramUserId || null;

  await store.set('brief:' + briefId, JSON.stringify(brief), TTL_BRIEF);
  console.log('[BriefStore] Revision requested for brief', { brief_id: briefId });
  return { brief: brief, alreadyProcessed: false };
}

/**
 * Get all brief IDs for a given date.
 */
async function getDailyBriefIds(dateStr) {
  var raw = await store.get('briefs:daily:' + dateStr);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

module.exports = {
  BRIEF_STATES: BRIEF_STATES,
  generateBriefId: generateBriefId,
  createBrief: createBrief,
  getBrief: getBrief,
  updateBrief: updateBrief,
  approveBrief: approveBrief,
  rejectBrief: rejectBrief,
  reviseBrief: reviseBrief,
  getDailyBriefIds: getDailyBriefIds
};
