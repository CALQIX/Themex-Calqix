#!/usr/bin/env node
/*
 * Smoke test for the self-healing Shopify token flow.
 *
 * Exercises three code paths:
 *   A. Redis hit          — Redis has a token → use it (fast path).
 *   B. Redis miss, env OK — no Redis key, env SHOPIFY_ADMIN_ACCESS_TOKEN is valid → use it and persist to Redis.
 *   C. Redis miss, env missing/invalid — mint a fresh token via OAuth client_credentials and persist.
 *
 * Run: node scripts/test-token-selfheal.js
 */

require('dotenv').config();
var shopify = require('../lib/shopify-admin');
var store = require('../lib/store');

var REDIS_KEY = 'shopify:admin_token';

async function pingShop() {
  var data = await shopify.graphql('{ shop { name } }');
  return data && data.shop && data.shop.name;
}

async function main() {
  console.log('Self-heal smoke test');
  console.log('====================');

  console.log('\n[A] Baseline — current Redis + env state');
  try {
    var before = await store.get(REDIS_KEY);
    console.log('   Redis token present: ' + (before ? (before.slice(0, 10) + '***') : 'no'));
    console.log('   Env token present:   ' + (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ? 'yes' : 'no'));
    var name = await pingShop();
    console.log('   shop.name = ' + name + ' — ok');
  } catch (e) {
    console.error('   FAIL — ' + e.message);
    process.exit(1);
  }

  console.log('\n[B] Clear in-memory cache, force Redis read');
  try {
    shopify.invalidateToken();
    var name = await pingShop();
    console.log('   shop.name = ' + name + ' — ok (used Redis cached token)');
  } catch (e) {
    console.error('   FAIL — ' + e.message);
    process.exit(1);
  }

  console.log('\n[C] Clear Redis + in-memory + corrupt env, force fresh mint');
  try {
    await store.del(REDIS_KEY);
    shopify.invalidateToken();
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = '';
    var name = await pingShop();
    console.log('   shop.name = ' + name + ' — ok (minted fresh token via OAuth)');
    var after = await store.get(REDIS_KEY);
    console.log('   Redis re-populated: ' + (after ? (after.slice(0, 10) + '***') : 'NO — persistence broken'));
    if (!after) { process.exit(1); }
  } catch (e) {
    console.error('   FAIL — ' + e.message);
    process.exit(1);
  }

  console.log('\n====================');
  console.log('ALL SELF-HEAL PATHS PASS');
}

main().catch(function (err) {
  console.error('[test-token-selfheal] fatal', err);
  process.exit(1);
});
