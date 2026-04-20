/**
 * Meta Marketing API Client — unified read/write layer.
 *
 * Extends existing meta-ads.js with:
 *   - Normalized internal schema for insights
 *   - Write operations (status change, budget adjust)
 *   - Pagination support
 *   - Rate limit handling
 *   - Dry-run mode
 *   - Execution logging
 *
 * Uses Graph API v21.0 by default (configurable via META_GRAPH_API_VERSION).
 */
var fetch = require('node-fetch');
var store = require('./store');

var API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
var BASE_URL = 'https://graph.facebook.com/' + API_VERSION;
var ACCESS_TOKEN = function () { return process.env.META_ACCESS_TOKEN || ''; };
var AD_ACCOUNT_ID = function () { return process.env.META_AD_ACCOUNT_ID || 'act_2108393566376667'; };
var DRY_RUN = process.env.ENABLE_AD_WRITES !== 'true';

var MAX_RETRIES = 2;
var RATE_LIMIT_WAIT_MS = 60000;

// --- Low-level request ---

async function graphRequest(method, path, params, body) {
  var url = BASE_URL + '/' + path;
  var token = ACCESS_TOKEN();
  if (!token) throw new Error('META_ACCESS_TOKEN not set');

  if (method === 'GET') {
    var qs = new URLSearchParams();
    qs.set('access_token', token);
    if (params) {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
    }
    url += '?' + qs.toString();
  }

  var opts = { method: method, headers: {} };
  if (method === 'POST' && body) {
    opts.headers['Content-Type'] = 'application/json';
    var postBody = Object.assign({}, body);
    postBody.access_token = token;
    opts.body = JSON.stringify(postBody);
  }

  for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      var res = await fetch(url, opts);
      var data = await res.json();

      // Rate limit
      if (res.status === 429 || (data.error && data.error.code === 32)) {
        console.warn('[MetaAPI] Rate limited, waiting...', { path: path, attempt: attempt });
        if (attempt < MAX_RETRIES) {
          await new Promise(function (r) { setTimeout(r, RATE_LIMIT_WAIT_MS); });
          continue;
        }
      }

      if (data.error) {
        return { ok: false, data: null, error: data.error.message || 'Unknown error', errorCode: data.error.code };
      }

      // Handle paginated responses
      if (Array.isArray(data.data)) {
        return { ok: true, data: data.data, paging: data.paging || null };
      }

      return { ok: true, data: data };
    } catch (err) {
      if (attempt < MAX_RETRIES) continue;
      return { ok: false, data: null, error: err.message };
    }
  }
  return { ok: false, data: null, error: 'Max retries exceeded' };
}

/**
 * Paginate through all results.
 */
async function graphRequestAll(path, params) {
  var allData = [];
  var result = await graphRequest('GET', path, params);
  if (!result.ok) return result;
  allData = allData.concat(result.data || []);

  var paging = result.paging;
  var pages = 0;
  while (paging && paging.next && pages < 10) {
    pages++;
    try {
      var res = await fetch(paging.next);
      var data = await res.json();
      if (data.error) break;
      if (Array.isArray(data.data)) allData = allData.concat(data.data);
      paging = data.paging || null;
    } catch (e) { break; }
  }

  return { ok: true, data: allData };
}

// --- READ: Insights ---

/**
 * Fetch insights at a given level.
 * @param {string} level - 'account' | 'campaign' | 'adset' | 'ad'
 * @param {string} since - YYYY-MM-DD
 * @param {string} until - YYYY-MM-DD
 * @param {object} [extraParams]
 * @returns {Promise<{ok: boolean, rows: Array}>}
 */
async function fetchInsights(level, since, until, extraParams) {
  var fields = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,' +
    'impressions,clicks,ctr,cpc,cpm,spend,frequency,' +
    'actions,action_values,cost_per_action_type';

  var params = Object.assign({
    fields: fields,
    time_range: { since: since, until: until },
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '0' }],
    limit: 500
  }, extraParams || {});

  if (level !== 'account') params.level = level;

  var result = await graphRequestAll(AD_ACCOUNT_ID() + '/insights', params);
  if (!result.ok) return { ok: false, rows: [], error: result.error };

  var rows = (result.data || []).map(normalizeInsightRow);
  return { ok: true, rows: rows };
}

/**
 * Fetch insights with breakdowns.
 */
async function fetchInsightsWithBreakdowns(level, since, until, breakdowns) {
  return fetchInsights(level, since, until, { breakdowns: breakdowns.join(',') });
}

/**
 * Normalize a raw Meta insight row into internal schema.
 */
function normalizeInsightRow(row) {
  var actions = row.actions || [];
  var actionValues = row.action_values || [];
  var costPerAction = row.cost_per_action_type || [];

  function findAction(types) {
    for (var i = 0; i < types.length; i++) {
      for (var j = 0; j < actions.length; j++) {
        if (actions[j].action_type === types[i]) return parseInt(actions[j].value) || 0;
      }
    }
    return 0;
  }

  function findActionValue(types) {
    for (var i = 0; i < types.length; i++) {
      for (var j = 0; j < actionValues.length; j++) {
        if (actionValues[j].action_type === types[i]) return parseFloat(actionValues[j].value) || 0;
      }
    }
    return 0;
  }

  function findCostPerAction(types) {
    for (var i = 0; i < types.length; i++) {
      for (var j = 0; j < costPerAction.length; j++) {
        if (costPerAction[j].action_type === types[i]) return parseFloat(costPerAction[j].value) || 0;
      }
    }
    return 0;
  }

  // Priority order — findAction returns first match, not sum.
  // omni_purchase (cross-surface) → pixel/CAPI specific → legacy rollup.
  var PURCHASE = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];
  var ATC = ['offsite_conversion.fb_pixel_add_to_cart'];
  var IC = ['offsite_conversion.fb_pixel_initiate_checkout'];
  var VC = ['offsite_conversion.fb_pixel_view_content'];
  var LPV = ['landing_page_view'];

  var spend = parseFloat(row.spend) || 0;
  var purchases = findAction(PURCHASE);
  var revenue = findActionValue(PURCHASE);

  return {
    campaign_name: row.campaign_name || '',
    campaign_id: row.campaign_id || '',
    adset_name: row.adset_name || '',
    adset_id: row.adset_id || '',
    ad_name: row.ad_name || '',
    ad_id: row.ad_id || '',
    impressions: parseInt(row.impressions) || 0,
    clicks: parseInt(row.clicks) || 0,
    ctr: parseFloat(row.ctr) || 0,
    cpc: parseFloat(row.cpc) || 0,
    cpm: parseFloat(row.cpm) || 0,
    spend: spend,
    frequency: parseFloat(row.frequency) || 0,
    purchases: purchases,
    revenue: revenue,
    roas: spend > 0 ? revenue / spend : 0,
    atc: findAction(ATC),
    ic: findAction(IC),
    vc: findAction(VC),
    lpv: findAction(LPV),
    cost_per_purchase: findCostPerAction(PURCHASE),
    cost_per_atc: findCostPerAction(ATC),
    _raw: row
  };
}

// --- READ: Entity config ---

async function fetchAdsets(statusFilter) {
  var filtering = statusFilter
    ? [{ field: 'effective_status', operator: 'IN', value: statusFilter }]
    : [];
  return graphRequestAll(AD_ACCOUNT_ID() + '/adsets', {
    fields: 'name,id,status,effective_status,optimization_goal,daily_budget,lifetime_budget,campaign_id',
    filtering: filtering,
    limit: 100
  });
}

async function fetchCampaigns(statusFilter) {
  var filtering = statusFilter
    ? [{ field: 'effective_status', operator: 'IN', value: statusFilter }]
    : [];
  return graphRequestAll(AD_ACCOUNT_ID() + '/campaigns', {
    fields: 'name,id,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining',
    filtering: filtering,
    limit: 100
  });
}

async function fetchAds(statusFilter) {
  var filtering = statusFilter
    ? [{ field: 'effective_status', operator: 'IN', value: statusFilter }]
    : [];
  return graphRequestAll(AD_ACCOUNT_ID() + '/ads', {
    fields: 'name,id,status,effective_status,adset_id,campaign_id',
    filtering: filtering,
    limit: 200
  });
}

async function fetchAccountInfo() {
  return graphRequest('GET', AD_ACCOUNT_ID(), {
    fields: 'name,balance,amount_spent,spend_cap,currency,account_status'
  });
}

// --- WRITE: Ad status ---

/**
 * Change ad status. Logs before and after.
 * @param {string} adId
 * @param {string} newStatus - 'ACTIVE' | 'PAUSED'
 * @param {string} reason
 * @param {boolean} [forceDryRun]
 * @returns {Promise<{ok: boolean, dryRun: boolean, result: object}>}
 */
async function changeAdStatus(adId, newStatus, reason, forceDryRun) {
  var isDry = DRY_RUN || forceDryRun;
  var logEntry = {
    action: 'change_ad_status',
    adId: adId,
    newStatus: newStatus,
    reason: reason,
    dryRun: isDry,
    timestamp: new Date().toISOString()
  };

  console.log('[MetaAPI] changeAdStatus', logEntry);

  if (isDry) {
    logEntry.result = 'dry_run_skipped';
    await logWriteAction(logEntry);
    return { ok: true, dryRun: true, result: logEntry };
  }

  var result = await graphRequest('POST', adId, null, { status: newStatus });
  logEntry.result = result.ok ? 'success' : result.error;
  await logWriteAction(logEntry);
  return { ok: result.ok, dryRun: false, result: result };
}

/**
 * Adjust adset daily budget.
 * @param {string} adsetId
 * @param {number} newBudgetCents - new daily budget in cents
 * @param {string} reason
 * @param {boolean} [forceDryRun]
 */
async function adjustAdsetBudget(adsetId, newBudgetCents, reason, forceDryRun) {
  var isDry = DRY_RUN || forceDryRun;
  var logEntry = {
    action: 'adjust_adset_budget',
    adsetId: adsetId,
    newBudgetCents: newBudgetCents,
    newBudgetEur: newBudgetCents / 100,
    reason: reason,
    dryRun: isDry,
    timestamp: new Date().toISOString()
  };

  console.log('[MetaAPI] adjustAdsetBudget', logEntry);

  if (isDry) {
    logEntry.result = 'dry_run_skipped';
    await logWriteAction(logEntry);
    return { ok: true, dryRun: true, result: logEntry };
  }

  var result = await graphRequest('POST', adsetId, null, { daily_budget: newBudgetCents });
  logEntry.result = result.ok ? 'success' : result.error;
  await logWriteAction(logEntry);
  return { ok: result.ok, dryRun: false, result: result };
}

/**
 * Adjust campaign budget (CBO).
 */
async function adjustCampaignBudget(campaignId, newBudgetCents, reason, forceDryRun) {
  var isDry = DRY_RUN || forceDryRun;
  var logEntry = {
    action: 'adjust_campaign_budget',
    campaignId: campaignId,
    newBudgetCents: newBudgetCents,
    reason: reason,
    dryRun: isDry,
    timestamp: new Date().toISOString()
  };

  console.log('[MetaAPI] adjustCampaignBudget', logEntry);

  if (isDry) {
    logEntry.result = 'dry_run_skipped';
    await logWriteAction(logEntry);
    return { ok: true, dryRun: true, result: logEntry };
  }

  var result = await graphRequest('POST', campaignId, null, { daily_budget: newBudgetCents });
  logEntry.result = result.ok ? 'success' : result.error;
  await logWriteAction(logEntry);
  return { ok: result.ok, dryRun: false, result: result };
}

// --- Write action logging ---

async function logWriteAction(entry) {
  try {
    var dateStr = new Date().toISOString().split('T')[0];
    var key = 'meta_writes:' + dateStr;
    var list = [];
    var raw = await store.get(key);
    if (raw) try { list = JSON.parse(raw); } catch (e) { list = []; }
    list.push(entry);
    await store.set(key, JSON.stringify(list), 14 * 86400);
  } catch (e) {
    console.error('[MetaAPI] Failed to log write action:', e.message);
  }
}

async function getWriteLog(dateStr) {
  var raw = await store.get('meta_writes:' + (dateStr || new Date().toISOString().split('T')[0]));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

module.exports = {
  graphRequest: graphRequest,
  graphRequestAll: graphRequestAll,
  fetchInsights: fetchInsights,
  fetchInsightsWithBreakdowns: fetchInsightsWithBreakdowns,
  normalizeInsightRow: normalizeInsightRow,
  fetchAdsets: fetchAdsets,
  fetchCampaigns: fetchCampaigns,
  fetchAds: fetchAds,
  fetchAccountInfo: fetchAccountInfo,
  changeAdStatus: changeAdStatus,
  adjustAdsetBudget: adjustAdsetBudget,
  adjustCampaignBudget: adjustCampaignBudget,
  getWriteLog: getWriteLog,
  AD_ACCOUNT_ID: AD_ACCOUNT_ID,
  API_VERSION: API_VERSION
};
