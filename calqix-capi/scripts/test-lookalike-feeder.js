#!/usr/bin/env node
/**
 * Smoke test for the lookalike-feeder cron on the deployed Vercel endpoint.
 *
 * Usage:
 *   node scripts/test-lookalike-feeder.js --dry                 # dry-run (no Meta writes)
 *   node scripts/test-lookalike-feeder.js --live                # real upload
 *   node scripts/test-lookalike-feeder.js --lookback 30 --dry   # shorter window
 *
 * Env required:
 *   CAPI_BASE_URL       (optional, default https://calqix-capi.vercel.app)
 *   CRON_SECRET
 */
require('dotenv').config();
var fetch = require('node-fetch');

function parseArgs(argv) {
  var args = { dry: false, live: false, lookback: null };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry') { args.dry = true; continue; }
    if (argv[i] === '--live') { args.live = true; continue; }
    if (argv[i] === '--lookback' && argv[i + 1]) { args.lookback = argv[++i]; continue; }
  }
  if (!args.dry && !args.live) args.dry = true; // default to safe mode
  return args;
}

async function main() {
  var args = parseArgs(process.argv);
  var base = process.env.CAPI_BASE_URL || 'https://calqix-capi.vercel.app';
  var secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[Test] CRON_SECRET ontbreekt');
    process.exit(1);
  }

  var params = new URLSearchParams({ secret: secret });
  if (args.dry) params.set('dry_run', '1');
  if (args.lookback) params.set('lookback', String(args.lookback));

  var url = base + '/api/cron/lookalike-feeder?' + params.toString();
  console.log('[Test] GET', url.replace(secret, '***'));
  console.log('[Test] mode:', args.dry ? 'DRY-RUN' : 'LIVE');

  var start = Date.now();
  var resp = await fetch(url, { method: 'GET', timeout: 60000 });
  var body = await resp.json().catch(function () { return {}; });
  var ms = Date.now() - start;

  console.log('[Test] HTTP:', resp.status, '(' + ms + 'ms)');
  console.log('[Test] Body:', JSON.stringify(body, null, 2));

  if (resp.status !== 200 || !body.ok) {
    console.error('[Test] FAIL');
    process.exit(1);
  }

  console.log('[Test] PASS');
}

main().catch(function (err) {
  console.error('[Test] Fatal:', err.message);
  process.exit(1);
});
