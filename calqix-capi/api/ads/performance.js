const { apiGet, authDiagnostics, AD_ACCOUNT_ID, parseActionValue, parseCostPerAction } = require('../../lib/meta-ads');

var PURCHASE_TYPES = [
  'purchase',
  'offsite_conversion.fb_pixel_purchase'
];
var ATC_TYPES = [
  'offsite_conversion.fb_pixel_add_to_cart'
];
var IC_TYPES = [
  'offsite_conversion.fb_pixel_initiate_checkout'
];
var VC_TYPES = [
  'offsite_conversion.fb_pixel_view_content'
];
var LEAD_TYPES = [
  'offsite_conversion.fb_pixel_lead'
];

var DATE_PRESETS = {
  1: 'today',
  3: 'last_3d',
  7: 'last_7d',
  14: 'last_14d',
  28: 'last_28d',
  30: 'last_30d',
  90: 'last_90d'
};

function closestPreset(days) {
  var d = parseInt(days, 10) || 7;
  if (d > 90) d = 90;
  if (d < 1) d = 1;
  // Find closest preset
  var keys = Object.keys(DATE_PRESETS).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    if (d <= keys[i]) return DATE_PRESETS[keys[i]];
  }
  return 'last_90d';
}

function formatRow(item) {
  var actions = item.actions || [];
  var costPerAction = item.cost_per_action_type || [];
  var spend = parseFloat(item.spend) || 0;

  var purchases = parseActionValue(actions, PURCHASE_TYPES);
  var addToCarts = parseActionValue(actions, ATC_TYPES);
  var initiateCheckouts = parseActionValue(actions, IC_TYPES);
  var viewContents = parseActionValue(actions, VC_TYPES);
  var leads = parseActionValue(actions, LEAD_TYPES);

  var costPerPurchase = parseCostPerAction(costPerAction, PURCHASE_TYPES);
  var costPerAtc = parseCostPerAction(costPerAction, ATC_TYPES);

  // Calculate ROAS from purchase_roas or action_values
  var roas = 0;
  if (item.purchase_roas && Array.isArray(item.purchase_roas) && item.purchase_roas.length > 0) {
    roas = parseFloat(item.purchase_roas[0].value) || 0;
  } else if (item.action_values) {
    var purchaseValue = parseActionValue(item.action_values, PURCHASE_TYPES);
    roas = spend > 0 ? Number((purchaseValue / spend).toFixed(2)) : 0;
  }

  return {
    name: item.campaign_name || item.adset_name || item.ad_name || 'Unknown',
    id: item.campaign_id || item.adset_id || item.ad_id || null,
    spend: Number(spend.toFixed(2)),
    impressions: parseInt(item.impressions) || 0,
    clicks: parseInt(item.clicks) || 0,
    ctr: parseFloat(item.ctr) || 0,
    cpc: parseFloat(item.cpc) || 0,
    cpm: parseFloat(item.cpm) || 0,
    frequency: parseFloat(item.frequency) || 0,
    reach: parseInt(item.reach) || 0,
    purchases: purchases,
    cost_per_purchase: costPerPurchase,
    add_to_carts: addToCarts,
    cost_per_atc: costPerAtc,
    initiate_checkouts: initiateCheckouts,
    view_contents: viewContents,
    leads: leads,
    roas: roas
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var days = req.query.days || 7;
  var level = req.query.level || 'campaign';
  if (['campaign', 'adset', 'ad'].indexOf(level) === -1) {
    return res.status(400).json({ error: 'level must be campaign, adset, or ad' });
  }

  var datePreset = closestPreset(days);

  var result = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,action_values,purchase_roas,frequency,reach',
    date_preset: datePreset,
    level: level,
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  });

  if (!result.ok) {
    return res.status(200).json({
      status: 'ERROR',
      error: result.error,
      retryAfter: result.retryAfter
    });
  }

  var rows = Array.isArray(result.data) ? result.data : [];
  var formatted = rows.map(formatRow);

  // Sort by spend descending
  formatted.sort(function (a, b) { return b.spend - a.spend; });

  var totalSpend = formatted.reduce(function (sum, r) { return sum + r.spend; }, 0);
  var totalPurchases = formatted.reduce(function (sum, r) { return sum + r.purchases; }, 0);
  var totalAtc = formatted.reduce(function (sum, r) { return sum + r.add_to_carts; }, 0);

  return res.status(200).json({
    status: 'OK',
    period: datePreset,
    level: level,
    count: formatted.length,
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      purchases: totalPurchases,
      add_to_carts: totalAtc,
      avg_roas: totalSpend > 0 && totalPurchases > 0
        ? Number((formatted.reduce(function (s, r) { return s + r.roas * r.spend; }, 0) / totalSpend).toFixed(2))
        : 0
    },
    data: formatted
  });
}

module.exports = handler;
