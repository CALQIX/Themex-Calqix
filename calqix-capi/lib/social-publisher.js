/**
 * Social Publisher - publish content directly to Facebook Page and Instagram Business.
 *
 * Uses Meta Graph API v21.0.
 * Requires env vars:
 *   FACEBOOK_PAGE_ID         - The CALQIX Facebook Page ID
 *   INSTAGRAM_ACCOUNT_ID     - The IG Business account ID linked to the Page
 *   META_ACCESS_TOKEN         - Token with pages_manage_posts + instagram_content_publish
 *
 * If FACEBOOK_PAGE_ID or INSTAGRAM_ACCOUNT_ID are not set, publishing to that platform is disabled.
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');

var API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
var BASE = 'https://graph.facebook.com/' + API_VERSION;

function getPageId() { return process.env.FACEBOOK_PAGE_ID || ''; }
function getIgAccountId() { return process.env.INSTAGRAM_ACCOUNT_ID || ''; }
function getToken() { return process.env.META_ACCESS_TOKEN || ''; }

/**
 * Check which social platforms are configured.
 */
function getEnabledPlatforms() {
  return {
    facebook: Boolean(getPageId()),
    instagram: Boolean(getIgAccountId()),
    any: Boolean(getPageId() || getIgAccountId())
  };
}

/**
 * Publish a photo post to Facebook Page.
 * POST /{page_id}/photos
 */
async function publishToFacebook(imageUrl, caption) {
  var pageId = getPageId();
  if (!pageId) return { ok: false, error: 'FACEBOOK_PAGE_ID not configured' };

  try {
    var res = await fetch(BASE + '/' + pageId + '/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        message: caption,
        access_token: getToken()
      })
    });

    var data = await res.json();
    if (data.error) {
      return { ok: false, error: 'FB publish failed: ' + data.error.message };
    }

    return { ok: true, platform: 'facebook', post_id: data.id || data.post_id };
  } catch (err) {
    return { ok: false, error: 'FB publish error: ' + err.message };
  }
}

/**
 * Publish a photo to Instagram Business account.
 * Step 1: Create media container (POST /{ig_account_id}/media)
 * Step 2: Wait for processing
 * Step 3: Publish container (POST /{ig_account_id}/media_publish)
 */
async function publishToInstagram(imageUrl, caption) {
  var igId = getIgAccountId();
  if (!igId) return { ok: false, error: 'INSTAGRAM_ACCOUNT_ID not configured' };

  try {
    // Step 1: Create media container
    var containerRes = await fetch(BASE + '/' + igId + '/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption,
        access_token: getToken()
      })
    });

    var container = await containerRes.json();
    if (container.error) {
      return { ok: false, error: 'IG container failed: ' + container.error.message };
    }

    if (!container.id) {
      return { ok: false, error: 'IG container: no ID returned' };
    }

    // Step 2: Wait for container processing
    await new Promise(function (r) { setTimeout(r, 5000); });

    // Step 3: Publish
    var publishRes = await fetch(BASE + '/' + igId + '/media_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: getToken()
      })
    });

    var published = await publishRes.json();
    if (published.error) {
      return { ok: false, error: 'IG publish failed: ' + published.error.message };
    }

    return { ok: true, platform: 'instagram', post_id: published.id };
  } catch (err) {
    return { ok: false, error: 'IG publish error: ' + err.message };
  }
}

/**
 * Publish to all configured platforms (or specific targets).
 * @param {string} imageUrl
 * @param {string} caption
 * @param {string} [target] - 'facebook' | 'instagram' | 'both'
 */
async function publishToSocial(imageUrl, caption, target) {
  var results = [];
  var errors = [];
  var doFb = target === 'facebook' || target === 'both';
  var doIg = target === 'instagram' || target === 'both';

  if (doFb && getPageId()) {
    var fb = await publishToFacebook(imageUrl, caption);
    if (fb.ok) results.push(fb);
    else errors.push({ platform: 'facebook', error: fb.error });
  }

  if (doIg && getIgAccountId()) {
    var ig = await publishToInstagram(imageUrl, caption);
    if (ig.ok) results.push(ig);
    else errors.push({ platform: 'instagram', error: ig.error });
  }

  return { results: results, errors: errors };
}

/**
 * Log a publish action to Redis.
 */
async function logPublish(postId, target, results, errors) {
  try {
    var entry = {
      post_id: postId,
      target: target,
      results: results,
      errors: errors,
      published_at: dates.formatDateTimeAmsterdam(new Date())
    };
    var dateStr = dates.todayKey();
    var key = 'social:published:' + dateStr;
    var raw = await store.get(key);
    var list = [];
    if (raw) try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { list = []; }
    list.push(entry);
    await store.set(key, JSON.stringify(list), 30 * 86400);
  } catch (e) {
    console.warn('[SocialPublisher] Log error:', e.message);
  }
}

/**
 * Check if a Predis image URL is likely expired (>45 min since generation).
 */
function isImageLikelyExpired(generatedAt) {
  if (!generatedAt) return true;
  var genTime = new Date(generatedAt).getTime();
  var now = Date.now();
  var minutesElapsed = (now - genTime) / 60000;
  return minutesElapsed > 45;
}

/**
 * Check META_ACCESS_TOKEN permissions for social publishing.
 */
async function checkPermissions() {
  var token = getToken();
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set', permissions: [] };

  try {
    var res = await fetch(BASE + '/me/permissions?access_token=' + token);
    var data = await res.json();
    if (data.error) return { ok: false, error: data.error.message, permissions: [] };

    var granted = (data.data || [])
      .filter(function (p) { return p.status === 'granted'; })
      .map(function (p) { return p.permission; });

    var required = ['pages_manage_posts', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
    var missing = required.filter(function (p) { return granted.indexOf(p) === -1; });

    return {
      ok: missing.length === 0,
      granted: granted,
      missing: missing,
      error: missing.length > 0 ? 'Missing permissions: ' + missing.join(', ') : null
    };
  } catch (err) {
    return { ok: false, error: err.message, permissions: [] };
  }
}

/**
 * Auto-fetch FACEBOOK_PAGE_ID from the token.
 */
async function fetchPageId() {
  var token = getToken();
  if (!token) return { ok: false, error: 'No token' };

  try {
    var res = await fetch(BASE + '/me/accounts?fields=id,name,access_token&access_token=' + token);
    var data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    var pages = data.data || [];
    return { ok: true, pages: pages.map(function (p) { return { id: p.id, name: p.name }; }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Auto-fetch INSTAGRAM_ACCOUNT_ID from a Facebook Page ID.
 */
async function fetchInstagramId(pageId) {
  var token = getToken();
  if (!token) return { ok: false, error: 'No token' };

  try {
    var res = await fetch(BASE + '/' + pageId + '?fields=instagram_business_account&access_token=' + token);
    var data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    var igAccount = data.instagram_business_account;
    if (!igAccount || !igAccount.id) return { ok: false, error: 'No Instagram Business account linked to this Page' };
    return { ok: true, id: igAccount.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getEnabledPlatforms: getEnabledPlatforms,
  publishToFacebook: publishToFacebook,
  publishToInstagram: publishToInstagram,
  publishToSocial: publishToSocial,
  logPublish: logPublish,
  isImageLikelyExpired: isImageLikelyExpired,
  checkPermissions: checkPermissions,
  fetchPageId: fetchPageId,
  fetchInstagramId: fetchInstagramId
};
