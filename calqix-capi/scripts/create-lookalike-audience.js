#!/usr/bin/env node
/**
 * One-time helper: create a Meta Custom Audience that the Lookalike Feeder
 * cron will feed daily.
 *
 * Usage:
 *   node scripts/create-lookalike-audience.js
 *   node scripts/create-lookalike-audience.js --name "CALQIX Purchasers 180d" --description "Paying customers last 180d"
 *
 * Env required:
 *   META_ACCESS_TOKEN        — with ads_management scope
 *   META_AD_ACCOUNT_ID       — e.g. act_2108393566376667
 *
 * After the audience is created, copy its ID into Vercel env as
 * META_LOOKALIKE_SOURCE_AUDIENCE_ID and redeploy.
 */
require('dotenv').config();
var fetch = require('node-fetch');

var META_API_VERSION = process.env.META_API_VERSION || 'v22.0';

function parseArgs(argv) {
  var args = { name: 'CALQIX Purchasers 180d', description: 'Paying customers, rolling 180-day window. Fed daily by lookalike-feeder cron.' };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) { args.name = argv[++i]; continue; }
    if (argv[i] === '--description' && argv[i + 1]) { args.description = argv[++i]; continue; }
  }
  return args;
}

async function main() {
  var args = parseArgs(process.argv);
  var accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  var adAccount = (process.env.META_AD_ACCOUNT_ID || '').trim();

  if (!accessToken) {
    console.error('[CreateAudience] META_ACCESS_TOKEN ontbreekt');
    process.exit(1);
  }
  if (!adAccount) {
    console.error('[CreateAudience] META_AD_ACCOUNT_ID ontbreekt (formaat: act_XXXXXXXXXX)');
    process.exit(1);
  }
  if (adAccount.indexOf('act_') !== 0) {
    adAccount = 'act_' + adAccount;
  }

  var url = 'https://graph.facebook.com/' + META_API_VERSION + '/' + adAccount + '/customaudiences';
  var body = new URLSearchParams({
    name: args.name,
    subtype: 'CUSTOM',
    description: args.description,
    customer_file_source: 'USER_PROVIDED_ONLY',
    access_token: accessToken
  });

  console.log('[CreateAudience] POST ' + url);
  console.log('[CreateAudience] name="' + args.name + '"');

  var resp = await fetch(url, {
    method: 'POST',
    body: body
  });
  var data = await resp.json().catch(function () { return {}; });

  if (!resp.ok || data.error) {
    console.error('[CreateAudience] FAILED:', resp.status, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('[CreateAudience] OK — audience created');
  console.log('  id:   ', data.id);
  console.log('  name: ', args.name);
  console.log('');
  console.log('Next steps:');
  console.log('  1. In Vercel: set META_LOOKALIKE_SOURCE_AUDIENCE_ID=' + data.id);
  console.log('  2. Redeploy calqix-capi');
  console.log('  3. Smoke test: node scripts/test-lookalike-feeder.js --dry');
  console.log('  4. Register schedule: node scripts/bootstrap.js create-all-schedules');
}

main().catch(function (err) {
  console.error('[CreateAudience] Fatal:', err.message);
  process.exit(1);
});
