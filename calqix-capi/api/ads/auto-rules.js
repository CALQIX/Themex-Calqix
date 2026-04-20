const { apiGet, authDiagnostics, authAction, AD_ACCOUNT_ID, parseActionValue, pickActionValue } = require('../../lib/meta-ads');

// Priority order — pick first match to avoid double-counting overlapping
// Meta action rows for the same purchase conversion.
var PURCHASE_PRIORITY = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];
var ATC_TYPES = ['offsite_conversion.fb_pixel_add_to_cart'];
// Match Ads Manager UI default attribution.
var ATTRIBUTION_WINDOWS = ['7d_click', '1d_view'];

async function handler(req, res) {
  if (req.method === 'GET') {
    return handleEvaluate(req, res);
  }

  if (req.method === 'POST') {
    return res.status(200).json({
      status: 'INFO',
      message: 'Gebruik api/ads/actions.js om aanbevelingen uit te voeren. Dit endpoint is alleen voor het evalueren van regels (GET).'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleEvaluate(req, res) {
  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var recommendations = [];

  // Fetch all active ad sets with insights
  var adsetsResult = await apiGet(AD_ACCOUNT_ID + '/adsets', {
    fields: 'name,status,effective_status,optimization_goal,daily_budget,learning_phase_info',
    filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'] }],
    limit: 50
  });

  if (!adsetsResult.ok) {
    return res.status(200).json({ status: 'ERROR', error: adsetsResult.error });
  }

  var adsets = Array.isArray(adsetsResult.data) ? adsetsResult.data : [];

  // Fetch ad-level insights for rules 1 and 3
  var adInsightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'ad_name,ad_id,adset_name,adset_id,impressions,clicks,ctr,spend,frequency,reach,actions,cost_per_action_type,action_values',
    date_preset: 'last_7d',
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    level: 'ad',
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '0' }],
    limit: 200
  });

  var adInsights = adInsightsResult.ok && Array.isArray(adInsightsResult.data) ? adInsightsResult.data : [];

  // Fetch adset-level insights for rules 2 and 5
  var adsetInsightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend,impressions,actions,action_values,cost_per_action_type',
    date_preset: 'last_7d',
    action_attribution_windows: ATTRIBUTION_WINDOWS,
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  });

  var adsetInsights = adsetInsightsResult.ok && Array.isArray(adsetInsightsResult.data) ? adsetInsightsResult.data : [];

  // Also fetch last 3 days for budget utilization (rule 5)
  var adsetInsights3dResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend',
    date_preset: 'last_3d',
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  });

  var adsetInsights3d = adsetInsights3dResult.ok && Array.isArray(adsetInsights3dResult.data) ? adsetInsights3dResult.data : [];

  // REGEL 1: Kill underperformers (ad-level)
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;

    if (impressions >= 1000 && ctr < 0.8) {
      recommendations.push({
        rule: 'KILL_UNDERPERFORMER',
        severity: 'HIGH',
        level: 'ad',
        target_id: ad.ad_id,
        target_name: ad.ad_name,
        adset_name: ad.adset_name,
        message: 'Ad "' + ad.ad_name + '" heeft ' + impressions + ' impressies maar slechts ' + ctr.toFixed(2) + '% CTR. Aanbeveling: pauzeer.',
        metric: { impressions: impressions, ctr: ctr },
        suggested_action: {
          action: 'pause_ad',
          target_id: ad.ad_id,
          dry_run: true
        }
      });
    }
  });

  // REGEL 2: Scale winners (adset-level)
  adsetInsights.forEach(function (adset) {
    var spend = parseFloat(adset.spend) || 0;
    var purchaseValue = 0;
    if (adset.action_values) {
      // Priority-pick to avoid double counting.
      purchaseValue = pickActionValue(adset.action_values, PURCHASE_PRIORITY);
    }
    var roas = spend > 0 ? purchaseValue / spend : 0;

    if (roas > 3 && spend > 20) {
      // Find the adset's current budget
      var adsetMeta = adsets.find(function (a) { return a.id === adset.adset_id; });
      var currentBudget = adsetMeta && adsetMeta.daily_budget ? parseInt(adsetMeta.daily_budget, 10) / 100 : null;
      var newBudget = currentBudget ? Number((currentBudget * 1.2).toFixed(2)) : null;

      recommendations.push({
        rule: 'SCALE_WINNER',
        severity: 'MEDIUM',
        level: 'adset',
        target_id: adset.adset_id,
        target_name: adset.adset_name,
        message: 'Ad set "' + adset.adset_name + '" heeft ROAS ' + roas.toFixed(2) + 'x met ' + spend.toFixed(2) + ' EUR spend.' +
          (currentBudget ? ' Aanbeveling: verhoog budget van ' + currentBudget + ' naar ' + newBudget + ' EUR/dag.' : ''),
        metric: { roas: Number(roas.toFixed(2)), spend: Number(spend.toFixed(2)), purchase_value: Number(purchaseValue.toFixed(2)) },
        suggested_action: newBudget ? {
          action: 'adjust_budget',
          target_id: adset.adset_id,
          params: { daily_budget_eur: newBudget },
          dry_run: true
        } : null
      });
    }
  });

  // REGEL 3: Creative fatigue (ad-level)
  adInsights.forEach(function (ad) {
    var frequency = parseFloat(ad.frequency) || 0;

    if (frequency > 3.0) {
      recommendations.push({
        rule: 'CREATIVE_FATIGUE',
        severity: 'MEDIUM',
        level: 'ad',
        target_id: ad.ad_id,
        target_name: ad.ad_name,
        adset_name: ad.adset_name,
        message: 'Ad "' + ad.ad_name + '" heeft frequency ' + frequency.toFixed(1) + '. Audience ziet deze ad te vaak. Overweeg te pauzeren en nieuwe creative te maken.',
        metric: { frequency: frequency },
        suggested_action: {
          action: 'pause_ad',
          target_id: ad.ad_id,
          dry_run: true
        }
      });
    }
  });

  // REGEL 4: Learning Limited escape
  adsets.forEach(function (adset) {
    if (adset.effective_status !== 'LEARNING_LIMITED') return;

    var insightRow = adsetInsights.find(function (i) { return i.adset_id === adset.id; });
    var actions = insightRow ? insightRow.actions || [] : [];
    var purchases = pickActionValue(actions, PURCHASE_PRIORITY);
    var atcEvents = parseActionValue(actions, ATC_TYPES);
    var goal = adset.optimization_goal || 'OFFSITE_CONVERSIONS';

    if (purchases < 20) {
      recommendations.push({
        rule: 'LEARNING_LIMITED_ESCAPE',
        severity: 'HIGH',
        level: 'adset',
        target_id: adset.id,
        target_name: adset.name,
        message: 'Ad set "' + adset.name + '" is Learning Limited en genereert ' + purchases + '/week purchases. Overweeg switch naar AddToCart optimalisatie (' + atcEvents + ' ATC events/week beschikbaar).',
        metric: { purchases_per_week: purchases, atc_per_week: atcEvents, current_goal: goal },
        suggested_action: {
          action: 'change_optimization',
          target_id: adset.id,
          params: { custom_event_type: 'ADD_TO_CART' },
          dry_run: true
        }
      });
    }
  });

  // REGEL 5: Budget niet besteed
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var expectedSpend3d = dailyBudgetEur * 3;

    var insightRow = adsetInsights3d.find(function (i) { return i.adset_id === adset.id; });
    var actualSpend3d = insightRow ? parseFloat(insightRow.spend) || 0 : 0;

    var pct = expectedSpend3d > 0 ? Number((actualSpend3d / expectedSpend3d * 100).toFixed(1)) : 0;

    if (pct < 50 && actualSpend3d > 0) {
      recommendations.push({
        rule: 'BUDGET_UNDERUTILIZED',
        severity: 'LOW',
        level: 'adset',
        target_id: adset.id,
        target_name: adset.name,
        message: 'Ad set "' + adset.name + '" besteedt slechts ' + pct + '% van het budget (' + actualSpend3d.toFixed(2) + '/' + expectedSpend3d.toFixed(2) + ' EUR afgelopen 3 dagen). Mogelijke oorzaak: audience te klein of bid te laag.',
        metric: { budget_utilization_pct: pct, actual_spend_3d: Number(actualSpend3d.toFixed(2)), expected_spend_3d: Number(expectedSpend3d.toFixed(2)) },
        suggested_action: null
      });
    }
  });

  // Sort by severity
  var severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  recommendations.sort(function (a, b) {
    return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
  });

  return res.status(200).json({
    status: 'OK',
    recommendation_count: recommendations.length,
    note: 'Deze aanbevelingen worden NOOIT automatisch uitgevoerd. Gebruik api/ads/actions.js met dry_run:false om een actie door te voeren.',
    rules_evaluated: [
      'KILL_UNDERPERFORMER: ad met 1000+ impressies en CTR < 0.8%',
      'SCALE_WINNER: ad set met ROAS > 3x en spend > 20 EUR',
      'CREATIVE_FATIGUE: ad met frequency > 3.0',
      'LEARNING_LIMITED_ESCAPE: ad set Learning Limited met < 20 purchases/week',
      'BUDGET_UNDERUTILIZED: ad set besteedt < 50% budget afgelopen 3 dagen'
    ],
    recommendations: recommendations
  });
}

module.exports = handler;
