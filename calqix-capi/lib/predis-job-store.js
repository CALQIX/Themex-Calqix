/**
 * Predis Job Store — tracks generation jobs, results, and asset metadata.
 *
 * Redis keys:
 *   predis:job:{jobId}     → JSON  TTL 14d  (job status and result)
 *   predis:daily:{date}    → JSON  TTL 14d  (list of job IDs for date)
 */
var store = require('./store');
var memory = require('./content-memory');
var dates = require('./dates');

var TTL_JOB = 14 * 86400;

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
 * Record a submitted job.
 */
async function recordSubmission(jobId, slot, brief, payload, draftOnly) {
  var dateStr = today();
  var job = {
    jobId: jobId,
    slot: slot,
    date: dateStr,
    status: draftOnly ? 'draft_only' : 'submitted',
    draftOnly: draftOnly,
    brief: {
      angle: brief.angle,
      pillar: brief.pillar,
      product: brief.product,
      confidence: brief.confidence,
      metaBacked: brief.metaBacked
    },
    payload: payload._meta || null,
    submittedAt: new Date().toISOString(),
    completedAt: null,
    assets: null,
    error: null
  };

  await setJSON('predis:job:' + jobId, job, TTL_JOB);

  // Add to daily list
  var dailyJobs = (await getJSON('predis:daily:' + dateStr)) || [];
  dailyJobs.push(jobId);
  await setJSON('predis:daily:' + dateStr, dailyJobs, TTL_JOB);

  return job;
}

/**
 * Record job completion with assets.
 */
async function recordCompletion(jobId, assets) {
  var job = await getJSON('predis:job:' + jobId);
  if (!job) return null;

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.assets = assets;
  await setJSON('predis:job:' + jobId, job, TTL_JOB);

  // Record in content memory
  await memory.recordPredisOutcome(jobId, { status: 'completed', assetCount: assets ? assets.length : 0 });

  return job;
}

/**
 * Record job failure.
 */
async function recordFailure(jobId, error) {
  var job = await getJSON('predis:job:' + jobId);
  if (!job) return null;

  job.status = 'failed';
  job.completedAt = new Date().toISOString();
  job.error = error;
  await setJSON('predis:job:' + jobId, job, TTL_JOB);

  await memory.recordPredisOutcome(jobId, { status: 'failed', error: error });

  return job;
}

/**
 * Get job by ID.
 */
async function getJob(jobId) {
  return getJSON('predis:job:' + jobId);
}

/**
 * Get all jobs for a date.
 */
async function getDailyJobs(dateStr) {
  var ids = (await getJSON('predis:daily:' + (dateStr || today()))) || [];
  var jobs = [];
  for (var i = 0; i < ids.length; i++) {
    var job = await getJob(ids[i]);
    if (job) jobs.push(job);
  }
  return jobs;
}

/**
 * Get summary stats for a date.
 */
async function getDailySummary(dateStr) {
  var jobs = await getDailyJobs(dateStr);
  var submitted = 0, completed = 0, failed = 0, draftOnly = 0;
  jobs.forEach(function (j) {
    if (j.status === 'submitted') submitted++;
    else if (j.status === 'completed') completed++;
    else if (j.status === 'failed') failed++;
    else if (j.status === 'draft_only') draftOnly++;
  });
  return { total: jobs.length, submitted: submitted, completed: completed, failed: failed, draftOnly: draftOnly };
}

module.exports = {
  recordSubmission: recordSubmission,
  recordCompletion: recordCompletion,
  recordFailure: recordFailure,
  getJob: getJob,
  getDailyJobs: getDailyJobs,
  getDailySummary: getDailySummary
};
