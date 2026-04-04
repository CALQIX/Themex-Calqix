/**
 * Content Plan Cron — 06:00 Amsterdam
 *
 * Generates daily content plan using Meta signals, angle scoring, and memory.
 * Produces plan with 2 main posts + 1 reserve.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var planner = require('../../lib/content-planner');
var performanceLoop = require('../../lib/content-performance-loop');
var store = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/content-plan');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:content-plan';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    // Get cached Meta signals from content-insights run
    var metaSignals = await performanceLoop.getCachedSignals();
    console.log('[ContentPlan] Meta signals available:', Boolean(metaSignals));

    var plan = await planner.generateDailyPlan(metaSignals);

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: plan.date,
      status: plan.status,
      post1: { angle: plan.posts.post1.angle, pillar: plan.posts.post1.pillar, product: plan.posts.post1.product, confidence: plan.posts.post1.confidence },
      post2: { angle: plan.posts.post2.angle, pillar: plan.posts.post2.pillar, product: plan.posts.post2.product, confidence: plan.posts.post2.confidence },
      reserve: { angle: plan.posts.reserve.angle, pillar: plan.posts.reserve.pillar, product: plan.posts.reserve.product, confidence: plan.posts.reserve.confidence },
      metaSignalsUsed: plan.metaSignalsUsed,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentPlan] Error:', err.message);
    await store.del('cron:lock:content-plan');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
