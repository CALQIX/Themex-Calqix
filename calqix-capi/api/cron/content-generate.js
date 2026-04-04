/**
 * Content Generate Cron — 06:20 Amsterdam
 *
 * Builds creative briefs from daily plan and submits Predis generation jobs.
 * Covers brand/compliance review + copy generation + creative brief + Predis submission.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var memory = require('../../lib/content-memory');
var briefBuilder = require('../../lib/creative-brief-builder');
var compliance = require('../../lib/compliance-checker');
var payloadBuilder = require('../../lib/predis-payload-builder');
var predisClient = require('../../lib/predis-client');
var jobStore = require('../../lib/predis-job-store');
var store = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/content-generate');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:content-generate';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 600);

    var dateStr = new Date().toISOString().split('T')[0];
    var plan = await memory.getDailyPlan(dateStr);
    if (!plan) {
      await store.del(lockKey);
      return res.status(200).json({ ok: false, error: 'No plan found for ' + dateStr });
    }

    // Build briefs
    var briefs = briefBuilder.buildAllBriefs(plan);
    console.log('[ContentGenerate] Briefs built for', dateStr);

    // Compliance check each brief
    var results = { post1: null, post2: null, reserve: null };
    var slots = ['post1', 'post2', 'reserve'];

    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var brief = briefs[slot];

      var compResult = await compliance.check(brief);
      if (!compResult.approved) {
        console.warn('[ContentGenerate] Compliance rejected ' + slot + ':', compResult.violations);
        results[slot] = { ok: false, reason: 'compliance_rejected', violations: compResult.violations };
        continue;
      }

      // Build Predis payload
      var payload = payloadBuilder.buildPayload(brief);
      var validation = payloadBuilder.validatePayload(payload);
      if (!validation.valid) {
        console.warn('[ContentGenerate] Invalid payload for ' + slot + ':', validation.errors);
        results[slot] = { ok: false, reason: 'invalid_payload', errors: validation.errors };
        continue;
      }

      // Submit to Predis
      var submitResult = await predisClient.submitJob(payload);
      if (submitResult.ok) {
        await jobStore.recordSubmission(submitResult.jobId, slot, brief, payload, submitResult.draftOnly);
        // Store brief as content asset
        await memory.setContentJob(submitResult.jobId, {
          slot: slot, brief: brief, predisJobId: submitResult.jobId, draftOnly: submitResult.draftOnly
        });
        results[slot] = { ok: true, jobId: submitResult.jobId, draftOnly: submitResult.draftOnly };
      } else {
        results[slot] = { ok: false, reason: 'predis_submit_failed', error: submitResult.error };
      }
    }

    // Update plan status
    plan.status = 'generating';
    plan.generationResults = results;
    await memory.setDailyPlan(dateStr, plan);

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      results: {
        post1: results.post1 ? { ok: results.post1.ok, jobId: results.post1.jobId || null } : null,
        post2: results.post2 ? { ok: results.post2.ok, jobId: results.post2.jobId || null } : null,
        reserve: results.reserve ? { ok: results.reserve.ok, jobId: results.reserve.jobId || null } : null
      },
      predisEnabled: predisClient.getProviderStatus().enabled,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentGenerate] Error:', err.message);
    await store.del('cron:lock:content-generate');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
