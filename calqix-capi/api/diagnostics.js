const dotenv = require('dotenv');
const { formatUserData } = require('../lib/hash');
const { sendEvent, META_API_VERSION } = require('../lib/meta-capi');

dotenv.config();

function checkEnvVars() {
  const vars = [
    'META_PIXEL_ID',
    'META_ACCESS_TOKEN',
    'SHOPIFY_WEBHOOK_SECRET',
    'META_TEST_EVENT_CODE',
    'META_API_VERSION',
    'DIAGNOSTICS_KEY'
  ];

  return vars.reduce(function (acc, name) {
    var val = process.env[name];
    acc[name] = val ? 'SET (' + val.length + ' chars)' : 'NOT SET';
    return acc;
  }, {});
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
    'CALQIX-Diagnostics/1.0'
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

  return res.status(200).json({
    status: metaResult && metaResult.ok ? 'OK' : 'FAILED',
    api_version: META_API_VERSION,
    event_id: eventId,
    test_event_code: process.env.META_TEST_EVENT_CODE || null,
    meta_response: metaResult,
    meta_error: metaError,
    user_data_sent: userDataKeys,
    env_status: checkEnvVars(),
    timestamp: new Date().toISOString()
  });
}

module.exports = handler;
