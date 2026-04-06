/**
 * Content Review Cron — 07:05 Amsterdam
 *
 * 1. Polls Predis for completed assets
 * 2. Reviews each creative via Claude API (brand compliance scoring)
 * 3. Auto-approve (>= 20/25), manual review (15-19), auto-reject (< 15)
 * 4. Sends rich Telegram preview with scores
 */
var fetch = require('node-fetch');
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var memory = require('../../lib/content-memory');
var briefBuilder = require('../../lib/creative-brief-builder');
var predisClient = require('../../lib/predis-client');
var jobStore = require('../../lib/predis-job-store');
var { sendTelegram } = require('../../lib/telegram');
var approvalQueue = require('../../lib/approval-queue');
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var briefStore = require('../../lib/brief-store');
var envValidator = require('../../lib/env-validator');
var { sendBriefReview, sendRevisionPreview } = require('../../lib/telegram-content-review');
var creativeReviser = require('../../lib/creative-reviser');

var CLAUDE_REVIEW_PROMPT = [
  'You are a brand compliance reviewer for CALQIX, a premium oral care brand.',
  '',
  'Brand rules:',
  '- Colors: dark navy #0A1628 + white only',
  '- Tone: scientific, accessible, clinical, premium, credible, direct',
  '- Forbidden words: miracle, cure, guaranteed, proven results, dentist-approved, doctor recommended, limited time only, act now, shocking, unbelievable, cheap, bargain, 100% effective, instant results, overnight',
  '- Forbidden claims: repairs cavities, cures gum disease, whitens teeth guaranteed, FDA approved, as seen on TV',
  '- Max headline: 40 chars, max primary text: 125 chars',
  '- Never fabricate testimonials or clinical claims',
  '',
  'Review this creative:',
  'Product: {product}',
  'Angle: {angle}',
  'Text: {text}',
  'CTA: Shop Now',
  '',
  'Respond ONLY in JSON, no other text:',
  '{',
  '  "verdict": "PASS" or "NEEDS_WORK" or "FAIL",',
  '  "scores": {',
  '    "brand_alignment": 1-5,',
  '    "copy_quality": 1-5,',
  '    "claim_safety": 1-5,',
  '    "platform_fit": 1-5,',
  '    "commercial_intent": 1-5',
  '  },',
  '  "total_score": 5-25,',
  '  "issues": [],',
  '  "fixes": []',
  '}'
].join('\n');

/**
 * Call Claude API to review a creative brief.
 */
async function reviewWithClaude(product, angle, text) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[ContentReview] ANTHROPIC_API_KEY not set, skipping Claude review');
    return null;
  }

  var prompt = CLAUDE_REVIEW_PROMPT
    .replace('{product}', product || 'unknown')
    .replace('{angle}', angle || 'unknown')
    .replace('{text}', text || '');

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
      console.error('[ContentReview] Claude API error:', data.error || res.statusText);
      return null;
    }

    var content = data.content && data.content[0] ? data.content[0].text : '';
    // Extract JSON from response (handle possible markdown wrapping)
    var jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ContentReview] Could not parse Claude JSON:', content.substring(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[ContentReview] Claude exception:', err.message);
    return null;
  }
}

/**
 * Determine auto-decision based on total score.
 */
function autoDecision(totalScore) {
  if (totalScore >= 20) return 'auto_approved';
  if (totalScore >= 15) return 'needs_approval';
  return 'auto_rejected';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, '/api/cron/content-review');
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var lockKey = 'cron:lock:content-review';
    var locked = await store.get(lockKey);
    if (locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
    }
    await store.set(lockKey, '1', 300);

    var dateStr = dates.todayKey();
    var plan = await memory.getDailyPlan(dateStr);
    if (!plan) {
      await store.del(lockKey);
      return res.status(200).json({ ok: false, error: 'No plan found for ' + dateStr });
    }

    // Poll Predis jobs for completion
    var dailyJobs = await jobStore.getDailyJobs(dateStr);
    var pollResults = [];
    var slotCaptions = {};
    var slotAssets = {};
    for (var i = 0; i < dailyJobs.length; i++) {
      var job = dailyJobs[i];
      if (job.status === 'submitted') {
        var pollResult = await predisClient.pollJob(job.jobId);
        if (pollResult.ok && pollResult.status === 'completed') {
          await jobStore.recordCompletion(job.jobId, pollResult.assets);
          pollResults.push({ jobId: job.jobId, slot: job.slot, status: 'completed', assets: pollResult.assets ? pollResult.assets.length : 0 });
          if (pollResult.caption) slotCaptions[job.slot] = pollResult.caption;
          if (pollResult.assets) slotAssets[job.slot] = pollResult.assets;
        } else if (!pollResult.ok) {
          await jobStore.recordFailure(job.jobId, pollResult.error);
          pollResults.push({ jobId: job.jobId, slot: job.slot, status: 'failed', error: pollResult.error });
        } else {
          pollResults.push({ jobId: job.jobId, slot: job.slot, status: pollResult.status });
        }
      } else if (job.status === 'completed' && job.assets) {
        pollResults.push({ jobId: job.jobId, slot: job.slot, status: 'completed' });
      }
    }

    // Build briefs for review
    var briefs = await briefBuilder.buildAllBriefs(plan);
    var slots = ['post1', 'post2', 'reserve'];
    var reviews = [];

    for (var s = 0; s < slots.length; s++) {
      var slotName = slots[s];
      var brief = briefs[slotName];
      if (!brief) continue;

      // Use Predis-generated caption if available, otherwise fall back to brief text
      var text = slotCaptions[slotName] || brief.caption || brief.hook || brief.body || '';
      var review = await reviewWithClaude(brief.product, brief.angle, text);

      // Split text into headline and primary_text
      var headline = '';
      var primaryText = text;
      if (text.indexOf('\n') > -1) {
        var textParts = text.split('\n');
        headline = textParts[0].trim();
        primaryText = textParts.slice(1).join('\n').trim();
      } else if (text.length > 40) {
        // If single block, first sentence or first 40 chars as headline
        var dotIdx = text.indexOf('. ');
        if (dotIdx > 0 && dotIdx <= 60) {
          headline = text.substring(0, dotIdx + 1).trim();
          primaryText = text.substring(dotIdx + 2).trim();
        } else {
          headline = text.substring(0, 40).trim();
          primaryText = text;
        }
      } else {
        headline = text;
        primaryText = '';
      }

      // Build Claude review status
      var claudeStatus = review ? 'success' : 'failed';
      var claudeSummary = '';
      var entryScore = 0;
      var entryVerdict = 'PENDING';
      var entryScores = {};
      var entryIssues = [];
      var entryFixes = [];
      var entryDecision = 'needs_approval';

      if (review) {
        entryScore = review.total_score || 0;
        entryVerdict = review.verdict || 'UNKNOWN';
        entryScores = review.scores || {};
        entryIssues = review.issues || [];
        entryFixes = review.fixes || [];
        entryDecision = autoDecision(entryScore);
        claudeSummary = entryVerdict === 'PASS' ? 'Goedgekeurd voor menselijke review'
          : entryVerdict === 'FAIL' ? 'Hoog risico - afgewezen door Claude'
          : 'Aanpassing nodig - handmatige review vereist';

        // Revision loop: if score 10-19, attempt auto-revision via Claude + Predis
        if (entryScore >= 10 && entryScore < 20) {
          try {
            var creative = {
              post_id: null,
              caption: text,
              text: text,
              product: brief.product,
              angle: brief.angle,
              slot: slotName,
              market: brief.market || 'NL'
            };
            var revisionResult = await creativeReviser.reviewAndRevise(creative, review);
            if (revisionResult.revised) {
              console.log('[ContentReview] Revision generated for slot ' + slotName);
              claudeSummary = 'Automatisch herzien - wacht op Predis regeneratie';
              entryDecision = 'revision_pending';
              // Send revision preview to Telegram
              await sendRevisionPreview(revisionResult);
            } else if (revisionResult.skipReason) {
              console.log('[ContentReview] Revision skipped: ' + revisionResult.skipReason);
            }
          } catch (revErr) {
            console.warn('[ContentReview] Revision failed for slot ' + slotName + ':', revErr.message);
          }
        }
      } else {
        entryIssues = ['Claude API niet beschikbaar'];
        claudeSummary = 'Claude review mislukt - handmatige review vereist';
        console.error('[ContentReview] Claude review failed for slot ' + slotName + ', marking as needs_approval');
      }

      // Create approval queue item if needed
      var aqId = null;
      if (entryDecision === 'auto_approved') {
        await store.set('content:approved:' + dateStr + ':' + slotName, JSON.stringify({
          brief: brief, review: { score: entryScore, verdict: entryVerdict }, approvedAt: new Date().toISOString()
        }), 86400);
      } else if (entryDecision === 'needs_approval') {
        var aqItem = await approvalQueue.createItem({
          type: 'content_publish',
          entityName: slotName + ' - ' + brief.product + '/' + brief.angle,
          entityId: dateStr + ':' + slotName,
          reason: 'Score ' + entryScore + '/25 needs manual approval',
          metrics: { score: entryScore, verdict: entryVerdict },
          expectedEffect: 'Approve creative for ' + slotName,
          payload: { brief: brief }
        });
        aqId = aqItem ? aqItem.id : null;
      }

      // Persist brief with real brf_ ID in Redis
      var storedBrief = await briefStore.createBrief({
        dateStr: dateStr,
        slot: slotName,
        product: brief.product || '',
        angle: brief.angle || '',
        headline: headline,
        primary_text: primaryText,
        hook: brief.hook || '',
        cta: brief.cta || '',
        market: brief.market || 'NL',
        score: entryScore,
        verdict: entryVerdict,
        scores: entryScores,
        issues: entryIssues,
        fixes: entryFixes,
        decision: entryDecision,
        claude_status: claudeStatus,
        claude_review_summary: claudeSummary,
        approval_queue_id: aqId,
        raw_brief: brief
      });

      console.log('[ContentReview] Brief created:', storedBrief.brief_id, 'slot:', slotName, 'score:', entryScore, 'decision:', entryDecision);

      // Record in content memory
      if (entryDecision === 'auto_approved') {
        await memory.recordApproval(storedBrief.brief_id, 'Auto-approved (score ' + entryScore + '/25)');
      } else if (entryDecision === 'auto_rejected') {
        await memory.recordRejection(storedBrief.brief_id, 'Auto-rejected (score ' + entryScore + '/25): ' + entryIssues.join('; '));
      }

      var entry = {
        slot: slotName,
        product: brief.product,
        angle: brief.angle,
        text: text,
        headline: headline,
        primary_text: primaryText,
        brief_id: storedBrief.brief_id,
        score: entryScore,
        verdict: entryVerdict,
        scores: entryScores,
        issues: entryIssues,
        fixes: entryFixes,
        decision: entryDecision,
        claude_status: claudeStatus,
        claude_review_summary: claudeSummary
      };

      reviews.push(entry);

      // Small delay between Claude calls
      if (s < slots.length - 1) {
        await new Promise(function (r) { setTimeout(r, 1000); });
      }
    }

    // Store reviews in Redis
    await store.set('content:reviews:' + dateStr, JSON.stringify(reviews), 14 * 86400);

    // Send one Telegram message per brief with inline buttons
    console.log('[ContentReview] Sending', reviews.length, 'brief review messages to Telegram');
    for (var r = 0; r < reviews.length; r++) {
      var rv = reviews[r];
      try {
        await sendBriefReview(rv, r + 1, reviews.length);
        console.log('[ContentReview] Sent review message for brief', rv.brief_id);
      } catch (tgErr) {
        console.error('[ContentReview] Failed to send Telegram for brief', rv.brief_id, ':', tgErr.message);
      }
      // Small delay between Telegram messages to avoid rate limits
      if (r < reviews.length - 1) {
        await new Promise(function (wait) { setTimeout(wait, 500); });
      }
    }

    // Update plan status
    plan.status = 'reviewed';
    plan.reviews = reviews.map(function (rv) { return { slot: rv.slot, score: rv.score, decision: rv.decision }; });
    await memory.setDailyPlan(dateStr, plan);

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      reviews: reviews.map(function (rv) { return { slot: rv.slot, brief_id: rv.brief_id, score: rv.score, decision: rv.decision, verdict: rv.verdict }; }),
      pollResults: pollResults,
      auth_source: auth.source
    });
  } catch (err) {
    console.error('[ContentReview] Error:', err.message);
    try { await sendTelegram('CALQIX Content Review - ERROR\n' + err.message); } catch (e) { /* ignore */ }
    await store.del('cron:lock:content-review');
    return res.status(200).json({ ok: false, error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
