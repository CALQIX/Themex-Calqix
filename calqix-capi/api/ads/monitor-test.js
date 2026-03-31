var { sendTelegram } = require('../../lib/telegram');
var { authDiagnostics } = require('../../lib/meta-ads');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var now = new Date().toISOString();
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;

  var message = '🧪 <b>TEST - CALQIX Ads Monitor</b>\n\n' +
    'Dit is een testbericht. Als je dit ziet, werkt de Telegram integratie correct.\n\n' +
    '<b>Timestamp:</b> ' + now + '\n' +
    '<b>Bot token:</b> ' + (botToken ? 'SET (' + botToken.length + ' chars)' : 'NOT SET') + '\n' +
    '<b>Chat ID:</b> ' + (chatId ? 'SET' : 'NOT SET');

  var result = await sendTelegram(message);

  return res.status(200).json({
    status: result.sent ? 'OK' : 'FAILED',
    telegram: result,
    env: {
      TELEGRAM_BOT_TOKEN: botToken ? 'SET (' + botToken.length + ' chars)' : 'NOT SET',
      TELEGRAM_CHAT_ID: chatId ? 'SET' : 'NOT SET'
    },
    timestamp: now
  });
}

module.exports = handler;
