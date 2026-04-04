/**
 * Content Insights Cron — 05:45 Amsterdam
 *
 * Fetches Meta ad performance and converts into content planning signals.
 * Stores signals in Redis for downstream content planning.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
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

  var auth = await authenticate(req, rawBody, '/api/cron/content-insights');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:content-insights';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    console.log('[ContentInsights] Starting performance analysis...');
    var signals = await performanceLoop.analyzePerformance();

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      topAngles: signals.topAngles,
      weakAngles: signals.weakAngles,
      spendStarved: signals.spendStarved.length,
      fatigued: signals.fatigued.length,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentInsights] Error:', err.message);
    await store.del('cron:lock:content-insights');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
