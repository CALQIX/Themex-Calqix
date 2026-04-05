/**
 * Environment Validator — checks required secrets at startup/import time.
 *
 * Usage: require('./env-validator').validate('content-review')
 *
 * Does NOT throw — logs errors clearly and returns { ok, missing[] }.
 * Caller decides whether to abort.
 */

var PROFILES = {
  'content-review': [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'ANTHROPIC_API_KEY'
  ],
  'telegram-callback': [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ],
  'shopify': [
    'SHOPIFY_ADMIN_ACCESS_TOKEN'
  ],
  'full': [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'ANTHROPIC_API_KEY',
    'SHOPIFY_ADMIN_ACCESS_TOKEN'
  ]
};

/**
 * Validate that required env vars are present for a given profile.
 * @param {string} profile - one of: content-review, telegram-callback, shopify, full
 * @returns {{ ok: boolean, missing: string[], sources: object }}
 */
function validate(profile) {
  var required = PROFILES[profile] || PROFILES['full'];
  var missing = [];
  var sources = {};

  for (var i = 0; i < required.length; i++) {
    var key = required[i];
    var val = process.env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
    } else {
      // Mask value for safe logging
      sources[key] = val.substring(0, 6) + '***' + val.substring(val.length - 3);
    }
  }

  if (missing.length > 0) {
    console.error('[EnvValidator] MISSING required env vars for profile "' + profile + '":', missing.join(', '));
  } else {
    console.log('[EnvValidator] Profile "' + profile + '" OK — all ' + required.length + ' vars present');
  }

  return { ok: missing.length === 0, missing: missing, sources: sources };
}

/**
 * Resolve the Shopify Admin token from environment.
 * Checks SHOPIFY_ADMIN_ACCESS_TOKEN (preferred) and logs the source.
 * Never logs the raw token.
 * @returns {{ token: string|null, source: string }}
 */
function resolveShopifyToken() {
  var token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
  if (token) {
    console.log('[EnvValidator] Shopify Admin token resolved from SHOPIFY_ADMIN_ACCESS_TOKEN (' + token.substring(0, 8) + '***)');
    return { token: token, source: 'SHOPIFY_ADMIN_ACCESS_TOKEN' };
  }

  console.error('[EnvValidator] No Shopify Admin token found. Set SHOPIFY_ADMIN_ACCESS_TOKEN in .env or Vercel env vars.');
  return { token: null, source: 'none' };
}

module.exports = {
  validate: validate,
  resolveShopifyToken: resolveShopifyToken
};
