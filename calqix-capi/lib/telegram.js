// Simpele Telegram bot notificatie module
// Gebruikt node-fetch (consistent met rest van project)
var fetch = require('node-fetch');

async function sendTelegram(message, replyMarkup) {
  // Global kill switch: operator kan alle Telegram-output uitzetten zonder crons te breken.
  // Default: disabled. Zet TELEGRAM_ENABLED=true in Vercel env om weer te activeren.
  if (process.env.TELEGRAM_ENABLED !== 'true') {
    return { sent: false, reason: 'telegram_disabled' };
  }

  var token = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN of TELEGRAM_CHAT_ID niet ingesteld, skip notificatie');
    return { sent: false, reason: 'missing_env_vars' };
  }

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var body = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);

  try {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    var data = await res.json();

    if (!data.ok) {
      console.error('[Telegram] API error:', data.description);
      return { sent: false, reason: data.description };
    }

    return { sent: true, message_id: data.result.message_id };
  } catch (err) {
    console.error('[Telegram] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendTelegram: sendTelegram };
