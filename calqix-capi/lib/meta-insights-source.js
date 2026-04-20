/**
 * Meta Insights Source of Truth
 *
 * Fetches ad account / campaign / adset / ad level insights
 * directly from Meta Marketing API. These are META-ATTRIBUTED metrics
 * and should be used as the canonical source for Telegram reporting.
 *
 * Separates metrics into:
 *   - META_ATTRIBUTED: from Meta Ads Insights API (purchases, ROAS, etc.)
 *   - Billing/account data: from Ad Account fields
 */
var { apiGet, AD_ACCOUNT_ID, parseActionValue, pickActionValue } = require('./meta-ads');

// Priority order for picking a single purchase metric per insight row.
// DO NOT SUM — Meta returns multiple rows representing the same conversion.
// Order: most-inclusive cross-surface rollup → pixel/CAPI-specific → legacy.
var PURCHASE_PRIORITY = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'purchase'
];
// Backwards-compat export (deprecated, do not use for summing).
var PURCHASE_TYPES = PURCHASE_PRIORITY;
var ATC_TYPES = ['offsite_conversion.fb_pixel_add_to_cart'];
var IC_TYPES = ['offsite_conversion.fb_pixel_initiate_checkout'];
var VC_TYPES = ['offsite_conversion.fb_pixel_view_content'];
var LPV_TYPES = ['landing_page_view'];
var LINK_CLICK_TYPES = ['link_click'];

// Explicit attribution windows pinned to match Meta Ads Manager UI default.
// Keeps Telegram numbers in sync with what you see in Ads Manager.
var ATTRIBUTION_WINDOWS = ['7d_click', '1d_view'];

/**
 * Build a date string YYYY-MM-DD from a Date object.
 */
function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Safe API call wrapper.
 */
async function safeGet(path, params, label) {
  try {
    var result = await apiGet(path, params);
    if (!result.ok) {
      console.warn('[MetaInsights] API call failed: ' + label, { error: result.error });
    }
    return result;
  } catch (err) {
    console.error('[MetaInsights] API exception: ' + label, { message: err.message });
    return { ok: false, data: null, error: err.message };
  }
}

/**
 * Parse funnel metrics from a set of insight rows.
 * @param {Array} rows - Insight rows with actions and action_values
 * @returns {object} Aggregated funnel metrics
 */
function parseFunnelFromRows(rows) {
  var f = { vc: 0, atc: 0, ic: 0, purchases: 0, spend: 0, revenue: 0, impressions: 0, clicks: 0, lpv: 0, linkClicks: 0 };
  if (!Array.isArray(rows)) return f;

  rows.forEach(function (row) {
    var actions = row.actions || [];
    var actionValues = row.action_values || [];
    f.vc += parseActionValue(actions, VC_TYPES);
    f.atc += parseActionValue(actions, ATC_TYPES);
    f.ic += parseActionValue(actions, IC_TYPES);
    // Purchases use priority-pick (not sum) — avoids double-counting when
    // Meta returns both `purchase` and `offsite_conversion.fb_pixel_purchase`
    // for the same conversion.
    f.purchases += pickActionValue(actions, PURCHASE_PRIORITY);
    f.lpv += parseActionValue(actions, LPV_TYPES);
    f.linkClicks += parseActionValue(actions, LINK_CLICK_TYPES);
    f.spend += parseFloat(row.spend) || 0;
    f.revenue += pickActionValue(actionValues, PURCHASE_PRIORITY);
    f.impressions += parseInt(row.impressions) || 0;
    f.clicks += parseInt(row.clicks) || 0;
  });

  f.roas = f.spend > 0 ? f.revenue / f.spend : 0;
  f.cpc = f.clicks > 0 ? f.spend / f.clicks : 0;
  f.ctr = f.impressions > 0 ? (f.clicks / f.impressions * 100) : 0;
  f.costPerPurchase = f.purchases > 0 ? f.spend / f.purchases : 0;
  f.costPerAtc = f.atc > 0 ? f.spend / f.atc : 0;

  return f;
}

/**
 * Fetch account-level insights for a time range.
 * @param {string} since - YYYY-MM-DD
 * @param {string} until - YYYY-MM-DD
 * @param {string} [label] - label for logging
 * @returns {Promise<{ok: boolean, funnel: object, errors: string[]}>}
 */
async function fetchAccountInsights(since, until, label) {
  var errors = [];
  var result = await safeGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'spend,impressions,clicks,ctr,cpc,actions,action_values',
    time_range: { since: since, until: until },
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    limit: 1
  }, label || 'account_insights');

  if (!result.ok) {
    errors.push((label || 'account_insights') + ': ' + result.error);
    return { ok: false, funnel: parseFunnelFromRows([]), errors: errors };
  }

  var rows = Array.isArray(result.data) ? result.data : [];
  return { ok: true, funnel: parseFunnelFromRows(rows), errors: errors };
}

/**
 * Fetch ad-level insights for spend imbalance and creative analysis.
 * @param {string} since
 * @param {string} until
 * @returns {Promise<{ok: boolean, ads: Array, errors: string[]}>}
 */
async function fetchAdInsights(since, until) {
  var errors = [];
  var result = await safeGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'ad_name,ad_id,adset_name,adset_id,campaign_name,campaign_id,impressions,clicks,ctr,cpc,spend,frequency,actions,action_values,cost_per_action_type',
    time_range: { since: since, until: until },
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    level: 'ad',
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '0' }],
    limit: 200
  }, 'ad_insights');

  if (!result.ok) {
    errors.push('ad_insights: ' + result.error);
    return { ok: false, ads: [], errors: errors };
  }

  return { ok: true, ads: Array.isArray(result.data) ? result.data : [], errors: errors };
}

/**
 * Fetch adset-level insights.
 */
async function fetchAdsetInsights(since, until) {
  var errors = [];
  var result = await safeGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,campaign_name,campaign_id,spend,impressions,clicks,actions,action_values',
    time_range: { since: since, until: until },
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  }, 'adset_insights');

  if (!result.ok) {
    errors.push('adset_insights: ' + result.error);
    return { ok: false, adsets: [], errors: errors };
  }

  return { ok: true, adsets: Array.isArray(result.data) ? result.data : [], errors: errors };
}

/**
 * Fetch active adsets configuration.
 */
async function fetchActiveAdsets() {
  var result = await safeGet(AD_ACCOUNT_ID + '/adsets', {
    fields: 'name,id,status,effective_status,optimization_goal,daily_budget,campaign_id',
    filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'] }],
    limit: 50
  }, 'adsets_active');

  return {
    ok: result.ok,
    adsets: result.ok && Array.isArray(result.data) ? result.data : [],
    error: result.ok ? null : result.error
  };
}

/**
 * Fetch account billing/payment fields.
 * NOTE: billing_threshold is NOT available via public API.
 * We can read: balance, amount_spent, spend_cap, currency, account_status.
 */
async function fetchAccountBilling() {
  var result = await safeGet(AD_ACCOUNT_ID, {
    fields: 'balance,amount_spent,spend_cap,currency,account_status,name'
  }, 'account_billing');

  if (!result.ok) {
    return { ok: false, data: null, error: result.error };
  }

  var d = result.data || {};
  return {
    ok: true,
    data: {
      name: d.name || '',
      balance: d.balance !== undefined ? parseInt(d.balance, 10) / 100 : null,
      amount_spent: d.amount_spent !== undefined ? parseInt(d.amount_spent, 10) / 100 : null,
      spend_cap: d.spend_cap !== undefined ? parseInt(d.spend_cap, 10) / 100 : null,
      currency: d.currency || 'EUR',
      account_status: d.account_status,
      // billing_threshold is NOT available via API — monitor-only via manual config
      billing_threshold: parseInt(process.env.BILLING_THRESHOLD || '112', 10),
      billing_threshold_source: 'env_config_manual'
    },
    error: null
  };
}

/**
 * Fetch a complete snapshot for Telegram reporting.
 * @param {Date} now
 * @returns {Promise<object>} Full snapshot with today, 3d, 7d funnels + billing + ads
 */
async function fetchFullSnapshot(now) {
  var todayStr = toDateStr(now);
  var d3 = new Date(now); d3.setDate(d3.getDate() - 2);
  var since3d = toDateStr(d3);
  var d7 = new Date(now); d7.setDate(d7.getDate() - 6);
  var since7d = toDateStr(d7);

  var errors = [];

  // Parallel fetch all data
  var results = await Promise.all([
    fetchAccountInsights(todayStr, todayStr, 'today'),
    fetchAccountInsights(since3d, todayStr, '3d'),
    fetchAccountInsights(since7d, todayStr, '7d'),
    fetchAdInsights(since3d, todayStr),
    fetchAdsetInsights(since3d, todayStr),
    fetchAdsetInsights(since7d, todayStr),
    fetchActiveAdsets(),
    fetchAccountBilling(),
    // Today adset-level for spend spike detection
    fetchAdsetInsights(todayStr, todayStr)
  ]);

  var todayAccount = results[0];
  var threeDayAccount = results[1];
  var sevenDayAccount = results[2];
  var adInsights = results[3];
  var adsetInsights3d = results[4];
  var adsetInsights7d = results[5];
  var activeAdsets = results[6];
  var billing = results[7];
  var todayAdsets = results[8];

  // Collect all errors
  errors = errors.concat(todayAccount.errors, threeDayAccount.errors, sevenDayAccount.errors,
    adInsights.errors, adsetInsights3d.errors, adsetInsights7d.errors);
  if (!activeAdsets.ok) errors.push('adsets_active: ' + activeAdsets.error);
  if (!billing.ok) errors.push('billing: ' + billing.error);
  if (todayAdsets.errors) errors = errors.concat(todayAdsets.errors);

  return {
    today: todayAccount.funnel,
    threeDays: threeDayAccount.funnel,
    sevenDays: sevenDayAccount.funnel,
    ads: adInsights.ads,
    adsetInsights3d: adsetInsights3d.adsets,
    adsetInsights7d: adsetInsights7d.adsets,
    activeAdsets: activeAdsets.adsets,
    todayAdsets: todayAdsets.adsets,
    billing: billing.ok ? billing.data : null,
    errors: errors.filter(Boolean),
    fetchedAt: now.toISOString()
  };
}

/**
 * Fetch match_keys coverage from Pixel stats API (24h window).
 * Returns per-key event counts to track EMQ improvement.
 * @param {Date} now
 * @returns {Promise<{ok: boolean, keys: object, total: number, coverage: object}>}
 */
async function fetchMatchKeysStats(now) {
  var pixelId = process.env.META_PIXEL_ID;
  if (!pixelId) return { ok: false, keys: {}, total: 0, coverage: {}, error: 'no_pixel_id' };

  var endTs = Math.floor(now.getTime() / 1000);
  var startTs = endTs - 86400; // 24h window

  var result = await safeGet(pixelId + '/stats', {
    aggregation: 'match_keys',
    start: startTs,
    end: endTs
  }, 'match_keys');

  if (!result.ok) {
    return { ok: false, keys: {}, total: 0, coverage: {}, error: result.error };
  }

  var combined = {};
  var rows = Array.isArray(result.data) ? result.data : [];
  rows.forEach(function (hourBlock) {
    var entries = Array.isArray(hourBlock.data) ? hourBlock.data : [];
    entries.forEach(function (item) {
      if (!combined[item.value]) combined[item.value] = 0;
      combined[item.value] += item.count || 0;
    });
  });

  // Fetch total events for coverage calculation
  var eventResult = await safeGet(pixelId + '/stats', {
    aggregation: 'event',
    start: startTs,
    end: endTs
  }, 'event_totals');

  var total = 0;
  if (eventResult.ok && Array.isArray(eventResult.data)) {
    eventResult.data.forEach(function (hourBlock) {
      var entries = Array.isArray(hourBlock.data) ? hourBlock.data : [];
      entries.forEach(function (item) { total += item.count || 0; });
    });
  }

  var coverage = {};
  var importantKeys = ['email', 'external_id', 'fn', 'ln', 'ct', 'zip', 'country', 'ph'];
  importantKeys.forEach(function (key) {
    coverage[key] = total > 0 ? Math.round((combined[key] || 0) / total * 100) : 0;
  });

  return { ok: true, keys: combined, total: total, coverage: coverage };
}

/**
 * Fetch country-level performance breakdown (7d).
 * Uses campaign-level insights with country breakdown for targeting optimization.
 * @param {Date} now
 * @returns {Promise<{ok: boolean, countries: Array, errors: string[]}>}
 */
async function fetchCountryBreakdown(now) {
  var errors = [];
  var d7 = new Date(now); d7.setDate(d7.getDate() - 6);
  var since7d = toDateStr(d7);
  var todayStr = toDateStr(now);

  var result = await safeGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'country,spend,impressions,clicks,actions,action_values',
    time_range: { since: since7d, until: todayStr },
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    breakdowns: 'country',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 50
  }, 'country_breakdown');

  if (!result.ok) {
    errors.push('country_breakdown: ' + result.error);
    return { ok: false, countries: [], errors: errors };
  }

  var rows = Array.isArray(result.data) ? result.data : [];
  var countries = rows.map(function (row) {
    var spend = parseFloat(row.spend) || 0;
    var purchases = pickActionValue(row.actions || [], PURCHASE_PRIORITY);
    var revenue = pickActionValue(row.action_values || [], PURCHASE_PRIORITY);
    var atc = parseActionValue(row.actions || [], ATC_TYPES);
    var impressions = parseInt(row.impressions) || 0;
    var clicks = parseInt(row.clicks) || 0;

    return {
      country: row.country || 'unknown',
      spend: spend,
      impressions: impressions,
      clicks: clicks,
      atc: atc,
      purchases: purchases,
      revenue: revenue,
      roas: spend > 0 ? revenue / spend : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
      ctr: impressions > 0 ? (clicks / impressions * 100) : 0
    };
  }).sort(function (a, b) { return b.revenue - a.revenue; });

  return { ok: true, countries: countries, errors: errors };
}

module.exports = {
  fetchFullSnapshot: fetchFullSnapshot,
  fetchAccountInsights: fetchAccountInsights,
  fetchAdInsights: fetchAdInsights,
  fetchAdsetInsights: fetchAdsetInsights,
  fetchActiveAdsets: fetchActiveAdsets,
  fetchAccountBilling: fetchAccountBilling,
  fetchMatchKeysStats: fetchMatchKeysStats,
  fetchCountryBreakdown: fetchCountryBreakdown,
  parseFunnelFromRows: parseFunnelFromRows,
  parseActionValue: parseActionValue,
  pickActionValue: pickActionValue,
  PURCHASE_TYPES: PURCHASE_TYPES,
  PURCHASE_PRIORITY: PURCHASE_PRIORITY,
  ATC_TYPES: ATC_TYPES,
  IC_TYPES: IC_TYPES,
  VC_TYPES: VC_TYPES,
  ATTRIBUTION_WINDOWS: ATTRIBUTION_WINDOWS
};
