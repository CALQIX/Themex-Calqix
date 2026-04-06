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

var planner = require('./content-planner');

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
  var lines = ['\ud83c\udfa8 <b>CALQIX Content Overzicht - ' + dates.formatDateAmsterdam(new Date()) + '</b>\n'];

  // Post 1
  lines.push('\ud83d\udfe2 <b>POST 1 (08:30 - Awareness)</b>');
  formatPostPreview(lines, briefs.post1);
  lines.push('');

  // Post 2
  lines.push('\ud83d\udfe0 <b>POST 2 (18:30 - Conversie)</b>');
  formatPostPreview(lines, briefs.post2);
  lines.push('');

  // Reserve
  lines.push('\u26aa <b>RESERVE POST</b>');
  formatPostPreview(lines, briefs.reserve);
  lines.push('');

  // Meta-backed indicator
  if (plan.metaSignalsUsed) {
    lines.push('\ud83d\udcca <b>Meta-data:</b> Ja - hoeken gebaseerd op ad prestaties');
  } else {
    lines.push('\ud83d\udcca <b>Meta-data:</b> Nee - rotatie + geheugen');
  }

  // Job summary
  if (jobSummary) {
    lines.push('\n\ud83d\udd27 <b>Generatie:</b> ' + jobSummary.completed + ' voltooid, ' +
      jobSummary.failed + ' mislukt, ' + jobSummary.draftOnly + ' concept');
  }

  // Note: individual briefs are now sent as separate messages with inline buttons
  lines.push('\n\ud83d\udcdd Individuele reviews worden hieronder verstuurd met knoppen.');

  var mode = process.env.CONTENT_AUTOMATION_MODE || 'DRAFT_ONLY';
  lines.push('\n\u2699\ufe0f Modus: <b>' + mode + '</b>');

  return sendTelegram(lines.join('\n'));
}

/**
 * Format a single post preview for Telegram.
 */
function formatPostPreview(lines, brief) {
  var mkt = planner.getMarketLanguage(brief.market || 'NL');
  var adLang = brief.ad_output_language || mkt.output_language;
  lines.push('\u2022 <b>Product:</b> ' + (brief.product || 'onbekend'));
  lines.push('\u2022 <b>Hoek:</b> ' + (brief.angle || 'onbekend'));
  lines.push('\u2022 <b>Pilaar:</b> ' + (brief.pillar || 'onbekend'));
  lines.push('\u2022 <b>Markt:</b> ' + (brief.market || 'NL') + ' (' + mkt.label + ')');
  lines.push('\u2022 <b>Content taal:</b> English | <b>Ad taal:</b> ' + adLang);
  lines.push('\u2022 <b>Vertrouwen:</b> ' + (brief.confidence || 0) + '/100' + (brief.metaBacked ? ' \u2b50 Meta-backed' : ''));
  lines.push('\u2022 <b>Hook:</b> ' + truncate(brief.hook || '', 80));
  lines.push('\u2022 <b>CTA:</b> ' + (brief.cta || ''));
  lines.push('\u2022 <b>Formaat:</b> ' + (brief.format || '') + ' ' + (brief.aspectRatio || ''));
}

/**
 * Send ad optimization report to Telegram.
 * @param {object} results — { executed, queued, skipped } from ad-action-executor
 * @param {object} snapshot — performance snapshot summary
 * @param {string} mode — MONITOR_ONLY | SUGGEST | AUTO_EXECUTE
 * @returns {Promise<object>}
 */
async function sendAdOptimizationReport(results, snapshot, mode) {
  var lines = ['\ud83d\udcc8 <b>CALQIX Ad Rapport - ' + dates.formatDateTimeAmsterdam(new Date()) + '</b>\n'];
  var modeLabels = { 'EXECUTE': 'LIVE', 'AUTO_EXECUTE': 'LIVE', 'SUGGEST': 'SUGGESTIE', 'MONITOR_ONLY': 'MONITOR' };
  lines.push('\u2699\ufe0f Modus: <b>' + (modeLabels[mode] || mode) + '</b>\n');

  // Executed actions
  if (results.executed && results.executed.length > 0) {
    lines.push('\u2705 <b>UITGEVOERD:</b>');
    results.executed.forEach(function (e) {
      var p = e.proposal;
      lines.push('\u2022 ' + p.action + ': ' + p.entityName);
      lines.push('  Reden: ' + truncate(p.reason, 80));
    });
    lines.push('');
  }

  // Queued for approval
  if (results.queued && results.queued.length > 0) {
    lines.push('\u23f3 <b>WACHT OP GOEDKEURING:</b>');
    results.queued.forEach(function (q) {
      var p = q.proposal;
      var qid = q.result.queueId || '';
      lines.push('\u2022 ' + p.action + ': ' + p.entityName);
      lines.push('  Reden: ' + truncate(p.reason, 80));
      lines.push('  Goedkeuren: <code>' + BASE_URL + '/api/approval/approve?id=' + qid + '</code>');
    });
    lines.push('');
  }

  // Flagged / skipped
  var flagged = (results.skipped || []).filter(function (s) {
    return s.proposal.action === 'flag_fatigue' || s.proposal.action === 'flag_spend_starved' || s.proposal.action === 'flag_review';
  });
  if (flagged.length > 0) {
    lines.push('\u26a0\ufe0f <b>AANDACHT VEREIST:</b>');
    flagged.forEach(function (f) {
      var p = f.proposal;
      lines.push('\u2022 ' + p.rule + ': ' + p.entityName + ' - ' + truncate(p.reason, 60));
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
    lines.push('\ud83d\udcb0 Uitgaven vandaag: \u20ac' + todaySpend.toFixed(2));
  }

  // Approval queue summary
  var queueSummary = await approvalQueue.getQueueSummary();
  lines.push('\n\ud83d\udceb Wachtrij: ' + queueSummary.pending + ' wachtend, ' + queueSummary.approved + ' goedgekeurd, ' + queueSummary.executed + ' uitgevoerd');

  return sendTelegram(lines.join('\n'));
}

/**
 * Send action execution confirmation.
 */
async function sendActionConfirmation(item, result) {
  var emoji = result.ok ? '\u2705' : '\u274c';
  var lines = [
    emoji + ' <b>Ad Actie ' + (result.ok ? 'Uitgevoerd' : 'Mislukt') + '</b>',
    '',
    '\u2022 Actie: ' + item.type,
    '\u2022 Doel: ' + item.entityName,
    '\u2022 Reden: ' + item.reason,
    result.ok ? '\u2022 Resultaat: Gelukt' : '\u2022 Fout: ' + (result.error || 'onbekend')
  ];
  return sendTelegram(lines.join('\n'));
}

/**
 * Send daily close summary to Telegram.
 */
async function sendDailyCloseSummary(date, actionLog, fatigueSummary, topAds, worstAds, queueSummary, contentSummary) {
  var lines = ['\ud83c\udf19 <b>CALQIX Dagsluiting - ' + dates.formatDateAmsterdam(new Date()) + '</b>\n'];

  // Action recap
  var executed = actionLog.filter(function (a) { return a.type === 'execution' && a.success; }).length;
  var queued = actionLog.filter(function (a) { return a.type === 'queued'; }).length;
  var evaluations = actionLog.filter(function (a) { return a.type === 'evaluation'; }).length;
  lines.push('\ud83d\udcca <b>Ad Acties:</b> ' + executed + ' uitgevoerd, ' + queued + ' in wachtrij, ' + evaluations + ' beoordeeld');

  // Fatigue recap
  if (fatigueSummary && fatigueSummary.length > 0) {
    lines.push('\n\ud83d\udd25 <b>Vermoeide Ads:</b>');
    fatigueSummary.forEach(function (f) {
      lines.push('\u2022 ' + f.adName + ' - CTR gedaald ' + f.ctrDeclinePct.toFixed(0) + '% vanaf piek');
    });
  }

  // Top and worst
  if (topAds && topAds.length > 0) {
    lines.push('\n\ud83c\udfc6 <b>Beste:</b> ' + topAds[0].ad_name + ' (ROAS ' + topAds[0].roas.toFixed(2) + 'x)');
  }
  if (worstAds && worstAds.length > 0) {
    lines.push('\ud83d\udc4e <b>Slechtste:</b> ' + worstAds[0].ad_name + ' (CTR ' + worstAds[0].ctr.toFixed(2) + '%)');
  }

  // Content summary
  if (contentSummary) {
    lines.push('\n\ud83d\udcdd <b>Content Pipeline:</b>');
    if (contentSummary.planExists) {
      lines.push('\u2022 Gegenereerd: ' + ((contentSummary.predisCompleted || 0) + (contentSummary.predisFailed || 0)) + ' creatives');
      lines.push('\u2022 Beoordeeld: ' + (contentSummary.reviews || []).length + ' (' + (contentSummary.reviews || []).filter(function (r) { return r.score >= 20; }).length + ' goedgekeurd)');
      lines.push('\u2022 Gepubliceerd: ' + (contentSummary.publishCount || 0));
      lines.push('\u2022 Hoeken: ' + (contentSummary.anglesUsed || []).join(', '));
    } else {
      lines.push('\u2022 Geen content plan vandaag');
    }
  }

  // Queue recap
  if (queueSummary) {
    lines.push('\n\ud83d\udceb <b>Wachtrij:</b> ' + queueSummary.pending + ' wachtend, ' + queueSummary.executed + ' uitgevoerd, ' + queueSummary.rejected + ' afgewezen');
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

  var mktInfo = planner.getMarketLanguage(creative.market || 'NL');

  var adLang = creative.ad_output_language || mktInfo.output_language;

  var captionLines = [
    'CALQIX Creative Review - ' + dateStr,
    '',
    'Product: ' + (creative.product || 'N/A') + ' | Hoek: ' + (creative.angle || 'N/A'),
    'Slot: ' + (creative.slot || 'N/A'),
    'Markt: ' + (creative.market || 'NL') + ' (' + mktInfo.label + ')',
    'Content: English | Ad: ' + adLang
  ];

  if (reviewResult) {
    var verdictNl = reviewResult.verdict === 'PASS' ? 'GOEDGEKEURD'
      : reviewResult.verdict === 'NEEDS_WORK' ? 'AANPASSING NODIG'
      : reviewResult.verdict === 'FAIL' ? 'AFGEKEURD' : reviewResult.verdict;
    captionLines.push('Score: ' + (reviewResult.total_score || 0) + '/25 - ' + verdictNl);
    if (reviewResult.issues && reviewResult.issues.length > 0) {
      captionLines.push('Problemen: ' + reviewResult.issues.slice(0, 3).join(', '));
    }
  }

  var captionText = (creative.caption || '').substring(0, 200);
  if (captionText) {
    captionLines.push('');
    captionLines.push('Tekst: "' + captionText + '"');
  }

  if (creative.predis_link) {
    captionLines.push('');
    captionLines.push('Predis: ' + creative.predis_link);
  }

  captionLines.push('');
  captionLines.push('Afbeelding verloopt in ~1 uur. Snel goedkeuren of opnieuw genereren.');

  var caption = captionLines.join('\n');

  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: 'Goedkeuren', callback_data: 'content_approve:' + postId },
        { text: 'Afwijzen', callback_data: 'content_reject:' + postId }
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
      var reviewMarket = creative.market || 'NL';
      var reviewMktInfo = planner.getMarketLanguage(reviewMarket);

      var prompt = [
        'You are a brand compliance reviewer for CALQIX, a premium oral care brand.',
        '',
        'IMPORTANT: This creative is intended for the ' + reviewMarket + ' market.',
        'The text on the image and caption should be in ' + reviewMktInfo.label + '.',
        'Do NOT flag the language as an issue. DO check that the ' + reviewMktInfo.label + ' text is',
        'grammatically correct, natural-sounding, and not a robotic translation.',
        '',
        'Brand rules:',
        '- Tone: scientific, accessible, clinical, premium, credible, direct',
        '- Forbidden: miracle, cure, guaranteed, proven results, dentist-approved, limited time only, act now, shocking, cheap, 100% effective, instant results',
        '- Max headline: 40 chars, max primary text: 125 chars',
        '',
        'Review this creative:',
        'Product: ' + (creative.product || 'unknown'),
        'Angle: ' + (creative.angle || 'unknown'),
        'Target market: ' + reviewMarket + ' (' + reviewMktInfo.label + ')',
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

/**
 * Escape HTML special characters for safe Telegram HTML output.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send a single brief review to Telegram with structured layout and inline buttons.
 * One message per brief — each with its own approve/reject/revise buttons.
 *
 * @param {object} review - review entry with brief_id, product, angle, headline, primary_text, score, verdict, issues, claude_review_summary, decision
 * @param {number} itemNumber - 1-indexed position
 * @param {number} totalItems - total number of briefs
 * @returns {Promise<object>}
 */
async function sendBriefReview(review, itemNumber, totalItems) {
  if (!review || !review.brief_id) {
    console.error('[BriefReview] Cannot send review: missing brief_id');
    return { sent: false, reason: 'missing_brief_id' };
  }

  var briefId = review.brief_id;
  var product = escapeHtml(review.product || 'onbekend');
  var angle = escapeHtml(review.angle || 'onbekend');
  var slot = review.slot || '';
  var score = review.score || 0;
  var verdict = review.verdict || 'PENDING';
  var decision = review.decision || 'needs_approval';

  // Status emoji and text
  var statusEmoji = decision === 'auto_approved' ? '\u2705'
    : decision === 'auto_rejected' ? '\u274c' : '\u23f3';
  var statusText = decision === 'auto_approved' ? 'Auto-goedgekeurd'
    : decision === 'auto_rejected' ? 'Auto-afgewezen' : 'Wacht op goedkeuring';

  // Verdict in Dutch
  var verdictNl = verdict === 'PASS' ? 'GOEDGEKEURD'
    : verdict === 'FAIL' ? 'AFGEKEURD'
    : verdict === 'NEEDS_WORK' ? 'AANPASSING NODIG'
    : verdict;

  // Build structured message
  var lines = [
    '<b>' + itemNumber + '/' + totalItems + '. ' + product + ' - ' + angle + '</b>',
    'Brief ID: <code>' + briefId + '</code>',
    'Slot: ' + escapeHtml(slot) + ' | Score: ' + score + '/25 - ' + verdictNl,
    ''
  ];

  // Headline
  var headline = escapeHtml(review.headline || '');
  if (headline) {
    lines.push('<b>Headline:</b>');
    lines.push('"' + truncate(headline, 80) + '"');
    if (headline.length > 40) {
      lines.push('\u26a0\ufe0f ' + headline.length + ' tekens (max 40)');
    }
    lines.push('');
  }

  // Primary text
  var primaryText = escapeHtml(review.primary_text || '');
  if (primaryText) {
    lines.push('<b>Primaire tekst:</b>');
    lines.push('"' + truncate(primaryText, 120) + '"');
    if (primaryText.length > 125) {
      lines.push('\u26a0\ufe0f ' + primaryText.length + ' tekens (max 125)');
    }
    lines.push('');
  }

  // Issues
  var issues = review.issues || [];
  if (issues.length > 0) {
    lines.push('<b>Problemen:</b>');
    for (var i = 0; i < Math.min(issues.length, 5); i++) {
      lines.push('\u2022 ' + escapeHtml(issues[i]));
    }
    if (issues.length > 5) {
      lines.push('... en ' + (issues.length - 5) + ' meer');
    }
    lines.push('');
  }

  // Claude review summary
  var claudeSummary = review.claude_review_summary || '';
  var claudeStatus = review.claude_status || 'pending';
  if (claudeSummary || claudeStatus !== 'pending') {
    lines.push('<b>Claude review:</b>');
    if (claudeStatus === 'failed') {
      lines.push('\u274c Review mislukt - handmatige beoordeling vereist');
    } else if (claudeSummary) {
      lines.push('\u2022 ' + escapeHtml(claudeSummary));
    }
    // Show suggested fixes if available
    var fixes = review.fixes || [];
    if (fixes.length > 0) {
      for (var f = 0; f < Math.min(fixes.length, 3); f++) {
        lines.push('  \u2192 ' + escapeHtml(fixes[f]));
      }
    }
    lines.push('');
  }

  // Status line
  lines.push('Status: ' + statusEmoji + ' ' + statusText);

  var text = lines.join('\n');

  // Build inline keyboard for pending items
  var replyMarkup = null;
  if (decision === 'needs_approval') {
    replyMarkup = {
      inline_keyboard: [
        [
          { text: '\u2705 Goedkeuren', callback_data: 'brief_approve:' + briefId },
          { text: '\u274c Afwijzen', callback_data: 'brief_reject:' + briefId }
        ],
        [
          { text: '\u270f\ufe0f Revisie', callback_data: 'brief_revise:' + briefId }
        ]
      ]
    };
  }

  console.log('[BriefReview] Sending review for brief', briefId, 'decision:', decision);
  return sendTelegram(text, replyMarkup);
}

/**
 * Send revision comparison preview to Telegram.
 * Shows original vs revised copy side by side.
 * @param {object} revisionResult - from creative-reviser.reviewAndRevise
 * @returns {Promise<object>}
 */
async function sendRevisionPreview(revisionResult) {
  if (!revisionResult || !revisionResult.revised) return { sent: false, reason: 'not_revised' };

  var original = revisionResult.original || {};
  var revised = revisionResult.revised_creative || {};
  var origReview = revisionResult.original_review || {};
  var revisedCopy = revisionResult.revised_copy || {};

  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + now.getFullYear();

  var lines = [
    '<b>CALQIX Creative Revisie - ' + dateStr + '</b>',
    '',
    'Product: ' + escapeHtml(original.product || 'onbekend') + ' | Hoek: ' + escapeHtml(original.angle || 'onbekend'),
    'Markt: ' + escapeHtml(original.market || 'NL'),
    '',
    '<b>ORIGINEEL (Score: ' + (origReview.total_score || 0) + '/25):</b>',
    '"' + escapeHtml(truncate(original.caption || original.text || '', 100)) + '"',
    'Problemen: ' + escapeHtml((origReview.issues || []).join(', ') || 'geen'),
    '',
    '<b>HERZIEN:</b>',
    'Headline: "' + escapeHtml(revisedCopy.headline || '') + '"',
    'Primary: "' + escapeHtml(truncate(revisedCopy.primary_text || '', 120)) + '"',
    'Wijzigingen: ' + escapeHtml((revisedCopy.changes_made || []).join(', ') || 'geen'),
    '',
    revised.draftOnly ? 'Status: Draft-only (Predis uitgeschakeld)' : 'Status: Herziene creative ingediend bij Predis'
  ];

  var text = lines.join('\n');

  var replyMarkup = null;
  if (revised.post_id) {
    replyMarkup = {
      inline_keyboard: [
        [
          { text: '\u2705 Goedkeuren', callback_data: 'brief_approve:' + revised.post_id },
          { text: '\u274c Afwijzen', callback_data: 'brief_reject:' + revised.post_id }
        ]
      ]
    };
  }

  return sendTelegram(text, replyMarkup);
}

module.exports = {
  sendContentReview: sendContentReview,
  sendBriefReview: sendBriefReview,
  sendAdOptimizationReport: sendAdOptimizationReport,
  sendActionConfirmation: sendActionConfirmation,
  sendDailyCloseSummary: sendDailyCloseSummary,
  sendCreativePreview: sendCreativePreview,
  sendTelegramPhoto: sendTelegramPhoto,
  reviewAndPreview: reviewAndPreview,
  sendRevisionPreview: sendRevisionPreview
};
