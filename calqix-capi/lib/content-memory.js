/**
 * Content Memory — Redis-backed memory for the content automation system.
 *
 * Stores and retrieves:
 *   - posted topics, hooks, CTAs history
 *   - angle fatigue scores
 *   - winning angle scores
 *   - blocked claims
 *   - product rotation balance
 *   - post approval/rejection reasons
 *   - Predis generation outcomes
 *
 * All keys use prefix `cm:` (content memory).
 * TTLs: history 90d, scores 30d, daily plans 14d.
 */
var store = require('./store');
var dates = require('./dates');

var TTL_HISTORY = 90 * 86400;
var TTL_SCORES = 30 * 86400;
var TTL_DAILY = 14 * 86400;
var MAX_HISTORY_ITEMS = 200;

// --- Helpers ---

function today() { return dates.todayKey(); }

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

async function appendToList(key, item, ttl) {
  var list = (await getJSON(key)) || [];
  list.unshift(item);
  if (list.length > MAX_HISTORY_ITEMS) list = list.slice(0, MAX_HISTORY_ITEMS);
  return setJSON(key, list, ttl);
}

// --- Posted History ---

async function recordPostedTopic(topic, meta) {
  return appendToList('cm:topics', { topic: topic, date: today(), meta: meta || {} }, TTL_HISTORY);
}

async function getPostedTopics(limit) {
  var list = (await getJSON('cm:topics')) || [];
  return list.slice(0, limit || 50);
}

async function recordPostedHook(hook, meta) {
  return appendToList('cm:hooks', { hook: hook, date: today(), meta: meta || {} }, TTL_HISTORY);
}

async function getPostedHooks(limit) {
  var list = (await getJSON('cm:hooks')) || [];
  return list.slice(0, limit || 50);
}

async function recordPostedCTA(cta, meta) {
  return appendToList('cm:ctas', { cta: cta, date: today(), meta: meta || {} }, TTL_HISTORY);
}

async function getPostedCTAs(limit) {
  var list = (await getJSON('cm:ctas')) || [];
  return list.slice(0, limit || 50);
}

// --- Angle Fatigue & Winning Scores ---

async function getAngleScores() {
  return (await getJSON('cm:angle_scores')) || {};
}

async function setAngleScores(scores) {
  return setJSON('cm:angle_scores', scores, TTL_SCORES);
}

async function recordAngleUsage(angle) {
  var scores = await getAngleScores();
  if (!scores[angle]) scores[angle] = { uses: 0, lastUsed: null, wins: 0, fatigue: 0 };
  scores[angle].uses++;
  scores[angle].lastUsed = today();
  scores[angle].fatigue = Math.min(100, scores[angle].fatigue + 15);
  return setAngleScores(scores);
}

async function recordAngleWin(angle) {
  var scores = await getAngleScores();
  if (!scores[angle]) scores[angle] = { uses: 0, lastUsed: null, wins: 0, fatigue: 0 };
  scores[angle].wins++;
  scores[angle].fatigue = Math.max(0, scores[angle].fatigue - 10);
  return setAngleScores(scores);
}

async function decayAngleFatigue() {
  var scores = await getAngleScores();
  Object.keys(scores).forEach(function (k) {
    scores[k].fatigue = Math.max(0, scores[k].fatigue - 5);
  });
  return setAngleScores(scores);
}

// --- Product Rotation ---

async function getProductRotation() {
  return (await getJSON('cm:product_rotation')) || {};
}

async function recordProductUsage(product) {
  var rot = await getProductRotation();
  if (!rot[product]) rot[product] = { count: 0, lastUsed: null };
  rot[product].count++;
  rot[product].lastUsed = today();
  return setJSON('cm:product_rotation', rot, TTL_SCORES);
}

// --- Blocked Claims ---

async function getBlockedClaims() {
  return (await getJSON('cm:blocked_claims')) || [];
}

async function addBlockedClaim(claim, reason) {
  return appendToList('cm:blocked_claims', { claim: claim, reason: reason, date: today() }, TTL_HISTORY);
}

// --- Approval / Rejection Reasons ---

async function recordApproval(postId, reason) {
  return appendToList('cm:approvals', { postId: postId, reason: reason, date: today(), action: 'approved' }, TTL_HISTORY);
}

async function recordRejection(postId, reason) {
  return appendToList('cm:rejections', { postId: postId, reason: reason, date: today(), action: 'rejected' }, TTL_HISTORY);
}

async function getApprovalHistory(limit) {
  return ((await getJSON('cm:approvals')) || []).slice(0, limit || 30);
}

async function getRejectionHistory(limit) {
  return ((await getJSON('cm:rejections')) || []).slice(0, limit || 30);
}

// --- Predis Outcomes ---

async function recordPredisOutcome(jobId, outcome) {
  return appendToList('cm:predis_outcomes', { jobId: jobId, outcome: outcome, date: today() }, TTL_HISTORY);
}

async function getPredisOutcomes(limit) {
  return ((await getJSON('cm:predis_outcomes')) || []).slice(0, limit || 30);
}

// --- Daily Plan ---

async function setDailyPlan(dateStr, plan) {
  return setJSON('cm:plan:' + dateStr, plan, TTL_DAILY);
}

async function getDailyPlan(dateStr) {
  return getJSON('cm:plan:' + (dateStr || today()));
}

// --- Content Jobs ---

async function setContentJob(jobId, data) {
  return setJSON('cm:job:' + jobId, data, TTL_DAILY);
}

async function getContentJob(jobId) {
  return getJSON('cm:job:' + jobId);
}

// --- Content Assets ---

async function setContentAsset(assetId, data) {
  return setJSON('cm:asset:' + assetId, data, TTL_DAILY);
}

async function getContentAsset(assetId) {
  return getJSON('cm:asset:' + assetId);
}

// --- Publish Log ---

async function recordPublish(postId, meta) {
  return appendToList('cm:publish_log', { postId: postId, meta: meta, date: today() }, TTL_HISTORY);
}

async function getPublishLog(limit) {
  return ((await getJSON('cm:publish_log')) || []).slice(0, limit || 30);
}

module.exports = {
  recordPostedTopic: recordPostedTopic, getPostedTopics: getPostedTopics,
  recordPostedHook: recordPostedHook, getPostedHooks: getPostedHooks,
  recordPostedCTA: recordPostedCTA, getPostedCTAs: getPostedCTAs,
  getAngleScores: getAngleScores, setAngleScores: setAngleScores,
  recordAngleUsage: recordAngleUsage, recordAngleWin: recordAngleWin, decayAngleFatigue: decayAngleFatigue,
  getProductRotation: getProductRotation, recordProductUsage: recordProductUsage,
  getBlockedClaims: getBlockedClaims, addBlockedClaim: addBlockedClaim,
  recordApproval: recordApproval, recordRejection: recordRejection,
  getApprovalHistory: getApprovalHistory, getRejectionHistory: getRejectionHistory,
  recordPredisOutcome: recordPredisOutcome, getPredisOutcomes: getPredisOutcomes,
  setDailyPlan: setDailyPlan, getDailyPlan: getDailyPlan,
  setContentJob: setContentJob, getContentJob: getContentJob,
  setContentAsset: setContentAsset, getContentAsset: getContentAsset,
  recordPublish: recordPublish, getPublishLog: getPublishLog
};
