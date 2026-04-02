/**
 * Shared QStash Signature Verification
 *
 * Centralizes QStash signature verification logic used by:
 *   - /api/ads/monitor
 *   - /api/ads/monitor-callback
 *   - /api/recovery/run
 *
 * Requires env vars:
 *   QSTASH_CURRENT_SIGNING_KEY
 *   QSTASH_NEXT_SIGNING_KEY
 *   QSTASH_VERIFY_URL (optional, defaults to https://calqix-capi.vercel.app)
 */

var BASE_URL = 'https://calqix-capi.vercel.app';

/**
 * Read the raw body from a request stream.
 * Must be used with `config = { api: { bodyParser: false } }` on the endpoint.
 * Falls back to req.body (stringified) if stream is empty.
 * @param {object} req
 * @returns {Promise<string>}
 */
function getRawBody(req) {
  return new Promise(function (resolve, reject) {
    // If body parser is disabled, req.body may be a Buffer
    if (Buffer.isBuffer(req.body)) {
      return resolve(req.body.toString('utf-8'));
    }
    var chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf-8');
      resolve(raw);
    });
    req.on('error', function (err) { reject(err); });
    // Safety timeout — if no data events fire within 2s, resolve with empty
    setTimeout(function () { resolve(chunks.length ? Buffer.concat(chunks).toString('utf-8') : ''); }, 2000);
  });
}

/**
 * Verify QStash signature on an incoming request.
 * @param {object} req — HTTP request object
 * @param {string} body — raw body string
 * @param {string} endpointPath — e.g. '/api/recovery/run'
 * @returns {Promise<boolean>}
 */
async function verifyQStashSignature(req, body, endpointPath) {
  var currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  var nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) return false;

  var signature = req.headers && req.headers['upstash-signature'];
  if (!signature) return false;

  try {
    var { Receiver } = require('@upstash/qstash');
    var receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
    var url = (process.env.QSTASH_VERIFY_URL || BASE_URL) + endpointPath;
    var isValid = await receiver.verify({
      signature: signature,
      body: body || '',
      url: url
    });
    return isValid;
  } catch (err) {
    console.warn('[QStashVerify] Signature verification failed for ' + endpointPath + ':', err.message);
    return false;
  }
}

/**
 * Verify CRON_SECRET from query param or Authorization header.
 * @param {object} req
 * @returns {boolean}
 */
function verifyCronSecret(req) {
  var secret = process.env.CRON_SECRET;
  if (!secret) return false;
  var querySecret = req.query && req.query.secret;
  if (querySecret === secret) return true;
  var authHeader = req.headers && req.headers['authorization'];
  if (authHeader === 'Bearer ' + secret) return true;
  return false;
}

/**
 * Authenticate a request using QStash signature (primary) or CRON_SECRET (fallback).
 * @param {object} req
 * @param {string} rawBody
 * @param {string} endpointPath
 * @returns {Promise<{ok: boolean, source: string}>}
 */
async function authenticate(req, rawBody, endpointPath) {
  var qstashValid = await verifyQStashSignature(req, rawBody, endpointPath);
  if (qstashValid) return { ok: true, source: 'qstash' };

  if (verifyCronSecret(req)) return { ok: true, source: 'cron_secret' };

  return { ok: false, source: 'none' };
}

module.exports = {
  getRawBody: getRawBody,
  verifyQStashSignature: verifyQStashSignature,
  verifyCronSecret: verifyCronSecret,
  authenticate: authenticate
};
