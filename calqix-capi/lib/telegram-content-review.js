/**
 * Telegram Content Review — sends content previews and ad action proposals to Telegram.
 *
 * Supports:
 *   - Daily content preview summaries
 *   - Ad optimization action proposals
 *   - Action execution confirmations
 *   - Approval queue summaries
 */
var fetch = require('node-fetch');
var { sendTelegram } = require('./telegram');
var approvalQueue = require('./approval-queue');
var store = require('./store');
var dates = require('./dates');

var BASE_URL = process.env.VERCEL_URL
  ? 'https://' + process.env.VERCEL_URL
  : 'https://calqix-capi.vercel.app';

/**
 * Send daily content review summary to Telegram.
 * @param {object} plan — from content-planner
 * @param {object} briefs — from creative-brief-builder { post1, post2, reserve }
 * @param {object} [jobSummary] — from predis-job-store
 * @returns {Promise<object>}
 */
async function sendContentReview(plan, briefs, jobSummary) {
  var lines = ['\ud83c\udfa8 <b>CALQIX Daily Content Review — ' + plan.date + '</b>\n'];

  // Post 1
  lines.push('\ud83d\udfe2 <b>POST 1 (08:30 — Awareness)</b>');
  formatPostPreview(lines, briefs.post1);
  lines.push('');

  // Post 2
  lines.push('\ud83d\udfe0 <b>POST 2 (18:30 — Conversion)</b>');
  formatPostPreview(lines, briefs.post2);
  lines.push('');

  // Reserve
  lines.push('\u26aa <b>RESERVE POST</b>');
  formatPostPreview(lines, briefs.reserve);
  lines.push('');

  // Meta-backed indicator
  if (plan.metaSignalsUsed) {
    lines.push('\ud83d\udcca <b>Meta-informed:</b> Yes — angles based on ad performance data');
  } else {
    lines.push('\ud83d\udcca <b>Meta-informed:</b> No — using rotation + memory only');
  }

  // Job summary
  if (jobSummary) {
    lines.push('\n\ud83d\udd27 <b>Generation:</b> ' + jobSummary.completed + ' completed, ' +
      jobSummary.failed + ' failed, ' + jobSummary.draftOnly + ' draft-only');
  }

  // Approval controls
  lines.push('\n\ud83d\udcdd <b>Actions:</b>');
  lines.push('Approve: <code>' + BASE_URL + '/api/approval/approve?id={JOB_ID}</code>');
  lines.push('Reject: <code>' + BASE_URL + '/api/approval/reject?id={JOB_ID}</code>');

  var mode = process.env.CONTENT_AUTOMATION_MODE || 'DRAFT_ONLY';
  lines.push('\n\u2699\ufe0f Mode: <b>' + mode + '</b>');

  return sendTelegram(lines.join('\n'));
}

/**
 * Format a single post preview for Telegram.
 */
function formatPostPreview(lines, brief) {
  lines.push('\u2022 <b>Product:</b> ' + (brief.product || 'unknown'));
  lines.push('\u2022 <b>Angle:</b> ' + (brief.angle || 'unknown'));
  lines.push('\u2022 <b>Pillar:</b> ' + (brief.pillar || 'unknown'));
  lines.push('\u2022 <b>Confidence:</b> ' + (brief.confidence || 0) + '/100' + (brief.metaBacked ? ' \u2b50 Meta-backed' : ''));
  lines.push('\u2022 <b>Hook:</b> ' + truncate(brief.hook || '', 80));
  lines.push('\u2022 <b>CTA:</b> ' + (brief.cta || ''));
  lines.push('\u2022 <b>Format:</b> ' + (brief.format || '') + ' ' + (brief.aspectRatio || ''));
}

/**
 * Send ad optimization report to Telegram.
 * @param {object} results — { executed, queued, skipped } from ad-action-executor
 * @param {object} snapshot — performance snapshot summary
 * @param {string} mode — MONITOR_ONLY | SUGGEST | AUTO_EXECUTE
 * @returns {Promise<object>}
 */
async function sendAdOptimizationReport(results, snapshot, mode) {
  var lines = ['\ud83d\udcc8 <b>CALQIX Ad Optimization Report</b>\n'];
  lines.push('\u2699\ufe0f Mode: <b>' + mode + '</b>\n');

  // Executed actions
  if (results.executed && results.executed.length > 0) {
    lines.push('\u2705 <b>EXECUTED:</b>');
    results.executed.forEach(function (e) {
      var p = e.proposal;
      lines.push('\u2022 ' + p.action + ': ' + p.entityName);
      lines.push('  Reason: ' + truncate(p.reason, 80));
    });
    lines.push('');
  }

  // Queued for approval
  if (results.queued && results.queued.length > 0) {
    lines.push('\u23f3 <b>AWAITING APPROVAL:</b>');
    results.queued.forEach(function (q) {
      var p = q.proposal;
      var qid = q.result.queueId || '';
      lines.push('\u2022 ' + p.action + ': ' + p.entityName);
      lines.push('  Reason: ' + truncate(p.reason, 80));
      lines.push('  Approve: <code>' + BASE_URL + '/api/approval/approve?id=' + qid + '</code>');
    });
    lines.push('');
  }

  // Flagged / skipped
  var flagged = (results.skipped || []).filter(function (s) {
    return s.proposal.action === 'flag_fatigue' || s.proposal.action === 'flag_spend_starved' || s.proposal.action === 'flag_review';
  });
  if (flagged.length > 0) {
    lines.push('\u26a0\ufe0f <b>FLAGGED FOR REVIEW:</b>');
    flagged.forEach(function (f) {
      var p = f.proposal;
      lines.push('\u2022 ' + p.rule + ': ' + p.entityName + ' — ' + truncate(p.reason, 60));
    });
    lines.push('');
  }

  // Top 3 ads
  if (snapshot && snapshot.adRows) {
    var topAds = snapshot.adRows.slice(0, 3);
    if (topAds.length > 0) {
      lines.push('\ud83c\udfc6 <b>TOP 3 ADS:</b>');
      topAds.forEach(function (ad) {
        lines.push('\u2022 ' + truncate(ad.ad_name, 25) + ' | \u20ac' + ad.spend.toFixed(2) +
          ' | CTR ' + ad.ctr.toFixed(1) + '% | ROAS ' + ad.roas.toFixed(2) + 'x');
      });
      lines.push('');
    }
  }

  // Daily totals
  if (snapshot && snapshot.todayAdsetRows) {
    var todaySpend = snapshot.todayAdsetRows.reduce(function (s, r) { return s + r.spend; }, 0);
    lines.push('\ud83d\udcb0 Today spend: \u20ac' + todaySpend.toFixed(2));
  }

  // Approval queue summary
  var queueSummary = await approvalQueue.getQueueSummary();
  lines.push('\n\ud83d\udceb Queue: ' + queueSummary.pending + ' pending, ' + queueSummary.approved + ' approved, ' + queueSummary.executed + ' executed');

  return sendTelegram(lines.join('\n'));
}

/**
 * Send action execution confirmation.
 */
async function sendActionConfirmation(item, result) {
  var emoji = result.ok ? '\u2705' : '\u274c';
  var lines = [
    emoji + ' <b>Ad Action ' + (result.ok ? 'Executed' : 'Failed') + '</b>',
    '',
    '\u2022 Action: ' + item.type,
    '\u2022 Target: ' + item.entityName,
    '\u2022 Reason: ' + item.reason,
    result.ok ? '\u2022 Result: Success' : '\u2022 Error: ' + (result.error || 'unknown')
  ];
  return sendTelegram(lines.join('\n'));
}

/**
 * Send daily close summary to Telegram.
 */
async function sendDailyCloseSummary(date, actionLog, fatigueSummary, topAds, worstAds, queueSummary, contentSummary) {
  var lines = ['\ud83c\udf19 <b>CALQIX Daily Close — ' + date + '</b>\n'];

  // Action recap
  var executed = actionLog.filter(function (a) { return a.type === 'execution' && a.success; }).length;
  var queued = actionLog.filter(function (a) { return a.type === 'queued'; }).length;
  var evaluations = actionLog.filter(function (a) { return a.type === 'evaluation'; }).length;
  lines.push('\ud83d\udcca <b>Ad Actions:</b> ' + executed + ' executed, ' + queued + ' queued, ' + evaluations + ' evaluated');

  // Fatigue recap
  if (fatigueSummary && fatigueSummary.length > 0) {
    lines.push('\n\ud83d\udd25 <b>Fatigued Ads:</b>');
    fatigueSummary.forEach(function (f) {
      lines.push('\u2022 ' + f.adName + ' — CTR dropped ' + f.ctrDeclinePct.toFixed(0) + '% from peak');
    });
  }

  // Top and worst
  if (topAds && topAds.length > 0) {
    lines.push('\n\ud83c\udfc6 <b>Best:</b> ' + topAds[0].ad_name + ' (ROAS ' + topAds[0].roas.toFixed(2) + 'x)');
  }
  if (worstAds && worstAds.length > 0) {
    lines.push('\ud83d\udc4e <b>Worst:</b> ' + worstAds[0].ad_name + ' (CTR ' + worstAds[0].ctr.toFixed(2) + '%)');
  }

  // Content summary
  if (contentSummary) {
    lines.push('\n\ud83d\udcdd <b>Content:</b>');
    if (contentSummary.planExists) {
      lines.push('\u2022 Plan: ' + (contentSummary.anglesUsed || []).join(', '));
      lines.push('\u2022 Predis: ' + (contentSummary.predisCompleted || 0) + ' completed, ' + (contentSummary.predisFailed || 0) + ' failed');
      lines.push('\u2022 Reviews: ' + (contentSummary.reviews || []).map(function (r) { return r.slot + ' ' + r.score + '/25'; }).join(', '));
      lines.push('\u2022 Published: ' + (contentSummary.publishCount || 0));
    } else {
      lines.push('\u2022 No content plan today');
    }
  }

  // Queue recap
  if (queueSummary) {
    lines.push('\n\ud83d\udceb <b>Queue:</b> ' + queueSummary.pending + ' pending, ' + queueSummary.executed + ' executed, ' + queueSummary.rejected + ' rejected');
  }

  return sendTelegram(lines.join('\n'));
}

/**
 * Send a photo to Telegram with optional caption and inline keyboard.
 */
async function sendTelegramPhoto(photoUrl, caption, replyMarkup) {
  var token = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: 'missing_env_vars' };

  var url = 'https://api.telegram.org/bot' + token + '/sendPhoto';
  var body = {
    chat_id: chatId,
    photo: photoUrl,
    parse_mode: 'HTML'
  };
  // Telegram photo caption max 1024 chars
  if (caption) body.caption = caption.substring(0, 1024);
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);

  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!data.ok) {
      console.error('[TelegramPhoto] API error:', data.description);
      return { sent: false, reason: data.description };
    }
    return { sent: true, message_id: data.result.message_id };
  } catch (err) {
    console.error('[TelegramPhoto] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Send creative preview to Telegram with image and approve/reject buttons.
 */
async function sendCreativePreview(creative, reviewResult) {
  var imageUrl = creative.image_url;
  var postId = creative.post_id;
  var dateStr = dates.formatDateAmsterdam(new Date());

  var captionLines = [
    'CALQIX Creative Review - ' + dateStr,
    '',
    'Product: ' + (creative.product || 'N/A') + ' | Angle: ' + (creative.angle || 'N/A'),
    'Slot: ' + (creative.slot || 'N/A')
  ];

  if (reviewResult) {
    captionLines.push('Score: ' + (reviewResult.total_score || 0) + '/25 - ' + (reviewResult.verdict || 'N/A'));
    if (reviewResult.issues && reviewResult.issues.length > 0) {
      captionLines.push('Issues: ' + reviewResult.issues.slice(0, 3).join(', '));
    }
  }

  var captionText = (creative.caption || '').substring(0, 200);
  if (captionText) {
    captionLines.push('');
    captionLines.push('Caption: "' + captionText + '"');
  }

  if (creative.predis_link) {
    captionLines.push('');
    captionLines.push('Predis: ' + creative.predis_link);
  }

  captionLines.push('');
  captionLines.push('Image expires in ~1 hour. Approve quickly or re-generate.');

  var caption = captionLines.join('\n');

  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: 'content_approve:' + postId },
        { text: 'Reject', callback_data: 'content_reject:' + postId }
      ],
      [
        { text: 'Open in Predis', url: creative.predis_link || 'https://app.predis.ai' }
      ]
    ]
  };

  if (imageUrl) {
    return sendTelegramPhoto(imageUrl, caption, inlineKeyboard);
  } else {
    // Fallback: text message if no image
    return sendTelegram(caption + '\n\n(Image not available)', inlineKeyboard);
  }
}

/**
 * Review a creative with Claude and send Telegram preview.
 * Called from predis-callback webhook for instant review.
 */
async function reviewAndPreview(creative) {
  var reviewResult = null;

  // Claude review
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      var prompt = [
        'You are a brand compliance reviewer for CALQIX, a premium oral care brand.',
        '',
        'Brand rules:',
        '- Tone: scientific, accessible, clinical, premium, credible, direct',
        '- Forbidden: miracle, cure, guaranteed, proven results, dentist-approved, limited time only, act now, shocking, cheap, 100% effective, instant results',
        '- Max headline: 40 chars, max primary text: 125 chars',
        '',
        'Review this creative:',
        'Product: ' + (creative.product || 'unknown'),
        'Angle: ' + (creative.angle || 'unknown'),
        'Text: ' + (creative.caption || ''),
        '',
        'Respond ONLY in JSON:',
        '{"verdict":"PASS|NEEDS_WORK|FAIL","scores":{"brand_alignment":1-5,"copy_quality":1-5,"claim_safety":1-5,"platform_fit":1-5,"commercial_intent":1-5},"total_score":5-25,"issues":[],"fixes":[]}'
      ].join('\n');

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
      if (res.ok && data.content && data.content[0]) {
        var jsonMatch = data.content[0].text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          reviewResult = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (err) {
      console.warn('[ReviewAndPreview] Claude review failed:', err.message);
    }
  }

  // Store review result in Redis
  if (reviewResult) {
    var dateStr = dates.todayKey();
    var reviewEntry = {
      post_id: creative.post_id,
      slot: creative.slot,
      product: creative.product,
      angle: creative.angle,
      score: reviewResult.total_score || 0,
      verdict: reviewResult.verdict || 'UNKNOWN',
      decision: (reviewResult.total_score || 0) >= 20 ? 'auto_approved' : (reviewResult.total_score || 0) >= 15 ? 'needs_approval' : 'auto_rejected',
      reviewedAt: new Date().toISOString()
    };

    // Append to daily reviews list
    var existingRaw = await store.get('content:reviews:' + dateStr);
    var reviews = [];
    if (existingRaw) {
      try { reviews = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw; } catch (e) { reviews = []; }
    }
    reviews.push(reviewEntry);
    await store.set('content:reviews:' + dateStr, JSON.stringify(reviews), 14 * 86400);

    // Auto-approve high scores
    if (reviewEntry.decision === 'auto_approved') {
      await store.set('content:approved:' + dateStr + ':' + creative.slot, JSON.stringify({
        creative: creative, review: reviewEntry, approvedAt: new Date().toISOString()
      }), 86400);
    } else if (reviewEntry.decision === 'needs_approval') {
      await approvalQueue.createItem({
        type: 'content_publish',
        entityName: creative.slot + ' - ' + creative.product + '/' + creative.angle,
        entityId: dateStr + ':' + creative.slot,
        reason: 'Score ' + reviewEntry.score + '/25 needs manual approval',
        metrics: { score: reviewEntry.score, verdict: reviewEntry.verdict },
        expectedEffect: 'Approve creative for ' + creative.slot,
        payload: { creative: creative, review: reviewEntry }
      });
    }
  }

  // Send Telegram preview with image + buttons
  await sendCreativePreview(creative, reviewResult);
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.substring(0, len - 3) + '...' : s;
}

module.exports = {
  sendContentReview: sendContentReview,
  sendAdOptimizationReport: sendAdOptimizationReport,
  sendActionConfirmation: sendActionConfirmation,
  sendDailyCloseSummary: sendDailyCloseSummary,
  sendCreativePreview: sendCreativePreview,
  sendTelegramPhoto: sendTelegramPhoto,
  reviewAndPreview: reviewAndPreview
};
