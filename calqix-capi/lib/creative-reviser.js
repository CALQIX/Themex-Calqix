/**
 * Creative Reviser - Closed-loop revision process for CALQIX creatives.
 *
 * Flow:
 *   1. Claude reviews creative -> score + issues + fixes
 *   2. If score 10-19 (NEEDS_WORK): Claude generates improved copy
 *   3. Improved copy sent to Predis for regeneration
 *   4. New creative reviewed again
 *   5. Score >= 20 -> approved | Score < 15 -> rejected | else -> manual
 *
 * Constraints:
 *   - Max 1 revision round per creative (no infinite loops)
 *   - Max 2 extra Predis credits per day for revisions
 *   - Revisions count toward daily Predis limit (max 6 calls/day)
 *   - All revisions logged in Redis: content:revisions:{DD-MM-YYYY}
 */
var fetch = require('node-fetch');
var store = require('./store');
var dates = require('./dates');
var predisClient = require('./predis-client');
var planner = require('./content-planner');

var MAX_DAILY_REVISIONS = 2;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Generate revised copy using Claude API.
 * @param {object} creative - original creative data
 * @param {object} review - Claude review result with issues/fixes
 * @returns {Promise<object|null>} revised copy or null on failure
 */
async function generateRevisedCopy(creative, review) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  var market = creative.market || 'NL';
  var marketInfo = planner.getMarketLanguage(market);
  var langLabel = marketInfo ? marketInfo.label : 'Nederlands';

  var prompt = [
    'Je bent de copy editor voor CALQIX, een premium oral care merk.',
    '',
    'ORIGINELE CREATIVE:',
    'Product: ' + (creative.product || 'onbekend'),
    'Angle: ' + (creative.angle || 'onbekend'),
    'Markt: ' + market + ' (' + langLabel + ')',
    'Tekst: "' + (creative.caption || creative.text || '') + '"',
    '',
    'REVIEW RESULTAAT:',
    'Score: ' + (review.total_score || 0) + '/25',
    'Problemen: ' + JSON.stringify(review.issues || []),
    'Suggesties: ' + JSON.stringify(review.fixes || []),
    '',
    'OPDRACHT:',
    'Herschrijf de creative copy zodat alle problemen zijn opgelost.',
    'Behoud de intentie en het product, maar verbeter:'
  ].concat((review.issues || []).map(function (i) { return '- Fix: ' + i; })).concat([
    '',
    'REGELS:',
    '- Taal: Engels (de output MOET in het Engels zijn)',
    '- Max headline: 40 karakters',
    '- Max primary text: 125 karakters',
    '- Toon: wetenschappelijk maar toegankelijk, premium, geloofwaardig',
    '- GEEN medische claims, GEEN neppe testimonials',
    '- Merknaam CALQIX en productnamen FlowCore/OralBiome/LumiCore blijven ongewijzigd',
    '- CTA: gebruik een goedgekeurde CTA (Shop Now, Try It Risk-Free, Learn More, etc.)',
    '',
    'Antwoord in JSON:',
    '{',
    '  "headline": "Verbeterde headline",',
    '  "primary_text": "Verbeterde primary text",',
    '  "caption": "Verbeterde social media caption",',
    '  "cta": "CTA tekst",',
    '  "changes_made": ["Lijst van wat er is veranderd"]',
    '}'
  ]).join('\n');

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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    var data = await res.json();
    if (!res.ok) {
      console.error('[Reviser] Claude API error:', data.error ? data.error.message : res.statusText);
      return null;
    }

    var content = data.content && data.content[0] ? data.content[0].text : '';
    var jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Reviser] Could not parse Claude revision JSON');
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Reviser] Claude revision exception:', err.message);
    return null;
  }
}

/**
 * Regenerate creative in Predis with revised copy.
 * @param {object} originalCreative - original creative data
 * @param {object} revisedCopy - Claude-generated revised copy
 * @returns {Promise<object>} updated creative object
 */
async function regenerateWithRevisedCopy(originalCreative, revisedCopy) {
  var revisedText = (revisedCopy.headline || '') + '. ' + (revisedCopy.primary_text || '');

  var payload = {
    text: revisedText,
    product_description: originalCreative.product || '',
    input_language: 'english',
    output_language: 'english'
  };

  // Add product images if available
  if (originalCreative.media_urls) {
    payload.media_urls = originalCreative.media_urls;
  }

  console.log('[Reviser] Submitting revised creative to Predis...');
  var result = await predisClient.submitJob(payload);

  return {
    post_id: result.jobId || null,
    image_url: originalCreative.image_url,
    predis_link: result.jobId ? 'https://app.predis.ai/post-details/' + result.jobId : null,
    caption: revisedCopy.caption || revisedText,
    product: originalCreative.product,
    angle: originalCreative.angle,
    slot: originalCreative.slot,
    market: originalCreative.market,
    headline: revisedCopy.headline,
    primary_text: revisedCopy.primary_text,
    cta: revisedCopy.cta,
    is_revision: true,
    revision_of: originalCreative.post_id,
    changes_made: revisedCopy.changes_made || [],
    draftOnly: result.draftOnly || false
  };
}

/**
 * Check if we can still do revisions today.
 * @returns {Promise<boolean>}
 */
async function canReviseToday() {
  var dateStr = dates.todayKey();
  var raw = await store.get('content:revisions:' + dateStr);
  if (!raw) return true;

  try {
    var revisions = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (Array.isArray(revisions) ? revisions.length : 0) < MAX_DAILY_REVISIONS;
  } catch (e) {
    return true;
  }
}

/**
 * Log a revision in Redis.
 * @param {object} revision - revision data to log
 */
async function logRevision(revision) {
  var dateStr = dates.todayKey();
  var key = 'content:revisions:' + dateStr;
  var raw = await store.get(key);
  var revisions = [];

  if (raw) {
    try { revisions = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { revisions = []; }
  }

  revisions.push({
    original_post_id: revision.original_post_id || null,
    revised_post_id: revision.revised_post_id || null,
    original_score: revision.original_score || 0,
    revised_score: revision.revised_score || 0,
    changes_made: revision.changes_made || [],
    timestamp: new Date().toISOString()
  });

  await store.set(key, JSON.stringify(revisions), 14 * 86400);
}

/**
 * Main revision flow: review -> revise -> re-review.
 *
 * @param {object} creative - creative data with post_id, caption, product, angle, etc.
 * @param {object} review - first Claude review result
 * @returns {Promise<object>} result with original, revised, reviews, and final decision
 */
async function reviewAndRevise(creative, review) {
  var score = review.total_score || 0;

  // Score >= 20: auto-approved, no revision needed
  if (score >= 20) {
    return {
      creative: creative,
      review: review,
      revised: false,
      rejected: false,
      decision: 'auto_approved'
    };
  }

  // Score < 10: too bad to revise, reject
  if (score < 10) {
    return {
      creative: creative,
      review: review,
      revised: false,
      rejected: true,
      decision: 'auto_rejected'
    };
  }

  // Score 10-19: attempt revision
  var canRevise = await canReviseToday();
  if (!canRevise) {
    console.log('[Reviser] Daily revision limit reached (' + MAX_DAILY_REVISIONS + '), skipping revision');
    return {
      creative: creative,
      review: review,
      revised: false,
      rejected: false,
      decision: score >= 15 ? 'needs_approval' : 'auto_rejected',
      skipReason: 'daily_limit_reached'
    };
  }

  console.log('[Reviser] Score ' + score + '/25 - attempting revision...');

  // Step 1: Generate revised copy
  var revisedCopy = await generateRevisedCopy(creative, review);
  if (!revisedCopy) {
    console.log('[Reviser] Failed to generate revised copy');
    return {
      creative: creative,
      review: review,
      revised: false,
      rejected: false,
      decision: score >= 15 ? 'needs_approval' : 'auto_rejected',
      skipReason: 'revision_failed'
    };
  }

  console.log('[Reviser] Revised copy generated. Changes: ' + (revisedCopy.changes_made || []).join(', '));

  // Step 2: Regenerate in Predis
  var revisedCreative = await regenerateWithRevisedCopy(creative, revisedCopy);

  // Step 3: Log revision
  await logRevision({
    original_post_id: creative.post_id,
    revised_post_id: revisedCreative.post_id,
    original_score: score,
    revised_score: 0, // will be updated after second review
    changes_made: revisedCopy.changes_made
  });

  return {
    original: creative,
    revised_creative: revisedCreative,
    original_review: review,
    revised_copy: revisedCopy,
    revised: true,
    rejected: false,
    decision: 'revision_pending'
  };
}

module.exports = {
  reviewAndRevise: reviewAndRevise,
  generateRevisedCopy: generateRevisedCopy,
  regenerateWithRevisedCopy: regenerateWithRevisedCopy,
  canReviseToday: canReviseToday,
  logRevision: logRevision,
  MAX_DAILY_REVISIONS: MAX_DAILY_REVISIONS
};
