/**
 * GET /api/google/oauth/start — initiates Google OAuth consent flow.
 *
 * Redirects the operator to Google's consent screen.
 * After consent, Google redirects back to /api/google/oauth/callback.
 *
 * Query params:
 *   ?secret=CRON_SECRET — required for authorization
 *   ?force=true — force re-consent (get new refresh token)
 */
var googleOAuth = require('../../../lib/google-oauth');
var crypto = require('crypto');
var store = require('../../../lib/store');

module.exports = async function (req, res) {
  try {
    // Auth check
    var secret = process.env.CRON_SECRET;
    var querySecret = req.query && req.query.secret;
    if (!secret || querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized — voeg ?secret=CRON_SECRET toe' });
    }

    // Generate CSRF state
    var state = crypto.randomBytes(16).toString('hex');
    await store.set('google:oauth:state:' + state, '1', 600); // 10 min TTL

    var forceConsent = req.query && req.query.force === 'true';
    var authUrl = googleOAuth.buildAuthUrl({
      state: state,
      forceConsent: forceConsent
    });

    console.log('[GoogleOAuth] Start consent flow, redirecting to Google');
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (error) {
    console.error('[GoogleOAuth] Start error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
