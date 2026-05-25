/**
 * Meta browser/server quality ledger.
 *
 * This is the proof layer for Meta's "Pixel events covered by CAPI" warning:
 * browser_seen means the browser Pixel beacon was attempted, server_confirmed
 * means the matching CAPI event was accepted by Meta, and paired means both
 * sides used the same event_name + event_id within the deduplication window.
 */
var store = require('./store');
var dates = require('./dates');

var TTL_PAIR = 7 * 86400;
var TTL_COVERAGE = 14 * 86400;
var DEDUP_WINDOW_SECONDS = 48 * 3600;

var EVENTS = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead', 'PageView'];
var CORE_EVENTS = ['InitiateCheckout', 'AddPaymentInfo', 'Purchase'];
var PREFIXES = {
  ViewContent: /^vc_.+/,
  AddToCart: /^atc_.+/,
  InitiateCheckout: /^ic_(?!cart_).+/,
  AddPaymentInfo: /^add_payment_info_.+/,
  Purchase: /^purchase_.+/,
  Lead: /^lead(?:_|$).+/,
  PageView: /^pv_.+/
};

function browserKey(eventName, eventId) {
  return 'meta:browser_event:' + eventName + ':' + eventId;
}

function pairKey(eventName, eventId) {
  return 'meta:pair:' + eventName + ':' + eventId;
}

function markerKey(kind, eventName, eventId) {
  return 'meta:coverage_marker:' + kind + ':' + eventName + ':' + eventId;
}

function coverageKey(day, eventName) {
  return 'meta:coverage:' + day + ':' + eventName;
}

function cleanEventName(value) {
  var name = String(value || '').trim();
  return EVENTS.indexOf(name) !== -1 ? name : null;
}

function cleanEventId(value) {
  var id = String(value || '').trim();
  if (!id || id.length > 180 || /[\s<>]/.test(id)) return null;
  return id;
}

function prefixOk(eventName, eventId) {
  var re = PREFIXES[eventName];
  return !re || re.test(String(eventId || ''));
}

function toUnixSeconds(value) {
  if (value === undefined || value === null || value === '') return Math.floor(Date.now() / 1000);
  if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
    return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }
  var parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function dayForEventTime(eventTime) {
  return dates.toISODateAmsterdam(new Date(toUnixSeconds(eventTime) * 1000));
}

function bool(value) {
  return Boolean(value);
}

function identityFlagsFromUserData(userData) {
  var ud = userData || {};
  return {
    em: bool(ud.em),
    ph: bool(ud.ph),
    fn: bool(ud.fn),
    ln: bool(ud.ln),
    ct: bool(ud.ct),
    st: bool(ud.st),
    zp: bool(ud.zp),
    country: bool(ud.country),
    fbp: bool(ud.fbp),
    fbc: bool(ud.fbc),
    external_id: bool(ud.external_id),
    client_ip_address: bool(ud.client_ip_address),
    client_user_agent: bool(ud.client_user_agent)
  };
}

function identityFlagsFromBrowser(body) {
  var flags = body && body.identity_flags || {};
  return {
    em: bool(flags.em || body.email_present),
    ph: bool(flags.ph || body.phone_present),
    fn: bool(flags.fn || body.first_name_present),
    ln: bool(flags.ln || body.last_name_present),
    ct: bool(flags.ct || body.city_present),
    st: bool(flags.st || body.state_present),
    zp: bool(flags.zp || body.zip_present),
    country: bool(flags.country || body.country_present),
    fbp: bool(flags.fbp || body.fbp_present || body.has_fbp),
    fbc: bool(flags.fbc || body.fbc_present || body.has_fbc),
    external_id: bool(flags.external_id || body.external_id_present || body.has_external_id),
    client_ip_address: false,
    client_user_agent: bool(flags.client_user_agent || body.user_agent_present || body.has_user_agent)
  };
}

function customFlagsFromCustomData(customData) {
  var cd = customData || {};
  return {
    content_ids: Array.isArray(cd.content_ids) ? cd.content_ids.length > 0 : bool(cd.content_ids),
    content_type: bool(cd.content_type),
    contents: Array.isArray(cd.contents) ? cd.contents.length > 0 : bool(cd.contents),
    value: cd.value !== undefined && cd.value !== null,
    currency: bool(cd.currency),
    num_items: cd.num_items !== undefined && cd.num_items !== null,
    order_id: bool(cd.order_id)
  };
}

function customFlagsFromBrowser(body) {
  var flags = body && body.custom_data_flags || {};
  return {
    content_ids: bool(flags.content_ids),
    content_type: bool(flags.content_type),
    contents: bool(flags.contents),
    value: bool(flags.value),
    currency: bool(flags.currency),
    num_items: bool(flags.num_items),
    order_id: bool(flags.order_id)
  };
}

async function incrementCoverage(day, eventName, field, amount) {
  var key = coverageKey(day, eventName);
  var redis = store._getRedis();
  if (redis) {
    await redis.hincrby(key, field, amount || 1);
    await redis.expire(key, TTL_COVERAGE);
    return;
  }
  var current = store.parseJsonValue(await store.get(key), {});
  current[field] = (Number(current[field]) || 0) + (amount || 1);
  await store.set(key, JSON.stringify(current), TTL_COVERAGE);
}

async function readCoverageHash(day, eventName) {
  var key = coverageKey(day, eventName);
  var redis = store._getRedis();
  var raw = null;
  if (redis) {
    raw = await redis.hgetall(key);
  } else {
    raw = store.parseJsonValue(await store.get(key), null);
  }
  var out = {};
  Object.keys(raw || {}).forEach(function (field) {
    out[field] = Number(raw[field]) || 0;
  });
  return out;
}

async function incrementOnce(kind, day, eventName, eventId, field) {
  var first = await store.setnx(markerKey(kind, eventName, eventId), '1', TTL_PAIR);
  if (first) await incrementCoverage(day, eventName, field, 1);
  return first;
}

async function mergePair(eventName, eventId, patch) {
  var key = pairKey(eventName, eventId);
  var existing = store.parseJsonValue(await store.get(key), {});
  var merged = Object.assign({}, existing, patch || {});
  merged.event_name = eventName;
  merged.event_id = eventId;
  merged.updated_at = new Date().toISOString();
  await store.set(key, JSON.stringify(merged), TTL_PAIR);
  return merged;
}

async function maybeRecordPair(day, eventName, eventId, pair) {
  if (!pair || !pair.browser_seen_at || !pair.server_confirmed_at) return false;
  var browserTime = Number(pair.browser_event_time) || 0;
  var serverTime = Number(pair.server_event_time) || 0;
  var inWindow = !browserTime || !serverTime || Math.abs(serverTime - browserTime) <= DEDUP_WINDOW_SECONDS;
  if (!inWindow) {
    await incrementOnce('pair_late', day, eventName, eventId, 'pair_late');
    return false;
  }
  return incrementOnce('paired', day, eventName, eventId, 'paired_browser_server');
}

async function recordBrowserEvent(input) {
  input = input || {};
  var eventName = cleanEventName(input.event_name || input.eventName);
  var eventId = cleanEventId(input.event_id || input.eventId);
  if (!eventName || !eventId) {
    return { ok: false, reason: 'invalid_event_name_or_id' };
  }

  var eventTime = toUnixSeconds(input.event_time || input.eventTime || input.timestamp);
  var day = dayForEventTime(eventTime);
  var validPrefix = prefixOk(eventName, eventId);
  var flags = identityFlagsFromBrowser(input);
  var customFlags = customFlagsFromBrowser(input);
  var entry = {
    event_name: eventName,
    event_id: eventId,
    event_time: eventTime,
    source: String(input.source || 'browser_pixel').slice(0, 80),
    source_url_present: Boolean(input.source_url),
    pixel_id_present: Boolean(input.pixel_id),
    identity_flags: flags,
    custom_data_flags: customFlags,
    prefix_ok: validPrefix,
    received_at: new Date().toISOString()
  };

  await store.set(browserKey(eventName, eventId), JSON.stringify(entry), TTL_PAIR);
  await incrementOnce('browser', day, eventName, eventId, 'browser_seen');
  if (!validPrefix) await incrementOnce('bad_id_browser', day, eventName, eventId, 'bad_event_id');

  var pair = await mergePair(eventName, eventId, {
    day: day,
    browser_seen_at: entry.received_at,
    browser_event_time: eventTime,
    browser_source: entry.source,
    browser_prefix_ok: validPrefix,
    browser_identity_flags: flags,
    browser_custom_data_flags: customFlags
  });
  await maybeRecordPair(pair.day || day, eventName, eventId, pair);
  return { ok: true, event_name: eventName, event_id: eventId, day: day, prefix_ok: validPrefix };
}

async function recordServerEvent(input) {
  input = input || {};
  var eventName = cleanEventName(input.event_name || input.eventName);
  var eventId = cleanEventId(input.event_id || input.eventId);
  if (!eventName || !eventId) {
    return { ok: false, reason: 'invalid_event_name_or_id' };
  }

  var eventTime = toUnixSeconds(input.event_time || input.eventTime || input.timestamp);
  var day = dayForEventTime(eventTime);
  var result = input.meta_result || input.result || {};
  var confirmed = Boolean(result && result.ok && !result.skipped);
  var failed = Boolean(result && result.ok === false);
  var validPrefix = prefixOk(eventName, eventId);
  var flags = identityFlagsFromUserData(input.user_data || input.userData || {});
  var customFlags = customFlagsFromCustomData(input.custom_data || input.customData || {});

  await incrementOnce('server', day, eventName, eventId, 'server_received');
  if (confirmed) await incrementOnce('confirmed', day, eventName, eventId, 'capi_confirmed');
  if (failed) await incrementOnce('failed', day, eventName, eventId, 'capi_failed');
  if (!validPrefix) await incrementOnce('bad_id_server', day, eventName, eventId, 'bad_event_id');

  var patch = {
    day: day,
    server_received_at: new Date().toISOString(),
    server_event_time: eventTime,
    server_source: String(input.source || 'server').slice(0, 80),
    server_prefix_ok: validPrefix,
    server_identity_flags: flags,
    server_custom_data_flags: customFlags,
    server_confirmed_at: confirmed ? new Date().toISOString() : undefined,
    server_failed_at: failed ? new Date().toISOString() : undefined,
    meta_status: result && result.status || null
  };
  Object.keys(patch).forEach(function (key) {
    if (patch[key] === undefined) delete patch[key];
  });
  var pair = await mergePair(eventName, eventId, patch);
  await maybeRecordPair(pair.day || day, eventName, eventId, pair);
  return { ok: true, event_name: eventName, event_id: eventId, day: day, confirmed: confirmed, prefix_ok: validPrefix };
}

function wilsonLower(successes, n, z) {
  if (!n) return null;
  var zz = z || 1.96;
  var p = successes / n;
  var z2 = zz * zz;
  return (p + z2 / (2 * n) - zz * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 1000) / 10;
}

function severityFor(eventName, row) {
  if ((row.bad_event_id || 0) > 0) return 'P0';
  var server = Number(row.server_received) || 0;
  var confirmed = Number(row.capi_confirmed) || 0;
  var browser = Number(row.browser_seen) || 0;
  var paired = Number(row.paired_browser_server) || 0;
  var delivery = server ? confirmed / server : null;
  var coverage = browser ? paired / browser : null;
  if (eventName === 'Purchase' && server > 0 && delivery !== null && delivery < 0.98) return 'P0';
  if (CORE_EVENTS.indexOf(eventName) !== -1) {
    if (browser > 0 && coverage !== null && coverage < 0.75) return 'P1';
    if (server > 0 && browser === 0) return 'P1';
  }
  if (browser > 0 && coverage !== null && coverage < 0.95) return 'P2';
  if ((row.capi_failed || 0) > 0) return 'P2';
  return 'OK';
}

function enrichRow(eventName, raw) {
  var row = Object.assign({
    event: eventName,
    browser_seen: 0,
    server_received: 0,
    capi_confirmed: 0,
    capi_failed: 0,
    paired_browser_server: 0,
    bad_event_id: 0,
    pair_late: 0
  }, raw || {});
  row.coverage_pct = pct(row.paired_browser_server, row.browser_seen);
  row.delivery_pct = pct(row.capi_confirmed, row.server_received);
  row.coverage_wilson95_lower_pct = row.browser_seen
    ? Math.round(wilsonLower(row.paired_browser_server, row.browser_seen) * 1000) / 10
    : null;
  row.sample_reliable = row.browser_seen >= 30 ||
    (row.coverage_wilson95_lower_pct !== null && row.coverage_wilson95_lower_pct >= 75);
  row.severity = severityFor(eventName, row);
  row.recommendation = recommendationFor(eventName, row);
  return row;
}

function recommendationFor(eventName, row) {
  if ((row.bad_event_id || 0) > 0) {
    return 'Fix event_id prefix en dedup key; browser en server moeten dezelfde event_name + event_id gebruiken.';
  }
  if (row.server_received > 0 && row.browser_seen === 0) {
    return 'Browser Pixel beacon ontbreekt in ledger; controleer theme bridge/custom pixel en Meta browser event fire.';
  }
  if (row.browser_seen > 0 && row.paired_browser_server === 0) {
    return 'CAPI server pair ontbreekt; controleer endpoint send/confirm en exact dezelfde event_id.';
  }
  if (row.browser_seen > 0 && row.coverage_pct < 95) {
    return 'Verhoog Pixel/CAPI overlap door elke browser event direct met dezelfde event_id naar CAPI te sturen.';
  }
  if (row.server_received > 0 && row.delivery_pct !== null && row.delivery_pct < 99.5) {
    return 'CAPI delivery onder norm; inspecteer Meta response en recovery queue.';
  }
  return 'Coverage en delivery binnen norm; sample blijven verzamelen.';
}

async function getDailyCoverage(day) {
  var date = day || dates.toISODateAmsterdam();
  var rows = [];
  for (var i = 0; i < EVENTS.length; i++) {
    var eventName = EVENTS[i];
    rows.push(enrichRow(eventName, await readCoverageHash(date, eventName)));
  }
  var any = rows.some(function (row) {
    return row.browser_seen || row.server_received || row.capi_confirmed || row.paired_browser_server || row.bad_event_id;
  });
  return {
    available: any,
    date: date,
    rows: rows,
    highest_priority: highestPriority(rows.map(function (row) { return row.severity; }))
  };
}

function highestPriority(priorities) {
  var rank = { OK: 0, P2: 1, P1: 2, P0: 3 };
  var best = 'OK';
  (priorities || []).forEach(function (priority) {
    if ((rank[priority] || 0) > (rank[best] || 0)) best = priority;
  });
  return best;
}

module.exports = {
  EVENTS: EVENTS,
  CORE_EVENTS: CORE_EVENTS,
  recordBrowserEvent: recordBrowserEvent,
  recordServerEvent: recordServerEvent,
  getDailyCoverage: getDailyCoverage,
  wilsonLower: wilsonLower,
  prefixOk: prefixOk,
  toUnixSeconds: toUnixSeconds
};
