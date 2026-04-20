/**
 * Meta Marketing API helper module.
 *
 * Provides reusable functions for Marketing API calls with:
 * - Rate limit handling (code 17)
 * - Auth error handling (code 190)
 * - Permission error handling (code 10)
 * - No PII logging
 */
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const { META_API_VERSION } = require('./meta-capi');

dotenv.config();

var AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_2108393566376667';
var MAX_DAILY_BUDGET = parseInt(process.env.ADS_MAX_DAILY_BUDGET || '20000', 10); // 200 euro in centen
var MIN_DAILY_BUDGET = 500; // 5 euro in centen
var MAX_BUDGET_MULTIPLIER = 2; // budget kan max 2x verhoogd worden per keer

function getAccessToken() {
  return process.env.META_ACCESS_TOKEN || '';
}

function buildUrl(path, params) {
  var base = 'https://graph.facebook.com/' + META_API_VERSION + '/' + path;
  var queryParts = [];
  if (params) {
    Object.keys(params).forEach(function (key) {
      var val = params[key];
      if (val !== undefined && val !== null) {
        queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(
          typeof val === 'object' ? JSON.stringify(val) : String(val)
        ));
      }
    });
  }
  queryParts.push('access_token=' + getAccessToken());
  return base + '?' + queryParts.join('&');
}

/**
 * Make a GET request to the Meta Marketing API.
 * @param {string} path - API path (e.g. "act_123/insights")
 * @param {object} params - Query parameters
 * @returns {Promise<{ok: boolean, data: any, error: string|null, retryAfter: number|null}>}
 */
async function apiGet(path, params) {
  var url = buildUrl(path, params);
  try {
    var response = await fetch(url);
    var result = await response.json();

    if (result.error) {
      return handleApiError(result.error);
    }

    return { ok: true, data: result.data || result, error: null, retryAfter: null };
  } catch (err) {
    return { ok: false, data: null, error: err.message, retryAfter: null };
  }
}

/**
 * Make a POST request to the Meta Marketing API.
 * @param {string} path - API path (e.g. "123456")
 * @param {object} body - POST body
 * @returns {Promise<{ok: boolean, data: any, error: string|null, retryAfter: number|null}>}
 */
async function apiPost(path, body) {
  var base = 'https://graph.facebook.com/' + META_API_VERSION + '/' + path;
  var postBody = Object.assign({}, body || {}, { access_token: getAccessToken() });

  try {
    var response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    });
    var result = await response.json();

    if (result.error) {
      return handleApiError(result.error);
    }

    return { ok: true, data: result, error: null, retryAfter: null };
  } catch (err) {
    return { ok: false, data: null, error: err.message, retryAfter: null };
  }
}

function handleApiError(error) {
  var code = error.code;
  var msg = error.message || 'Unknown Meta API error';
  // Append detailed fields if available
  if (error.error_user_title) msg += ' | ' + error.error_user_title;
  if (error.error_user_msg) msg += ' | ' + error.error_user_msg;
  if (error.error_subcode) msg += ' [subcode: ' + error.error_subcode + ']';

  if (code === 17 || code === 32) {
    // Rate limit
    return {
      ok: false,
      data: null,
      error: 'Rate limit bereikt. Wacht 5-10 minuten en probeer opnieuw. (' + msg + ')',
      retryAfter: 300
    };
  }

  if (code === 190) {
    // Auth error
    return {
      ok: false,
      data: null,
      error: 'Access token is ongeldig of verlopen. Genereer een nieuwe token. (' + msg + ')',
      retryAfter: null
    };
  }

  if (code === 10 || code === 200) {
    // Permission error
    return {
      ok: false,
      data: null,
      error: 'Permissie geweigerd. Controleer of de token ads_read en ads_management scopes heeft. (' + msg + ')',
      retryAfter: null
    };
  }

  return {
    ok: false,
    data: null,
    error: '[Meta API Error ' + code + '] ' + msg,
    retryAfter: null
  };
}

/**
 * Authenticate a request with DIAGNOSTICS_KEY.
 * @param {object} req
 * @returns {boolean}
 */
function authDiagnostics(req) {
  var diagKey = process.env.DIAGNOSTICS_KEY;
  var providedKey =
    (req.query && req.query.key) ||
    (req.headers && req.headers['x-diagnostics-key']);
  return Boolean(diagKey && diagKey === providedKey);
}

/**
 * Authenticate a write action with both DIAGNOSTICS_KEY and ADS_ACTION_KEY.
 * @param {object} req
 * @returns {{ok: boolean, reason: string|null}}
 */
function authAction(req) {
  if (!authDiagnostics(req)) {
    return { ok: false, reason: 'Missing or invalid DIAGNOSTICS_KEY' };
  }

  var actionKey = process.env.ADS_ACTION_KEY;
  var body = req.body || {};
  var providedActionKey = body.action_key ||
    (req.headers && req.headers['x-ads-action-key']);

  if (!actionKey || actionKey !== providedActionKey) {
    return { ok: false, reason: 'Missing or invalid ADS_ACTION_KEY' };
  }

  return { ok: true, reason: null };
}

/**
 * Parse an action value from Meta's actions array.
 * SUMS all matching action types. Use this only when the supplied actionTypes
 * are mutually exclusive (ATC, IC, VC, etc.). For overlapping metrics like
 * Purchase — where Meta returns multiple rows for the same conversion
 * (`purchase`, `offsite_conversion.fb_pixel_purchase`, `omni_purchase`) —
 * use `pickActionValue` instead to avoid double-counting.
 * @param {Array} actions - Meta actions array
 * @param {string[]} actionTypes - Action type names to look for
 * @returns {number}
 */
function parseActionValue(actions, actionTypes) {
  if (!Array.isArray(actions)) return 0;
  var total = 0;
  actions.forEach(function (a) {
    if (actionTypes.indexOf(a.action_type) !== -1) {
      total += parseFloat(a.value) || 0;
    }
  });
  return total;
}

/**
 * Pick a single action value from Meta's actions array using priority order.
 * Returns the value for the FIRST action type in `priorityTypes` that exists
 * in the actions array. Does NOT sum overlapping metrics.
 *
 * Use this for purchase counts / revenue where Meta returns multiple
 * representations of the same conversion:
 *   - `omni_purchase` (cross-surface rollup: web + app + offline, deduped)
 *   - `offsite_conversion.fb_pixel_purchase` (pixel/CAPI only)
 *   - `purchase` (legacy standard-event rollup)
 *
 * @param {Array} actions - Meta actions or action_values array
 * @param {string[]} priorityTypes - Action types in priority order
 * @returns {number}
 */
function pickActionValue(actions, priorityTypes) {
  if (!Array.isArray(actions) || !Array.isArray(priorityTypes)) return 0;
  for (var i = 0; i < priorityTypes.length; i++) {
    var target = priorityTypes[i];
    for (var j = 0; j < actions.length; j++) {
      if (actions[j].action_type === target) {
        return parseFloat(actions[j].value) || 0;
      }
    }
  }
  return 0;
}

/**
 * Parse cost per action from Meta's cost_per_action_type array.
 * @param {Array} costPerAction - Meta cost_per_action_type array
 * @param {string[]} actionTypes - Action type names to look for
 * @returns {number|null}
 */
function parseCostPerAction(costPerAction, actionTypes) {
  if (!Array.isArray(costPerAction)) return null;
  for (var i = 0; i < costPerAction.length; i++) {
    if (actionTypes.indexOf(costPerAction[i].action_type) !== -1) {
      return parseFloat(costPerAction[i].value) || null;
    }
  }
  return null;
}

module.exports = {
  AD_ACCOUNT_ID: AD_ACCOUNT_ID,
  MAX_DAILY_BUDGET: MAX_DAILY_BUDGET,
  MIN_DAILY_BUDGET: MIN_DAILY_BUDGET,
  MAX_BUDGET_MULTIPLIER: MAX_BUDGET_MULTIPLIER,
  apiGet: apiGet,
  apiPost: apiPost,
  authDiagnostics: authDiagnostics,
  authAction: authAction,
  parseActionValue: parseActionValue,
  pickActionValue: pickActionValue,
  parseCostPerAction: parseCostPerAction
};
