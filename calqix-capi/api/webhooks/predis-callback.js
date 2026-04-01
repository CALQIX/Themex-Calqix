var { sendTelegram } = require('../../lib/telegram');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional HMAC verification if PREDIS_WEBHOOK_SECRET is set
  var secret = process.env.PREDIS_WEBHOOK_SECRET;
  if (secret) {
    var providedSecret = (req.query && req.query.secret) ||
      (req.headers && req.headers['x-webhook-secret']);
    if (providedSecret !== secret) {
      console.warn('[predis-callback] Invalid webhook secret');
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  var body = req.body || {};
  var postId = body.post_id || body.id || 'unknown';
  var status = body.status || body.post_status || 'unknown';
  var urls = body.urls || body.output_urls || [];
  var caption = body.caption || '';
  var error = body.error || null;

  console.log('[predis-callback] Received:', JSON.stringify({
    post_id: postId,
    status: status,
    urls_count: urls.length,
    has_error: !!error
  }));

  // Send Telegram notification
  var msg = '';
  if (status === 'completed' || status === 'success') {
    msg = '<b>Predis ad klaar</b>\n\n' +
      'Post ID: <code>' + postId + '</code>\n' +
      'Status: ' + status + '\n';
    if (caption) {
      msg += 'Caption: ' + caption.substring(0, 200) + '\n';
    }
    if (urls.length > 0) {
      msg += '\nBekijk en download:\n';
      urls.forEach(function (url, i) {
        msg += (i + 1) + '. ' + url + '\n';
      });
    }
    msg += '\nOpen in Predis: https://predis.ai/app/posts/' + postId;
  } else if (error) {
    msg = '<b>Predis ad MISLUKT</b>\n\n' +
      'Post ID: <code>' + postId + '</code>\n' +
      'Error: ' + (typeof error === 'string' ? error : JSON.stringify(error));
  } else {
    msg = '<b>Predis webhook</b>\n\n' +
      'Post ID: <code>' + postId + '</code>\n' +
      'Status: ' + status;
  }

  var telegramResult = await sendTelegram(msg);

  return res.status(200).json({
    received: true,
    post_id: postId,
    status: status,
    telegram_sent: telegramResult ? telegramResult.sent : false
  });
}

module.exports = handler;
