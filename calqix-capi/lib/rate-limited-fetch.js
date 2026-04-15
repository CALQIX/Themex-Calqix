/**
 * Rate-Limited Fetch — shared HTTP client with exponential backoff.
 *
 * Used by all platform API clients (Meta, Google, TikTok).
 * Implements retry with jitter, respects Retry-After headers,
 * and provides per-domain concurrency awareness.
 *
 * Usage:
 *   var rlFetch = require('./rate-limited-fetch');
 *   var result = await rlFetch('https://graph.facebook.com/...', { method: 'POST', ... });
 */
var fetch = require('node-fetch');

var DEFAULT_MAX_RETRIES = 3;
var DEFAULT_BASE_DELAY_MS = 1000;
var DEFAULT_MAX_DELAY_MS = 30000;
var DEFAULT_TIMEOUT_MS = 25000;

/**
 * Fetch with exponential backoff and retry.
 *
 * @param {string} url
 * @param {object} [options] — standard fetch options + retry config
 * @param {number} [options.maxRetries] — default 3
 * @param {number} [options.baseDelay] — default 1000ms
 * @param {number} [options.maxDelay] — default 30000ms
 * @param {number} [options.timeout] — default 25000ms
 * @param {string} [options.label] — log label for debugging
 * @returns {Promise<{ok: boolean, status: number, data: object|null, error: string|null, attempts: number}>}
 */
async function rateLimitedFetch(url, options) {
  var opts = options || {};
  var maxRetries = opts.maxRetries !== undefined ? opts.maxRetries : DEFAULT_MAX_RETRIES;
  var baseDelay = opts.baseDelay || DEFAULT_BASE_DELAY_MS;
  var maxDelay = opts.maxDelay || DEFAULT_MAX_DELAY_MS;
  var timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
  var label = opts.label || 'RLFetch';

  var fetchOpts = {};
  if (opts.method) fetchOpts.method = opts.method;
  if (opts.headers) fetchOpts.headers = opts.headers;
  if (opts.body) fetchOpts.body = opts.body;

  var lastError = null;
  var attempts = 0;

  for (var i = 0; i <= maxRetries; i++) {
    attempts = i + 1;

    try {
      var controller = null;
      var timeoutId = null;

      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        fetchOpts.signal = controller.signal;
        timeoutId = setTimeout(function () { controller.abort(); }, timeout);
      }

      var response = await fetch(url, fetchOpts);

      if (timeoutId) clearTimeout(timeoutId);

      // Success
      if (response.ok) {
        var data = null;
        try { data = await response.json(); } catch (e) { /* not JSON */ }
        return { ok: true, status: response.status, data: data, error: null, attempts: attempts };
      }

      // Rate limited — respect Retry-After
      if (response.status === 429 || response.status === 503) {
        var retryAfter = response.headers.get('Retry-After');
        var waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : calculateDelay(i, baseDelay, maxDelay);

        if (i < maxRetries) {
          console.warn('[' + label + '] Rate limited (' + response.status + '), waiting ' + waitMs + 'ms before retry ' + (i + 1) + '/' + maxRetries);
          await sleep(waitMs);
          continue;
        }
      }

      // Server error — retry
      if (response.status >= 500 && i < maxRetries) {
        var delay = calculateDelay(i, baseDelay, maxDelay);
        console.warn('[' + label + '] Server error (' + response.status + '), retry ' + (i + 1) + '/' + maxRetries + ' in ' + delay + 'ms');
        await sleep(delay);
        continue;
      }

      // Client error or exhausted retries
      var errorBody = null;
      try { errorBody = await response.json(); } catch (e) { /* ignore */ }
      var errorMsg = errorBody && errorBody.error ? (errorBody.error.message || JSON.stringify(errorBody.error)) : ('HTTP ' + response.status);

      return { ok: false, status: response.status, data: errorBody, error: errorMsg, attempts: attempts };

    } catch (err) {
      lastError = err;

      if (i < maxRetries) {
        var retryDelay = calculateDelay(i, baseDelay, maxDelay);
        console.warn('[' + label + '] Network error: ' + err.message + ', retry ' + (i + 1) + '/' + maxRetries + ' in ' + retryDelay + 'ms');
        await sleep(retryDelay);
        continue;
      }
    }
  }

  return {
    ok: false,
    status: 0,
    data: null,
    error: lastError ? lastError.message : 'Max retries exceeded',
    attempts: attempts
  };
}

/**
 * Calculate exponential backoff delay with jitter.
 */
function calculateDelay(attempt, baseDelay, maxDelay) {
  var exponential = baseDelay * Math.pow(2, attempt);
  var jitter = Math.random() * baseDelay;
  return Math.min(exponential + jitter, maxDelay);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

module.exports = rateLimitedFetch;
module.exports.rateLimitedFetch = rateLimitedFetch;
