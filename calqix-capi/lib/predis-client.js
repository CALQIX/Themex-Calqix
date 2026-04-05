/**
 * Predis Client — provider abstraction for content generation.
 *
 * Provider A: Predis.ai
 * Provider B: (future) fallback renderer or alternative service
 *
 * Supports:
 *   - Submit generation jobs
 *   - Poll for results
 *   - Retry on failure
 *   - Draft-only mode
 *
 * Env vars:
 *   PREDIS_API_KEY     — API key for Predis.ai
 *   PREDIS_BASE_URL    — Base URL (default: https://api.predis.ai)
 *   PREDIS_PROVIDER    — 'predis' (default) or future providers
 *   CONTENT_ENABLE_PREDIS — 'true' to enable actual API calls
 */
var fetch = require('node-fetch');
var store = require('./store');

var PREDIS_API_KEY = function () { return process.env.PREDIS_API_KEY || ''; };
var PREDIS_BASE_URL = function () { return process.env.PREDIS_BASE_URL || 'https://brain.predis.ai'; };
var PROVIDER = function () { return process.env.PREDIS_PROVIDER || 'predis'; };
var ENABLED = function () { return process.env.CONTENT_ENABLE_PREDIS === 'true'; };

var MAX_POLL_ATTEMPTS = 20;
var POLL_INTERVAL_MS = 15000; // 15 seconds

/**
 * Submit a generation job to the configured provider.
 * @param {object} payload - Provider-specific payload
 * @returns {Promise<{ok: boolean, jobId: string|null, error: string|null, draftOnly: boolean}>}
 */
async function submitJob(payload) {
  if (!ENABLED()) {
    console.log('[Predis] Generation disabled (CONTENT_ENABLE_PREDIS !== true). Draft-only mode.');
    var draftId = 'draft_' + Date.now().toString(36);
    return { ok: true, jobId: draftId, error: null, draftOnly: true, payload: payload };
  }

  var provider = PROVIDER();
  if (provider === 'predis') {
    return submitPredisJob(payload);
  }

  // Future provider hook
  console.warn('[Predis] Unknown provider:', provider);
  return { ok: false, jobId: null, error: 'Unknown provider: ' + provider, draftOnly: false };
}

/**
 * Submit job to Predis.ai API.
 */
async function submitPredisJob(payload) {
  var apiKey = PREDIS_API_KEY();
  if (!apiKey) {
    return { ok: false, jobId: null, error: 'PREDIS_API_KEY not set', draftOnly: false };
  }

  var brandId = process.env.PREDIS_BRAND_ID || '';
  var url = PREDIS_BASE_URL() + '/predis_api/v1/create_content/';

  // Build Predis-specific body
  var predisBody = {
    brand_id: brandId,
    text: payload.text || payload.product_description || '',
    media_type: payload._meta && payload._meta.mediaType ? payload._meta.mediaType : 'single_image',
    model_version: '4',
    input_language: payload.input_language || 'english',
    output_language: payload.output_language || 'dutch'
  };

  // Add product images if provided (Predis uses these instead of stock photos)
  if (payload.media_urls && Array.isArray(payload.media_urls) && payload.media_urls.length > 0) {
    predisBody.media_urls = JSON.stringify(payload.media_urls.slice(0, 3));
  }

  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify(predisBody)
    });

    var data = await res.json();

    if (!res.ok || data.error) {
      console.error('[Predis] Submit failed:', data.error || res.statusText);
      return { ok: false, jobId: null, error: data.error || res.statusText, draftOnly: false };
    }

    var jobId = null;
    if (data.post_ids && Array.isArray(data.post_ids) && data.post_ids.length > 0) {
      jobId = data.post_ids[0];
    } else {
      jobId = data.id || data.job_id || data.postId || null;
    }
    var postStatus = data.post_status || 'unknown';
    console.log('[Predis] Job submitted:', jobId, 'status:', postStatus);
    return { ok: true, jobId: jobId, error: null, draftOnly: false, postStatus: postStatus };
  } catch (err) {
    console.error('[Predis] Submit exception:', err.message);
    return { ok: false, jobId: null, error: err.message, draftOnly: false };
  }
}

/**
 * Check job status — first checks Redis for webhook result, then falls back to get_posts API.
 * @param {string} jobId
 * @returns {Promise<{ok: boolean, status: string, assets: Array|null, caption: string|null, error: string|null}>}
 */
async function pollJob(jobId) {
  if (!ENABLED() || (jobId && jobId.startsWith('draft_'))) {
    return { ok: true, status: 'draft_only', assets: null, caption: null, error: null };
  }

  // 1. Check webhook result in Redis (fastest — Predis pushes here)
  try {
    var webhookRaw = await store.get('predis:webhook:' + jobId);
    if (webhookRaw) {
      var wh = typeof webhookRaw === 'string' ? JSON.parse(webhookRaw) : webhookRaw;
      if (wh.status === 'completed') {
        var whAssets = (wh.generatedMedia || []).map(function (m, i) {
          return { index: i, url: m.url || null, type: 'image', metadata: m };
        });
        return { ok: true, status: 'completed', assets: whAssets, caption: wh.caption || null, error: null };
      }
      if (wh.status === 'error') {
        return { ok: false, status: 'failed', assets: null, caption: null, error: 'Predis generation failed' };
      }
    }
  } catch (e) {
    console.warn('[Predis] Webhook check error:', e.message);
  }

  // 2. Fallback: query get_posts API to find this post
  var apiKey = PREDIS_API_KEY();
  if (!apiKey) return { ok: false, status: 'error', assets: null, caption: null, error: 'PREDIS_API_KEY not set' };

  var brandId = process.env.PREDIS_BRAND_ID || '';
  var url = PREDIS_BASE_URL() + '/predis_api/v1/get_posts/?brand_id=' + brandId + '&items_n=20&page_n=1';

  try {
    var res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': apiKey }
    });
    var data = await res.json();
    var posts = data.posts || [];

    for (var i = 0; i < posts.length; i++) {
      if (posts[i].post_id === jobId) {
        var post = posts[i];
        var postAssets = (post.urls || []).map(function (u, idx) {
          return { index: idx, url: u, type: 'image', metadata: null };
        });
        return { ok: true, status: 'completed', assets: postAssets, caption: post.caption || null, error: null };
      }
    }

    // Post not found in get_posts — still processing
    return { ok: true, status: 'processing', assets: null, caption: null, error: null };
  } catch (err) {
    console.warn('[Predis] get_posts fallback error:', err.message);
    return { ok: true, status: 'processing', assets: null, caption: null, error: null };
  }
}

/**
 * Extract asset URLs and metadata from Predis response.
 */
function extractAssets(data) {
  var assets = [];
  var outputs = data.outputs || data.images || data.media || [];
  if (!Array.isArray(outputs)) outputs = [outputs];

  outputs.forEach(function (output, idx) {
    assets.push({
      index: idx,
      url: output.url || output.image_url || output.media_url || null,
      type: output.type || output.media_type || 'image',
      width: output.width || null,
      height: output.height || null,
      metadata: output
    });
  });

  return assets;
}

/**
 * Get provider status and configuration.
 */
function getProviderStatus() {
  return {
    provider: PROVIDER(),
    enabled: ENABLED(),
    hasApiKey: Boolean(PREDIS_API_KEY()),
    baseUrl: PREDIS_BASE_URL()
  };
}

module.exports = {
  submitJob: submitJob,
  pollJob: pollJob,
  getProviderStatus: getProviderStatus,
  extractAssets: extractAssets
};
