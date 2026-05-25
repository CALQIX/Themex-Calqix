/**
 * AI Ad Advisor — Claude-powered traffic light optimization strategies.
 *
 * Three times per day (morning 07:00, midday 12:00, evening 19:00),
 * analyzes ad performance and generates 3 strategies:
 *   - Safe (green): preserve what works, minimal risk
 *   - Balanced (yellow): moderate changes, calculated growth
 *   - Aggressive (red): bold moves, high risk/reward
 *
 * Operator chooses via Telegram inline buttons.
 * Actions queue through approval-queue.js.
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');
var { sendTelegram } = require('./telegram');
var telegramReview = require('./telegram-content-review');

var ADVISORY_TTL = 86400; // 24 hours
var DEFAULT_MONITORED_CAMPAIGN_ID = '120250886895070715';
var DEFAULT_MONITORED_CAMPAIGN_NAME = 'ABO - FlowCore | 80 Static Ads LIVE | Purchase | 2026-05-18 V3';

function getMonitoredCampaignContext() {
  return {
    id: process.env.ADS_MONITOR_CAMPAIGN_ID || DEFAULT_MONITORED_CAMPAIGN_ID,
    name: process.env.ADS_MONITOR_CAMPAIGN_NAME || DEFAULT_MONITORED_CAMPAIGN_NAME,
    dailyBudgetEur: parseFloat(process.env.ADS_MONITOR_DAILY_BUDGET_EUR || '40'),
    intendedActiveAds: parseInt(process.env.ADS_MONITOR_INTENDED_ACTIVE_ADS || '80', 10),
    intendedActiveAdsets: parseInt(process.env.ADS_MONITOR_INTENDED_ACTIVE_ADSETS || '8', 10)
  };
}

function rowsForCampaign(rows, campaignId) {
  if (!campaignId) return rows || [];
  return (rows || []).filter(function (row) {
    return row && String(row.campaign_id || '') === String(campaignId);
  });
}

/**
 * Generate advisory from Claude based on current ad performance.
 */
async function generateAdvisory(performanceData, currentState, timeSlot) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[AdAdvisor] ANTHROPIC_API_KEY not set');
    return null;
  }

  var campaignContext = (currentState && currentState.campaignContext) || getMonitoredCampaignContext();
  var scopedRows = rowsForCampaign(performanceData && performanceData.adRows, campaignContext.id);
  // Check if the monitored campaign has any measured ad rows.
  var hasAds = scopedRows.length > 0;
  if (!hasAds) {
    return { noAds: true };
  }

  var limits = null;
  try {
    var limitsModule = require('./limits');
    limits = await limitsModule.getLimits();
  } catch (e) {
    limits = { max_adset_budget: 50, max_daily_spend: 100, max_campaign_budget: 200 };
  }

  var prompt = buildAdvisorPrompt(performanceData, currentState, timeSlot, limits);

  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    var data = await res.json();
    if (!res.ok) {
      console.error('[AdAdvisor] Claude API error:', data.error || res.statusText);
      return null;
    }

    var text = data.content && data.content[0] ? data.content[0].text : '';
    var jsonMatch = text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[AdAdvisor] Could not parse Claude JSON');
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[AdAdvisor] Error:', err.message);
    return null;
  }
}

/**
 * Build the Claude prompt with all performance data.
 */
function buildAdvisorPrompt(perfData, state, timeSlot, limits) {
  var slotDescriptions = {
    morning: 'Plan vandaag. Wat moeten we prioriteren op basis van recente trends?',
    midday: 'Halverwege de dag. Moeten we nu bijsturen?',
    evening: 'Dag is voorbij. Wat moet er morgen anders op basis van de data van vandaag?'
  };

  var campaignContext = state.campaignContext || getMonitoredCampaignContext();
  var adRows = rowsForCampaign(perfData.adRows || [], campaignContext.id);
  var adsetRows = rowsForCampaign(perfData.adsetRows || [], campaignContext.id);
  var campaignRows = rowsForCampaign(perfData.campaignRows || [], campaignContext.id);
  var adsetConfigs = rowsForCampaign(perfData.adsetConfigs || [], campaignContext.id);
  var adsetConfigById = {};
  adsetConfigs.forEach(function (cfg) {
    if (cfg && cfg.id) adsetConfigById[cfg.id] = cfg;
  });

  // Build ad data summary for the monitored live campaign only.
  var adSummary = adRows.slice(0, 20).map(function (ad) {
    return {
      ad_id: ad.ad_id,
      ad_name: ad.ad_name || 'unnamed',
      adset_id: ad.adset_id,
      adset_name: ad.adset_name || '',
      spend: (ad.spend || 0).toFixed(2),
      ctr: (ad.ctr || 0).toFixed(2),
      cpc: (ad.cpc || 0).toFixed(2),
      atc: ad.atc || 0,
      initiate_checkouts: ad.ic || 0,
      purchases: ad.purchases || 0,
      cpa: ad.cost_per_purchase ? ad.cost_per_purchase.toFixed(2) : 'n/a',
      roas: (ad.roas || 0).toFixed(2)
    };
  });

  var adsetSummary = adsetRows.slice(0, 12).map(function (adset) {
    var cfg = adsetConfigById[adset.adset_id] || {};
    var dailyBudget = cfg.daily_budget ? parseInt(cfg.daily_budget, 10) / 100 : null;
    return {
      adset_id: adset.adset_id,
      adset_name: adset.adset_name || 'unnamed',
      spend: (adset.spend || 0).toFixed(2),
      daily_budget_eur: dailyBudget,
      roas: (adset.roas || 0).toFixed(2),
      cpa: adset.cost_per_purchase ? adset.cost_per_purchase.toFixed(2) : 'n/a',
      purchases: adset.purchases || 0
    };
  });

  var campaignSummary = campaignRows.slice(0, 3).map(function (c) {
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name || campaignContext.name,
      spend: (c.spend || 0).toFixed(2),
      purchases: c.purchases || 0,
      revenue: (c.revenue || 0).toFixed(2),
      roas: (c.roas || 0).toFixed(2)
    };
  });

  var totalSpend = adRows.reduce(function (s, a) { return s + (a.spend || 0); }, 0);
  var totalPurchases = adRows.reduce(function (s, a) { return s + (a.purchases || 0); }, 0);
  var totalRevenue = adRows.reduce(function (s, a) { return s + (a.revenue || 0); }, 0);

  var mode = state.mode || process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';

  var lines = [
    'You are the ad optimization advisor for CALQIX, a premium oral care brand running Meta ads.',
    '',
    'TIMING: This is the ' + timeSlot + ' advisory.',
    slotDescriptions[timeSlot] || '',
    '',
    'MONITORED LIVE CAMPAIGN:',
    '- Campaign ID: ' + campaignContext.id,
    '- Name: ' + campaignContext.name,
    '- Budget: EUR ' + campaignContext.dailyBudgetEur + '/day ABO',
    '- Structure: standard single-image ads, no dynamic creative, no asset_feed_spec',
    '- Intended live structure: ' + campaignContext.intendedActiveAdsets + ' active adsets and ' + campaignContext.intendedActiveAds + ' active statics',
    '',
    'CURRENT AD DATA (monitored campaign, lookback window from system):',
    'Total spend: EUR ' + totalSpend.toFixed(2),
    'Total purchases: ' + totalPurchases,
    'Total revenue: EUR ' + totalRevenue.toFixed(2),
    'Overall ROAS: ' + (totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : '0') + 'x',
    '',
    'CAMPAIGN SUMMARY:',
    JSON.stringify(campaignSummary, null, 1),
    '',
    'ACTIVE ADS (' + adSummary.length + '):',
    JSON.stringify(adSummary, null, 1),
    '',
    'ACTIVE ADSETS (' + adsetSummary.length + '):',
    JSON.stringify(adsetSummary, null, 1),
    '',
    'CURRENT STATE:',
    '- ADS_OPTIMIZATION_MODE: ' + mode,
    '- ENABLE_AD_WRITES: ' + enableWrites,
    '',
    'CURRENT LIMITS (from Redis, operator can change these):',
    '- Max adset budget: EUR ' + limits.max_adset_budget,
    '- Max daily spend: EUR ' + limits.max_daily_spend,
    '- Max campaign budget: EUR ' + limits.max_campaign_budget,
    '',
    'IMPORTANT SAFETY:',
    '- This automation must NOT create campaigns, adsets, ads, creatives, or new delivery.',
    '- This automation must NOT recommend dynamic creative, asset_feed_spec, or bulk copy options for the 80-live-static setup.',
    '- Adcopy generation is out of scope. Only mention new copy/statics as a manual follow-up when the operator supplies new images.',
    '- Any pause or budget change is approval-first. It is only a proposal until the operator explicitly approves execution.',
    '- Never recommend changing campaign budget for this ABO campaign. Budget advice is adset-level only.',
    '- Never exceed the safety limits below.',
    '',
    'RULES:',
    '- Never exceed safety limits in any suggestion',
    '- Be specific: use exact adset/ad names and IDs from the data above',
    '- Include expected impact AND risk for each option',
    '- For each strategy, include concrete "actions" only with type no_action, pause_ad, scale_adset, or adjust_adset_budget',
    '- scale_adset means raise an adset budget and MUST include new_budget_eur',
    '- adjust_adset_budget means lower an adset budget and MUST include new_budget_eur',
    '- Do not propose pause_ad unless spend and funnel data justify it',
    '- Safe should genuinely be low risk: mostly keep winners running and monitor weak data',
    '- Balanced may reallocate budget between adsets if purchase/CPA/ROAS data supports it',
    '- Aggressive still cannot create/duplicate/replace delivery; it can only propose approval-gated pause or adset-budget changes',
    '- If everything is performing well, Safe can be "change nothing"',
    '- Be honest when data is insufficient for confident recommendations',
    '- If a strategy would exceed a limit, add "limit_exceeded": true',
    '- Consider: CPA trends, ROAS by country, creative fatigue signals, spend distribution efficiency',
    '',
    'LANGUAGE: Write the "analysis", "title", "summary", "expected_impact", and "risk" fields',
    'in Dutch. The operator speaks Dutch. Keep ad names, IDs, and metrics in their',
    'original form (do not translate campaign names or metric labels like CTR/CPA/ROAS).',
    '',
    'Respond ONLY in JSON:',
    '{',
    '  "analysis": "2-3 sentence plain language summary of current performance",',
    '  "recommendations": {',
    '    "keep_running": [{"entity_type":"campaign|adset|ad","entity_id":"id","entity_name":"name","reason":"why keep running","metrics":{"spend":0,"purchases":0,"cpa":0,"roas":0,"ctr":0}}],',
    '    "less_budget": [{"entity_type":"adset","entity_id":"id","entity_name":"name","reason":"why less budget","metrics":{"spend":0,"purchases":0,"cpa":0,"roas":0},"recommended_action":"monitor|adjust_adset_budget"}],',
    '    "more_budget": [{"entity_type":"adset","entity_id":"id","entity_name":"name","reason":"why more budget","metrics":{"spend":0,"purchases":0,"cpa":0,"roas":0},"recommended_action":"scale_adset","new_budget_eur":0}],',
    '    "possible_off": [{"entity_type":"ad","entity_id":"id","entity_name":"name","reason":"why possibly pause","metrics":{"spend":0,"purchases":0,"atc":0,"ic":0,"ctr":0},"recommended_action":"pause_ad|monitor"}]',
    '  },',
    '  "strategies": [',
    '    {',
    '      "level": "safe",',
    '      "title": "Max 30 chars",',
    '      "summary": "1-2 sentences what this does",',
    '      "actions": [',
    '        {',
    '          "type": "no_action|pause_ad|scale_adset|adjust_adset_budget",',
    '          "target_id": "Meta object ID or null",',
    '          "target_name": "Human readable name",',
    '          "detail": "Specific description",',
    '          "new_budget_eur": "Required for scale_adset or adjust_adset_budget"',
    '        }',
    '      ],',
    '      "expected_impact": "What should happen",',
    '      "risk": "What could go wrong",',
    '      "limit_exceeded": false,',
    '      "needs_followup": false,',
    '      "followup_question": null,',
    '      "followup_options": null',
    '    },',
    '    { "level": "balanced", ...same structure... },',
    '    { "level": "aggressive", ...same structure... }',
    '  ]',
    '}'
  ];

  return lines.join('\n');
}

/**
 * Send advisory to Telegram with traffic light inline buttons.
 */
async function sendAdvisoryToTelegram(advisory, timeSlot) {
  if (!advisory) {
    return { sent: false, reason: 'no_advisory' };
  }

  if (advisory.noAds) {
    return sendTelegram('CALQIX Ad Advies - Geen actieve campagnes gevonden. Advies overgeslagen.');
  }

  // Store advisory in Redis
  var advisoryId = 'adv_' + Date.now().toString(36);
  var dateStr = dates.todayKey();
  var timeStr = dates.formatDateTimeAmsterdam(new Date());

  var stored = {
    id: advisoryId,
    date: dateStr,
    time: timeStr,
    slot: timeSlot,
    analysis: advisory.analysis,
    recommendations: advisory.recommendations || null,
    strategies: advisory.strategies,
    chosen: null,
    followup_answer: null,
    status: 'pending',
    created_at: timeStr
  };

  await store.set('advisory:' + advisoryId, JSON.stringify(stored), ADVISORY_TTL);

  // Build Telegram message
  var lines = [
    '<b>CALQIX Ad Advies</b> - ' + timeStr,
    '',
    advisory.analysis || 'Geen analyse beschikbaar.',
    ''
  ];

  if (advisory.recommendations) {
    formatRecommendationSection(lines, 'Laten lopen', advisory.recommendations.keep_running);
    formatRecommendationSection(lines, 'Minder budget', advisory.recommendations.less_budget);
    formatRecommendationSection(lines, 'Meer budget', advisory.recommendations.more_budget);
    formatRecommendationSection(lines, 'Mogelijk uit', advisory.recommendations.possible_off);
  }

  var emojis = { safe: '\ud83d\udfe2', balanced: '\ud83d\udfe1', aggressive: '\ud83d\udd34' };
  var labels = { safe: 'VEILIG', balanced: 'GEBALANCEERD', aggressive: 'AGRESSIEF' };

  var strategies = advisory.strategies || [];
  for (var i = 0; i < strategies.length; i++) {
    var s = strategies[i];
    var emoji = emojis[s.level] || '';
    var label = labels[s.level] || s.level.toUpperCase();

    lines.push(emoji + ' <b>' + label + ':</b> ' + (s.title || ''));
    lines.push(s.summary || '');
    lines.push('Verwacht: ' + (s.expected_impact || 'N/A'));
    lines.push('Risico: ' + (s.risk || 'N/A'));
    if (s.limit_exceeded) {
      lines.push('Waarschuwing: Overschrijdt huidig budgetlimiet');
    }
    lines.push('');
  }

  var text = lines.join('\n');

  // Build inline keyboard
  var buttons = [
    [
      { text: '\ud83d\udfe2 Veilig', callback_data: 'adv:' + advisoryId + ':safe' },
      { text: '\ud83d\udfe1 Gebalanceerd', callback_data: 'adv:' + advisoryId + ':balanced' },
      { text: '\ud83d\udd34 Agressief', callback_data: 'adv:' + advisoryId + ':aggressive' }
    ],
    [
      { text: '\ud83d\udd04 Nieuw advies', callback_data: 'adv:' + advisoryId + ':refresh' },
      { text: '\u23ed Overslaan', callback_data: 'adv:' + advisoryId + ':skip' }
    ]
  ];

  // Add "Raise limit" button if any strategy exceeds limits
  var hasLimitExceeded = strategies.some(function (s) { return s.limit_exceeded; });
  if (hasLimitExceeded) {
    buttons.push([
      { text: 'Limiet verhogen', callback_data: 'lim:custom' }
    ]);
  }

  var inlineKeyboard = { inline_keyboard: buttons };

  return sendTelegram(text, inlineKeyboard);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(value, len) {
  var s = String(value || '');
  return s.length > len ? s.substring(0, len - 3) + '...' : s;
}

function formatMetricValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 2) : null;
  }
  return String(value);
}

function formatMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return '';
  var keys = ['spend', 'purchases', 'cpa', 'roas', 'ctr', 'atc', 'ic'];
  var parts = [];
  keys.forEach(function (key) {
    var val = formatMetricValue(metrics[key]);
    if (val !== null) parts.push(key.toUpperCase() + ' ' + val);
  });
  return parts.length ? ' | ' + parts.join(', ') : '';
}

function formatRecommendationSection(lines, title, rows) {
  rows = Array.isArray(rows) ? rows : [];
  if (rows.length === 0) return;
  lines.push('<b>' + escapeHtml(title) + ':</b>');
  rows.slice(0, 4).forEach(function (row) {
    lines.push(
      '- ' + escapeHtml(truncate(row.entity_name || row.entity_id || 'unknown', 45)) +
      formatMetrics(row.metrics) +
      ' | ' + escapeHtml(truncate(row.reason || '', 90))
    );
  });
  lines.push('');
}

/**
 * Collect performance data for advisory from cached snapshot.
 */
async function getPerformanceDataForAdvisory() {
  var insightsFetcher = require('./meta-insights-fetcher');
  try {
    var snapshot = await insightsFetcher.fetchOptimizationSnapshot();
    return snapshot;
  } catch (err) {
    console.error('[AdAdvisor] Fetch snapshot error:', err.message);
    return { adRows: [], adsetRows: [], campaignRows: [] };
  }
}

/**
 * Get current state for advisory prompt.
 */
async function getCurrentState() {
  var mode = process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';
  return { mode: mode, enableWrites: enableWrites, campaignContext: getMonitoredCampaignContext() };
}

/**
 * Full advisory flow: fetch data, generate with Claude, send to Telegram.
 */
async function runAdvisory(timeSlot) {
  console.log('[AdAdvisor] Running', timeSlot, 'advisory...');

  var perfData = await getPerformanceDataForAdvisory();
  var state = await getCurrentState();

  var advisory = await generateAdvisory(perfData, state, timeSlot);
  if (!advisory) {
    console.warn('[AdAdvisor] No advisory generated for', timeSlot);
    return { ok: false, reason: 'generation_failed' };
  }

  var result = await sendAdvisoryToTelegram(advisory, timeSlot);
  console.log('[AdAdvisor]', timeSlot, 'advisory sent:', result.sent);

  return { ok: true, sent: result.sent, noAds: advisory.noAds || false };
}

module.exports = {
  generateAdvisory: generateAdvisory,
  sendAdvisoryToTelegram: sendAdvisoryToTelegram,
  getPerformanceDataForAdvisory: getPerformanceDataForAdvisory,
  getCurrentState: getCurrentState,
  runAdvisory: runAdvisory
};
