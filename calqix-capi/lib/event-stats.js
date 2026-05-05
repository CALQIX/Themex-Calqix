var store = require('./store');

var STATS_TTL = 14 * 86400;

function dateKey(date) {
  var value = date ? new Date(date) : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function statKey(day, eventName, source) {
  return 'stats:' + day + ':' + eventName + ':' + source;
}

async function incrementEventStat(eventName, source, date) {
  if (!eventName || !source) return;
  var key = statKey(dateKey(date), eventName, source);
  var redis = store._getRedis();
  if (redis) {
    await redis.incr(key);
    await redis.expire(key, STATS_TTL);
    return;
  }

  var current = parseInt(await store.get(key), 10) || 0;
  await store.set(key, String(current + 1), STATS_TTL);
}

async function getEventStats(days) {
  var count = parseInt(days, 10) || 7;
  var events = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead'];
  var sources = ['browser', 'server'];
  var out = [];

  for (var i = count - 1; i >= 0; i--) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    var day = dateKey(d);
    var row = { date: day, events: {} };

    for (var e = 0; e < events.length; e++) {
      var eventName = events[e];
      var browser = parseInt(await store.get(statKey(day, eventName, 'browser')), 10) || 0;
      var server = parseInt(await store.get(statKey(day, eventName, 'server')), 10) || 0;
      row.events[eventName] = {
        browser: browser,
        server: server,
        dedup_rate: Math.max(browser, server) > 0
          ? Number((Math.min(browser, server) / Math.max(browser, server)).toFixed(4))
          : null
      };
    }
    out.push(row);
  }

  return out;
}

async function countKeys(pattern, max) {
  var redis = store._getRedis();
  if (!redis) return null;
  var cursor = '0';
  var count = 0;
  var limit = max || 5000;

  do {
    var result = await redis.scan(cursor, { match: pattern, count: 200 });
    cursor = String(result[0]);
    count += (result[1] || []).length;
  } while (cursor !== '0' && count < limit);

  return count;
}

async function getOperationalCounts() {
  var recovery = await countKeys('backfill:pending:*');
  var identities = await countKeys('identity:*');
  return {
    recovery_queue_size: recovery,
    identity_store_count: identities
  };
}

module.exports = {
  incrementEventStat: incrementEventStat,
  getEventStats: getEventStats,
  getOperationalCounts: getOperationalCounts
};
