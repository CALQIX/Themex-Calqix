/**
 * QStash Callback / Failure Callback Endpoint
 *
 * QStash calls this endpoint after the monitor job completes or fails.
 * Used to track delivery status and trigger secondary notifications on failure.
 *
 * Callback:         POST /api/ads/monitor-callback?type=success
 * Failure Callback: POST /api/ads/monitor-callback?type=failure
 *
 * Both are verified via QStash signature.
 */
var { sendTelegram } = require('../../lib/telegram');
var store = require('../../lib/store');

async function verifyQStashSignature(req, body) {
  var currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  var nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) return false;

  var signature = req.headers && req.headers['upstash-signature'];
  if (!signature) return false;

  try {
    var { Receiver } = require('@upstash/qstash');
    var receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
    var isValid = await receiver.verify({
      signature: signature,
      body: body || '',
      url: (process.env.QSTASH_VERIFY_URL || 'https://calqix-capi.vercel.app') + '/api/ads/monitor-callback'
    });
    return isValid;
  } catch (err) {
    console.warn('[MonitorCallback] QStash sig verify failed:', err.message);
    return false;
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  var isValid = await verifyQStashSignature(req, rawBody);
  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var callbackType = (req.query && req.query.type) || 'unknown';
  var body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) { /* ignore parse errors */ }

  console.log('[MonitorCallback] Received', { type: callbackType, body: JSON.stringify(body).substring(0, 500) });

  if (callbackType === 'failure') {
    // QStash exhausted all retries — send emergency notification
    var failMsg = '\ud83d\udea8 <b>CALQIX Monitor — QStash Delivery FAILED</b>\n\n'
      + 'QStash kon de dagelijkse monitor niet bereiken na alle retries.\n'
      + 'Status: <code>' + (body.status || 'unknown') + '</code>\n\n'
      + 'Check:\n'
      + '1. Vercel deployment status\n'
      + '2. Upstash QStash dashboard\n'
      + '3. Vercel function logs';

    try {
      await sendTelegram(failMsg);
    } catch (e) {
      console.error('[MonitorCallback] Telegram notification failed', e.message);
    }

    // Persist failure in store
    var today = new Date().toISOString().split('T')[0];
    await store.setNotifyStatus('qstash_failure_' + today, {
      type: 'qstash_delivery_failure',
      status: body.status,
      timestamp: new Date().toISOString()
    });
  }

  if (callbackType === 'success') {
    console.log('[MonitorCallback] QStash delivery confirmed successful');
  }

  return res.status(200).json({ received: true, type: callbackType });
}

module.exports = handler;
