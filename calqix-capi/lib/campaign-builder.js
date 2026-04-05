/**
 * Campaign Builder - AI-powered campaign creation from ad performance data.
 *
 * Flow:
 *   1. Operator sends /build_campaign
 *   2. Select intent (scale_winner, new_country, new_angle, retargeting, ai_decide)
 *   3. Claude generates campaign proposal based on performance data
 *   4. Operator adjusts budget/countries or approves
 *   5. System creates campaign + adsets + ads via Meta API (all PAUSED)
 *   6. Operator activates when ready
 *
 * Safety:
 *   - ALWAYS creates campaigns as PAUSED
 *   - NEVER exceeds max_campaign_budget from lib/limits.js
 *   - NEVER creates more than 1 campaign per command
 *   - Only duplicates ads with 100+ impressions AND CTR > 1%
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');
var limits = require('./limits');
var metaApiClient = require('./meta-api-client');

var PIXEL_ID = function () { return process.env.META_PIXEL_ID || '934134615770602'; };

/**
 * Generate a unique proposal ID.
 */
function generateProposalId() {
  return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

/**
 * Fetch current performance data for Claude context.
 */
async function fetchPerformanceContext() {
  var now = new Date();
  var todayStr = now.toISOString().split('T')[0];
  var d7 = new Date(now); d7.setDate(d7.getDate() - 6);
  var since7d = d7.toISOString().split('T')[0];

  var results = await Promise.all([
    metaApiClient.fetchInsights('campaign', since7d, todayStr),
    metaApiClient.fetchInsights('adset', since7d, todayStr),
    metaApiClient.fetchInsights('ad', since7d, todayStr),
    metaApiClient.fetchCampaigns(['ACTIVE', 'PAUSED']),
    metaApiClient.fetchAdsets(['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'])
  ]);

  var campaignInsights = results[0].ok ? results[0].rows : [];
  var adsetInsights = results[1].ok ? results[1].rows : [];
  var adInsights = results[2].ok ? results[2].rows : [];
  var campaigns = results[3].ok ? results[3].data : [];
  var adsets = results[4].ok ? results[4].data : [];

  // Filter qualifying winner ads (100+ impressions, CTR > 1%)
  var winnerAds = adInsights.filter(function (ad) {
    return ad.impressions >= 100 && ad.ctr > 1.0;
  }).sort(function (a, b) { return b.roas - a.roas; });

  return {
    campaigns: campaignInsights.slice(0, 20),
    adsets: adsetInsights.slice(0, 30),
    ads: adInsights.slice(0, 50),
    winnerAds: winnerAds.slice(0, 20),
    activeCampaigns: campaigns.length,
    activeAdsets: adsets.length,
    hasWinners: winnerAds.length > 0,
    winnerCount: winnerAds.length,
    period: since7d + ' to ' + todayStr
  };
}

/**
 * Generate a campaign proposal using Claude.
 * @param {string} intent - scale_winner|new_country|new_angle|retargeting|ai_decide
 * @param {object} perfData - from fetchPerformanceContext
 * @param {object} currentLimits - from limits.getLimits()
 * @returns {Promise<object>} proposal
 */
async function generateProposal(intent, perfData, currentLimits) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Summarize performance for prompt (avoid token bloat)
  var topCampaigns = perfData.campaigns.slice(0, 10).map(function (c) {
    return {
      name: c.campaign_name, id: c.campaign_id,
      spend: c.spend, roas: Math.round(c.roas * 100) / 100,
      purchases: c.purchases, ctr: Math.round(c.ctr * 100) / 100,
      impressions: c.impressions
    };
  });

  var topAdsets = perfData.adsets.slice(0, 15).map(function (a) {
    return {
      name: a.adset_name, id: a.adset_id, campaign: a.campaign_name,
      spend: a.spend, roas: Math.round(a.roas * 100) / 100,
      purchases: a.purchases, ctr: Math.round(a.ctr * 100) / 100
    };
  });

  var winnerAds = perfData.winnerAds.slice(0, 10).map(function (a) {
    return {
      name: a.ad_name, id: a.ad_id, adset: a.adset_name,
      spend: a.spend, roas: Math.round(a.roas * 100) / 100,
      purchases: a.purchases, ctr: Math.round(a.ctr * 100) / 100,
      impressions: a.impressions
    };
  });

  var prompt = 'You are a Meta Ads campaign architect for CALQIX, a premium oral care brand.\n\n' +
    'OPERATOR INTENT: ' + intent + '\n\n' +
    'CURRENT AD PERFORMANCE (last 7 days):\n' +
    'Campaigns:\n' + JSON.stringify(topCampaigns, null, 1) + '\n\n' +
    'Adsets:\n' + JSON.stringify(topAdsets, null, 1) + '\n\n' +
    'Winner Ads (100+ impressions, CTR > 1%):\n' + JSON.stringify(winnerAds, null, 1) + '\n\n' +
    'CURRENT LIMITS:\n' +
    'Max campaign budget: EUR ' + currentLimits.max_campaign_budget + '/day\n' +
    'Max adset budget: EUR ' + currentLimits.max_adset_budget + '/day\n' +
    'Max daily spend: EUR ' + currentLimits.max_daily_spend + '/day\n\n' +
    'PRODUCTS:\n' +
    '- FlowCore: cordless water flosser, EUR 39.95\n' +
    '- OralBiome: nano-HA toothpaste tablets\n' +
    '- Bundle: complete routine package\n\n' +
    'NAMING CONVENTION: {Type} - {Product} | {Countries} | {Optimization} | {Date}\n' +
    'Examples: CBO - FlowCore | DE | IC | ' + dates.todayKey() + '\n\n' +
    'Based on the intent and data, propose a complete campaign structure.\n' +
    'Use today\'s date: ' + dates.todayKey() + '\n\n' +
    'CRITICAL RULES:\n' +
    '- Daily budget MUST NOT exceed EUR ' + currentLimits.max_campaign_budget + '\n' +
    '- Only reference winner ad IDs from the data above\n' +
    '- If no winner ads exist, respond with empty adsets and explain why\n' +
    '- Write "rationale", "data_basis", "risks", "success_metric", and "kill_criteria" in Dutch.\n' +
    '  The operator speaks Dutch. Keep campaign/adset names, IDs, and metric labels in English.\n\n' +
    'Respond ONLY in JSON (no markdown, no backticks):\n' +
    '{\n' +
    '  "campaign_name": "Descriptive name following naming convention",\n' +
    '  "rationale": "2-3 sentences why this campaign makes sense based on the data",\n' +
    '  "campaign": {\n' +
    '    "objective": "OUTCOME_SALES",\n' +
    '    "buying_type": "AUCTION",\n' +
    '    "special_ad_categories": [],\n' +
    '    "daily_budget_cents": amount_in_cents,\n' +
    '    "bid_strategy": "LOWEST_COST_WITHOUT_CAP"\n' +
    '  },\n' +
    '  "adsets": [\n' +
    '    {\n' +
    '      "name": "Descriptive adset name",\n' +
    '      "optimization_goal": "OFFSITE_CONVERSIONS",\n' +
    '      "billing_event": "IMPRESSIONS",\n' +
    '      "promoted_object_event": "INITIATED_CHECKOUT or PURCHASE",\n' +
    '      "targeting": {\n' +
    '        "geo_locations": { "countries": ["DE"] },\n' +
    '        "age_min": 25,\n' +
    '        "age_max": 65\n' +
    '      },\n' +
    '      "ads": [\n' +
    '        { "name": "Ad name", "source_ad_id": "actual_id", "source_ad_name": "name" }\n' +
    '      ]\n' +
    '    }\n' +
    '  ],\n' +
    '  "estimated_daily_spend": "EUR X",\n' +
    '  "data_basis": "What data supports this",\n' +
    '  "risks": ["Risk 1"],\n' +
    '  "success_metric": "What to measure after 3-5 days",\n' +
    '  "kill_criteria": "When to shut it down"\n' +
    '}';

  var response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  var result = await response.json();
  if (result.error) throw new Error('Claude error: ' + (result.error.message || JSON.stringify(result.error)));

  var text = (result.content && result.content[0] && result.content[0].text) || '';

  // Parse JSON from response
  var jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');

  var proposal;
  try {
    proposal = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Failed to parse Claude JSON: ' + e.message);
  }

  // Enforce budget limit
  var maxBudgetCents = currentLimits.max_campaign_budget * 100;
  if (proposal.campaign && proposal.campaign.daily_budget_cents > maxBudgetCents) {
    proposal.campaign.daily_budget_cents = maxBudgetCents;
  }

  return proposal;
}

/**
 * Store a proposal in Redis.
 */
async function storeProposal(proposalId, intent, proposal) {
  var entry = {
    intent: intent,
    proposal: proposal,
    adjustments: [],
    status: 'proposed',
    campaign_id: null,
    created_at: dates.formatDateTimeAmsterdam(new Date())
  };
  await store.set('campaign_proposal:' + proposalId, JSON.stringify(entry), 86400);
  return entry;
}

/**
 * Get a stored proposal.
 */
async function getProposal(proposalId) {
  var raw = await store.get('campaign_proposal:' + proposalId);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

/**
 * Update a stored proposal.
 */
async function updateProposal(proposalId, updates) {
  var entry = await getProposal(proposalId);
  if (!entry) return null;
  Object.keys(updates).forEach(function (k) { entry[k] = updates[k]; });
  await store.set('campaign_proposal:' + proposalId, JSON.stringify(entry), 86400);
  return entry;
}

/**
 * Adjust budget on a proposal.
 */
async function adjustBudget(proposalId, newBudgetCents) {
  var entry = await getProposal(proposalId);
  if (!entry || !entry.proposal || !entry.proposal.campaign) return null;

  var maxCents = (await limits.getLimits()).max_campaign_budget * 100;
  if (newBudgetCents > maxCents) newBudgetCents = maxCents;

  var oldBudget = entry.proposal.campaign.daily_budget_cents;
  entry.proposal.campaign.daily_budget_cents = newBudgetCents;
  entry.adjustments.push({
    type: 'budget',
    old: oldBudget,
    new: newBudgetCents,
    at: dates.formatDateTimeAmsterdam(new Date())
  });
  entry.status = 'adjusted';
  await store.set('campaign_proposal:' + proposalId, JSON.stringify(entry), 86400);
  return entry;
}

/**
 * Adjust countries on a proposal.
 */
async function adjustCountries(proposalId, countries) {
  var entry = await getProposal(proposalId);
  if (!entry || !entry.proposal || !entry.proposal.adsets) return null;

  var countryArray = countries.split(',').map(function (c) { return c.trim(); });
  entry.proposal.adsets.forEach(function (adset) {
    if (adset.targeting && adset.targeting.geo_locations) {
      adset.targeting.geo_locations.countries = countryArray;
    }
  });

  // Update campaign name with new countries
  var name = entry.proposal.campaign_name || '';
  var countryStr = countryArray.join('+');
  // Replace country segment in name pattern: ... | XX | ... or ... | XX+YY | ...
  var nameSegments = name.split(' | ');
  if (nameSegments.length >= 3) {
    nameSegments[1] = countryStr;
    entry.proposal.campaign_name = nameSegments.join(' | ');
  }

  entry.adjustments.push({
    type: 'countries',
    new: countryArray,
    at: dates.formatDateTimeAmsterdam(new Date())
  });
  entry.status = 'adjusted';
  await store.set('campaign_proposal:' + proposalId, JSON.stringify(entry), 86400);
  return entry;
}

/**
 * Build campaign via Meta Marketing API. All entities created PAUSED.
 * @param {object} proposal - The full proposal object
 * @returns {Promise<object>} Build result
 */
async function buildCampaign(proposal) {
  var adAccountId = metaApiClient.AD_ACCOUNT_ID();
  var isDryRun = process.env.ENABLE_AD_WRITES !== 'true';

  var buildLog = {
    action: 'build_campaign',
    campaign_name: proposal.campaign_name,
    dryRun: isDryRun,
    timestamp: new Date().toISOString(),
    steps: []
  };

  // Enforce budget limit
  var maxCents = (await limits.getLimits()).max_campaign_budget * 100;
  var budgetCents = Math.min(proposal.campaign.daily_budget_cents || 2000, maxCents);

  if (isDryRun) {
    buildLog.result = 'dry_run_skipped';
    buildLog.steps.push('Would create campaign: ' + proposal.campaign_name);
    buildLog.steps.push('Would create ' + (proposal.adsets || []).length + ' adsets');
    var totalAds = 0;
    (proposal.adsets || []).forEach(function (as) { totalAds += (as.ads || []).length; });
    buildLog.steps.push('Would create ' + totalAds + ' ads');
    await logBuild(buildLog);
    return {
      ok: true,
      dryRun: true,
      campaign_id: 'dry_run',
      campaign_name: proposal.campaign_name,
      adsets_created: (proposal.adsets || []).length,
      ads_created: totalAds
    };
  }

  // Step 1: Create campaign
  var campaignResult = await metaApiClient.graphRequest('POST', adAccountId + '/campaigns', null, {
    name: proposal.campaign_name,
    objective: proposal.campaign.objective || 'OUTCOME_SALES',
    buying_type: proposal.campaign.buying_type || 'AUCTION',
    special_ad_categories: proposal.campaign.special_ad_categories || [],
    daily_budget: budgetCents,
    bid_strategy: proposal.campaign.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED'
  });

  if (!campaignResult.ok) {
    buildLog.result = 'campaign_create_failed: ' + campaignResult.error;
    await logBuild(buildLog);
    return { ok: false, error: 'Campaign creation failed: ' + campaignResult.error };
  }

  var campaignId = campaignResult.data.id;
  buildLog.steps.push('Campaign created: ' + campaignId);

  var adsetsCreated = 0;
  var adsCreated = 0;

  // Step 2: Create adsets
  var adsets = proposal.adsets || [];
  for (var i = 0; i < adsets.length; i++) {
    var adsetSpec = adsets[i];
    var promotedObject = { pixel_id: PIXEL_ID() };
    if (adsetSpec.promoted_object_event) {
      promotedObject.custom_event_type = adsetSpec.promoted_object_event;
    }

    var adsetResult = await metaApiClient.graphRequest('POST', adAccountId + '/adsets', null, {
      campaign_id: campaignId,
      name: adsetSpec.name,
      optimization_goal: adsetSpec.optimization_goal || 'OFFSITE_CONVERSIONS',
      billing_event: adsetSpec.billing_event || 'IMPRESSIONS',
      targeting: JSON.stringify(adsetSpec.targeting || {}),
      promoted_object: promotedObject,
      status: 'PAUSED'
    });

    if (!adsetResult.ok) {
      buildLog.steps.push('Adset failed: ' + adsetSpec.name + ' - ' + adsetResult.error);
      continue;
    }

    var adsetId = adsetResult.data.id;
    adsetsCreated++;
    buildLog.steps.push('Adset created: ' + adsetId + ' (' + adsetSpec.name + ')');

    // Step 3: Create ads (duplicate from winners)
    var ads = adsetSpec.ads || [];
    for (var j = 0; j < ads.length; j++) {
      var adSpec = ads[j];
      if (!adSpec.source_ad_id) {
        buildLog.steps.push('Ad skipped (no source_ad_id): ' + adSpec.name);
        continue;
      }

      // Fetch creative from source ad
      var sourceResult = await metaApiClient.graphRequest('GET', adSpec.source_ad_id, { fields: 'creative' });
      if (!sourceResult.ok || !sourceResult.data || !sourceResult.data.creative) {
        buildLog.steps.push('Ad skipped (source fetch failed): ' + adSpec.name);
        continue;
      }

      var adResult = await metaApiClient.graphRequest('POST', adAccountId + '/ads', null, {
        adset_id: adsetId,
        name: adSpec.name,
        creative: { creative_id: sourceResult.data.creative.id },
        status: 'PAUSED'
      });

      if (adResult.ok) {
        adsCreated++;
        buildLog.steps.push('Ad created: ' + adResult.data.id);
      } else {
        buildLog.steps.push('Ad failed: ' + adSpec.name + ' - ' + adResult.error);
      }
    }
  }

  buildLog.result = 'success';
  buildLog.campaign_id = campaignId;
  await logBuild(buildLog);

  return {
    ok: true,
    dryRun: false,
    campaign_id: campaignId,
    campaign_name: proposal.campaign_name,
    adsets_created: adsetsCreated,
    ads_created: adsCreated
  };
}

/**
 * Activate a campaign (set to ACTIVE).
 */
async function activateCampaign(campaignId) {
  if (process.env.ENABLE_AD_WRITES !== 'true') {
    return { ok: true, dryRun: true, message: 'Dry run: would activate ' + campaignId };
  }

  var result = await metaApiClient.graphRequest('POST', campaignId, null, { status: 'ACTIVE' });
  return {
    ok: result.ok,
    dryRun: false,
    error: result.ok ? null : result.error
  };
}

/**
 * Log a build action to Redis.
 */
async function logBuild(entry) {
  try {
    var dateStr = dates.todayKey();
    var key = 'campaign_builds:' + dateStr;
    var raw = await store.get(key);
    var list = [];
    if (raw) try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { list = []; }
    list.push(entry);
    await store.set(key, JSON.stringify(list), 30 * 86400);
  } catch (e) {
    console.warn('[CampaignBuilder] Log error:', e.message);
  }
}

/**
 * Format a proposal for Telegram display.
 */
function formatProposalMessage(proposal) {
  var lines = [];
  lines.push('<b>CALQIX Campagne Voorstel</b>\n');
  lines.push('<b>' + (proposal.campaign_name || 'Naamloze campagne') + '</b>\n');
  lines.push(proposal.rationale || '');
  lines.push('');

  var budgetEur = (proposal.campaign && proposal.campaign.daily_budget_cents)
    ? (proposal.campaign.daily_budget_cents / 100)
    : 0;

  lines.push('<b>Structuur:</b>');
  lines.push('Budget: EUR ' + budgetEur + '/dag');
  lines.push('Doel: ' + ((proposal.campaign && proposal.campaign.objective) || 'OUTCOME_SALES'));
  lines.push('Biedstrategie: ' + ((proposal.campaign && proposal.campaign.bid_strategy) || 'LOWEST_COST_WITHOUT_CAP'));
  lines.push('');

  var adsets = proposal.adsets || [];
  if (adsets.length > 0) {
    lines.push('<b>Adsets:</b>');
    for (var i = 0; i < adsets.length; i++) {
      var as = adsets[i];
      var countries = (as.targeting && as.targeting.geo_locations && as.targeting.geo_locations.countries)
        ? as.targeting.geo_locations.countries.join(', ')
        : '?';
      var adCount = (as.ads || []).length;
      lines.push((i + 1) + '. ' + as.name);
      lines.push('   Landen: ' + countries);
      lines.push('   Optimalisatie: ' + (as.promoted_object_event || as.optimization_goal || '?'));
      lines.push('   Ads: ' + adCount + ' (van winnaars)');
    }
  } else {
    lines.push('Geen adsets voorgesteld.');
  }

  lines.push('');
  if (proposal.data_basis) lines.push('<b>Gebaseerd op:</b> ' + proposal.data_basis);
  if (proposal.risks && proposal.risks.length > 0) lines.push('<b>Risico\'s:</b> ' + proposal.risks.join(', '));
  if (proposal.kill_criteria) lines.push('<b>Stoppen als:</b> ' + proposal.kill_criteria);
  if (proposal.success_metric) lines.push('<b>Meten:</b> ' + proposal.success_metric);

  return lines.join('\n');
}

module.exports = {
  generateProposalId: generateProposalId,
  fetchPerformanceContext: fetchPerformanceContext,
  generateProposal: generateProposal,
  storeProposal: storeProposal,
  getProposal: getProposal,
  updateProposal: updateProposal,
  adjustBudget: adjustBudget,
  adjustCountries: adjustCountries,
  buildCampaign: buildCampaign,
  activateCampaign: activateCampaign,
  formatProposalMessage: formatProposalMessage
};
