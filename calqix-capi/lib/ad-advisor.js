/**
 * AI Ad Advisor — Claude-powered traffic light optimization strategies.
 *
 * Three times per day (morning 09:00, midday 15:00, evening 21:00),
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

/**
 * Generate advisory from Claude based on current ad performance.
 */
async function generateAdvisory(performanceData, currentState, timeSlot) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[AdAdvisor] ANTHROPIC_API_KEY not set');
    return null;
  }

  // Check if any ads are running
  var hasAds = performanceData && performanceData.adRows && performanceData.adRows.length > 0;
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
    morning: 'Plan today. What should we prioritize based on recent trends?',
    midday: 'Halfway through the day. Should we adjust now?',
    evening: 'Day is done. What should change for tomorrow based on today\'s data?'
  };

  // Build ad data summary
  var adSummary = (perfData.adRows || []).slice(0, 15).map(function (ad) {
    return {
      ad_id: ad.ad_id,
      ad_name: ad.ad_name || 'unnamed',
      spend: (ad.spend || 0).toFixed(2),
      ctr: (ad.ctr || 0).toFixed(2),
      cpc: (ad.cpc || 0).toFixed(2),
      purchases: ad.purchases || 0,
      roas: (ad.roas || 0).toFixed(2)
    };
  });

  var adsetSummary = (perfData.adsetRows || []).slice(0, 10).map(function (adset) {
    return {
      adset_id: adset.adset_id,
      adset_name: adset.adset_name || 'unnamed',
      spend: (adset.spend || 0).toFixed(2),
      daily_budget: adset.daily_budget || 'unknown',
      roas: (adset.roas || 0).toFixed(2),
      cpa: (adset.cpa || 0).toFixed(2),
      purchases: adset.purchases || 0
    };
  });

  var totalSpend = (perfData.adRows || []).reduce(function (s, a) { return s + (a.spend || 0); }, 0);
  var totalPurchases = (perfData.adRows || []).reduce(function (s, a) { return s + (a.purchases || 0); }, 0);

  var mode = state.mode || process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';

  var lines = [
    'You are the ad optimization advisor for CALQIX, a premium oral care brand running Meta ads.',
    '',
    'TIMING: This is the ' + timeSlot + ' advisory.',
    slotDescriptions[timeSlot] || '',
    '',
    'CURRENT AD DATA (last 7 days):',
    'Total spend: EUR ' + totalSpend.toFixed(2),
    'Total purchases: ' + totalPurchases,
    'Overall ROAS: ' + (totalSpend > 0 ? (totalPurchases * 30 / totalSpend).toFixed(2) : '0') + 'x',
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
    'RULES:',
    '- Never exceed safety limits in any suggestion',
    '- Be specific: use exact adset/ad names and IDs from the data above',
    '- Include expected impact AND risk for each option',
    '- Safe should genuinely be low risk',
    '- Aggressive should genuinely push boundaries (within safety limits)',
    '- If everything is performing well, Safe can be "change nothing"',
    '- Be honest when data is insufficient for confident recommendations',
    '- If a strategy would exceed a limit, add "limit_exceeded": true',
    '',
    'Respond ONLY in JSON:',
    '{',
    '  "analysis": "2-3 sentence plain language summary of current performance",',
    '  "strategies": [',
    '    {',
    '      "level": "safe",',
    '      "title": "Max 30 chars",',
    '      "summary": "1-2 sentences what this does",',
    '      "actions": [',
    '        {',
    '          "type": "pause_ad|scale_budget|duplicate_ad|change_optimization|adjust_targeting|create_adset|no_action",',
    '          "target_id": "Meta object ID or null",',
    '          "target_name": "Human readable name",',
    '          "detail": "Specific description",',
    '          "value": "New value if applicable"',
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
    return sendTelegram('CALQIX Ad Advisor - No active campaigns found. Skipping advisory.');
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
    strategies: advisory.strategies,
    chosen: null,
    followup_answer: null,
    status: 'pending',
    created_at: timeStr
  };

  await store.set('advisory:' + advisoryId, JSON.stringify(stored), ADVISORY_TTL);

  // Build Telegram message
  var lines = [
    '<b>CALQIX Ad Advisor</b> - ' + timeStr,
    '',
    advisory.analysis || 'No analysis available.',
    ''
  ];

  var emojis = { safe: '\ud83d\udfe2', balanced: '\ud83d\udfe1', aggressive: '\ud83d\udd34' };
  var labels = { safe: 'SAFE', balanced: 'BALANCED', aggressive: 'AGGRESSIVE' };

  var strategies = advisory.strategies || [];
  for (var i = 0; i < strategies.length; i++) {
    var s = strategies[i];
    var emoji = emojis[s.level] || '';
    var label = labels[s.level] || s.level.toUpperCase();

    lines.push(emoji + ' <b>' + label + ':</b> ' + (s.title || ''));
    lines.push(s.summary || '');
    lines.push('Impact: ' + (s.expected_impact || 'N/A'));
    lines.push('Risk: ' + (s.risk || 'N/A'));
    if (s.limit_exceeded) {
      lines.push('Warning: Exceeds current budget limit');
    }
    lines.push('');
  }

  var text = lines.join('\n');

  // Build inline keyboard
  var buttons = [
    [
      { text: '\ud83d\udfe2 Safe', callback_data: 'adv:' + advisoryId + ':safe' },
      { text: '\ud83d\udfe1 Balanced', callback_data: 'adv:' + advisoryId + ':balanced' },
      { text: '\ud83d\udd34 Aggressive', callback_data: 'adv:' + advisoryId + ':aggressive' }
    ],
    [
      { text: '\ud83d\udd04 New advice', callback_data: 'adv:' + advisoryId + ':refresh' },
      { text: '\u23ed Skip', callback_data: 'adv:' + advisoryId + ':skip' }
    ]
  ];

  // Add "Raise limit" button if any strategy exceeds limits
  var hasLimitExceeded = strategies.some(function (s) { return s.limit_exceeded; });
  if (hasLimitExceeded) {
    buttons.push([
      { text: 'Raise limit first', callback_data: 'lim:custom' }
    ]);
  }

  var inlineKeyboard = { inline_keyboard: buttons };

  return sendTelegram(text, inlineKeyboard);
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
  return { mode: mode, enableWrites: enableWrites };
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
