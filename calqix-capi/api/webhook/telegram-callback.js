/**
 * Telegram Webhook Callback Handler
 *
 * Receives callback_query from inline keyboard buttons and text commands.
 * Handles:
 *   - content_approve:{postId} / content_reject:{postId}
 *   - adv:{advisoryId}:{safe|balanced|aggressive|refresh|skip}
 *   - advf:{advisoryId}:{optionIndex}
 *   - lim:{limitKey}:{delta}
 *   - /limits, /set_adset_max, /set_daily_max, /set_campaign_max
 */
var fetch = require('node-fetch');
var store = require('../../lib/store');
var approvalQueue = require('../../lib/approval-queue');
var dates = require('../../lib/dates');

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

    await answerCallback(callbackId, 'Approved! Queued for publishing.');
    await sendMessage(chatId, 'Creative ' + postId.substring(0, 8) + '... approved. Queued for next publish slot.');

  } else if (action === 'content_reject') {
    await store.set('content:rejected:' + dateStr + ':' + postId, JSON.stringify({
      post_id: postId, rejectedAt: new Date().toISOString(), rejectedBy: 'telegram'
    }), 86400);

    await answerCallback(callbackId, 'Rejected.');
    await sendMessage(chatId, 'Creative ' + postId.substring(0, 8) + '... rejected.');
  }
}

// --- Advisory choose ---
async function handleAdvisoryChoice(callbackId, chatId, advisoryId, action) {
  var raw = await store.get('advisory:' + advisoryId);
  if (!raw) {
    await answerCallback(callbackId, 'Advisory expired.');
    return;
  }
  var advisory = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (action === 'skip') {
    advisory.status = 'skipped';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);
    await answerCallback(callbackId, 'Advisory skipped.');
    return;
  }

  if (action === 'refresh') {
    await answerCallback(callbackId, 'Use the next scheduled advisory for fresh data.');
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
    await answerCallback(callbackId, 'Strategy not found.');
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
    await sendMessage(chatId, 'You chose: ' + levelEmoji(action) + ' ' + strategy.title + '\n\n' + strategy.followup_question, keyboard);
    await answerCallback(callbackId, 'Selected: ' + action);
  } else {
    // No followup needed, queue actions directly
    await queueStrategyActions(advisoryId, advisory, strategy);
    advisory.status = 'confirmed';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);

    await sendConfirmation(chatId, strategy);
    await answerCallback(callbackId, 'Actions queued!');
  }
}

// --- Advisory followup ---
async function handleAdvisoryFollowup(callbackId, chatId, advisoryId, optionIndex) {
  var raw = await store.get('advisory:' + advisoryId);
  if (!raw) {
    await answerCallback(callbackId, 'Advisory expired.');
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
    await answerCallback(callbackId, 'Strategy not found.');
    return;
  }

  var chosenOption = strategy.followup_options[parseInt(optionIndex, 10)] || '';
  if (chosenOption.toLowerCase().indexOf('cancel') !== -1) {
    advisory.status = 'skipped';
    await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);
    await answerCallback(callbackId, 'Cancelled.');
    await sendMessage(chatId, 'Strategy cancelled. No actions taken.');
    return;
  }

  advisory.followup_answer = parseInt(optionIndex, 10);
  advisory.status = 'confirmed';
  await store.set('advisory:' + advisoryId, JSON.stringify(advisory), 86400);

  await queueStrategyActions(advisoryId, advisory, strategy);
  await sendConfirmation(chatId, strategy, chosenOption);
  await answerCallback(callbackId, 'Confirmed! Actions queued.');
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
      'Type the limit you want to change:\n\n' +
      '/set_adset_max [amount]\n' +
      '/set_daily_max [amount]\n' +
      '/set_campaign_max [amount]\n\n' +
      'Example: /set_daily_max 150'
    );
    await answerCallback(callbackId, 'Type a command below');
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
  var text = 'CALQIX Budget Limits\n\n' +
    'Adset max:     EUR ' + updatedLimits.max_adset_budget + '\n' +
    'Daily max:     EUR ' + updatedLimits.max_daily_spend + '\n' +
    'Campaign max:  EUR ' + updatedLimits.max_campaign_budget + '\n\n' +
    'Last changed: ' + (updatedLimits.updated_at || 'now');
  var keyboard = buildLimitsKeyboard(updatedLimits);
  await editMessageText(chatId, messageId, text, keyboard);
  await answerCallback(callbackId, limitKey + ': EUR ' + oldValue + ' > EUR ' + newValue);
}

// --- Text command handlers ---
async function handleTextCommand(chatId, text) {
  var limits = require('../../lib/limits');

  if (text === '/limits') {
    var current = await limits.getLimits();
    var msg = 'CALQIX Budget Limits\n\n' +
      'Adset max:     EUR ' + current.max_adset_budget + '\n' +
      'Daily max:     EUR ' + current.max_daily_spend + '\n' +
      'Campaign max:  EUR ' + current.max_campaign_budget + '\n\n' +
      'Last changed: ' + (current.updated_at || 'system default');
    var keyboard = buildLimitsKeyboard(current);
    await sendMessage(chatId, msg, keyboard);
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
        await sendMessage(chatId, 'Invalid amount. Minimum EUR 10.');
        return true;
      }
      await limits.updateLimit(setCommands[cmdKeys[i]], amount);
      await sendMessage(chatId, cmdKeys[i].replace('/set_', '').replace('_', ' ') + ' updated: EUR ' + amount);
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
        { text: 'Custom amount...', callback_data: 'lim:custom' }
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
  var lines = ['Strategy queued: ' + levelEmoji(strategy.level) + ' ' + strategy.title + '\n'];

  var actions = strategy.actions || [];
  if (actions.length > 0) {
    lines.push('Actions:');
    for (var i = 0; i < actions.length; i++) {
      lines.push((i + 1) + '. ' + (actions[i].detail || actions[i].type));
    }
  }

  if (followupChoice) {
    lines.push('\nChoice: ' + followupChoice);
  }

  var mode = process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY';
  var enableWrites = process.env.ENABLE_AD_WRITES === 'true';
  if (!enableWrites || mode === 'MONITOR_ONLY') {
    lines.push('\nNote: System is in monitor-only mode. Actions logged but not executed.');
  } else {
    lines.push('\nActions executing via Meta API. Check Telegram for confirmation per action.');
  }

  await sendMessage(chatId, lines.join('\n'));
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

      // Unknown callback
      await answerCallback(callbackId, 'Unknown action');
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
