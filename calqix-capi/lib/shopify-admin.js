/**
 * Centralized Shopify Admin API client.
 *
 * Single entry point for all Shopify Admin REST and GraphQL calls.
 * Reads SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN from env.
 * Handles rate limiting (429) with automatic retry.
 *
 * Usage:
 *   var shopify = require('./shopify-admin');
 *   var data = await shopify.graphql('{ shop { name } }');
 *   var products = await shopify.rest('products.json?limit=5');
 */
var fetch = require('node-fetch');

var API_VERSION = '2024-10';

function getConfig() {
  var store = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  var token = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  return { store: store, token: token };
}

/**
 * Execute a Shopify Admin GraphQL query or mutation.
 * @param {string} query - GraphQL query string
 * @param {object} [variables] - GraphQL variables
 * @returns {Promise<object>} - data field from response
 */
async function graphql(query, variables) {
  var cfg = getConfig();
  if (!cfg.store || !cfg.token) {
    throw new Error('[ShopifyAdmin] SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreekt');
  }

  var url = 'https://' + cfg.store + '/admin/api/' + API_VERSION + '/graphql.json';
  var body = { query: query };
  if (variables && Object.keys(variables).length > 0) {
    body.variables = variables;
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': cfg.token
    },
    body: JSON.stringify(body)
  });

  if (response.status === 429) {
    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
    console.warn('[ShopifyAdmin] Rate limited, wacht ' + retryAfter + 's');
    await new Promise(function (r) { setTimeout(r, retryAfter * 1000); });
    return graphql(query, variables);
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
 * @param {string} endpoint - e.g. 'products.json?limit=5'
 * @param {string} [method] - HTTP method (default: GET)
 * @param {object} [body] - request body for POST/PUT
 * @returns {Promise<object>} - parsed JSON response
 */
async function rest(endpoint, method, body) {
  var cfg = getConfig();
  if (!cfg.store || !cfg.token) {
    throw new Error('[ShopifyAdmin] SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreekt');
  }

  method = method || 'GET';
  var url = 'https://' + cfg.store + '/admin/api/' + API_VERSION + '/' + endpoint;

  var options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': cfg.token
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  var response = await fetch(url, options);

  if (response.status === 429) {
    var retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
    console.warn('[ShopifyAdmin] Rate limited, wacht ' + retryAfter + 's');
    await new Promise(function (r) { setTimeout(r, retryAfter * 1000); });
    return rest(endpoint, method, body);
  }

  return response.json();
}

module.exports = {
  graphql: graphql,
  rest: rest,
  API_VERSION: API_VERSION
};
