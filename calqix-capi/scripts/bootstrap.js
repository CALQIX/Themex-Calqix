#!/usr/bin/env node
/**
 * CALQIX CAPI — Bootstrap & Verification Script
 *
 * Usage:
 *   node scripts/bootstrap.js                — run all checks
 *   node scripts/bootstrap.js verify-redis   — check Redis connectivity
 *   node scripts/bootstrap.js verify-qstash  — check QStash connectivity
 *   node scripts/bootstrap.js create-schedule — create/update QStash schedule
 *   node scripts/bootstrap.js list-schedules  — list existing QStash schedules
 *   node scripts/bootstrap.js delete-schedule — delete the monitor schedule
 *   node scripts/bootstrap.js smoke-test      — test monitor endpoint
 *   node scripts/bootstrap.js verify-all      — run full verification suite
 *
 * Requires: .env file or environment variables set
 */
require('dotenv').config();

var MONITOR_URL = process.env.CAPI_BASE_URL || 'https://calqix-capi.vercel.app';
// Consolidated schedule IDs (10 total, fits QStash free tier)
var SCHEDULE_ID_OPTIMIZER = 'calqix-optimizer';           // 1. Ad Pulse every 2h (07-23)
var SCHEDULE_ID_RECOVERY = 'calqix-recovery';              // 2. Recovery every minute
var SCHEDULE_ID_CONTENT_MORNING = 'calqix-content-morning'; // 3. Insights→Plan→Generate chain 05:45
var SCHEDULE_ID_CONTENT_REVIEW = 'calqix-content-review';  // 4. Review 07:05
var SCHEDULE_ID_CONTENT_PUBLISH_AM = 'calqix-content-publish-am'; // 5. Publish post1 08:30
var SCHEDULE_ID_CONTENT_PUBLISH_PM = 'calqix-content-publish-pm'; // 6. Publish post2 18:30
var SCHEDULE_ID_CONTENT_REFLECT = 'calqix-content-reflect'; // 7. Reflect 21:30
var SCHEDULE_ID_AD_MORNING = 'calqix-ad-morning';          // 8. Sync→Engine→Report chain 09:00
var SCHEDULE_ID_AD_MIDDAY = 'calqix-ad-midday';            // 9. Midday check 15:00
var SCHEDULE_ID_AD_CLOSE = 'calqix-ad-daily-close';        // 10. Daily close 21:00
// Legacy IDs for deletion cleanup
var LEGACY_IDS = [
  'calqix-daily-monitor', 'calqix-optimizer-morning', 'calqix-optimizer-afternoon',
  'calqix-optimizer-evening', 'calqix-content-insights', 'calqix-content-plan',
  'calqix-content-generate', 'calqix-ad-perf-sync', 'calqix-ad-opt-engine', 'calqix-ad-opt-report'
];

async function main() {
  var command = process.argv[2] || 'verify-all';
  console.log('\n=== CALQIX CAPI Bootstrap ===');
  console.log('Command:', command);
  console.log('');

  switch (command) {
    case 'verify-redis':
      return await verifyRedis();
    case 'verify-qstash':
      return await verifyQStash();
    case 'create-schedule':
      return await createOptimizerSchedule();
    case 'create-recovery-schedule':
      return await createRecoverySchedule();
    case 'create-all-schedules':
      return await createAllSchedules();
    case 'create-content-schedules':
      return await createContentSchedules();
    case 'create-ad-opt-schedules':
      return await createAdOptSchedules();
    case 'list-schedules':
      return await listSchedules();
    case 'delete-schedule':
      return await deleteAllSchedules();
    case 'smoke-test':
      return await smokeTest();
    case 'smoke-test-recovery':
      return await smokeTestRecovery();
    case 'verify-all':
      return await verifyAll();
    default:
      console.log('Unknown command:', command);
      process.exit(1);
  }
}

// --- Redis Verification ---

async function verifyRedis() {
  console.log('[Redis] Checking connectivity...');
  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error('[Redis] FAIL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN not set');
    return false;
  }

  try {
    var { Redis } = require('@upstash/redis');
    var redis = new Redis({ url: url, token: token });

    // Test SET
    var testKey = 'bootstrap:test:' + Date.now();
    await redis.set(testKey, 'ok', { ex: 60 });
    console.log('[Redis] SET ok');

    // Test GET
    var val = await redis.get(testKey);
    if (val !== 'ok') throw new Error('GET returned: ' + val);
    console.log('[Redis] GET ok');

    // Test DEL
    await redis.del(testKey);
    console.log('[Redis] DEL ok');

    // Test SETNX (lock behavior)
    var lockKey = 'bootstrap:lock:' + Date.now();
    var first = await redis.set(lockKey, '1', { nx: true, ex: 10 });
    var second = await redis.set(lockKey, '1', { nx: true, ex: 10 });
    if (!(first === 'OK' || first === true)) throw new Error('SETNX first attempt failed');
    if (second === 'OK' || second === true) throw new Error('SETNX should have failed on second attempt');
    await redis.del(lockKey);
    console.log('[Redis] SETNX (lock) ok');

    console.log('[Redis] PASS: All tests passed');
    console.log('[Redis] URL:', url.substring(0, 30) + '...');
    return true;
  } catch (err) {
    console.error('[Redis] FAIL:', err.message);
    return false;
  }
}

// --- QStash Verification ---

async function verifyQStash() {
  console.log('[QStash] Checking connectivity...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  var currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  var nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) {
    console.warn('[QStash] WARNING: QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not set — signature verification will fail');
  } else {
    console.log('[QStash] Signing keys present');
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    var schedules = await client.schedules.list();
    console.log('[QStash] Connected — ' + schedules.length + ' schedule(s) found');
    console.log('[QStash] PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

// --- Schedule Management ---

async function createOptimizerSchedule() {
  console.log('[QStash] Creating optimizer schedule (every 2h, 07:00-23:00)...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });

    var destination = MONITOR_URL + '/api/ads/monitor';
    var callbackUrl = MONITOR_URL + '/api/ads/monitor-callback?type=success';
    var failureCallbackUrl = MONITOR_URL + '/api/ads/monitor-callback?type=failure';
    var authHeader = { 'Authorization': 'Bearer ' + (process.env.CRON_SECRET || '') };

    var result = await client.schedules.create({
      scheduleId: SCHEDULE_ID_OPTIMIZER,
      destination: destination,
      cron: 'CRON_TZ=Europe/Amsterdam 0 7,9,11,13,15,17,19,21,23 * * *',
      retries: 3,
      headers: authHeader,
      callback: callbackUrl,
      failureCallback: failureCallbackUrl
    });
    console.log('[QStash] Optimizer schedule created (9x daily, every 2h 07-23)');

    console.log('[QStash] Optimizer schedule PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

async function createRecoverySchedule() {
  console.log('[QStash] Creating/updating recovery schedule (every minute)...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });

    var destination = MONITOR_URL + '/api/recovery/run';

    var authHeader = { 'Authorization': 'Bearer ' + (process.env.CRON_SECRET || '') };

    var schedule = await client.schedules.create({
      scheduleId: SCHEDULE_ID_RECOVERY,
      destination: destination,
      cron: 'CRON_TZ=Europe/Amsterdam * * * * *',
      retries: 1,
      headers: authHeader
    });

    console.log('[QStash] Recovery schedule created:');
    console.log('  ID:          ', schedule.scheduleId || SCHEDULE_ID_RECOVERY);
    console.log('  Destination: ', destination);
    console.log('  Cron:         every minute');
    console.log('  Retries:     ', 1);
    console.log('[QStash] Recovery schedule PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

async function createContentSchedules() {
  console.log('[QStash] Creating consolidated content schedules (5 slots)...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    var authHeader = { 'Authorization': 'Bearer ' + (process.env.CRON_SECRET || '') };

    var contentSchedules = [
      { id: SCHEDULE_ID_CONTENT_MORNING, path: '/api/cron/content-morning', cron: '45 5 * * *', label: 'Content Morning Chain 05:45 (insights→plan→generate)' },
      { id: SCHEDULE_ID_CONTENT_REVIEW, path: '/api/cron/content-review', cron: '5 7 * * *', label: 'Content Review 07:05' },
      { id: SCHEDULE_ID_CONTENT_PUBLISH_AM, path: '/api/cron/content-publish?slot=post1', cron: '30 8 * * *', label: 'Publish Post1 08:30' },
      { id: SCHEDULE_ID_CONTENT_PUBLISH_PM, path: '/api/cron/content-publish?slot=post2', cron: '30 18 * * *', label: 'Publish Post2 18:30' },
      { id: SCHEDULE_ID_CONTENT_REFLECT, path: '/api/cron/content-reflect', cron: '30 21 * * *', label: 'Content Reflect 21:30' }
    ];

    for (var i = 0; i < contentSchedules.length; i++) {
      var s = contentSchedules[i];
      var result = await client.schedules.create({
        scheduleId: s.id,
        destination: MONITOR_URL + s.path,
        cron: 'CRON_TZ=Europe/Amsterdam ' + s.cron,
        retries: 2,
        headers: authHeader
      });
      console.log('[QStash] Created: ' + s.label + ' (' + s.id + ')');
    }

    console.log('[QStash] Content schedules PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

async function createAdOptSchedules() {
  console.log('[QStash] Creating consolidated ad optimization schedules (3 slots)...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    var authHeader = { 'Authorization': 'Bearer ' + (process.env.CRON_SECRET || '') };

    var adSchedules = [
      { id: SCHEDULE_ID_AD_MORNING, path: '/api/cron/ad-morning', cron: '0 9 * * *', label: 'Ad Morning Chain 09:00 (sync→engine→report)' },
      { id: SCHEDULE_ID_AD_MIDDAY, path: '/api/cron/ad-midday-check', cron: '0 15 * * *', label: 'Ad Midday 15:00' },
      { id: SCHEDULE_ID_AD_CLOSE, path: '/api/cron/ad-daily-close', cron: '0 21 * * *', label: 'Ad Daily Close 21:00' }
    ];

    for (var i = 0; i < adSchedules.length; i++) {
      var s = adSchedules[i];
      var result = await client.schedules.create({
        scheduleId: s.id,
        destination: MONITOR_URL + s.path,
        cron: 'CRON_TZ=Europe/Amsterdam ' + s.cron,
        retries: 2,
        headers: authHeader
      });
      console.log('[QStash] Created: ' + s.label + ' (' + s.id + ')');
    }

    console.log('[QStash] Ad optimization schedules PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

async function createAllSchedules() {
  console.log('[QStash] Creating all consolidated schedules (10 total)...');
  var ok1 = await createOptimizerSchedule();
  var ok2 = await createRecoverySchedule();
  var ok3 = await createContentSchedules();
  var ok4 = await createAdOptSchedules();
  console.log('[QStash] Total: 1 optimizer + 1 recovery + 5 content + 3 ad-opt = 10 schedules');
  return ok1 && ok2 && ok3 && ok4;
}

async function listSchedules() {
  console.log('[QStash] Listing schedules...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    var schedules = await client.schedules.list();

    if (schedules.length === 0) {
      console.log('[QStash] No schedules found');
    } else {
      schedules.forEach(function (s) {
        console.log('  Schedule:', s.scheduleId || s.id);
        console.log('    Dest:', s.destination);
        console.log('    Cron:', s.cron);
        console.log('    Created:', s.createdAt);
        console.log('');
      });
    }
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

async function deleteAllSchedules() {
  console.log('[QStash] Deleting all CALQIX schedules...');
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    var ids = [
      SCHEDULE_ID_OPTIMIZER, SCHEDULE_ID_RECOVERY,
      SCHEDULE_ID_CONTENT_MORNING, SCHEDULE_ID_CONTENT_REVIEW,
      SCHEDULE_ID_CONTENT_PUBLISH_AM, SCHEDULE_ID_CONTENT_PUBLISH_PM, SCHEDULE_ID_CONTENT_REFLECT,
      SCHEDULE_ID_AD_MORNING, SCHEDULE_ID_AD_MIDDAY, SCHEDULE_ID_AD_CLOSE
    ].concat(LEGACY_IDS);
    for (var i = 0; i < ids.length; i++) {
      try {
        await client.schedules.delete(ids[i]);
        console.log('[QStash] Deleted:', ids[i]);
      } catch (e) {
        console.log('[QStash] Not found or already deleted:', ids[i]);
      }
    }
    console.log('[QStash] All schedules deleted');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
}

// --- Smoke Test ---

async function smokeTest() {
  console.log('[Smoke] Testing monitor endpoint...');
  var secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[Smoke] FAIL: CRON_SECRET not set');
    return false;
  }

  var fetch = require('node-fetch');
  var url = MONITOR_URL + '/api/ads/monitor?secret=' + encodeURIComponent(secret) + '&force=1';
  console.log('[Smoke] GET', url.substring(0, 60) + '...');

  try {
    var response = await fetch(url, { method: 'GET', timeout: 30000 });
    var body = await response.json();
    console.log('[Smoke] Status:', response.status);
    console.log('[Smoke] Response:', JSON.stringify(body, null, 2).substring(0, 1000));

    if (response.status === 200 && !body.error) {
      console.log('[Smoke] PASS');
      return true;
    } else {
      console.log('[Smoke] FAIL: unexpected response');
      return false;
    }
  } catch (err) {
    console.error('[Smoke] FAIL:', err.message);
    return false;
  }
}

async function smokeTestRecovery() {
  console.log('[Smoke] Testing recovery endpoint...');
  var secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[Smoke] FAIL: CRON_SECRET not set');
    return false;
  }

  var fetch = require('node-fetch');
  var url = MONITOR_URL + '/api/recovery/run?secret=' + encodeURIComponent(secret);
  console.log('[Smoke] GET', url.substring(0, 60) + '...');

  try {
    var response = await fetch(url, { method: 'GET', timeout: 15000 });
    var body = await response.json();
    console.log('[Smoke] Status:', response.status);
    console.log('[Smoke] Response:', JSON.stringify(body, null, 2).substring(0, 500));

    if (response.status === 200 && !body.error) {
      console.log('[Smoke] PASS');
      return true;
    } else {
      console.log('[Smoke] FAIL: unexpected response');
      return false;
    }
  } catch (err) {
    console.error('[Smoke] FAIL:', err.message);
    return false;
  }
}

// --- Full Verification ---

async function verifyAll() {
  console.log('Running full verification suite...\n');

  var results = {};

  // 1. Check env vars
  console.log('--- Environment Variables ---');
  var requiredVars = [
    'META_PIXEL_ID', 'META_ACCESS_TOKEN', 'SHOPIFY_WEBHOOK_SECRET',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
    'CRON_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'
  ];
  var optionalVars = ['GITHUB_TOKEN', 'GITHUB_REPO', 'BILLING_THRESHOLD', 'CAPI_ENABLED'];
  var missing = [];
  requiredVars.forEach(function (v) {
    var present = Boolean(process.env[v]);
    console.log('  ' + (present ? 'OK' : 'MISSING') + '  ' + v);
    if (!present) missing.push(v);
  });
  optionalVars.forEach(function (v) {
    var present = Boolean(process.env[v]);
    console.log('  ' + (present ? 'OK' : 'SKIP') + '  ' + v + ' (optional)');
  });
  results.env = missing.length === 0;
  console.log(results.env ? '\nEnv: PASS' : '\nEnv: FAIL — missing: ' + missing.join(', '));
  console.log('');

  // 2. Redis
  results.redis = await verifyRedis();
  console.log('');

  // 3. QStash
  results.qstash = await verifyQStash();
  console.log('');

  // 4. Endpoint reachability
  console.log('[Endpoints] Checking reachability...');
  var fetch = require('node-fetch');
  var endpoints = [
    '/api/checkout-event',
    '/api/add-to-cart',
    '/api/view-content',
    '/api/webhook/orders-paid',
    '/api/webhook/checkouts-create',
    '/api/webhook/carts-create',
    '/api/ads/monitor',
    '/api/ads/monitor-callback',
    '/api/recovery/run',
    '/api/cron/content-morning',
    '/api/cron/content-review',
    '/api/cron/content-publish',
    '/api/cron/content-reflect',
    '/api/cron/ad-morning',
    '/api/cron/ad-midday-check',
    '/api/cron/ad-daily-close',
    '/api/approval/status'
  ];
  var endpointOk = true;
  for (var i = 0; i < endpoints.length; i++) {
    try {
      var resp = await fetch(MONITOR_URL + endpoints[i], { method: 'GET', timeout: 5000 });
      var ok = resp.status < 500;
      console.log('  ' + (ok ? 'OK' : 'FAIL') + '  ' + endpoints[i] + ' (' + resp.status + ')');
      if (!ok) endpointOk = false;
    } catch (err) {
      console.log('  FAIL  ' + endpoints[i] + ' (' + err.message + ')');
      endpointOk = false;
    }
  }
  results.endpoints = endpointOk;
  console.log('');

  // Summary
  console.log('=== SUMMARY ===');
  Object.keys(results).forEach(function (k) {
    console.log('  ' + (results[k] ? 'PASS' : 'FAIL') + '  ' + k);
  });

  var allPass = Object.values(results).every(function (v) { return v; });
  console.log('\n' + (allPass ? '✅ All checks passed — system is production-ready.' : '❌ Some checks failed — review above.'));
  process.exit(allPass ? 0 : 1);
}

main().catch(function (err) {
  console.error('Bootstrap failed:', err.message);
  process.exit(1);
});
