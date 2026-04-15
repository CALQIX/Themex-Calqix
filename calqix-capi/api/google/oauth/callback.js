/**
 * GET /api/google/oauth/callback — Google OAuth callback endpoint.
 *
 * Receives authorization code from Google, exchanges for tokens,
 * stores refresh token in Redis. This is the ONLY authorized redirect URI.
 *
 * Authorized redirect URI:
 *   https://calqix-capi.vercel.app/api/google/oauth/callback
 */
var googleOAuth = require('../../../lib/google-oauth');
var store = require('../../../lib/store');

module.exports = async function (req, res) {
  try {
    var code = req.query && req.query.code;
    var state = req.query && req.query.state;
    var error = req.query && req.query.error;

    // Google returned an error
    if (error) {
      console.error('[GoogleOAuth] Callback error van Google:', error);
      return res.status(400).json({
        ok: false,
        error: 'Google OAuth fout: ' + error,
        description: req.query.error_description || ''
      });
    }

    if (!code) {
      return res.status(400).json({ ok: false, error: 'Geen authorization code ontvangen' });
    }

    // Verify CSRF state
    if (state) {
      var stateValid = await store.get('google:oauth:state:' + state);
      if (!stateValid) {
        console.warn('[GoogleOAuth] Ongeldige of verlopen state parameter');
        return res.status(400).json({ ok: false, error: 'Ongeldige state — probeer opnieuw via /api/google/oauth/start' });
      }
      // Clean up state
      try { var redis = store._getRedis(); if (redis) await redis.del('google:oauth:state:' + state); } catch (e) {}
    }

    // Exchange code for tokens
    var result = await googleOAuth.exchangeCode(code);

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        help: 'Controleer of de redirect URI exact matcht in Google Cloud Console'
      });
    }

    // Success response
    res.status(200).json({
      ok: true,
      message: 'Google OAuth succesvol afgerond',
      has_refresh_token: result.hasRefreshToken,
      next_steps: result.hasRefreshToken
        ? [
            'Refresh token is opgeslagen in Redis',
            'Google Ads API is nu beschikbaar',
            'Zet GOOGLE_ADS_ENABLED=true in Vercel om conversies te uploaden',
            'Check status via /api/google/oauth/health'
          ]
        : [
            'WAARSCHUWING: Geen refresh token ontvangen',
            'Ga naar /api/google/oauth/start?secret=CRON_SECRET&force=true voor re-consent'
          ]
    });
  } catch (error) {
    console.error('[GoogleOAuth] Callback error:', error.message);
    res.status(500).json({ ok: false, error: 'Interne fout: ' + error.message });
  }
};
