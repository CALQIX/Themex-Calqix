/**
 * End-to-end test for api/cron/identity-resubmit.
 *
 * 1. Finds a recent (< 24h) confirmed AddToCart event in Redis
 * 2. Injects a synthetic backfill:pending:{event_id} with test identity
 * 3. Triggers the identity-resubmit endpoint
 * 4. Verifies the resubmit marker was written and pending was drained
 * 5. Shows what match_keys Meta saw before/after
 *
 * Uses test@calqix-resubmit-probe.local as email to avoid polluting any real
 * customer identity graph. Meta will hash it, bucket it, and forget it.
 */
require('dotenv').config();
var store = require('../lib/store');
var eventState = require('../lib/event-state');
var redis = store._getRedis();

var API_BASE = 'https://calqix-capi.vercel.app/api';

async function findFreshAddToCartEvent() {
  var cursor = '0';
  var candidates = [];
  do {
    var res = await redis.scan(cursor, { match: 'meta:event:addtocart_*', count: 100 });
    cursor = String(res[0]);
    var keys = res[1] || [];
    for (var i = 0; i < keys.length; i++) {
      var raw = await redis.get(keys[i]);
      if (!raw) continue;
      var ev;
      if (typeof raw === 'object') { ev = raw; }
      else { try { ev = JSON.parse(raw); } catch (e) { continue; } }
      if (ev.state !== 'confirmed' && ev.state !== 'recovered') continue;
      var age = Date.now() - new Date(ev.created_at || 0).getTime();
      if (age > 23 * 3600 * 1000) continue; // leave 1h margin
      candidates.push({ key: keys[i], event_id: ev.event_id, age_ms: age, state: ev.state });
    }
  } while (cursor !== '0');
  candidates.sort(function (a, b) { return a.age_ms - b.age_ms; }); // newest first
  return candidates[0];
}

async function main() {
  console.log('=== identity-resubmit end-to-end test ===');

  var candidate = await findFreshAddToCartEvent();
  if (!candidate) {
    console.error('No fresh AddToCart event found in last 23h. Fire one first.');
    process.exit(1);
  }
  var eventId = candidate.event_id;
  console.log('\nUsing event:', eventId, '  age:', Math.round(candidate.age_ms / 60000), 'min');

  // Check payload exists
  var payload = await eventState.getEventPayload(eventId);
  if (!payload) {
    console.error('meta:payload:' + eventId + ' missing — cannot resubmit');
    process.exit(1);
  }
  console.log('Original user_data keys:', Object.keys(payload.user_data || {}).join(', '));

  // Clear any stale resubmit marker so the test actually runs.
  await store.del('backfill:resubmit:' + eventId);

  // Inject synthetic pending record with richer identity.
  var testIdentity = {
    email: 'test+resubmit-probe@calqix.local',
    phone: '+31612345678',
    fn: 'Test',
    ln: 'Probe',
    ct: 'Amsterdam',
    zp: '1011',
    country: 'NL',
    st: 'NH'
  };
  var pending = {
    event_id: eventId,
    event_name: 'AddToCart',
    identity: testIdentity,
    original_fields: Object.keys(payload.user_data || {}).length,
    new_fields: 8,
    created_at: new Date().toISOString()
  };
  await store.set('backfill:pending:' + eventId, JSON.stringify(pending), 24 * 3600);
  console.log('Injected backfill:pending:' + eventId);

  // Trigger the cron endpoint.
  var secret = process.env.CRON_SECRET;
  console.log('\nCalling identity-resubmit...');
  var res = await fetch(API_BASE + '/cron/identity-resubmit?secret=' + encodeURIComponent(secret));
  var data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));

  // Verify post-state.
  var marker = await store.get('backfill:resubmit:' + eventId);
  var stillPending = await store.get('backfill:pending:' + eventId);
  console.log('\nPost-state:');
  console.log('  backfill:resubmit:' + eventId + ' =', marker ? 'PRESENT ✓' : 'MISSING ✗');
  console.log('  backfill:pending:' + eventId + ' =', stillPending ? 'STILL THERE ✗' : 'DRAINED ✓');
  if (marker) {
    try { console.log('  marker:', JSON.stringify(JSON.parse(marker))); }
    catch (e) { console.log('  marker (raw):', marker); }
  }

  var newPayload = await eventState.getEventPayload(eventId);
  if (newPayload && newPayload.user_data) {
    console.log('\nMerged user_data keys:', Object.keys(newPayload.user_data).join(', '));
  }

  console.log('\n=== Done ===');
}

main().catch(function (e) {
  console.error('[error]', e && e.stack ? e.stack : e);
  process.exit(1);
});
