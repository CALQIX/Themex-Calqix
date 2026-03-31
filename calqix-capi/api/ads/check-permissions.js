const dotenv = require('dotenv');
const fetch = require('node-fetch');
const { META_API_VERSION } = require('../../lib/meta-capi');

dotenv.config();

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var diagKey = process.env.DIAGNOSTICS_KEY;
  var providedKey =
    (req.query && req.query.key) ||
    (req.headers && req.headers['x-diagnostics-key']);

  if (!diagKey || diagKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN not set in environment variables' });
  }

  var requiredPermissions = ['ads_read', 'ads_management'];
  var optionalPermissions = ['business_management'];

  try {
    var url = 'https://graph.facebook.com/' + META_API_VERSION + '/me/permissions?access_token=' + accessToken;
    var response = await fetch(url);
    var result = await response.json();

    if (result.error) {
      return res.status(200).json({
        status: 'ERROR',
        error: result.error.message,
        error_code: result.error.code,
        token_hint: result.error.code === 190
          ? 'Token is expired or invalid. Generate a new token in Meta Business Settings > System Users.'
          : undefined
      });
    }

    var permissions = (result.data || []).reduce(function (acc, perm) {
      acc[perm.permission] = perm.status;
      return acc;
    }, {});

    var missingRequired = requiredPermissions.filter(function (p) {
      return permissions[p] !== 'granted';
    });
    var missingOptional = optionalPermissions.filter(function (p) {
      return permissions[p] !== 'granted';
    });

    var allRequiredGranted = missingRequired.length === 0;

    var responseBody = {
      status: allRequiredGranted ? 'OK' : 'MISSING_PERMISSIONS',
      token_type: null,
      all_permissions: permissions,
      required: {},
      optional: {},
      api_version: META_API_VERSION
    };

    requiredPermissions.forEach(function (p) {
      responseBody.required[p] = permissions[p] === 'granted' ? 'GRANTED' : 'MISSING';
    });
    optionalPermissions.forEach(function (p) {
      responseBody.optional[p] = permissions[p] === 'granted' ? 'GRANTED' : 'MISSING';
    });

    if (!allRequiredGranted) {
      responseBody.instructions = {
        summary: 'Je access token mist de volgende permissies: ' + missingRequired.join(', '),
        steps: [
          '1. Ga naar Meta Business Settings (business.facebook.com/settings)',
          '2. Navigeer naar System Users (onder Users)',
          '3. Selecteer je System User (of maak een nieuwe aan)',
          '4. Klik op "Generate New Token"',
          '5. Selecteer je App',
          '6. Schakel de volgende scopes in: ads_read, ads_management, business_management',
          '7. Kopieer de nieuwe token',
          '8. Update META_ACCESS_TOKEN in Vercel Dashboard > Environment Variables',
          '9. Redeploy: vercel --prod --yes'
        ],
        alternative: 'Of genereer een nieuwe token in Events Manager > Settings > Conversions API > en voeg ads_read + ads_management scopes toe.'
      };
    }

    // Check token type
    try {
      var debugUrl = 'https://graph.facebook.com/' + META_API_VERSION + '/debug_token?input_token=' + accessToken + '&access_token=' + accessToken;
      var debugResponse = await fetch(debugUrl);
      var debugResult = await debugResponse.json();
      if (debugResult.data) {
        responseBody.token_type = debugResult.data.type || 'unknown';
        responseBody.token_expires = debugResult.data.expires_at
          ? (debugResult.data.expires_at === 0 ? 'never' : new Date(debugResult.data.expires_at * 1000).toISOString())
          : 'unknown';
        responseBody.token_app_id = debugResult.data.app_id || null;
      }
    } catch (e) {
      responseBody.token_type = 'unknown (debug failed)';
    }

    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
}

module.exports = handler;
