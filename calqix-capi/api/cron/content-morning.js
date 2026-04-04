/**
 * Content Morning Chain — 05:45 Amsterdam
 *
 * Consolidates 3 sequential cron jobs into 1 QStash schedule:
 *   1. Content Insights — fetch Meta performance, extract angle signals
 *   2. Content Plan — generate daily plan (2 posts + 1 reserve)
 *   3. Content Generate — build briefs, compliance check, submit Predis jobs
 *
 * Individual endpoints remain available for manual/debug use.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var performanceLoop = require('../../lib/content-performance-loop');
var planner = require('../../lib/content-planner');
var memory = require('../../lib/content-memory');
var briefBuilder = require('../../lib/creative-brief-builder');
var compliance = require('../../lib/compliance-checker');
var payloadBuilder = require('../../lib/predis-payload-builder');
var predisClient = require('../../lib/predis-client');
var jobStore = require('../../lib/predis-job-store');
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var shopifyProducts = require('../../lib/shopify-products');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/content-morning');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var lockKey = 'cron:lock:content-morning';
  try {
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 600);

    var output = { ok: true, steps: {}, auth_source: auth.source };

    // --- Step 1: Content Insights ---
    console.log('[ContentMorning] Step 1/3: Insights...');
    try {
      var signals = await performanceLoop.analyzePerformance();
      output.steps.insights = {
        ok: true,
        topAngles: signals.topAngles,
        weakAngles: signals.weakAngles,
        spendStarved: signals.spendStarved.length,
        fatigued: signals.fatigued.length
      };
      console.log('[ContentMorning] Insights done — top:', signals.topAngles.length, 'weak:', signals.weakAngles.length);
    } catch (err) {
      console.error('[ContentMorning] Insights error:', err.message);
      output.steps.insights = { ok: false, error: err.message };
    }

    // --- Step 2: Content Plan ---
    console.log('[ContentMorning] Step 2/3: Plan...');
    try {
      var metaSignals = await performanceLoop.getCachedSignals();
      var plan = await planner.generateDailyPlan(metaSignals);
      output.steps.plan = {
        ok: true,
        date: plan.date,
        post1: { angle: plan.posts.post1.angle, pillar: plan.posts.post1.pillar, product: plan.posts.post1.product, confidence: plan.posts.post1.confidence },
        post2: { angle: plan.posts.post2.angle, pillar: plan.posts.post2.pillar, product: plan.posts.post2.product, confidence: plan.posts.post2.confidence },
        reserve: { angle: plan.posts.reserve.angle, pillar: plan.posts.reserve.pillar, product: plan.posts.reserve.product, confidence: plan.posts.reserve.confidence },
        metaSignalsUsed: plan.metaSignalsUsed
      };
      console.log('[ContentMorning] Plan done — date:', plan.date);
    } catch (err) {
      console.error('[ContentMorning] Plan error:', err.message);
      output.steps.plan = { ok: false, error: err.message };
    }

    // --- Step 3: Content Generate ---
    console.log('[ContentMorning] Step 3/3: Generate...');
    try {
      var dateStr = dates.todayKey();
      var currentPlan = await memory.getDailyPlan(dateStr);
      if (!currentPlan) {
        output.steps.generate = { ok: false, error: 'No plan found for ' + dateStr };
      } else {
        var briefs = briefBuilder.buildAllBriefs(currentPlan);
        var genResults = { post1: null, post2: null, reserve: null };
        var slots = ['post1', 'post2', 'reserve'];

        for (var i = 0; i < slots.length; i++) {
          var slot = slots[i];
          var brief = briefs[slot];

          var compResult = await compliance.check(brief);
          if (!compResult.approved) {
            console.warn('[ContentMorning] Compliance rejected ' + slot + ':', compResult.violations);
            genResults[slot] = { ok: false, reason: 'compliance_rejected' };
            continue;
          }

          var payload = payloadBuilder.buildPayload(brief);
          var validation = payloadBuilder.validatePayload(payload);
          if (!validation.valid) {
            genResults[slot] = { ok: false, reason: 'invalid_payload' };
            continue;
          }

          // Inject Shopify product images for Predis
          try {
            var productImages = await shopifyProducts.getProductImages(brief.product);
            if (productImages && productImages.length > 0) {
              payload.media_urls = productImages.slice(0, 3);
              console.log('[ContentMorning] Added', payload.media_urls.length, 'product images for', slot);
            }
          } catch (imgErr) {
            console.warn('[ContentMorning] Product image fetch failed for', slot, ':', imgErr.message);
          }

          var submitResult = await predisClient.submitJob(payload);
          if (submitResult.ok) {
            await jobStore.recordSubmission(submitResult.jobId, slot, brief, payload, submitResult.draftOnly);
            await memory.setContentJob(submitResult.jobId, {
              slot: slot, brief: brief, predisJobId: submitResult.jobId, draftOnly: submitResult.draftOnly
            });
            genResults[slot] = { ok: true, jobId: submitResult.jobId, draftOnly: submitResult.draftOnly };
          } else {
            genResults[slot] = { ok: false, reason: 'predis_failed' };
          }
        }

        currentPlan.status = 'generating';
        currentPlan.generationResults = genResults;
        await memory.setDailyPlan(dateStr, currentPlan);

        output.steps.generate = {
          ok: true,
          post1: genResults.post1 ? { ok: genResults.post1.ok, jobId: genResults.post1.jobId || null } : null,
          post2: genResults.post2 ? { ok: genResults.post2.ok, jobId: genResults.post2.jobId || null } : null,
          reserve: genResults.reserve ? { ok: genResults.reserve.ok, jobId: genResults.reserve.jobId || null } : null,
          predisEnabled: predisClient.getProviderStatus().enabled
        };
        console.log('[ContentMorning] Generate done');
      }
    } catch (err) {
      console.error('[ContentMorning] Generate error:', err.message);
      output.steps.generate = { ok: false, error: err.message };
    }

    await store.del(lockKey);
    return res.status(200).json(output);
  } catch (err) {
    console.error('[ContentMorning] Fatal error:', err.message);
    await store.del(lockKey);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
