/**
 * Google OAuth 2.0 — token management for Google Ads API.
 *
 * Stores refresh token in Redis. Auto-refreshes access tokens.
 * Separate Web and Desktop client support.
 *
 * Env vars:
 *   GOOGLE_OAUTH_CLIENT_ID       — Web OAuth client ID
 *   GOOGLE_OAUTH_CLIENT_SECRET   — Web OAuth client secret
 *   GOOGLE_OAUTH_REDIRECT_URI    — Stable callback URL (production only)
 *   GOOGLE_OAUTH_DESKTOP_CLIENT_ID     — Desktop OAuth client ID (optional)
 *   GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET — Desktop OAuth client secret (optional)
 *
 * Redis keys:
 *   google:oauth:refresh_token   — encrypted refresh token (no TTL)
 *   google:oauth:access_token    — cached access token (50 min TTL)
 *   google:oauth:token_meta      — JSON metadata (scopes, obtained_at, etc.)
 */
var store = require('./store');
var rlFetch = require('./rate-limited-fetch');

var GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
var GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
var REDIS_REFRESH_KEY = 'google:oauth:refresh_token';
var REDIS_ACCESS_KEY = 'google:oauth:access_token';
var REDIS_META_KEY = 'google:oauth:token_meta';
var ACCESS_TOKEN_TTL = 50 * 60; // 50 minutes (tokens valid 60 min)

var SCOPES = [
  'https://www.googleapis.com/auth/adwords'
];

function getClientId() { return process.env.GOOGLE_OAUTH_CLIENT_ID || ''; }
function getClientSecret() { return process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''; }
function getRedirectUri() { return process.env.GOOGLE_OAUTH_REDIRECT_URI || ''; }

/**
 * Build the Google OAuth authorization URL for the consent screen.
 * @param {object} [opts]
 * @param {string} [opts.state] — CSRF state parameter
 * @param {boolean} [opts.forceConsent] — force consent screen even if already authorized
 * @returns {string} authorization URL
 */
function buildAuthUrl(opts) {
  opts = opts || {};
  var clientId = getClientId();
  var redirectUri = getRedirectUri();

  if (!clientId || !redirectUri) {
    throw new Error('[GoogleOAuth] GOOGLE_OAUTH_CLIENT_ID of GOOGLE_OAUTH_REDIRECT_URI ontbreekt');
  }

  // Guard: prevent preview URLs from being used as callback
  if (redirectUri.includes('--') && redirectUri.includes('.vercel.app')) {
    throw new Error('[GoogleOAuth] Preview deployment URL gedetecteerd als redirect_uri. Gebruik een stabiel productie-domein.');
  }

  var params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: opts.forceConsent ? 'consent' : 'consent',
    include_granted_scopes: 'true'
  });

  if (opts.state) params.set('state', opts.state);

  return GOOGLE_AUTH_URL + '?' + params.toString();
}

/**
 * Exchange authorization code for tokens.
 * Stores refresh token in Redis.
 *
 * @param {string} code — authorization code from callback
 * @returns {Promise<{ok: boolean, error: string|null, hasRefreshToken: boolean}>}
 */
async function exchangeCode(code) {
  var clientId = getClientId();
  var clientSecret = getClientSecret();
  var redirectUri = getRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false, error: 'OAuth configuratie incompleet', hasRefreshToken: false };
  }

  var body = new URLSearchParams({
    code: code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  var result = await rlFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    label: 'GoogleOAuth-Exchange',
    maxRetries: 1,
    timeout: 15000
  });

  if (!result.ok) {
    var errBody = '';
    try { errBody = typeof result.body === 'string' ? result.body : JSON.stringify(result.body); } catch (e) {}
    console.error('[GoogleOAuth] Token exchange mislukt:', result.status, errBody);
    return { ok: false, error: 'token_exchange_failed: ' + result.status, hasRefreshToken: false };
  }

  var tokens = result.body;
  if (typeof tokens === 'string') {
    try { tokens = JSON.parse(tokens); } catch (e) {
      return { ok: false, error: 'invalid_response', hasRefreshToken: false };
    }
  }

  // Store access token with TTL
  if (tokens.access_token) {
    await store.set(REDIS_ACCESS_KEY, tokens.access_token, ACCESS_TOKEN_TTL);
  }

  // Store refresh token permanently (no TTL)
  var hasRefresh = Boolean(tokens.refresh_token);
  if (hasRefresh) {
    var redis = store._getRedis();
    if (redis) {
      await redis.set(REDIS_REFRESH_KEY, tokens.refresh_token);
    }
  }

  // Store metadata
  var meta = {
    obtained_at: new Date().toISOString(),
    scopes: tokens.scope || SCOPES.join(' '),
    has_refresh_token: hasRefresh,
    token_type: tokens.token_type || 'Bearer',
    expires_in: tokens.expires_in || 3600
  };
  await store.set(REDIS_META_KEY, JSON.stringify(meta));

  console.log('[GoogleOAuth] Tokens opgeslagen:', {
    hasAccessToken: Boolean(tokens.access_token),
    hasRefreshToken: hasRefresh,
    scopes: meta.scopes
  });

  return { ok: true, error: null, hasRefreshToken: hasRefresh };
}

/**
 * Get a valid access token. Auto-refreshes if expired.
 *
 * @returns {Promise<{token: string|null, error: string|null}>}
 */
async function getAccessToken() {
  // Try cached access token first
  var cached = await store.get(REDIS_ACCESS_KEY);
  if (cached) {
    return { token: cached, error: null };
  }

  // Need to refresh
  var redis = store._getRedis();
  if (!redis) {
    return { token: null, error: 'redis_unavailable' };
  }

  var refreshToken = await redis.get(REDIS_REFRESH_KEY);
  if (!refreshToken) {
    return { token: null, error: 'no_refresh_token — voer eerst OAuth consent flow uit via /api/google/oauth/start' };
  }

  var clientId = getClientId();
  var clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    return { token: null, error: 'oauth_config_missing' };
  }

  var body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  var result = await rlFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    label: 'GoogleOAuth-Refresh',
    maxRetries: 2,
    timeout: 15000
  });

  if (!result.ok) {
    console.error('[GoogleOAuth] Token refresh mislukt:', result.status);
    return { token: null, error: 'refresh_failed: ' + result.status };
  }

  var tokens = result.body;
  if (typeof tokens === 'string') {
    try { tokens = JSON.parse(tokens); } catch (e) {
      return { token: null, error: 'invalid_refresh_response' };
    }
  }

  if (!tokens.access_token) {
    return { token: null, error: 'no_access_token_in_response' };
  }

  // Cache the new access token
  await store.set(REDIS_ACCESS_KEY, tokens.access_token, ACCESS_TOKEN_TTL);

  // If Google issued a new refresh token (rare), store it
  if (tokens.refresh_token) {
    await redis.set(REDIS_REFRESH_KEY, tokens.refresh_token);
  }

  return { token: tokens.access_token, error: null };
}

/**
 * Check if OAuth is configured and has a refresh token.
 * Used by health endpoint.
 *
 * @returns {Promise<object>} health status
 */
async function getHealthStatus() {
  var status = {
    configured: Boolean(getClientId() && getClientSecret() && getRedirectUri()),
    redirect_uri: getRedirectUri() ? maskUri(getRedirectUri()) : null,
    has_refresh_token: false,
    has_access_token: false,
    token_meta: null,
    scopes: SCOPES,
    errors: []
  };

  // Check for preview URL
  var uri = getRedirectUri();
  if (uri && uri.includes('--') && uri.includes('.vercel.app')) {
    status.errors.push('redirect_uri lijkt een preview deployment URL te zijn');
  }

  if (!status.configured) {
    status.errors.push('OAuth credentials incompleet');
    return status;
  }

  try {
    var redis = store._getRedis();
    if (redis) {
      var refreshToken = await redis.get(REDIS_REFRESH_KEY);
      status.has_refresh_token = Boolean(refreshToken);
    }

    var accessToken = await store.get(REDIS_ACCESS_KEY);
    status.has_access_token = Boolean(accessToken);

    var metaStr = await store.get(REDIS_META_KEY);
    if (metaStr) {
      try { status.token_meta = JSON.parse(metaStr); } catch (e) {}
    }
  } catch (e) {
    status.errors.push('Redis check mislukt: ' + e.message);
  }

  if (!status.has_refresh_token) {
    status.errors.push('Geen refresh token — voer OAuth consent flow uit');
  }

  return status;
}

/**
 * Revoke the stored tokens (for cleanup/re-auth).
 */
async function revokeTokens() {
  var redis = store._getRedis();
  if (redis) {
    await redis.del(REDIS_REFRESH_KEY);
    await redis.del(REDIS_ACCESS_KEY);
    await redis.del(REDIS_META_KEY);
  }
  console.log('[GoogleOAuth] Tokens verwijderd');
}

function maskUri(uri) {
  if (!uri) return null;
  try {
    var u = new URL(uri);
    return u.protocol + '//' + u.host + u.pathname;
  } catch (e) { return '***'; }
}

module.exports = {
  buildAuthUrl: buildAuthUrl,
  exchangeCode: exchangeCode,
  getAccessToken: getAccessToken,
  getHealthStatus: getHealthStatus,
  revokeTokens: revokeTokens,
  SCOPES: SCOPES
};
