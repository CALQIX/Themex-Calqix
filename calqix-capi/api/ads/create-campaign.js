var { apiGet, apiPost, authAction, AD_ACCOUNT_ID } = require('../../lib/meta-ads');
var { sendTelegram } = require('../../lib/telegram');

var META_PIXEL_ID = process.env.META_PIXEL_ID || '934134615770602';
var CET_OFFSET = 2; // CET = UTC+1, CEST = UTC+2 (zomertijd)

function getCETDate() {
  var now = new Date();
  var cetMs = now.getTime() + (CET_OFFSET * 60 * 60 * 1000);
  return new Date(cetMs);
}

function getDateStr() {
  var cet = getCETDate();
  var parts = cet.toISOString().split('T')[0].split('-');
  return parts[2] + '-' + parts[1] + '-' + parts[0];
}

function shouldSchedule() {
  var cet = getCETDate();
  var cetHour = cet.getUTCHours();
  return cetHour >= 18;
}

function getNextMidnightUTC() {
  // Next midnight CET in UTC = today+1 at (24 - CET_OFFSET):00 UTC
  var now = new Date();
  var tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(24 - CET_OFFSET, 0, 0, 0);
  // Return as Unix timestamp (seconds)
  return Math.floor(tomorrow.getTime() / 1000);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var auth = authAction(req);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized: ' + auth.reason });
  }

  var body = req.body || {};
  var dryRun = body.dry_run !== false; // DEFAULT TRUE

  var dateStr = getDateStr();
  var campaignName = body.campaign_name || 'CBO - OralBiome | NL/BE/DE/AT | ATC | ' + dateStr;
  var dailyBudgetCents = body.daily_budget_cents || 3000; // €30
  var adsetName = body.adset_name || 'ATC | NL+BE+DE+AT | 25+ | OPEN';
  var countries = body.countries || ['NL', 'BE', 'DE', 'AT'];
  var ageMin = body.age_min || 25;
  var optimizationEvent = body.optimization_event || 'ADD_TO_CART';

  // Auto-activate: always ACTIVE, schedule if after 18:00 CET
  var scheduled = shouldSchedule();
  var startTime = scheduled ? getNextMidnightUTC() : null;

  // Ads to create: array of { name, creative_id }
  // Naming convention: {Market}_{Angle}_{Nr}_{Theme} | {dateStr}
  var ads = body.ads || [
    { name: 'NL_Angle_1_Microbioom | ' + dateStr, creative_id: '940326145496174' },
    { name: 'NL_Angle_2_Slechte_Adem | ' + dateStr, creative_id: '2024248394799694' },
    { name: 'NL_Angle_3_Routine | ' + dateStr, creative_id: '1006853958962216' },
    { name: 'DE_Angle_1_Mikrobiom | ' + dateStr, creative_id: '1446342570212916' },
    { name: 'DE_Angle_3_Routine | ' + dateStr, creative_id: '931146969320890' }
  ];

  var plan = {
    campaign: {
      name: campaignName,
      objective: 'OUTCOME_SALES',
      daily_budget: dailyBudgetCents,
      daily_budget_eur: (dailyBudgetCents / 100).toFixed(2) + ' EUR',
      status: 'ACTIVE',
      scheduled: scheduled,
      start_time: startTime ? new Date(startTime * 1000).toISOString() : 'direct',
      special_ad_categories: []
    },
    adset: {
      name: adsetName,
      optimization_goal: 'OFFSITE_CONVERSIONS',
      optimization_event: optimizationEvent,
      billing_event: 'IMPRESSIONS',
      pixel_id: META_PIXEL_ID,
      targeting: { countries: countries, age_min: ageMin },
      status: 'ACTIVE'
    },
    ads: ads.map(function (a) { return { name: a.name, creative_id: a.creative_id }; })
  };

  if (dryRun) {
    return res.status(200).json({
      dry_run: true,
      message: 'Dit is wat er zou worden aangemaakt. Stuur opnieuw met dry_run: false om uit te voeren.',
      plan: plan,
      api_calls: [
        'POST /' + AD_ACCOUNT_ID + '/campaigns',
        'POST /' + AD_ACCOUNT_ID + '/adsets',
        ads.map(function (a) { return 'POST /' + AD_ACCOUNT_ID + '/ads (creative: ' + a.creative_id + ')'; })
      ]
    });
  }

  // --- EXECUTE ---
  var results = { campaign: null, adset: null, ads: [] };
  var errors = [];

  // 1. Create Campaign (CBO with lowest cost, always ACTIVE)
  var campPayload = {
    name: campaignName,
    objective: 'OUTCOME_SALES',
    status: 'ACTIVE',
    special_ad_categories: [],
    daily_budget: dailyBudgetCents,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP'
  };
  // If after 18:00 CET, schedule start for next midnight
  if (startTime) {
    campPayload.start_time = startTime;
  }
  var campResult = await apiPost(AD_ACCOUNT_ID + '/campaigns', campPayload);

  if (!campResult.ok) {
    errors.push({ step: 'campaign', error: campResult.error });
    return res.status(200).json({ success: false, errors: errors, plan: plan });
  }

  var campaignId = campResult.data.id;
  results.campaign = { id: campaignId, name: campaignName };

  console.log('[ADS CREATE] Campaign created:', campaignId, campaignName);

  // 2. Create Ad Set (no daily_budget — CBO manages budget at campaign level)
  var adsetResult = await apiPost(AD_ACCOUNT_ID + '/adsets', {
    campaign_id: campaignId,
    name: adsetName,
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    promoted_object: {
      pixel_id: META_PIXEL_ID,
      custom_event_type: optimizationEvent
    },
    targeting: {
      geo_locations: { countries: countries },
      age_min: ageMin
    },
    status: 'ACTIVE'
  });

  if (!adsetResult.ok) {
    errors.push({ step: 'adset', error: adsetResult.error });
    // Try to clean up campaign
    await apiPost(campaignId, { status: 'PAUSED' });
    return res.status(200).json({ success: false, campaign_created: results.campaign, errors: errors, plan: plan });
  }

  var adsetId = adsetResult.data.id;
  results.adset = { id: adsetId, name: adsetName };

  console.log('[ADS CREATE] Ad Set created:', adsetId, adsetName);

  // 3. Create Ads
  for (var i = 0; i < ads.length; i++) {
    var adResult = await apiPost(AD_ACCOUNT_ID + '/ads', {
      adset_id: adsetId,
      name: ads[i].name,
      creative: { creative_id: ads[i].creative_id },
      status: 'ACTIVE'
    });

    if (adResult.ok) {
      results.ads.push({ id: adResult.data.id, name: ads[i].name, creative_id: ads[i].creative_id });
      console.log('[ADS CREATE] Ad created:', adResult.data.id, ads[i].name);
    } else {
      errors.push({ step: 'ad', name: ads[i].name, error: adResult.error });
    }
  }

  // 4. Send Telegram notification
  var statusMsg = scheduled
    ? 'SCHEDULED (start vannacht 00:00 CET)'
    : 'ACTIVE (direct gestart)';

  var telegramMsg = '\ud83d\ude80 <b>Nieuwe CBO Campagne Aangemaakt</b>\n\n' +
    '<b>Campagne:</b> ' + campaignName + '\n' +
    '<b>Status:</b> ' + statusMsg + '\n' +
    '<b>Budget:</b> ' + (dailyBudgetCents / 100).toFixed(2) + ' EUR/dag\n' +
    '<b>Optimalisatie:</b> ' + optimizationEvent + '\n' +
    '<b>Landen:</b> ' + countries.join(', ') + '\n' +
    '<b>Ad Set:</b> ' + adsetName + '\n' +
    '<b>Ads:</b>\n';

  results.ads.forEach(function (a) {
    telegramMsg += '  \u2022 ' + a.name + '\n';
  });

  if (errors.length > 0) {
    telegramMsg += '\n\u26a0\ufe0f <b>Fouten:</b> ' + errors.length + '\n';
    errors.forEach(function (e) { telegramMsg += '- ' + e.step + ': ' + (e.name || '') + ' ' + e.error + '\n'; });
  }

  var tgResult = await sendTelegram(telegramMsg);

  return res.status(200).json({
    success: errors.length === 0,
    dry_run: false,
    scheduled: scheduled,
    start_time: startTime ? new Date(startTime * 1000).toISOString() : 'now',
    results: results,
    errors: errors.length > 0 ? errors : undefined,
    telegram: tgResult
  });
}

module.exports = handler;
