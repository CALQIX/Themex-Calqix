const { apiGet, authDiagnostics, AD_ACCOUNT_ID } = require('../../lib/meta-ads');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  // 1. Fetch campaigns
  var campResult = await apiGet(AD_ACCOUNT_ID + '/campaigns', {
    fields: 'name,status,objective,daily_budget,lifetime_budget,budget_remaining,effective_status,configured_status',
    limit: 50
  });

  if (!campResult.ok) {
    return res.status(200).json({ status: 'ERROR', error: campResult.error, retryAfter: campResult.retryAfter });
  }

  var campaigns = Array.isArray(campResult.data) ? campResult.data : [];
  var warnings = [];
  var tree = [];

  for (var i = 0; i < campaigns.length; i++) {
    var camp = campaigns[i];
    var campNode = {
      name: camp.name,
      id: camp.id,
      status: camp.status,
      effective_status: camp.effective_status,
      configured_status: camp.configured_status,
      objective: camp.objective,
      daily_budget: camp.daily_budget ? (parseInt(camp.daily_budget, 10) / 100).toFixed(2) + ' EUR' : null,
      lifetime_budget: camp.lifetime_budget ? (parseInt(camp.lifetime_budget, 10) / 100).toFixed(2) + ' EUR' : null,
      budget_remaining: camp.budget_remaining ? (parseInt(camp.budget_remaining, 10) / 100).toFixed(2) + ' EUR' : null,
      ad_sets: []
    };

    // 2. Fetch ad sets per campaign
    var adsetResult = await apiGet(camp.id + '/adsets', {
      fields: 'name,status,effective_status,optimization_goal,billing_event,daily_budget,targeting,learning_phase_info',
      limit: 50
    });

    if (adsetResult.ok && Array.isArray(adsetResult.data)) {
      for (var j = 0; j < adsetResult.data.length; j++) {
        var adset = adsetResult.data[j];
        var adsetNode = {
          name: adset.name,
          id: adset.id,
          status: adset.status,
          effective_status: adset.effective_status,
          optimization_goal: adset.optimization_goal,
          billing_event: adset.billing_event,
          daily_budget: adset.daily_budget ? (parseInt(adset.daily_budget, 10) / 100).toFixed(2) + ' EUR' : null,
          learning_phase: adset.learning_phase_info || null,
          targeting_summary: summarizeTargeting(adset.targeting),
          ads: []
        };

        // Flag learning limited / learning
        if (adset.effective_status === 'LEARNING_LIMITED') {
          warnings.push({
            type: 'LEARNING_LIMITED',
            level: 'adset',
            id: adset.id,
            name: adset.name,
            message: 'Ad set is in Learning Limited. Onvoldoende optimalisatie-events.'
          });
        } else if (adset.effective_status === 'LEARNING') {
          warnings.push({
            type: 'LEARNING',
            level: 'adset',
            id: adset.id,
            name: adset.name,
            message: 'Ad set is nog in de learning phase.'
          });
        }

        // 3. Fetch ads per ad set
        var adsResult = await apiGet(adset.id + '/ads', {
          fields: 'name,status,effective_status,creative{id,name,thumbnail_url}',
          limit: 50
        });

        if (adsResult.ok && Array.isArray(adsResult.data)) {
          for (var k = 0; k < adsResult.data.length; k++) {
            var ad = adsResult.data[k];
            var adNode = {
              name: ad.name,
              id: ad.id,
              status: ad.status,
              effective_status: ad.effective_status,
              creative_id: ad.creative ? ad.creative.id : null
            };

            if (ad.effective_status === 'DISAPPROVED') {
              warnings.push({
                type: 'DISAPPROVED',
                level: 'ad',
                id: ad.id,
                name: ad.name,
                message: 'Ad is afgekeurd door Meta.'
              });
            } else if (ad.effective_status === 'WITH_ISSUES') {
              warnings.push({
                type: 'WITH_ISSUES',
                level: 'ad',
                id: ad.id,
                name: ad.name,
                message: 'Ad heeft problemen.'
              });
            }

            adsetNode.ads.push(adNode);
          }
        }

        campNode.ad_sets.push(adsetNode);
      }
    }

    tree.push(campNode);
  }

  return res.status(200).json({
    status: 'OK',
    campaign_count: tree.length,
    warning_count: warnings.length,
    warnings: warnings,
    campaigns: tree
  });
}

function summarizeTargeting(targeting) {
  if (!targeting) return null;
  var summary = {};
  if (targeting.geo_locations) {
    var countries = targeting.geo_locations.countries;
    if (countries) summary.countries = countries;
  }
  if (targeting.age_min) summary.age_min = targeting.age_min;
  if (targeting.age_max) summary.age_max = targeting.age_max;
  if (targeting.genders) summary.genders = targeting.genders;
  return summary;
}

module.exports = handler;
