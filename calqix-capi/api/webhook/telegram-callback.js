/**
 * Telegram Webhook Callback Handler
 *
 * Receives callback_query from inline keyboard buttons and text commands.
 * Handles:
 *   - content_approve:{postId} / content_reject:{postId}
 *   - pub:{postId}:{facebook|instagram|both|queue}
 *   - adv:{advisoryId}:{safe|balanced|aggressive|refresh|skip}
 *   - advf:{advisoryId}:{optionIndex}
 *   - lim:{limitKey}:{delta}
 *   - cb:intent:{intent} / cb:build:{id} / cb:adjust:{id}:{field}
 *   - cb:setbudget:{id}:{cents} / cb:setgeo:{id}:{countries}
 *   - cb:regenerate:{id} / cb:cancel:{id} / cb:activate:{id} / cb:keep_paused:{id}
 *   - /limits, /set_adset_max, /set_daily_max, /set_campaign_max
 *   - /build_campaign, /preflight
 */
var fetch = require('node-fetch');
var store = require('../../lib/store');
var approvalQueue = require('../../lib/approval-queue');
var dates = require('../../lib/dates');
var socialPublisher = require('../../lib/social-publisher');
var campaignBuilder = require('../../lib/campaign-builder');

function getBotToken() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
function getChatId() { return process.env.TELEGRAM_CHAT_ID || ''; }

async function answerCallback(callbackId, text) {
  var token = getBotToken();
  if (!token) return;
  try {
    await fetch('https://api.telegram.org/bot' + token + '/answerCallbackQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: text })
    });
  } catch (e) { console.warn('[TGCallback] answerCallback error:', e.message); }
}

async function sendMessage(chatId, text, replyMarkup) {
  var token = getBotToken();
  if (!token) return;
  var body = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) { console.warn('[TGCallback] sendMessage error:', e.message); }
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  var token = getBotToken();
  if (!token) return;
  var body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  try {
    await fetch('https://api.telegram.org/bot' + token + '/editMessageText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) { console.warn('[TGCallback] editMessageText error:', e.message); }
}

// --- Content approve/reject ---
async function handleContentAction(callbackId, chatId, action, postId) {
  var dateStr = dates.todayKey();

  if (action === 'content_approve') {
    // Mark as approved in Redis
    var jobRaw = await store.get('predis:job:' + postId);
    var slotName = 'unknown';
    if (jobRaw) {
      try {
        var job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;
        slotName = job.slot || 'unknown';
      } catch (e) { /* ignore */ }
    }

    await store.set('content:approved:' + dateStr + ':' + slotName, JSON.stringify({
      post_id: postId, approvedAt: new Date().toISOString(), approvedBy: 'telegram'
    }), 86400);

    await answerCallback(callbackId, 'Goedgekeurd!');

    // Show publish platform selection
    var platforms = socialPublisher.getEnabledPlatforms();
    var pubKeyboard = buildPublishKeyboard(postId, platforms);
    await sendMessage(chatId, 'Creative goedgekeurd! Waar wil je publiceren?', pubKeyboard);

  } else if (action === 'content_reject') {
    await store.set('content:rejected:' + dateStr + ':' + postId, JSON.stringify({
      post_id: postId, rejectedAt: new Date().toISOString(), rejectedBy: 'telegram'
    }), 86400);

    await answerCallback(callbackId, 'Afgekeurd.');
    await sendMessage(chatId, 'Creative ' + postId.substring(0, 8) + '... afgekeurd.');
  }
}

// --- Advisory choose ---
async function handleAdvisoryChoice(callbackId, chatId, advisoryId, action) {
  var raw = await store.get('advisory:' + advisoryId);
  if (!raw) {
    await answerCallback(callbackId, 'Advies verlopen.');
    return;
  }
  var advisory = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (action === 'skip') {
    advisory.status = 'skipped';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);
    await answerCallback(callbackId, 'Advies overgeslagen.');
    return;
  }

  if (action === 'refresh') {
    await answerCallback(callbackId, 'Wacht op volgend gepland advies voor nieuwe data.');
    return;
  }

  // Find chosen strategy
  var strategy = null;
  if (advisory.strategies) {
    for (var i = 0; i < advisory.strategies.length; i++) {
      if (advisory.strategies[i].level === action) {
        strategy = advisory.strategies[i];
        break;
      }
    }
  }

  if (!strategy) {
    await answerCallback(callbackId, 'Strategie niet gevonden.');
    return;
  }

  advisory.chosen = action;

  if (strategy.needs_followup && strategy.followup_question && strategy.followup_options) {
    advisory.status = 'chosen';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);

    // Send followup question with option buttons
    var fButtons = strategy.followup_options.map(function (opt, idx) {
      return { text: opt, callback_data: 'advf:' + advisoryId + ':' + idx };
    });
    var keyboard = { inline_keyboard: [fButtons] };
    await sendMessage(chatId, 'Gekozen: ' + levelEmoji(action) + ' ' + strategy.title + '\n\n' + strategy.followup_question, keyboard);
    await answerCallback(callbackId, 'Gekozen: ' + action);
  } else {
    // No followup needed, queue actions directly
    await queueStrategyActions(advisoryId, advisory, strategy);
    advisory.status = 'confirmed';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);

    await sendConfirmation(chatId, strategy);
    await answerCallback(callbackId, 'Acties in wachtrij!');
  }
}

// --- Advisory followup ---
async function handleAdvisoryFollowup(callbackId, chatId, advisoryId, optionIndex) {
  var raw = await store.get('advisory:' + advisoryId);
  if (!raw) {
    await answerCallback(callbackId, 'Advies verlopen.');
    return;
  }
  var advisory = typeof raw === 'string' ? JSON.parse(raw) : raw;

  var strategy = null;
  if (advisory.strategies && advisory.chosen) {
    for (var i = 0; i < advisory.strategies.length; i++) {
      if (advisory.strategies[i].level === advisory.chosen) {
        strategy = advisory.strategies[i];
        break;
      }
    }
  }

  if (!strategy || !strategy.followup_options) {
    await answerCallback(callbackId, 'Strategie niet gevonden.');
    return;
  }

  var chosenOption = strategy.followup_options[parseInt(optionIndex, 10)] || '';
  if (chosenOption.toLowerCase().indexOf('cancel') !== -1) {
    advisory.status = 'skipped';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);
    await answerCallback(callbackId, 'Geannuleerd.');
    await sendMessage(chatId, 'Strategie geannuleerd. Geen acties uitgevoerd.');
    return;
  }

  advisory.followup_answer = parseInt(optionIndex, 10);
  advisory.status = 'confirmed';
  await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);

  await queueStrategyActions(advisoryId, advisory, strategy);
  await sendConfirmation(chatId, strategy, chosenOption);
  await answerCallback(callbackId, 'Bevestigd! Acties in wachtrij.');
}

// --- Limit adjustments ---
async function handleLimitAction(callbackId, chatId, messageId, parts) {
  var limits = require('../../lib/limits');

  if (parts[1] === 'show') {
    var current = await limits.getLimits();
    await answerCallback(callbackId, 'Current: EUR ' + (current[parts[2]] || 0));
    return;
  }

  if (parts[1] === 'custom') {
    await sendMessage(chatId,
      'Typ het limiet dat je wilt wijzigen:\n\n' +
      '/set_adset_max [bedrag]\n' +
      '/set_daily_max [bedrag]\n' +
      '/set_campaign_max [bedrag]\n\n' +
      'Voorbeeld: /set_daily_max 150'
    );
    await answerCallback(callbackId, 'Typ een commando hieronder');
    return;
  }

  // Adjust limit: lim:max_adset_budget:+10
  var limitKey = parts[1];
  var delta = parseInt(parts[2], 10);
  if (isNaN(delta)) {
    await answerCallback(callbackId, 'Invalid delta');
    return;
  }

  var currentLimits = await limits.getLimits();
  var oldValue = currentLimits[limitKey] || 0;
  var newValue = Math.max(10, oldValue + delta);

  await limits.updateLimit(limitKey, newValue);
  var updatedLimits = await limits.getLimits();

  // Edit message in-place with new values
  var text = 'CALQIX Budget Limieten\n\n' +
    'Adset max:      EUR ' + updatedLimits.max_adset_budget + '\n' +
    'Dagelijks max:  EUR ' + updatedLimits.max_daily_spend + '\n' +
    'Campagne max:   EUR ' + updatedLimits.max_campaign_budget + '\n\n' +
    'Laatst gewijzigd: ' + (updatedLimits.updated_at || 'nu');
  var keyboard = buildLimitsKeyboard(updatedLimits);
  await editMessageText(chatId, messageId, text, keyboard);
  await answerCallback(callbackId, limitKey + ': EUR ' + oldValue + ' > EUR ' + newValue);
}

// --- Text command handlers ---
async function handleTextCommand(chatId, text) {
  var limits = require('../../lib/limits');

  if (text === '/limits') {
    var current = await limits.getLimits();
    var msg = 'CALQIX Budget Limieten\n\n' +
      'Adset max:      EUR ' + current.max_adset_budget + '\n' +
      'Dagelijks max:  EUR ' + current.max_daily_spend + '\n' +
      'Campagne max:   EUR ' + current.max_campaign_budget + '\n\n' +
      'Laatst gewijzigd: ' + (current.updated_at || 'standaard');
    var keyboard = buildLimitsKeyboard(current);
    await sendMessage(chatId, msg, keyboard);
    return true;
  }

  if (text === '/build_campaign') {
    var intentKeyboard = {
      inline_keyboard: [
        [
          { text: 'Winnaar opschalen', callback_data: 'cb:intent:scale_winner' },
          { text: 'Nieuw land testen', callback_data: 'cb:intent:new_country' }
        ],
        [
          { text: 'Nieuwe hoek testen', callback_data: 'cb:intent:new_angle' },
          { text: 'Retargeting', callback_data: 'cb:intent:retargeting' }
        ],
        [
          { text: 'AI laten beslissen', callback_data: 'cb:intent:ai_decide' }
        ]
      ]
    };
    await sendMessage(chatId, '<b>CALQIX Campagne Builder</b>\n\nWat voor campagne wil je bouwen?', intentKeyboard);
    return true;
  }

  if (text === '/preflight') {
    await sendMessage(chatId, 'Pre-flight checks uitvoeren...');
    try {
      var permCheck = await socialPublisher.checkPermissions();
      var platforms = socialPublisher.getEnabledPlatforms();
      var lines = ['<b>Pre-flight Status</b>\n'];
      lines.push('FACEBOOK_PAGE_ID: ' + (platforms.facebook ? 'configured' : 'not set'));
      lines.push('INSTAGRAM_ACCOUNT_ID: ' + (platforms.instagram ? 'configured' : 'not set'));
      lines.push('');
      if (permCheck.ok) {
        lines.push('Token permissies: OK');
      } else if (permCheck.missing && permCheck.missing.length > 0) {
        lines.push('Ontbrekende permissies: ' + permCheck.missing.join(', '));
        lines.push('\nToevoegen via developers.facebook.com > CALQIX API app > Permissions. Daarna token vernieuwen.');
      } else {
        lines.push('Permissie check: ' + (permCheck.error || 'onbekende fout'));
      }
      if (permCheck.granted && permCheck.granted.length > 0) {
        lines.push('\nVerleend: ' + permCheck.granted.join(', '));
      }
      await sendMessage(chatId, lines.join('\n'));
    } catch (err) {
      await sendMessage(chatId, 'Pre-flight fout: ' + err.message);
    }
    return true;
  }

  var setCommands = {
    '/set_adset_max': 'max_adset_budget',
    '/set_daily_max': 'max_daily_spend',
    '/set_campaign_max': 'max_campaign_budget'
  };

  var cmdKeys = Object.keys(setCommands);
  for (var i = 0; i < cmdKeys.length; i++) {
    if (text.indexOf(cmdKeys[i] + ' ') === 0) {
      var amount = parseInt(text.split(' ')[1], 10);
      if (isNaN(amount) || amount < 10) {
        await sendMessage(chatId, 'Ongeldig bedrag. Minimum EUR 10.');
        return true;
      }
      await limits.updateLimit(setCommands[cmdKeys[i]], amount);
      await sendMessage(chatId, cmdKeys[i].replace('/set_', '').replace('_', ' ') + ' aangepast: EUR ' + amount);
      return true;
    }
  }

  return false;
}

// --- Helper functions ---
function levelEmoji(level) {
  if (level === 'safe') return '\ud83d\udfe2';
  if (level === 'balanced') return '\ud83d\udfe1';
  if (level === 'aggressive') return '\ud83d\udd34';
  return '';
}

function buildLimitsKeyboard(limits) {
  return {
    inline_keyboard: [
      [
        { text: 'Adset: -10', callback_data: 'lim:max_adset_budget:-10' },
        { text: 'EUR ' + limits.max_adset_budget, callback_data: 'lim:show:max_adset_budget' },
        { text: 'Adset: +10', callback_data: 'lim:max_adset_budget:+10' }
      ],
      [
        { text: 'Daily: -25', callback_data: 'lim:max_daily_spend:-25' },
        { text: 'EUR ' + limits.max_daily_spend, callback_data: 'lim:show:max_daily_spend' },
        { text: 'Daily: +25', callback_data: 'lim:max_daily_spend:+25' }
      ],
      [
        { text: 'Campaign: -50', callback_data: 'lim:max_campaign_budget:-50' },
        { text: 'EUR ' + limits.max_campaign_budget, callback_data: 'lim:show:max_campaign_budget' },
        { text: 'Campaign: +50', callback_data: 'lim:max_campaign_budget:+50' }
      ],
      [
        { text: 'Aangepast bedrag...', callback_data: 'lim:custom' }
      ]
    ]
  };
}

async function queueStrategyActions(advisoryId, advisory, strategy) {
  var actions = strategy.actions || [];
  var mode = process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';

  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    if (action.type === 'no_action') continue;

    await approvalQueue.createItem({
      type: action.type,
      entityName: action.target_name || 'unknown',
      entityId: action.target_id || advisoryId + ':' + i,
      reason: action.detail || strategy.summary,
      metrics: { advisory_level: strategy.level, advisory_id: advisoryId },
      expectedEffect: strategy.expected_impact,
      payload: { action: action, advisory_id: advisoryId, mode: mode, enable_writes: enableWrites }
    });
  }
}

async function sendConfirmation(chatId, strategy, followupChoice) {
  var lines = ['Strategie in wachtrij: ' + levelEmoji(strategy.level) + ' ' + strategy.title + '\n'];

  var actions = strategy.actions || [];
  if (actions.length > 0) {
    lines.push('Acties:');
    for (var i = 0; i < actions.length; i++) {
      lines.push((i + 1) + '. ' + (actions[i].detail || actions[i].type));
    }
  }

  if (followupChoice) {
    lines.push('\nKeuze: ' + followupChoice);
  }

  var mode = process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';
  if (!enableWrites || mode === 'MONITOR_ONLY') {
    lines.push('\nLet op: Systeem staat in monitor-modus. Acties gelogd maar niet uitgevoerd.');
  } else {
    lines.push('\nActies worden uitgevoerd via Meta API. Bevestiging volgt per actie.');
  }

  await sendMessage(chatId, lines.join('\n'));
}

// --- Publish keyboard ---
function buildPublishKeyboard(postId, platforms) {
  var rows = [];
  if (platforms.facebook && platforms.instagram) {
    rows.push([
      { text: '\ud83d\udcd8 Facebook', callback_data: 'pub:' + postId + ':facebook' },
      { text: '\ud83d\udcf8 Instagram', callback_data: 'pub:' + postId + ':instagram' }
    ]);
    rows.push([
      { text: '\ud83d\udcd8+\ud83d\udcf8 Beide', callback_data: 'pub:' + postId + ':both' },
      { text: '\ud83d\udccb Wachtrij', callback_data: 'pub:' + postId + ':queue' }
    ]);
  } else if (platforms.facebook) {
    rows.push([
      { text: '\ud83d\udcd8 Facebook', callback_data: 'pub:' + postId + ':facebook' },
      { text: '\ud83d\udccb Wachtrij', callback_data: 'pub:' + postId + ':queue' }
    ]);
  } else if (platforms.instagram) {
    rows.push([
      { text: '\ud83d\udcf8 Instagram', callback_data: 'pub:' + postId + ':instagram' },
      { text: '\ud83d\udccb Wachtrij', callback_data: 'pub:' + postId + ':queue' }
    ]);
  } else {
    rows.push([
      { text: '\ud83d\udccb Wachtrij', callback_data: 'pub:' + postId + ':queue' }
    ]);
  }
  return { inline_keyboard: rows };
}

// --- Social publish handler ---
async function handlePublish(callbackId, chatId, postId, target) {
  if (target === 'queue') {
    await answerCallback(callbackId, 'In wachtrij gezet.');
    await sendMessage(chatId, 'Creative in wachtrij voor volgende publicatieslot.');
    return;
  }

  // Get creative data from Redis
  var creative = await getCreativeFromRedis(postId);
  if (!creative || !creative.image_url) {
    await answerCallback(callbackId, 'Geen afbeelding gevonden.');
    await sendMessage(chatId, 'Geen afbeelding beschikbaar voor deze creative. Publiceer handmatig via Predis.');
    return;
  }

  // Check image expiry
  if (socialPublisher.isImageLikelyExpired(creative.completed_at || creative.created_at)) {
    await sendMessage(chatId, 'Let op: Afbeelding mogelijk verlopen (Predis URLs ~1 uur geldig). Toch publiceren...');
  }

  var caption = creative.caption || creative.text || '';

  await answerCallback(callbackId, 'Publiceren...');
  await sendMessage(chatId, 'Publiceren naar ' + target + '...');

  var publishResult;
  if (target === 'facebook') {
    var fbRes = await socialPublisher.publishToFacebook(creative.image_url, caption);
    publishResult = { results: fbRes.ok ? [fbRes] : [], errors: fbRes.ok ? [] : [{ platform: 'facebook', error: fbRes.error }] };
  } else if (target === 'instagram') {
    var igRes = await socialPublisher.publishToInstagram(creative.image_url, caption);
    publishResult = { results: igRes.ok ? [igRes] : [], errors: igRes.ok ? [] : [{ platform: 'instagram', error: igRes.error }] };
  } else if (target === 'both') {
    publishResult = await socialPublisher.publishToSocial(creative.image_url, caption, 'both');
  } else {
    await sendMessage(chatId, 'Onbekend publicatiedoel: ' + target);
    return;
  }

  // Send confirmation
  var platformsPublished = publishResult.results.map(function (r) { return r.platform; }).join(' + ') || 'none';
  var errorsText = publishResult.errors.map(function (e) { return e.platform + ': ' + e.error; }).join('\n') || '';

  var confirmText = 'Gepubliceerd naar: ' + platformsPublished;
  if (errorsText) confirmText += '\n\nFouten:\n' + errorsText;

  // If FB was published, offer to use as ad creative (page post ads)
  var fbResult = publishResult.results.find(function (r) { return r.platform === 'facebook'; });
  var adKeyboard = null;
  if (fbResult && fbResult.post_id) {
    // Store published post data for ad creation
    var publishRef = 'social:pub_ref:' + postId;
    await store.set(publishRef, JSON.stringify({
      postId: postId,
      fbPostId: fbResult.post_id,
      igPostId: (publishResult.results.find(function (r) { return r.platform === 'instagram'; }) || {}).post_id || null,
      caption: caption,
      imageUrl: creative.image_url,
      publishedAt: new Date().toISOString()
    }), 7 * 86400);

    adKeyboard = {
      inline_keyboard: [[
        { text: 'Gebruik als advertentie', callback_data: 'cb:use_as_ad:' + postId },
        { text: 'Klaar', callback_data: 'cb:pub_done:' + postId }
      ]]
    };
    confirmText += '\n\nJe kunt deze post gebruiken als advertentie in Meta Ads.';
  }

  await sendMessage(chatId, confirmText, adKeyboard);

  // Log and update status
  await socialPublisher.logPublish(postId, target, publishResult.results, publishResult.errors);
  await store.set('content:publish_status:' + postId, JSON.stringify({
    published_to: publishResult.results,
    errors: publishResult.errors,
    published_at: dates.formatDateTimeAmsterdam(new Date())
  }), 30 * 86400);
}

async function getCreativeFromRedis(postId) {
  // Try predis webhook result first
  var raw = await store.get('predis:webhook:' + postId);
  if (raw) {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { /* */ }
  }
  // Try job record
  var jobRaw = await store.get('predis:job:' + postId);
  if (jobRaw) {
    try { return typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw; } catch (e) { /* */ }
  }
  return null;
}

// --- Campaign builder handler ---
async function handleCampaignCallback(callbackId, chatId, messageId, data) {
  var parts = data.split(':');
  var action = parts[1];

  // cb:intent:{intent}
  if (action === 'intent') {
    var intent = parts[2];
    await answerCallback(callbackId, 'Prestaties analyseren...');
    await sendMessage(chatId, 'Ad prestaties analyseren en voorstel genereren...');

    try {
      var limits = require('../../lib/limits');
      var perfData = await campaignBuilder.fetchPerformanceContext();

      if (!perfData.hasWinners) {
        await sendMessage(chatId, 'Nog niet genoeg data. Minimaal 1 ad nodig met 100+ impressies en CTR > 1%.\n\nWinnende ads gevonden: 0');
        return;
      }

      var currentLimits = await limits.getLimits();
      var proposal = await campaignBuilder.generateProposal(intent, perfData, currentLimits);

      var proposalId = campaignBuilder.generateProposalId();
      await campaignBuilder.storeProposal(proposalId, intent, proposal);

      var msg = campaignBuilder.formatProposalMessage(proposal);
      var keyboard = buildProposalKeyboard(proposalId);
      await sendMessage(chatId, msg, keyboard);
    } catch (err) {
      console.error('[CampaignBuilder] Proposal error:', err.message);
      await sendMessage(chatId, 'Campagne voorstel mislukt: ' + err.message);
    }
    return;
  }

  // cb:build:{proposalId}
  if (action === 'build') {
    var buildProposalId = parts[2];
    var entry = await campaignBuilder.getProposal(buildProposalId);
    if (!entry || !entry.proposal) {
      await answerCallback(callbackId, 'Voorstel verlopen.');
      return;
    }

    await answerCallback(callbackId, 'Campagne bouwen...');
    await sendMessage(chatId, 'Campagne bouwen via Meta API (alles GEPAUZEERD)...');

    try {
      var buildResult = await campaignBuilder.buildCampaign(entry.proposal);
      await campaignBuilder.updateProposal(buildProposalId, {
        status: buildResult.ok ? 'built' : 'build_failed',
        campaign_id: buildResult.campaign_id || null
      });

      if (!buildResult.ok) {
        await sendMessage(chatId, 'Campagne bouwen mislukt: ' + buildResult.error);
        return;
      }

      var dryNote = buildResult.dryRun ? '\n\n(DRY RUN: ENABLE_AD_WRITES staat niet op true. Geen echte wijzigingen.)' : '';

      var confirmMsg = '<b>Campagne succesvol gebouwd!</b>\n\n' +
        'Campagne: ' + buildResult.campaign_name + '\n' +
        'ID: ' + buildResult.campaign_id + '\n' +
        'Status: GEPAUZEERD\n' +
        'Adsets: ' + buildResult.adsets_created + ' aangemaakt\n' +
        'Ads: ' + buildResult.ads_created + ' gedupliceerd van winnaars' + dryNote;

      var activateKeyboard = {
        inline_keyboard: [[
          { text: 'Nu activeren', callback_data: 'cb:activate:' + buildResult.campaign_id },
          { text: 'Gepauzeerd houden', callback_data: 'cb:keep_paused:' + buildResult.campaign_id }
        ]]
      };
      await sendMessage(chatId, confirmMsg, buildResult.dryRun ? null : activateKeyboard);
    } catch (err) {
      console.error('[CampaignBuilder] Build error:', err.message);
      await sendMessage(chatId, 'Campagne bouwfout: ' + err.message);
    }
    return;
  }

  // cb:adjust:{proposalId}:budget
  if (action === 'adjust' && parts[3] === 'budget') {
    var adjBudgetId = parts[2];
    var budgetKeyboard = {
      inline_keyboard: [
        [
          { text: 'EUR 10/day', callback_data: 'cb:setbudget:' + adjBudgetId + ':1000' },
          { text: 'EUR 20/day', callback_data: 'cb:setbudget:' + adjBudgetId + ':2000' },
          { text: 'EUR 30/day', callback_data: 'cb:setbudget:' + adjBudgetId + ':3000' }
        ],
        [
          { text: 'EUR 40/day', callback_data: 'cb:setbudget:' + adjBudgetId + ':4000' },
          { text: 'EUR 50/day', callback_data: 'cb:setbudget:' + adjBudgetId + ':5000' }
        ]
      ]
    };
    await answerCallback(callbackId, 'Budget kiezen');
    await sendMessage(chatId, 'Kies nieuw dagbudget:', budgetKeyboard);
    return;
  }

  // cb:adjust:{proposalId}:countries
  if (action === 'adjust' && parts[3] === 'countries') {
    var adjGeoId = parts[2];
    var geoKeyboard = {
      inline_keyboard: [
        [
          { text: 'NL only', callback_data: 'cb:setgeo:' + adjGeoId + ':NL' },
          { text: 'DE only', callback_data: 'cb:setgeo:' + adjGeoId + ':DE' }
        ],
        [
          { text: 'NL+BE', callback_data: 'cb:setgeo:' + adjGeoId + ':NL,BE' },
          { text: 'DE+AT', callback_data: 'cb:setgeo:' + adjGeoId + ':DE,AT' }
        ],
        [
          { text: 'All (NL+BE+DE+AT)', callback_data: 'cb:setgeo:' + adjGeoId + ':NL,BE,DE,AT' },
          { text: 'FR', callback_data: 'cb:setgeo:' + adjGeoId + ':FR' }
        ]
      ]
    };
    await answerCallback(callbackId, 'Landen kiezen');
    await sendMessage(chatId, 'Kies doellanden:', geoKeyboard);
    return;
  }

  // cb:setbudget:{proposalId}:{cents}
  if (action === 'setbudget') {
    var setBudgetId = parts[2];
    var budgetCents = parseInt(parts[3], 10);
    if (isNaN(budgetCents)) {
      await answerCallback(callbackId, 'Invalid budget');
      return;
    }

    var updatedBudget = await campaignBuilder.adjustBudget(setBudgetId, budgetCents);
    if (!updatedBudget) {
      await answerCallback(callbackId, 'Voorstel verlopen.');
      return;
    }

    var updatedMsg = campaignBuilder.formatProposalMessage(updatedBudget.proposal);
    var updatedKeyboard = buildProposalKeyboard(setBudgetId);
    await answerCallback(callbackId, 'Budget aangepast naar EUR ' + (budgetCents / 100));
    await sendMessage(chatId, updatedMsg + '\n\n(Budget aangepast)', updatedKeyboard);
    return;
  }

  // cb:setgeo:{proposalId}:{countries}
  if (action === 'setgeo') {
    var setGeoId = parts[2];
    var countries = parts.slice(3).join(':'); // countries may contain commas but not colons
    var updatedGeo = await campaignBuilder.adjustCountries(setGeoId, countries);
    if (!updatedGeo) {
      await answerCallback(callbackId, 'Voorstel verlopen.');
      return;
    }

    var geoMsg = campaignBuilder.formatProposalMessage(updatedGeo.proposal);
    var geoKb = buildProposalKeyboard(setGeoId);
    await answerCallback(callbackId, 'Landen aangepast naar ' + countries);
    await sendMessage(chatId, geoMsg + '\n\n(Landen aangepast)', geoKb);
    return;
  }

  // cb:regenerate:{proposalId}
  if (action === 'regenerate') {
    var regenId = parts[2];
    var regenEntry = await campaignBuilder.getProposal(regenId);
    if (!regenEntry) {
      await answerCallback(callbackId, 'Voorstel verlopen.');
      return;
    }

    await answerCallback(callbackId, 'Opnieuw genereren...');
    await campaignBuilder.updateProposal(regenId, { status: 'cancelled' });

    // Re-trigger intent with same intent type
    await handleCampaignCallback(callbackId, chatId, messageId, 'cb:intent:' + regenEntry.intent);
    return;
  }

  // cb:cancel:{proposalId}
  if (action === 'cancel') {
    var cancelId = parts[2];
    await campaignBuilder.updateProposal(cancelId, { status: 'cancelled' });
    await answerCallback(callbackId, 'Geannuleerd.');
    await sendMessage(chatId, 'Campagne voorstel geannuleerd.');
    return;
  }

  // cb:activate:{campaignId}
  if (action === 'activate') {
    var activateCampaignId = parts[2];
    await answerCallback(callbackId, 'Activeren...');

    var activateResult = await campaignBuilder.activateCampaign(activateCampaignId);
    if (activateResult.ok) {
      var dryMsg = activateResult.dryRun ? ' (DRY RUN)' : '';
      await sendMessage(chatId, 'Campagne ' + activateCampaignId + ' geactiveerd!' + dryMsg + '\n\nAds zijn nu live. Monitor de prestaties.');
    } else {
      await sendMessage(chatId, 'Activering mislukt: ' + activateResult.error);
    }
    return;
  }

  // cb:keep_paused:{campaignId}
  if (action === 'keep_paused') {
    await answerCallback(callbackId, 'Blijft gepauzeerd.');
    await sendMessage(chatId, 'Campagne blijft GEPAUZEERD. Later activeren via Meta Ads Manager.');
    return;
  }

  // cb:pub_done:{postId}
  if (action === 'pub_done') {
    await answerCallback(callbackId, 'Klaar.');
    return;
  }

  // cb:use_as_ad:{postId} - fetch active campaigns and let operator pick one
  if (action === 'use_as_ad') {
    var useAdPostId = parts[2];
    await answerCallback(callbackId, 'Campagnes ophalen...');

    try {
      var metaApiClient = require('../../lib/meta-api-client');
      var activeCampaigns = await metaApiClient.fetchCampaigns(['ACTIVE', 'PAUSED']);
      var campaigns = (activeCampaigns.ok ? activeCampaigns.data : []).slice(0, 6);

      if (campaigns.length === 0) {
        await sendMessage(chatId, 'Geen actieve of gepauzeerde campagnes gevonden. Gebruik /build_campaign om er een aan te maken.');
        return;
      }

      // Store postId reference for the next step
      await store.set('social:ad_pending:' + chatId, useAdPostId, 3600);

      var campaignRows = [];
      for (var ci = 0; ci < campaigns.length; ci += 2) {
        var row = [{ text: campaigns[ci].name.substring(0, 30), callback_data: 'cb:add_to_camp:' + useAdPostId + ':' + campaigns[ci].id }];
        if (campaigns[ci + 1]) {
          row.push({ text: campaigns[ci + 1].name.substring(0, 30), callback_data: 'cb:add_to_camp:' + useAdPostId + ':' + campaigns[ci + 1].id });
        }
        campaignRows.push(row);
      }
      campaignRows.push([{ text: 'Annuleren', callback_data: 'cb:pub_done:' + useAdPostId }]);

      await sendMessage(chatId, 'Kies een campagne om deze creative aan toe te voegen:', { inline_keyboard: campaignRows });
    } catch (err) {
      console.error('[UseAsAd] Error:', err.message);
      await sendMessage(chatId, 'Fout bij ophalen campagnes: ' + err.message);
    }
    return;
  }

  // cb:add_to_camp:{postId}:{campaignId} - create ad from published page post
  if (action === 'add_to_camp') {
    var addPostId = parts[2];
    var addCampaignId = parts[3];
    await answerCallback(callbackId, 'Advertentie aanmaken...');

    try {
      var metaApi = require('../../lib/meta-api-client');
      var pubRefRaw = await store.get('social:pub_ref:' + addPostId);
      if (!pubRefRaw) {
        await sendMessage(chatId, 'Gepubliceerde post referentie verlopen. Publiceer opnieuw.');
        return;
      }
      var pubRef = typeof pubRefRaw === 'string' ? JSON.parse(pubRefRaw) : pubRefRaw;

      if (!pubRef.fbPostId) {
        await sendMessage(chatId, 'Geen Facebook post ID gevonden. Alleen Facebook pagina-posts kunnen als advertentie gebruikt worden.');
        return;
      }

      var isDryRun = process.env.ENABLE_AD_WRITES !== 'true';
      if (isDryRun) {
        await sendMessage(chatId, '<b>DRY RUN</b>: Zou advertentie maken van pagina-post ' + pubRef.fbPostId + ' in campagne ' + addCampaignId + '.\n\nZet ENABLE_AD_WRITES=true om uit te voeren.');
        return;
      }

      var adAccountId = metaApi.AD_ACCOUNT_ID();
      var pageId = process.env.FACEBOOK_PAGE_ID;

      // Construct the full page post ID format: {page_id}_{post_id}
      var pagePostId = pubRef.fbPostId;
      if (pagePostId.indexOf('_') === -1 && pageId) {
        pagePostId = pageId + '_' + pagePostId;
      }

      // Step 1: Find first adset in this campaign
      var adsetsResult = await metaApi.graphRequest('GET', addCampaignId + '/adsets', { fields: 'id,name', limit: '1' });
      if (!adsetsResult.ok || !adsetsResult.data || !adsetsResult.data.data || adsetsResult.data.data.length === 0) {
        await sendMessage(chatId, 'Geen adsets gevonden in deze campagne. Kan geen ad toevoegen zonder adset.');
        return;
      }
      var adsetId = adsetsResult.data.data[0].id;

      // Step 2: Create creative from page post
      var creativeResult = await metaApi.graphRequest('POST', adAccountId + '/adcreatives', null, {
        object_story_id: pagePostId
      });

      if (!creativeResult.ok) {
        await sendMessage(chatId, 'Creative aanmaken mislukt: ' + creativeResult.error);
        return;
      }

      // Step 3: Create ad with the creative
      var adName = 'Social Post Ad - ' + dates.formatDateAmsterdam(new Date());
      var adResult = await metaApi.graphRequest('POST', adAccountId + '/ads', null, {
        adset_id: adsetId,
        name: adName,
        creative: { creative_id: creativeResult.data.id },
        status: 'PAUSED'
      });

      if (!adResult.ok) {
        await sendMessage(chatId, 'Advertentie aanmaken mislukt: ' + adResult.error);
        return;
      }

      await sendMessage(chatId, '<b>Advertentie aangemaakt van gepubliceerde post!</b>\n\nAd ID: ' + adResult.data.id + '\nAdset: ' + adsetsResult.data.data[0].name + '\nStatus: GEPAUZEERD\n\nActiveer via Meta Ads Manager wanneer je klaar bent.');
    } catch (err) {
      console.error('[AddToCampaign] Error:', err.message);
      await sendMessage(chatId, 'Fout bij aanmaken advertentie: ' + err.message);
    }
    return;
  }

  await answerCallback(callbackId, 'Onbekende campagne actie');
}

function buildProposalKeyboard(proposalId) {
  return {
    inline_keyboard: [
      [
        { text: 'Bouwen', callback_data: 'cb:build:' + proposalId },
        { text: 'Budget aanpassen', callback_data: 'cb:adjust:' + proposalId + ':budget' }
      ],
      [
        { text: 'Landen wijzigen', callback_data: 'cb:adjust:' + proposalId + ':countries' },
        { text: 'Nieuw voorstel', callback_data: 'cb:regenerate:' + proposalId }
      ],
      [
        { text: 'Annuleren', callback_data: 'cb:cancel:' + proposalId }
      ]
    ]
  };
}

// --- Main handler ---
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    var body = req.body;
    if (!body) {
      return res.status(200).json({ ok: true });
    }

    // Handle callback_query (button presses)
    if (body.callback_query) {
      var cq = body.callback_query;
      var callbackId = cq.id;
      var data = cq.data || '';
      var chatId = cq.message && cq.message.chat ? cq.message.chat.id : getChatId();
      var messageId = cq.message ? cq.message.message_id : null;

      console.log('[TGCallback] callback_query:', data);

      // Content approve/reject
      if (data.indexOf('content_approve:') === 0 || data.indexOf('content_reject:') === 0) {
        var parts = data.split(':');
        await handleContentAction(callbackId, chatId, parts[0], parts[1]);
        return res.status(200).json({ ok: true });
      }

      // Advisory choice
      if (data.indexOf('adv:') === 0) {
        var advParts = data.split(':');
        await handleAdvisoryChoice(callbackId, chatId, advParts[1], advParts[2]);
        return res.status(200).json({ ok: true });
      }

      // Advisory followup
      if (data.indexOf('advf:') === 0) {
        var advfParts = data.split(':');
        await handleAdvisoryFollowup(callbackId, chatId, advfParts[1], advfParts[2]);
        return res.status(200).json({ ok: true });
      }

      // Limit adjustments
      if (data.indexOf('lim:') === 0) {
        var limParts = data.split(':');
        await handleLimitAction(callbackId, chatId, messageId, limParts);
        return res.status(200).json({ ok: true });
      }

      // Social publish
      if (data.indexOf('pub:') === 0) {
        var pubParts = data.split(':');
        await handlePublish(callbackId, chatId, pubParts[1], pubParts[2]);
        return res.status(200).json({ ok: true });
      }

      // Campaign builder callbacks
      if (data.indexOf('cb:') === 0) {
        await handleCampaignCallback(callbackId, chatId, messageId, data);
        return res.status(200).json({ ok: true });
      }

      // Unknown callback
      await answerCallback(callbackId, 'Onbekende actie');
      return res.status(200).json({ ok: true });
    }

    // Handle text messages (commands)
    if (body.message && body.message.text) {
      var msgChatId = body.message.chat ? body.message.chat.id : getChatId();
      var handled = await handleTextCommand(msgChatId, body.message.text.trim());
      if (!handled) {
        console.log('[TGCallback] Unhandled text:', body.message.text.substring(0, 50));
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[TGCallback] Error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
