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
var SCHEDULE_ID = 'calqix-daily-monitor';

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
      return await createSchedule();
    case 'list-schedules':
      return await listSchedules();
    case 'delete-schedule':
      return await deleteSchedule();
    case 'smoke-test':
      return await smokeTest();
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

async function createSchedule() {
  console.log('[QStash] Creating/updating schedule...');
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

    var schedule = await client.schedules.create({
      scheduleId: SCHEDULE_ID,
      destination: destination,
      cron: 'CRON_TZ=Europe/Amsterdam 0 7 * * *',
      retries: 3,
      callback: callbackUrl,
      failureCallback: failureCallbackUrl
    });

    console.log('[QStash] Schedule created/updated:');
    console.log('  ID:          ', schedule.scheduleId || SCHEDULE_ID);
    console.log('  Destination: ', destination);
    console.log('  Cron:        ', 'CRON_TZ=Europe/Amsterdam 0 7 * * *');
    console.log('  Retries:     ', 3);
    console.log('  Callback:    ', callbackUrl);
    console.log('  Fail CB:     ', failureCallbackUrl);
    console.log('[QStash] PASS');
    return true;
  } catch (err) {
    console.error('[QStash] FAIL:', err.message);
    return false;
  }
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

async function deleteSchedule() {
  console.log('[QStash] Deleting schedule:', SCHEDULE_ID);
  var qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.error('[QStash] FAIL: QSTASH_TOKEN not set');
    return false;
  }

  try {
    var { Client } = require('@upstash/qstash');
    var client = new Client({ token: qstashToken });
    await client.schedules.delete(SCHEDULE_ID);
    console.log('[QStash] Schedule deleted');
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
    '/api/ads/monitor-callback'
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
