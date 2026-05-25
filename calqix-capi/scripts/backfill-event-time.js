require('dotenv').config();

var store = require('../lib/store');

var TTL_EVENT = 7 * 86400;

function toUnixSeconds(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }
  var parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

async function main() {
  var redis = store._getRedis();
  if (!redis) {
    throw new Error('Redis not available');
  }

  var cursor = '0';
  var stats = {
    scanned: 0,
    updated: 0,
    skipped_has_event_time: 0,
    skipped_no_event_state: 0,
    skipped_no_event_time: 0,
    fallback_created_at: 0,
    parse_errors: 0
  };

  do {
    var out = await redis.scan(cursor, { match: 'meta:payload:*', count: 200 });
    cursor = String(out[0]);
    var keys = out[1] || [];
    for (var i = 0; i < keys.length; i++) {
      stats.scanned++;
      var payloadRaw = await redis.get(keys[i]);
      var payload = store.parseJsonValue(payloadRaw, null);
      if (!payload) {
        stats.parse_errors++;
        continue;
      }
      if (payload.event_time) {
        stats.skipped_has_event_time++;
        continue;
      }
      var eventId = keys[i].replace(/^meta:payload:/, '');
      var eventRaw = await redis.get('meta:event:' + eventId);
      var eventState = store.parseJsonValue(eventRaw, null);
      if (!eventState) {
        stats.skipped_no_event_state++;
        continue;
      }
      var eventTime = toUnixSeconds(eventState.event_time);
      var eventTimeSource = 'meta:event.event_time';
      if (!eventTime) {
        eventTime = toUnixSeconds(eventState.created_at);
        eventTimeSource = 'meta:event.created_at_fallback';
        if (eventTime) stats.fallback_created_at++;
      }
      if (!eventTime) {
        stats.skipped_no_event_time++;
        continue;
      }
      payload.event_time = eventTime;
      payload.event_time_source = eventTimeSource;
      await store.set(keys[i], JSON.stringify(payload), TTL_EVENT);
      stats.updated++;
    }
  } while (cursor !== '0');

  console.log(JSON.stringify(stats, null, 2));
}

main().catch(function (err) {
  console.error('[backfill-event-time] failed:', err.message);
  process.exit(1);
});
