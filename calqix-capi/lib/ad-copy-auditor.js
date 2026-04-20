/**
 * Ad Copy Auditor - Analyzes active Meta ad copy via Claude and suggests improvements.
 *
 * Runs 1x per day as part of the morning ad chain.
 * Does NOT auto-update ads - sends suggestions to Telegram with approve buttons.
 *
 * Constraints:
 *   - Only audits ads NOT in learning phase (>500 impressions)
 *   - Max 1 audit per day (idempotent via Redis lock)
 *   - Never updates ads in learning phase
 *   - Suggestions sent to Telegram with per-ad approve/skip buttons
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');
var { sendTelegram } = require('./telegram');

var AD_ACCOUNT_ID = function () { return process.env.META_AD_ACCOUNT_ID || 'act_2108393566376667'; };
var META_TOKEN = function () { return process.env.META_ACCESS_TOKEN || ''; };
var API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
var BASE_URL = 'https://graph.facebook.com/' + API_VERSION;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Fetch active ads with their creative copy.
 * @returns {Promise<Array>} list of active ads with copy data
 */
async function fetchActiveAds() {
  var token = META_TOKEN();
  if (!token) {
    console.warn('[AdCopyAudit] META_ACCESS_TOKEN not set');
    return [];
  }

  var url = BASE_URL + '/' + AD_ACCOUNT_ID() + '/ads?'
    + 'fields=id,name,status,effective_status,creative{body,title,link_description,object_story_spec},insights.date_preset(last_3d){impressions,clicks,ctr,spend,actions}'
    + '&effective_status=["ACTIVE"]'
    + '&limit=20'
    + '&access_token=' + token;

  try {
    var res = await fetch(url);
    var data = await res.json();
    if (data.error) {
      console.error('[AdCopyAudit] Meta API error:', data.error.message);
      return [];
    }
    return data.data || [];
  } catch (err) {
    console.error('[AdCopyAudit] Fetch error:', err.message);
    return [];
  }
}

/**
 * Analyze ad copy via Claude and generate improvement suggestions.
 * @param {Array} ads - active ads from Meta
 * @returns {Promise<object|null>} Claude analysis result
 */
async function analyzeWithClaude(ads) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  var adData = ads.map(function (ad) {
    var creative = ad.creative || {};
    var insights = ad.insights && ad.insights.data && ad.insights.data[0] ? ad.insights.data[0] : {};
    var actions = insights.actions || [];
    // Priority-pick (not sum) — Meta returns overlapping purchase rows.
    var purchases = 0;
    var PURCHASE_PRIORITY = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];
    for (var p = 0; p < PURCHASE_PRIORITY.length && purchases === 0; p++) {
      for (var a = 0; a < actions.length; a++) {
        if (actions[a].action_type === PURCHASE_PRIORITY[p]) {
          purchases = parseInt(actions[a].value) || 0;
          break;
        }
      }
    }

    return {
      id: ad.id,
      name: ad.name,
      headline: creative.title || '',
      body: creative.body || '',
      link_description: creative.link_description || '',
      impressions: parseInt(insights.impressions) || 0,
      clicks: parseInt(insights.clicks) || 0,
      ctr: insights.ctr || '0',
      spend: insights.spend || '0',
      purchases: purchases
    };
  });

  // Only audit ads with enough data (>500 impressions)
  var eligibleAds = adData.filter(function (a) { return a.impressions > 500; });
  if (eligibleAds.length === 0) {
    console.log('[AdCopyAudit] No ads with >500 impressions to audit');
    return null;
  }

  var prompt = 'Analyseer deze actieve CALQIX Meta advertenties en geef per ad een optimalisatiesuggestie.\n\n'
    + 'ACTIEVE ADS:\n' + JSON.stringify(eligibleAds, null, 2) + '\n\n'
    + 'MERK: CALQIX - Premium oral care (nano-hydroxyapatite tandpasta tabletten + draadloze waterflosser + probiotische mondtabletten)\n'
    + 'TOON: Wetenschappelijk, premium, geloofwaardig, direct\n\n'
    + 'Geef per ad:\n'
    + '1. Huidige sterkte (1-5)\n'
    + '2. Grootste zwakte\n'
    + '3. Concrete verbetering (exacte nieuwe tekst)\n\n'
    + 'Focus op: hook kracht, waardepropositie duidelijkheid, CTA effectiviteit, en markt-specifieke toon.\n\n'
    + 'Antwoord in JSON:\n'
    + '{\n'
    + '  "ad_reviews": [\n'
    + '    {\n'
    + '      "ad_id": "...",\n'
    + '      "ad_name": "...",\n'
    + '      "score": 1-5,\n'
    + '      "weakness": "...",\n'
    + '      "improved_headline": "...",\n'
    + '      "improved_body": "...",\n'
    + '      "rationale": "..."\n'
    + '    }\n'
    + '  ],\n'
    + '  "top_recommendation": "De belangrijkste actie die nu genomen moet worden"\n'
    + '}';

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
      console.error('[AdCopyAudit] Claude error:', data.error ? data.error.message : res.statusText);
      return null;
    }

    var content = data.content && data.content[0] ? data.content[0].text : '';
    var jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[AdCopyAudit] Claude exception:', err.message);
    return null;
  }
}

/**
 * Send audit results to Telegram with per-ad action buttons.
 * @param {object} analysis - Claude analysis result
 * @returns {Promise<void>}
 */
async function sendAuditToTelegram(analysis) {
  if (!analysis || !analysis.ad_reviews || analysis.ad_reviews.length === 0) return;

  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + now.getFullYear();

  // Summary message
  var summaryLines = [
    '<b>CALQIX Ad Copy Audit - ' + dateStr + '</b>',
    '',
    'Ads geanalyseerd: ' + analysis.ad_reviews.length,
    ''
  ];

  var lowScoreAds = analysis.ad_reviews.filter(function (r) { return r.score < 4; });
  if (lowScoreAds.length > 0) {
    summaryLines.push('Ads met verbeterpotentieel: ' + lowScoreAds.length);
  }

  if (analysis.top_recommendation) {
    summaryLines.push('');
    summaryLines.push('<b>Top aanbeveling:</b>');
    summaryLines.push(analysis.top_recommendation);
  }

  await sendTelegram(summaryLines.join('\n'));
  await sleep(500);

  // Per-ad messages with buttons for low-score ads
  for (var i = 0; i < analysis.ad_reviews.length; i++) {
    var review = analysis.ad_reviews[i];
    var scoreEmoji = review.score >= 4 ? '\u2705' : review.score >= 3 ? '\u26a0\ufe0f' : '\u274c';

    var adLines = [
      scoreEmoji + ' <b>' + escapeHtml(review.ad_name || review.ad_id) + '</b> (Score: ' + review.score + '/5)',
      '',
      '<b>Zwakte:</b> ' + escapeHtml(review.weakness || 'geen'),
      ''
    ];

    if (review.improved_headline) {
      adLines.push('<b>Verbeterde headline:</b>');
      adLines.push('"' + escapeHtml(review.improved_headline) + '"');
    }
    if (review.improved_body) {
      adLines.push('<b>Verbeterde body:</b>');
      adLines.push('"' + escapeHtml(truncate(review.improved_body, 200)) + '"');
    }
    if (review.rationale) {
      adLines.push('');
      adLines.push('<i>' + escapeHtml(review.rationale) + '</i>');
    }

    var replyMarkup = null;
    if (review.score < 4 && review.ad_id) {
      // Store the improved copy in Redis for later execution
      await store.set('adcopy:pending:' + review.ad_id, JSON.stringify({
        ad_id: review.ad_id,
        improved_headline: review.improved_headline,
        improved_body: review.improved_body,
        rationale: review.rationale,
        timestamp: new Date().toISOString()
      }), 86400);

      replyMarkup = {
        inline_keyboard: [
          [
            { text: '\u270f\ufe0f Pas aan', callback_data: 'adcopy:update:' + review.ad_id },
            { text: '\u23ed\ufe0f Overslaan', callback_data: 'adcopy:skip:' + review.ad_id }
          ]
        ]
      };
    }

    await sendTelegram(adLines.join('\n'), replyMarkup);
    await sleep(300);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.substring(0, len - 3) + '...' : s;
}

/**
 * Run the full ad copy audit.
 * Idempotent: max 1 run per day via Redis lock.
 * @returns {Promise<object>} audit result summary
 */
async function runAudit() {
  var dateStr = dates.todayKey();
  var lockKey = 'adcopy:audit:' + dateStr;
  var existing = await store.get(lockKey);
  if (existing) {
    console.log('[AdCopyAudit] Already ran today, skipping');
    return { skipped: true, reason: 'already_ran_today' };
  }

  console.log('[AdCopyAudit] Starting daily ad copy audit...');

  // Fetch active ads
  var ads = await fetchActiveAds();
  if (ads.length === 0) {
    console.log('[AdCopyAudit] No active ads found');
    return { skipped: true, reason: 'no_active_ads' };
  }

  console.log('[AdCopyAudit] Found ' + ads.length + ' active ads');

  // Analyze with Claude
  var analysis = await analyzeWithClaude(ads);
  if (!analysis) {
    console.log('[AdCopyAudit] Analysis failed or no eligible ads');
    return { skipped: true, reason: 'analysis_failed' };
  }

  // Send to Telegram
  await sendAuditToTelegram(analysis);

  // Store result and set lock
  await store.set(lockKey, JSON.stringify({
    ran_at: new Date().toISOString(),
    ads_analyzed: analysis.ad_reviews ? analysis.ad_reviews.length : 0,
    top_recommendation: analysis.top_recommendation
  }), 86400);

  console.log('[AdCopyAudit] Audit complete. ' + (analysis.ad_reviews ? analysis.ad_reviews.length : 0) + ' ads analyzed');

  return {
    skipped: false,
    ads_analyzed: analysis.ad_reviews ? analysis.ad_reviews.length : 0,
    low_score_ads: analysis.ad_reviews ? analysis.ad_reviews.filter(function (r) { return r.score < 4; }).length : 0,
    top_recommendation: analysis.top_recommendation
  };
}

module.exports = {
  runAudit: runAudit,
  fetchActiveAds: fetchActiveAds,
  analyzeWithClaude: analyzeWithClaude
};
