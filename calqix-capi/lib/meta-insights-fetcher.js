/**
 * Meta Insights Fetcher — normalized insights fetcher for ad optimization.
 *
 * Wraps meta-api-client.js with caching and storage in Redis.
 * Provides normalized snapshots for the rules engine.
 *
 * Redis keys:
 *   ad_performance:{date}:{level} → JSON  TTL 24h
 */
var metaApi = require('./meta-api-client');
var store = require('./store');

var TTL_CACHE = 3600; // 1 hour cache for insights
var TTL_DAILY = 24 * 3600;

var LOOKBACK_DAYS = parseInt(process.env.ADS_OPTIMIZATION_LOOKBACK_DAYS || '3', 10);

function today() { return new Date().toISOString().split('T')[0]; }

function daysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

/**
 * Fetch and store ad-level performance data.
 * @param {string} [since] - defaults to LOOKBACK_DAYS ago
 * @param {string} [until] - defaults to today
 * @returns {Promise<{ok: boolean, rows: Array, error: string|null}>}
 */
async function fetchAdPerformance(since, until) {
  var s = since || daysAgo(LOOKBACK_DAYS - 1);
  var u = until || today();
  var cacheKey = 'ad_performance:' + u + ':ad';

  // Check cache
  var cached = await getJSON(cacheKey);
  if (cached && cached._cachedAt) {
    var age = Date.now() - new Date(cached._cachedAt).getTime();
    if (age < TTL_CACHE * 1000) {
      return { ok: true, rows: cached.rows, error: null, cached: true };
    }
  }

  var result = await metaApi.fetchInsights('ad', s, u);
  if (result.ok) {
    await setJSON(cacheKey, { rows: result.rows, _cachedAt: new Date().toISOString() }, TTL_DAILY);
  }
  return { ok: result.ok, rows: result.rows || [], error: result.error || null, cached: false };
}

/**
 * Fetch and store adset-level performance data.
 */
async function fetchAdsetPerformance(since, until) {
  var s = since || daysAgo(LOOKBACK_DAYS - 1);
  var u = until || today();
  var cacheKey = 'ad_performance:' + u + ':adset';

  var cached = await getJSON(cacheKey);
  if (cached && cached._cachedAt) {
    var age = Date.now() - new Date(cached._cachedAt).getTime();
    if (age < TTL_CACHE * 1000) {
      return { ok: true, rows: cached.rows, error: null, cached: true };
    }
  }

  var result = await metaApi.fetchInsights('adset', s, u);
  if (result.ok) {
    await setJSON(cacheKey, { rows: result.rows, _cachedAt: new Date().toISOString() }, TTL_DAILY);
  }
  return { ok: result.ok, rows: result.rows || [], error: result.error || null, cached: false };
}

/**
 * Fetch and store campaign-level performance data.
 */
async function fetchCampaignPerformance(since, until) {
  var s = since || daysAgo(LOOKBACK_DAYS - 1);
  var u = until || today();
  var cacheKey = 'ad_performance:' + u + ':campaign';

  var cached = await getJSON(cacheKey);
  if (cached && cached._cachedAt) {
    var age = Date.now() - new Date(cached._cachedAt).getTime();
    if (age < TTL_CACHE * 1000) {
      return { ok: true, rows: cached.rows, error: null, cached: true };
    }
  }

  var result = await metaApi.fetchInsights('campaign', s, u);
  if (result.ok) {
    await setJSON(cacheKey, { rows: result.rows, _cachedAt: new Date().toISOString() }, TTL_DAILY);
  }
  return { ok: result.ok, rows: result.rows || [], error: result.error || null, cached: false };
}

/**
 * Fetch today-only performance for real-time checks.
 */
async function fetchTodayPerformance(level) {
  var t = today();
  return metaApi.fetchInsights(level || 'ad', t, t);
}

/**
 * Fetch full ad optimization snapshot (all levels + config).
 * @returns {Promise<object>}
 */
async function fetchOptimizationSnapshot() {
  var errors = [];

  var results = await Promise.all([
    fetchAdPerformance(),
    fetchAdsetPerformance(),
    fetchCampaignPerformance(),
    metaApi.fetchAdsets(['ACTIVE', 'LEARNING', 'LEARNING_LIMITED']),
    metaApi.fetchCampaigns(['ACTIVE']),
    metaApi.fetchAccountInfo(),
    fetchTodayPerformance('ad'),
    fetchTodayPerformance('adset')
  ]);

  if (!results[0].ok) errors.push('ad_performance: ' + results[0].error);
  if (!results[1].ok) errors.push('adset_performance: ' + results[1].error);
  if (!results[2].ok) errors.push('campaign_performance: ' + results[2].error);
  if (!results[3].ok) errors.push('adsets_config: ' + (results[3].error || 'failed'));
  if (!results[4].ok) errors.push('campaigns_config: ' + (results[4].error || 'failed'));
  if (!results[5].ok) errors.push('account_info: ' + (results[5].error || 'failed'));

  return {
    adRows: results[0].rows || [],
    adsetRows: results[1].rows || [],
    campaignRows: results[2].rows || [],
    adsetConfigs: results[3].ok ? (results[3].data || []) : [],
    campaignConfigs: results[4].ok ? (results[4].data || []) : [],
    accountInfo: results[5].ok ? results[5].data : null,
    todayAdRows: results[6].ok ? (results[6].rows || []) : [],
    todayAdsetRows: results[7].ok ? (results[7].rows || []) : [],
    errors: errors,
    fetchedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS
  };
}

module.exports = {
  fetchAdPerformance: fetchAdPerformance,
  fetchAdsetPerformance: fetchAdsetPerformance,
  fetchCampaignPerformance: fetchCampaignPerformance,
  fetchTodayPerformance: fetchTodayPerformance,
  fetchOptimizationSnapshot: fetchOptimizationSnapshot,
  LOOKBACK_DAYS: LOOKBACK_DAYS
};
