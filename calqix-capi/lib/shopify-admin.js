/**
 * Centralized Shopify Admin API client.
 *
 * Single entry point for all Shopify Admin REST and GraphQL calls.
 * Reads SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, SHOPIFY_API_SECRET from env.
 *
 * Token lifecycle (self-healing):
 *   1. In-memory cache per serverless instance.
 *   2. Falls back to Redis key `shopify:admin_token` (shared across instances).
 *   3. Falls back to SHOPIFY_ADMIN_ACCESS_TOKEN env var (bootstrap only).
 *   4. On 401 or cold boot without any token, mints a fresh token via OAuth
 *      `client_credentials` grant against /admin/oauth/access_token using
 *      SHOPIFY_API_KEY + SHOPIFY_API_SECRET, then persists to Redis.
 *
 * This means the system auto-recovers from any token invalidation event
 * (app reinstall, scope change, manual revoke) without operator action,
 * as long as API_KEY + API_SECRET remain valid.
 *
 * Handles 429 rate limiting with automatic retry.
 *
 * Usage:
 *   var shopify = require('./shopify-admin');
 *   var data = await shopify.graphql('{ shop { name } }');
 *   var products = await shopify.rest('products.json?limit=5');
 */
var fetch = require('node-fetch');
var store = require('./store');

var API_VERSION = '2024-10';
var REDIS_TOKEN_KEY = 'shopify:admin_token';

var cachedToken = null;        // in-memory cache per instance
var refreshInFlight = null;    // shared Promise to coalesce concurrent refreshes

function getConfig() {
  return {
    store: (process.env.SHOPIFY_STORE_DOMAIN || '').trim(),
    apiKey: (process.env.SHOPIFY_API_KEY || '').trim(),
    apiSecret: (process.env.SHOPIFY_API_SECRET || '').trim(),
    envToken: (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim()
  };
}

/**
 * Resolve the current Shopify Admin access token.
 * Order: in-memory cache → Redis → env var → mint fresh.
 * @returns {Promise<string>}
 */
async function getToken() {
  if (cachedToken) return cachedToken;

  try {
    var fromRedis = await store.get(REDIS_TOKEN_KEY);
    if (fromRedis && typeof fromRedis === 'string' && fromRedis.indexOf('shpat_') === 0) {
      cachedToken = fromRedis;
      return fromRedis;
    }
  } catch (e) { /* Redis unavailable — fall through */ }

  var cfg = getConfig();
  if (cfg.envToken && cfg.envToken.indexOf('shpat_') === 0) {
    cachedToken = cfg.envToken;
    // Persist env bootstrap token to Redis so peers converge.
    try { await store.set(REDIS_TOKEN_KEY, cfg.envToken); } catch (e) { /* non-fatal */ }
    return cfg.envToken;
  }

  return refreshToken();
}

/**
 * Mint a fresh Shopify Admin access token via OAuth client_credentials grant.
 * Writes through to in-memory cache and Redis. Concurrent callers coalesce
 * onto a single in-flight refresh via `refreshInFlight`.
 * @returns {Promise<string>}
 */
async function refreshToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async function () {
    var cfg = getConfig();
    if (!cfg.store || !cfg.apiKey || !cfg.apiSecret) {
      throw new Error(
        '[ShopifyAdmin] Cannot mint token — SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, or SHOPIFY_API_SECRET missing'
      );
    }

    console.log('[ShopifyAdmin] Minting fresh access token via OAuth client_credentials');
    var url = 'https://' + cfg.store + '/admin/oauth/access_token';
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: cfg.apiKey,
        client_secret: cfg.apiSecret
      })
    });

    if (!response.ok) {
      var text = await response.text();
      throw new Error(
        '[ShopifyAdmin] Token mint failed: HTTP ' + response.status + ' — ' + text.substring(0, 200)
      );
    }

    var data = await response.json();
    if (!data || !data.access_token) {
      throw new Error('[ShopifyAdmin] Token mint response missing access_token');
    }

    cachedToken = data.access_token;
    try {
      await store.set(REDIS_TOKEN_KEY, data.access_token);
    } catch (e) {
      console.warn('[ShopifyAdmin] Failed to persist token to Redis:', e.message);
    }
    console.log('[ShopifyAdmin] Token refreshed — ' + data.access_token.slice(0, 10) + '***');
    return data.access_token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Invalidate the cached token. Next call refreshes.
 */
function invalidateToken() {
  cachedToken = null;
}

/**
 * Execute a Shopify Admin GraphQL query or mutation.
 * Auto-refreshes the access token on 401 and retries once.
 * @param {string} query - GraphQL query string
 * @param {object} [variables] - GraphQL variables
 * @param {boolean} [_retried] - internal flag to prevent infinite 401 loops
 * @returns {Promise<object>} - data field from response
 */
async function graphql(query, variables, _retried) {
  var cfg = getConfig();
  if (!cfg.store) {
    throw new Error('[ShopifyAdmin] SHOPIFY_STORE_DOMAIN ontbreekt');
  }

  var token = await getToken();
  var url = 'https://' + cfg.store + '/admin/api/' + API_VERSION + '/graphql.json';
  var body = { query: query };
  if (variables && Object.keys(variables).length > 0) {
    body.variables = variables;
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify(body)
  });

  if (response.status === 401 && !_retried) {
    console.warn('[ShopifyAdmin] 401 on GraphQL — invalidating cache and retrying with fresh token');
    invalidateToken();
    try { await store.del(REDIS_TOKEN_KEY); } catch (e) { /* non-fatal */ }
    await refreshToken();
    return graphql(query, variables, true);
  }

  if (response.status === 429) {
    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
    console.warn('[ShopifyAdmin] Rate limited, wacht ' + retryAfter + 's');
    await new Promise(function (r) { setTimeout(r, retryAfter * 1000); });
    return graphql(query, variables, _retried);
  }

  var data = await response.json();

  if (data.errors) {
    console.error('[ShopifyAdmin] GraphQL errors:', JSON.stringify(data.errors));
    var msg = data.errors[0] ? data.errors[0].message : 'Unknown GraphQL error';
    throw new Error('[ShopifyAdmin] ' + msg);
  }

  return data.data;
}

/**
 * Execute a Shopify Admin REST API call.
 * Auto-refreshes the access token on 401 and retries once.
 * @param {string} endpoint - e.g. 'products.json?limit=5'
 * @param {string} [method] - HTTP method (default: GET)
 * @param {object} [body] - request body for POST/PUT
 * @param {boolean} [_retried] - internal flag to prevent infinite 401 loops
 * @returns {Promise<object>} - parsed JSON response
 */
async function rest(endpoint, method, body, _retried) {
  var cfg = getConfig();
  if (!cfg.store) {
    throw new Error('[ShopifyAdmin] SHOPIFY_STORE_DOMAIN ontbreekt');
  }

  var token = await getToken();
  method = method || 'GET';
  var url = 'https://' + cfg.store + '/admin/api/' + API_VERSION + '/' + endpoint;

  var options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  var response = await fetch(url, options);

  if (response.status === 401 && !_retried) {
    console.warn('[ShopifyAdmin] 401 on REST — invalidating cache and retrying with fresh token');
    invalidateToken();
    try { await store.del(REDIS_TOKEN_KEY); } catch (e) { /* non-fatal */ }
    await refreshToken();
    return rest(endpoint, method, body, true);
  }

  if (response.status === 429) {
    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
    console.warn('[ShopifyAdmin] Rate limited, wacht ' + retryAfter + 's');
    await new Promise(function (r) { setTimeout(r, retryAfter * 1000); });
    return rest(endpoint, method, body, _retried);
  }

  return response.json();
}

module.exports = {
  graphql: graphql,
  rest: rest,
  getToken: getToken,
  refreshToken: refreshToken,
  invalidateToken: invalidateToken,
  API_VERSION: API_VERSION
};
