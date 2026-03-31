const dotenv = require('dotenv');
const fetch = require('node-fetch');
const { cacheSize, recentKeys } = require('../lib/dedup-guard');
const { formatUserData } = require('../lib/hash');
const { isCapiEnabled, sendEvent, META_API_VERSION } = require('../lib/meta-capi');

dotenv.config();

function checkEnvVars() {
  var vars = [
    'META_PIXEL_ID',
    'META_ACCESS_TOKEN',
    'SHOPIFY_WEBHOOK_SECRET',
    'META_TEST_EVENT_CODE',
    'META_API_VERSION',
    'DIAGNOSTICS_KEY',
    'CAPI_ENABLED'
  ];

  return vars.reduce(function (acc, name) {
    var val = process.env[name];
    acc[name] = val ? 'SET (' + val.length + ' chars)' : 'NOT SET';
    return acc;
  }, {});
}

async function checkPixelIdConflict() {
  var serverPixelId = process.env.META_PIXEL_ID || null;
  var browserPixelId = null;
  var error = null;

  try {
    var response = await fetch('https://calqix.com', {
      headers: { 'User-Agent': 'CALQIX-Diagnostics/2.0' },
      timeout: 5000
    });
    var html = await response.text();
    var match = html.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/);
    if (match) {
      browserPixelId = match[1];
    }
  } catch (err) {
    error = err.message;
  }

  return {
    server_pixel_id: serverPixelId,
    browser_pixel_id: browserPixelId || '(not found in HTML — may be injected by Shopify web-pixels-manager at runtime)',
    pixel_id_match: browserPixelId ? browserPixelId === serverPixelId : null,
    note: browserPixelId === null && !error
      ? 'Shopify FB sales channel injects pixel via sandboxed web-pixels-manager, not visible in page HTML'
      : undefined,
    error: error || undefined
  };
}

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

  var testUserData = formatUserData(
    {
      email: 'test@calqix.com',
      first_name: 'Test',
      last_name: 'User',
      country_code: 'NL',
      phone: '+31612345678'
    },
    '127.0.0.1',
    'CALQIX-Diagnostics/2.0'
  );

  var testCustomData = {
    value: 1.00,
    currency: 'EUR',
    content_ids: ['diagnostics_test'],
    content_type: 'product',
    content_name: 'Diagnostics Test Event'
  };

  var eventId = 'diag_' + Date.now();
  var metaResult = null;
  var metaError = null;

  try {
    metaResult = await sendEvent(
      'PageView',
      eventId,
      'https://calqix.com/diagnostics-test',
      testUserData,
      testCustomData
    );
  } catch (err) {
    metaError = err.message;
  }

  var userDataKeys = Object.keys(testUserData).reduce(function (acc, key) {
    var val = testUserData[key];
    if (Array.isArray(val)) {
      acc[key] = val.map(function (v) { return typeof v === 'string' && v.length === 64 ? 'sha256:' + v.substring(0, 8) + '...' : v; });
    } else {
      acc[key] = typeof val === 'string' && val.length > 20 ? val.substring(0, 20) + '...' : val;
    }
    return acc;
  }, {});

  var capiEnabled = isCapiEnabled();
  var pixelCheck = await checkPixelIdConflict();

  return res.status(200).json({
    status: metaResult && metaResult.ok ? 'OK' : 'FAILED',
    capi_enabled: capiEnabled,
    capi_mode: capiEnabled ? 'SENDING events to Meta' : 'LOGGING only (events NOT sent to Meta)',
    api_version: META_API_VERSION,
    event_id: eventId,
    test_event_code: process.env.META_TEST_EVENT_CODE || null,
    meta_response: metaResult,
    meta_error: metaError,
    pixel_id_check: pixelCheck,
    dedup_guard: {
      cache_size: cacheSize(),
      recent_keys: recentKeys(5)
    },
    deployment: {
      node_version: process.version,
      vercel_region: process.env.VERCEL_REGION || 'unknown',
      meta_api_version: META_API_VERSION
    },
    user_data_sent: userDataKeys,
    env_status: checkEnvVars(),
    timestamp: new Date().toISOString()
  });
}

module.exports = handler;
