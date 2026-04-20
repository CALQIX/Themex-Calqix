#!/usr/bin/env node
/*
 * Pixel source verification after AddToCart dedup cleanup.
 *
 * After the admin has:
 *   1) Set Shopify F&I Data sharing to Conservative
 *   2) Paused Meta Pixel AddToCart tag in GTM web container GTM-T86BFXXW
 *
 * this script confirms that `assets/calqix-meta-bridge.js` is now the SOLE
 * AddToCart source reaching Meta from our stack, by reading:
 *
 *   - Redis daily summary (diag:summary:{YYYY-MM-DD}) written by
 *     api/add-to-cart.js via lib/capi-diagnostics.js.
 *   - Per-event match_keys from diag:atc:{eventId} keys.
 *
 * Usage:
 *   node scripts/check-pixel-sources.js                # last 7 days
 *   node scripts/check-pixel-sources.js --days=1       # today only
 *   node scripts/check-pixel-sources.js --events=50    # also scan N recent per-event records
 *
 * Required env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 * The script does NOT mutate state and is safe to re-run anytime.
 */

require('dotenv').config();
const store = require('../lib/store');

function parseArgs() {
  var out = { days: 7, events: 20 };
  process.argv.slice(2).forEach(function (arg) {
    var m = arg.match(/^--(days|events)=(\d+)$/);
    if (m) out[m[1]] = parseInt(m[2], 10);
  });
  return out;
}

function daysBack(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = new Date(Date.now() - i * 86400000);
    out.push(d.toISOString().split('T')[0]);
  }
  return out;
}

function pct(n, total) {
  if (!total) return '0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

async function readDailySummaries(days) {
  var dates = daysBack(days);
  var rows = [];
  for (var i = 0; i < dates.length; i++) {
    var raw = await store.get('diag:summary:' + dates[i]);
    if (!raw) {
      rows.push({ date: dates[i], summary: null });
      continue;
    }
    try {
      rows.push({ date: dates[i], summary: JSON.parse(raw) });
    } catch (e) {
      rows.push({ date: dates[i], summary: null, error: e.message });
    }
  }
  return rows;
}

async function scanRecentAtcEvents(limit) {
  var redis = store._getRedis();
  if (!redis) {
    return { error: 'Redis not initialized — check UPSTASH_REDIS_REST_* env vars' };
  }

  var keys = [];
  var cursor = 0;
  var iterations = 0;
  try {
    do {
      var res = await redis.scan(cursor, { match: 'diag:atc:*', count: 100 });
      cursor = parseInt(res[0], 10);
      keys = keys.concat(res[1] || []);
      iterations++;
      if (iterations > 50) break;
    } while (cursor !== 0 && keys.length < limit * 4);
  } catch (err) {
    return { error: 'Redis SCAN failed: ' + err.message };
  }

  keys = keys.slice(0, limit);
  var events = [];
  for (var i = 0; i < keys.length; i++) {
    var raw = await store.get(keys[i]);
    if (!raw) continue;
    try {
      var parsed = JSON.parse(raw);
      parsed._key = keys[i];
      events.push(parsed);
    } catch (e) { /* ignore malformed entry */ }
  }
  events.sort(function (a, b) {
    var ta = new Date(a.ts || 0).getTime();
    var tb = new Date(b.ts || 0).getTime();
    return tb - ta;
  });
  return { events: events, totalKeys: keys.length };
}

function printDailySummary(rows) {
  console.log('\n=== Daily AddToCart summary (from diag:summary:{date}) ===\n');
  var totals = { total: 0, em: 0, ph: 0, fbp: 0, fbc: 0, external_id: 0 };
  var hadAny = false;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.summary || !row.summary.AddToCart) {
      console.log('  ' + row.date + '  — (no events)');
      continue;
    }
    hadAny = true;
    var s = row.summary.AddToCart;
    totals.total += s.total || 0;
    totals.em += s.em || 0;
    totals.ph += s.ph || 0;
    totals.fbp += s.fbp || 0;
    totals.fbc += s.fbc || 0;
    totals.external_id += s.external_id || 0;

    console.log(
      '  ' + row.date +
      '  total=' + s.total +
      '  em=' + pct(s.em, s.total) +
      '  fbp=' + pct(s.fbp, s.total) +
      '  fbc=' + pct(s.fbc, s.total) +
      '  ext_id=' + pct(s.external_id, s.total)
    );
  }

  console.log('\n  TOTAL over window:');
  console.log('    events=' + totals.total);
  console.log('    email coverage      ' + pct(totals.em, totals.total));
  console.log('    fbp coverage        ' + pct(totals.fbp, totals.total));
  console.log('    fbc coverage        ' + pct(totals.fbc, totals.total));
  console.log('    external_id coverage ' + pct(totals.external_id, totals.total));

  if (!hadAny) {
    console.log('\n  ⚠ No AddToCart summary rows. Either no events occurred,');
    console.log('    or diag:summary:* keys expired (TTL 7d) or were never written.');
  }

  return totals;
}

function printRecentEvents(scanResult) {
  console.log('\n=== Recent per-event match_keys (from diag:atc:{eventId}) ===\n');
  if (scanResult.error) {
    console.log('  ⚠ ' + scanResult.error);
    return;
  }
  var events = scanResult.events;
  if (events.length === 0) {
    console.log('  (no diag:atc:* keys found — TTL 24h)');
    return;
  }
  events.forEach(function (ev) {
    var mk = ev.match_keys || {};
    var present = Object.keys(mk).filter(function (k) { return mk[k]; }).join(',');
    console.log(
      '  ' + (ev.ts || '?') +
      '  source=' + (ev.source || '?') +
      '  ok=' + (ev.ok ? 'Y' : 'N') +
      '  keys=[' + present + ']'
    );
  });
  console.log('\n  (showing ' + events.length + ' most recent of ' + scanResult.totalKeys + ' scanned)');
}

function printVerdict(totals) {
  console.log('\n=== Verdict ===\n');
  if (totals.total === 0) {
    console.log('  ⚠ No AddToCart events in window. Either:');
    console.log('    - admin cleanup is still propagating (wait 30m after changes), or');
    console.log('    - the calqix-meta-bridge.js is not firing (check browser console), or');
    console.log('    - Redis diag keys expired (re-run after next ATC).');
    return;
  }
  var healthy = [];
  var issues = [];

  if (totals.fbp / totals.total >= 0.95) healthy.push('fbp ≥95%');
  else issues.push('fbp coverage ' + pct(totals.fbp, totals.total) + ' — bridge may not be generating _fbp fallback');

  if (totals.external_id / totals.total >= 0.90) healthy.push('external_id ≥90%');
  else issues.push('external_id coverage ' + pct(totals.external_id, totals.total) + ' — anon_id cookie may be missing');

  if (totals.em / totals.total >= 0.40) healthy.push('email ≥40% (logged-in proxy)');
  // email <40% is not an issue per se — most ATC sessions are anonymous.

  console.log('  Healthy: ' + (healthy.length ? healthy.join(', ') : 'none'));
  if (issues.length) {
    console.log('  Issues:');
    issues.forEach(function (i) { console.log('    - ' + i); });
  }
  console.log('\n  Next step: check Meta Events Manager after 24h for event_id dedup coverage.');
  console.log('  Target: ≥95% (was 50% before admin cleanup).');
}

async function main() {
  var args = parseArgs();
  console.log('CALQIX AddToCart verification — window=' + args.days + 'd');
  console.log('Redis store: ' + store.getStoreType());

  var rows = await readDailySummaries(args.days);
  var totals = printDailySummary(rows);

  var scan = await scanRecentAtcEvents(args.events);
  printRecentEvents(scan);

  printVerdict(totals);
}

main().catch(function (err) {
  console.error('[check-pixel-sources] fatal', err);
  process.exit(1);
});
