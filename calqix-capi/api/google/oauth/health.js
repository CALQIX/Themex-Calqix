/**
 * GET /api/google/oauth/health — Google OAuth + API health check.
 *
 * Shows config sanity without leaking secrets.
 * Requires CRON_SECRET or DIAGNOSTICS_KEY for auth.
 */
var googleOAuth = require('../../../lib/google-oauth');

module.exports = async function (req, res) {
  try {
    // Auth
    var secret = process.env.CRON_SECRET || '';
    var diagKey = process.env.DIAGNOSTICS_KEY || '';
    var authHeader = req.headers['authorization'] || '';
    var querySecret = (req.query && req.query.secret) || '';

    var authorized = (secret && (authHeader === 'Bearer ' + secret || querySecret === secret)) ||
                     (diagKey && (authHeader === 'Bearer ' + diagKey || querySecret === diagKey));

    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var oauthHealth = await googleOAuth.getHealthStatus();

    var ga4Status = {
      measurement_id: process.env.GA4_MEASUREMENT_ID ? maskValue(process.env.GA4_MEASUREMENT_ID) : null,
      has_api_secret: Boolean(process.env.GA4_API_SECRET),
      enabled: process.env.GA4_ENABLED === 'true',
      property_id: process.env.GA4_PROPERTY_ID || null,
      stream_id: process.env.GA4_STREAM_ID || null
    };

    var gadsStatus = {
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID ? maskValue(process.env.GOOGLE_ADS_CUSTOMER_ID) : null,
      manager_id: process.env.GOOGLE_ADS_MANAGER_ID ? maskValue(process.env.GOOGLE_ADS_MANAGER_ID) : null,
      has_developer_token: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
      conversion_action: process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || null,
      enabled: (process.env.GOOGLE_ADS_ENABLED || '').trim() === 'true',
      has_oauth_token: oauthHealth.has_refresh_token
    };

    var envStatus = {
      google_enabled: process.env.GOOGLE_ENABLED === 'true',
      cloud_project_id: process.env.GOOGLE_CLOUD_PROJECT_ID || null,
      vercel_env: process.env.VERCEL_ENV || 'unknown',
      deployment_url: process.env.VERCEL_URL || 'unknown'
    };

    res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      oauth: oauthHealth,
      ga4: ga4Status,
      google_ads: gadsStatus,
      environment: envStatus,
      actions: buildActions(oauthHealth, ga4Status, gadsStatus)
    });
  } catch (error) {
    console.error('[GoogleHealth] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
};

function maskValue(val) {
  if (!val) return null;
  if (val.length <= 6) return '***';
  return val.slice(0, 3) + '***' + val.slice(-3);
}

function buildActions(oauth, ga4, gads) {
  var actions = [];

  if (!oauth.has_refresh_token) {
    actions.push({
      priority: 'CRITICAL',
      action: 'Voer OAuth consent flow uit',
      url: '/api/google/oauth/start?secret=CRON_SECRET'
    });
  }

  if (!ga4.enabled && ga4.measurement_id && ga4.has_api_secret) {
    actions.push({
      priority: 'INFO',
      action: 'GA4 is geconfigureerd maar uitgeschakeld — zet GA4_ENABLED=true in Vercel'
    });
  }

  if (!gads.enabled && gads.customer_id && gads.has_developer_token && oauth.has_refresh_token) {
    actions.push({
      priority: 'READY',
      action: 'Google Ads is klaar — zet GOOGLE_ADS_ENABLED=true in Vercel'
    });
  }

  if (gads.enabled && !oauth.has_refresh_token) {
    actions.push({
      priority: 'ERROR',
      action: 'Google Ads staat aan maar geen OAuth token — uploads zullen falen'
    });
  }

  if (actions.length === 0) {
    actions.push({ priority: 'OK', action: 'Alles correct geconfigureerd' });
  }

  return actions;
}
