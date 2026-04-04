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
    var briefs = briefBuilder.buildAllBriefs(plan);
    var slots = ['post1', 'post2', 'reserve'];
    var reviews = [];

    for (var s = 0; s < slots.length; s++) {
      var slotName = slots[s];
      var brief = briefs[slotName];
      if (!brief) continue;

      // Use Predis-generated caption if available, otherwise fall back to brief text
      var text = slotCaptions[slotName] || brief.caption || brief.hook || brief.body || '';
      var review = await reviewWithClaude(brief.product, brief.angle, text);

      var entry = {
        slot: slotName,
        product: brief.product,
        angle: brief.angle,
        text: text,
        briefId: brief.slot + '_' + dateStr
      };

      if (review) {
        entry.score = review.total_score || 0;
        entry.verdict = review.verdict || 'UNKNOWN';
        entry.scores = review.scores || {};
        entry.issues = review.issues || [];
        entry.fixes = review.fixes || [];
        entry.decision = autoDecision(entry.score);
      } else {
        // Claude unavailable: hold as needs_approval
        entry.score = 0;
        entry.verdict = 'PENDING';
        entry.scores = {};
        entry.issues = ['Claude API unavailable'];
        entry.fixes = [];
        entry.decision = 'needs_approval';
      }

      // Execute decision
      if (entry.decision === 'auto_approved') {
        await store.set('content:approved:' + dateStr + ':' + slotName, JSON.stringify({
          brief: brief, review: entry, approvedAt: new Date().toISOString()
        }), 86400);
        await memory.recordApproval(entry.briefId, 'Auto-approved (score ' + entry.score + '/25)');
      } else if (entry.decision === 'needs_approval') {
        await approvalQueue.createItem({
          type: 'content_publish',
          entityName: slotName + ' - ' + brief.product + '/' + brief.angle,
          entityId: dateStr + ':' + slotName,
          reason: 'Score ' + entry.score + '/25 needs manual approval',
          metrics: { score: entry.score, verdict: entry.verdict },
          expectedEffect: 'Approve creative for ' + slotName,
          payload: { brief: brief, review: entry }
        });
      } else {
        await memory.recordRejection(entry.briefId, 'Auto-rejected (score ' + entry.score + '/25): ' + (entry.issues || []).join('; '));
      }

      reviews.push(entry);

      // Small delay between Claude calls
      if (s < slots.length - 1) {
        await new Promise(function (r) { setTimeout(r, 1000); });
      }
    }

    // Store reviews in Redis
    await store.set('content:reviews:' + dateStr, JSON.stringify(reviews), 14 * 86400);

    // Build and send Telegram review message
    var tgLines = ['<b>CALQIX Content Review</b> - ' + dateStr + '\n'];
    for (var r = 0; r < reviews.length; r++) {
      var rv = reviews[r];
      var statusEmoji = rv.decision === 'auto_approved' ? '\u2705' : rv.decision === 'auto_rejected' ? '\u274c' : '\u23f3';
      var statusText = rv.decision === 'auto_approved' ? 'Auto-approved' : rv.decision === 'auto_rejected' ? 'Auto-rejected' : 'Awaiting approval';

      tgLines.push((r + 1) + '. <b>' + (rv.product || '') + '</b> - ' + (rv.angle || ''));
      tgLines.push('   Score: ' + rv.score + '/25 - ' + (rv.verdict || 'N/A'));
      tgLines.push('   Text: "' + (rv.text || '').substring(0, 80) + (rv.text && rv.text.length > 80 ? '...' : '') + '"');
      tgLines.push('   Issues: ' + (rv.issues && rv.issues.length > 0 ? rv.issues.join(', ') : 'None'));
      tgLines.push('   Status: ' + statusEmoji + ' ' + statusText);
      tgLines.push('');
    }

    var pendingReviews = reviews.filter(function (rv) { return rv.decision === 'needs_approval'; });
    if (pendingReviews.length > 0) {
      tgLines.push('Reply /approve {brief_id} or /reject {brief_id}');
    }

    await sendTelegram(tgLines.join('\n'));

    // Update plan status
    plan.status = 'reviewed';
    plan.reviews = reviews.map(function (rv) { return { slot: rv.slot, score: rv.score, decision: rv.decision }; });
    await memory.setDailyPlan(dateStr, plan);

    await store.del(lockKey);

    return res.status(200).json({
      ok: true,
      date: dateStr,
      reviews: reviews.map(function (rv) { return { slot: rv.slot, score: rv.score, decision: rv.decision, verdict: rv.verdict }; }),
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
