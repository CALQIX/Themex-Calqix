/**
 * Bridge Version Tracker
 *
 * Records the `bridge_version` string that the browser bridge attaches to
 * every CAPI payload (see assets/calqix-meta-bridge.js). Lets us diff the
 * version distribution across recent traffic so the bridge-version-check
 * cron can detect stuck theme caches.
 *
 * Redis layout
 *   bridge:version:count:{version}:{yyyy-mm-ddThh}  → integer counter  TTL 72h
 *   bridge:version:first_seen:{version}             → ISO timestamp    TTL 30d
 *   bridge:version:last_seen:{version}              → ISO timestamp    TTL 30d
 *   bridge:version:known                            → JSON array of versions  TTL 30d
 *
 * Reads are cheap — we never scan, only GET the keys we already know about.
 */
var store = require('./store');

var TTL_HOUR_COUNTER = 72 * 3600;   // 3 days of hourly counters
var TTL_SEEN = 30 * 86400;
var TTL_KNOWN_LIST = 30 * 86400;
var KNOWN_KEY = 'bridge:version:known';
var MAX_KNOWN_VERSIONS = 25;

function hourKey(date) {
  var d = date || new Date();
  // ISO hour granularity in UTC. Not timezone-aware because all we need is
  // "distinct bucket per calendar hour" and the checker compares buckets
  // against each other, not against wall-clock times.
  return d.toISOString().slice(0, 13);
}

function sanitizeVersion(v) {
  if (!v) return null;
  var s = String(v).trim();
  if (!s) return null;
  // Guard against garbage: version should be short and URL-safe-ish.
  if (s.length > 40) return null;
  if (!/^[a-zA-Z0-9._\-]+$/.test(s)) return null;
  return s;
}

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

async function addToKnownList(version) {
  var list = (await getJSON(KNOWN_KEY)) || [];
  if (list.indexOf(version) === -1) {
    list.push(version);
    if (list.length > MAX_KNOWN_VERSIONS) {
      list = list.slice(-MAX_KNOWN_VERSIONS);
    }
    await setJSON(KNOWN_KEY, list, TTL_KNOWN_LIST);
  }
}

/**
 * Fire-and-forget record of a bridge version hit. Swallows all errors — we
 * never want the CAPI hot path to fail because tracking is down.
 *
 * @param {string} version — bridge_version field from the request body
 * @returns {Promise<{ok:boolean, version:string|null}>}
 */
async function recordVersion(version) {
  try {
    var v = sanitizeVersion(version);
    if (!v) return { ok: false, version: null };

    var redis = store._getRedis();
    var hk = hourKey();
    var countKey = 'bridge:version:count:' + v + ':' + hk;

    if (redis && typeof redis.incr === 'function') {
      try {
        await redis.incr(countKey);
        await redis.expire(countKey, TTL_HOUR_COUNTER);
      } catch (e) {
        // Fall back to non-atomic inc.
        var cur = parseInt(await store.get(countKey) || '0', 10);
        await store.set(countKey, String(cur + 1), TTL_HOUR_COUNTER);
      }
    } else {
      var current = parseInt(await store.get(countKey) || '0', 10);
      await store.set(countKey, String(current + 1), TTL_HOUR_COUNTER);
    }

    var now = new Date().toISOString();
    var firstSeen = await store.get('bridge:version:first_seen:' + v);
    if (!firstSeen) {
      await store.set('bridge:version:first_seen:' + v, now, TTL_SEEN);
      await addToKnownList(v);
    }
    await store.set('bridge:version:last_seen:' + v, now, TTL_SEEN);

    return { ok: true, version: v };
  } catch (e) {
    return { ok: false, version: null, error: e && e.message };
  }
}

/**
 * Sum hourly counters for a version over the last N hours.
 */
async function sumHourlyCounters(version, hoursBack) {
  var total = 0;
  var now = new Date();
  for (var h = 0; h < hoursBack; h++) {
    var d = new Date(now.getTime() - h * 3600 * 1000);
    var c = parseInt(await store.get('bridge:version:count:' + version + ':' + hourKey(d)) || '0', 10);
    total += c;
  }
  return total;
}

/**
 * Return a distribution snapshot: counts per version for the last `hoursBack`
 * hours, plus first/last seen timestamps. Sorted newest-first-seen first.
 *
 * @param {number} [hoursBack] default 6
 * @returns {Promise<{
 *   hoursBack:number,
 *   totalEvents:number,
 *   versions: Array<{
 *     version:string, count:number, sharePct:number,
 *     firstSeen:string|null, lastSeen:string|null,
 *     ageHours:number|null
 *   }>
 * }>}
 */
async function getVersionStats(hoursBack) {
  var hours = hoursBack || 6;
  var known = (await getJSON(KNOWN_KEY)) || [];
  var results = [];
  var total = 0;

  for (var i = 0; i < known.length; i++) {
    var v = known[i];
    var count = await sumHourlyCounters(v, hours);
    var firstSeen = await store.get('bridge:version:first_seen:' + v);
    var lastSeen = await store.get('bridge:version:last_seen:' + v);
    var ageHours = firstSeen
      ? Math.round((Date.now() - new Date(firstSeen).getTime()) / 3600000)
      : null;
    results.push({
      version: v,
      count: count,
      firstSeen: firstSeen,
      lastSeen: lastSeen,
      ageHours: ageHours
    });
    total += count;
  }

  for (var j = 0; j < results.length; j++) {
    results[j].sharePct = total > 0 ? (results[j].count / total) * 100 : 0;
  }

  // Newest first_seen first; unknown first_seen last.
  results.sort(function (a, b) {
    if (!a.firstSeen && !b.firstSeen) return 0;
    if (!a.firstSeen) return 1;
    if (!b.firstSeen) return -1;
    return new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime();
  });

  return { hoursBack: hours, totalEvents: total, versions: results };
}

module.exports = {
  recordVersion: recordVersion,
  getVersionStats: getVersionStats,
  sanitizeVersion: sanitizeVersion,
  sumHourlyCounters: sumHourlyCounters,
  hourKey: hourKey
};
