/**
 * Ad Performance Sync Cron — 09:00 Amsterdam
 *
 * Fetches campaign, adset, and ad level data from Meta.
 * Normalizes and stores in Redis. Updates fatigue tracker.
 */
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var insightsFetcher = require('../../lib/meta-insights-fetcher');
var fatigueTracker = require('../../lib/ad-fatigue-tracker');
var store = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/ad-performance-sync');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:ad-performance-sync';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    console.log('[AdPerfSync] Fetching optimization snapshot...');
    var snapshot = await insightsFetcher.fetchOptimizationSnapshot();

    // Update fatigue tracker with ad-level data
    var fatigueResults = {};
    if (snapshot.adRows.length > 0) {
      console.log('[AdPerfSync] Updating fatigue tracker for', snapshot.adRows.length, 'ads');
      fatigueResults = await fatigueTracker.bulkUpdate(snapshot.adRows);
    }

    var fatiguedCount = Object.keys(fatigueResults).filter(function (k) {
      return fatigueResults[k] && fatigueResults[k].fatigued;
    }).length;

    // Store snapshot metadata
    var dateStr = new Date().toISOString().split('T')[0];
    await store.set('ad_perf_sync:' + dateStr, JSON.stringify({
      fetchedAt: snapshot.fetchedAt,
      adCount: snapshot.adRows.length,
      adsetCount: snapshot.adsetRows.length,
      campaignCount: snapshot.campaignRows.length,
      errors: snapshot.errors,
      fatiguedAds: fatiguedCount
    }), 86400);

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      ads: snapshot.adRows.length,
      adsets: snapshot.adsetRows.length,
      campaigns: snapshot.campaignRows.length,
      errors: snapshot.errors,
      fatiguedAds: fatiguedCount,
      lookbackDays: snapshot.lookbackDays,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[AdPerfSync] Error:', err.message);
    await store.del('cron:lock:ad-performance-sync');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
