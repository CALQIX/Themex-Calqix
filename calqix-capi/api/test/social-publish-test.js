/**
 * Social Publish Test
 *
 * GET /api/test/social-publish-test?key=DIAGNOSTICS_KEY&target=instagram|facebook|both
 *
 * Posts a test image to the selected platform(s) and sends
 * a Telegram message with the result + campaign builder prompt.
 */
var socialPublisher = require('../../lib/social-publisher');
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var fetch = require('node-fetch');

var TEST_IMAGE_URL = 'https://cdn.shopify.com/s/files/1/0788/4375/3553/files/calqix-flowcore-product.jpg?v=1700000000';

function getBotToken() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
function getChatId() { return process.env.TELEGRAM_CHAT_ID || ''; }

async function sendTelegram(text, replyMarkup) {
  var token = getBotToken();
  var chatId = getChatId();
  if (!token || !chatId) return { sent: false };
  var body = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  try {
    var res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) { return { sent: false, error: e.message }; }
}

module.exports = async function handler(req, res) {
  var diagKey = process.env.DIAGNOSTICS_KEY;
  var providedKey = req.query && req.query.key;
  if (!diagKey || diagKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var target = (req.query && req.query.target) || 'both';
  var testCaption = 'CALQIX Test Post - ' + dates.formatDateTimeAmsterdam(new Date()) + '\n\nThis is a test post from the CALQIX automation system. Will be deleted after testing.';

  var output = {
    target: target,
    timestamp: new Date().toISOString(),
    testImageUrl: TEST_IMAGE_URL,
    results: [],
    errors: []
  };

  // First, check if test image URL is accessible
  try {
    var imgCheck = await fetch(TEST_IMAGE_URL, { method: 'HEAD' });
    output.imageAccessible = imgCheck.ok;
    output.imageStatus = imgCheck.status;
    if (!imgCheck.ok) {
      // Fallback to a guaranteed accessible image
      output.testImageUrl = 'https://calqix.com/cdn/shop/files/FlowCore-Packshot-Front_800x.png';
    }
  } catch (e) {
    output.imageAccessible = false;
    output.testImageUrl = 'https://calqix.com/cdn/shop/files/FlowCore-Packshot-Front_800x.png';
  }

  var imageUrl = output.testImageUrl;

  // Publish to selected target
  if (target === 'facebook' || target === 'both') {
    var fbResult = await socialPublisher.publishToFacebook(imageUrl, testCaption);
    if (fbResult.ok) {
      output.results.push(fbResult);
    } else {
      output.errors.push({ platform: 'facebook', error: fbResult.error });
    }
  }

  if (target === 'instagram' || target === 'both') {
    var igResult = await socialPublisher.publishToInstagram(imageUrl, testCaption);
    if (igResult.ok) {
      output.results.push(igResult);
    } else {
      output.errors.push({ platform: 'instagram', error: igResult.error });
    }
  }

  // Store test post in Redis for campaign builder reference
  var testPostId = 'test_' + Date.now();
  await store.set('social:test_post:' + testPostId, JSON.stringify({
    image_url: imageUrl,
    caption: testCaption,
    results: output.results,
    errors: output.errors,
    published_at: dates.formatDateTimeAmsterdam(new Date())
  }), 86400);

  // Log
  await socialPublisher.logPublish(testPostId, target, output.results, output.errors);

  // Send Telegram notification with approve/reject for testing
  var platformsPublished = output.results.map(function (r) { return r.platform; }).join(' + ') || 'none';
  var postIds = output.results.map(function (r) { return r.platform + ': ' + r.post_id; }).join('\n') || 'none';
  var errorLines = output.errors.map(function (e) { return e.platform + ': ' + e.error; }).join('\n') || 'none';

  var tgText = '<b>CALQIX Social Publish Test</b>\n\n' +
    'Published to: ' + platformsPublished + '\n' +
    'Post IDs:\n' + postIds + '\n';

  if (output.errors.length > 0) {
    tgText += '\nErrors:\n' + errorLines + '\n';
  }

  tgText += '\nThis is a test. Approve to test the approval flow, or reject to dismiss.';

  var keyboard = {
    inline_keyboard: [
      [
        { text: 'Approve (test)', callback_data: 'content_approve:' + testPostId },
        { text: 'Reject (test)', callback_data: 'content_reject:' + testPostId }
      ]
    ]
  };

  await sendTelegram(tgText, keyboard);

  output.testPostId = testPostId;
  output.telegramSent = true;

  return res.status(200).json(output);
};
