/**
 * OB Reviews Add — daily QStash cron.
 *
 * Schedule: daily at 03:00 Europe/Amsterdam (calqix-ob-reviews-add)
 * Endpoint: /api/cron/ob-reviews-add
 *
 * Picks 2-4 random review templates from `data/ob-review-pool.json`, assigns a
 * today-date + unique id to each, and PREPENDS them to the Shopify product
 * metafield `product.metafields.calqix.ob_extra_reviews` (type: json_string).
 *
 * Safety:
 *   - Redis lock (10 min TTL) prevents overlapping runs on retry storms.
 *   - Cap metafield to MAX_METAFIELD_ENTRIES (200) — rotates oldest out so the
 *     section bundle size stays bounded.
 *   - Skips pool entries that were used in the last REPEAT_WINDOW_DAYS (30)
 *     (tracked by a combined hash of name+title+body).
 *   - Never adds an entry whose required fields are missing.
 *
 * Product resolution:
 *   - Env `OB_PRODUCT_ID` (preferred, numeric Shopify product id).
 *   - Fallback: GraphQL productByHandle(handle: "oralbiome").
 *
 * Required env:
 *   SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN,
 *   CRON_SECRET (QStash bearer auth).
 */
var path = require('path');
var crypto = require('crypto');
var store = require('../../lib/store');

var POOL_PATH = path.join(__dirname, '..', '..', 'data', 'ob-review-pool.json');
var LOCK_KEY = 'cron:lock:ob-reviews-add';
var LOCK_TTL = 10 * 60; // 10 minutes
var RECENT_HASH_KEY = 'cron:ob-reviews-add:recent-hashes'; // Redis sorted set
var REPEAT_WINDOW_DAYS = 30;
var MIN_PER_DAY = 2;
var MAX_PER_DAY = 4;
var MAX_METAFIELD_ENTRIES = 200;
var METAFIELD_NAMESPACE = 'calqix';
var METAFIELD_KEY = 'ob_extra_reviews';
var PRODUCT_HANDLE_FALLBACK = 'oralbiome';
var GQL_API_VERSION = '2025-01';

function pickRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleInPlace(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function hashTemplate(tpl) {
  // Stable hash based on content, not on injected date/id — so the same pool
  // entry produces the same recent-use key regardless of when it's picked.
  var s = [tpl.cc, tpl.n, tpl.t, tpl.b].join('|');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function amsterdamTodayIso() {
  // Amsterdam is CET/CEST — we emit YYYY-MM-DD in local Amsterdam time so the
  // date shown on the card matches "today" from a user's perspective.
  try {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date()); // e.g. 2026-04-22
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function validateTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return false;
  if (!tpl.cc || typeof tpl.cc !== 'string') return false;
  if (!tpl.co || typeof tpl.co !== 'string') return false;
  if (!tpl.n  || typeof tpl.n  !== 'string') return false;
  if (!tpl.t  || typeof tpl.t  !== 'string') return false;
  if (!tpl.b  || typeof tpl.b  !== 'string') return false;
  if (typeof tpl.r !== 'number' || tpl.r < 1 || tpl.r > 5) return false;
  if (!Array.isArray(tpl.tg) || tpl.tg.length === 0) return false;
  return true;
}

async function shopifyGraphQL(storeDomain, token, query, variables) {
  var url = 'https://' + storeDomain + '/admin/api/' + GQL_API_VERSION + '/graphql.json';
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  if (!res.ok) {
    var text = await res.text().catch(function () { return ''; });
    throw new Error('Shopify GraphQL HTTP ' + res.status + ': ' + text.slice(0, 200));
  }
  var body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error('Shopify GraphQL errors: ' + JSON.stringify(body.errors).slice(0, 300));
  }
  return body.data || {};
}

async function resolveProductGid(storeDomain, token) {
  var envId = (process.env.OB_PRODUCT_ID || '').trim();
  if (envId) {
    return 'gid://shopify/Product/' + envId.replace(/\D/g, '');
  }
  var query = 'query($h: String!) { productByHandle(handle: $h) { id } }';
  var data = await shopifyGraphQL(storeDomain, token, query, { h: PRODUCT_HANDLE_FALLBACK });
  if (!data.productByHandle || !data.productByHandle.id) {
    throw new Error('Product with handle "' + PRODUCT_HANDLE_FALLBACK + '" not found.');
  }
  return data.productByHandle.id;
}

async function fetchExistingExtras(storeDomain, token, productGid) {
  var query = 'query($id: ID!, $ns: String!, $key: String!) { ' +
    'product(id: $id) { metafield(namespace: $ns, key: $key) { value type } } }';
  var data = await shopifyGraphQL(storeDomain, token, query, {
    id: productGid, ns: METAFIELD_NAMESPACE, key: METAFIELD_KEY
  });
  var raw = data.product && data.product.metafield && data.product.metafield.value;
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[ob-reviews-add] existing metafield not valid JSON, starting fresh');
    return [];
  }
}

async function writeExtras(storeDomain, token, productGid, arr) {
  var mutation = 'mutation($m: [MetafieldsSetInput!]!) { ' +
    'metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }';
  var variables = {
    m: [{
      ownerId: productGid,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: 'json_string',
      value: JSON.stringify(arr)
    }]
  };
  var data = await shopifyGraphQL(storeDomain, token, mutation, variables);
  var errs = data.metafieldsSet && data.metafieldsSet.userErrors;
  if (errs && errs.length) {
    throw new Error('metafieldsSet errors: ' + JSON.stringify(errs).slice(0, 300));
  }
}

async function loadRecentHashes() {
  var redis = store._getRedis();
  if (!redis) return new Set();
  var cutoffMs = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  try {
    // zrangebyscore returns members with score >= cutoff.
    var members = await redis.zrange(RECENT_HASH_KEY, cutoffMs, '+inf', { byScore: true });
    return new Set(Array.isArray(members) ? members : []);
  } catch (e) {
    console.warn('[ob-reviews-add] zrange failed, treating recent-hashes as empty', { msg: e.message });
    return new Set();
  }
}

async function markRecentHashes(hashes) {
  var redis = store._getRedis();
  if (!redis || hashes.length === 0) return;
  var nowMs = Date.now();
  try {
    for (var i = 0; i < hashes.length; i++) {
      await redis.zadd(RECENT_HASH_KEY, { score: nowMs, member: hashes[i] });
    }
    // Trim entries older than 2x the window — keeps the set bounded.
    var trimCutoff = nowMs - 2 * REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    await redis.zremrangebyscore(RECENT_HASH_KEY, '-inf', trimCutoff);
  } catch (e) {
    console.warn('[ob-reviews-add] zadd/trim failed (non-fatal)', { msg: e.message });
  }
}

module.exports = async function (req, res) {
  try {
    // QStash auth (bearer) or querystring secret.
    var secret = (process.env.CRON_SECRET || '').trim();
    var authHeader = req.headers && req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var locked = await store.set(LOCK_KEY, '1', LOCK_TTL, true);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'lock active' });
    }

    // Load pool
    var poolModule = require(POOL_PATH);
    var pool = Array.isArray(poolModule.pool) ? poolModule.pool : [];
    var validPool = pool.filter(validateTemplate);
    if (validPool.length === 0) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, reason: 'pool empty or invalid' });
    }

    // Exclude recently used templates
    var recentHashes = await loadRecentHashes();
    var eligible = validPool.filter(function (tpl) {
      return !recentHashes.has(hashTemplate(tpl));
    });
    // If we ran out of eligible (small pool + long streak), fall back to full pool.
    if (eligible.length < MAX_PER_DAY) {
      console.warn('[ob-reviews-add] eligible pool small, falling back to full pool', {
        eligible: eligible.length, total: validPool.length
      });
      eligible = validPool.slice();
    }

    // Shuffle + pick N
    shuffleInPlace(eligible);
    var N = pickRandomInt(MIN_PER_DAY, MAX_PER_DAY);
    var picks = eligible.slice(0, N);

    // Resolve product
    var storeDomain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
    var adminToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
    if (!storeDomain || !adminToken) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, reason: 'missing shopify credentials' });
    }
    var productGid = await resolveProductGid(storeDomain, adminToken);

    // Fetch existing extras
    var existing = await fetchExistingExtras(storeDomain, adminToken, productGid);

    // Determine next id: max existing + 1, but start at 121 (inline ends at 120).
    var maxId = 120;
    existing.forEach(function (r) { if (r && typeof r.id === 'number' && r.id > maxId) maxId = r.id; });

    var today = amsterdamTodayIso();
    var newEntries = picks.map(function (tpl, i) {
      return {
        id: maxId + 1 + i,
        n: tpl.n,
        cc: tpl.cc,
        co: tpl.co,
        r: tpl.r,
        t: tpl.t,
        b: tpl.b,
        tg: tpl.tg.slice(),
        d: today
      };
    });

    // Prepend + cap
    var merged = newEntries.concat(existing);
    if (merged.length > MAX_METAFIELD_ENTRIES) {
      merged = merged.slice(0, MAX_METAFIELD_ENTRIES);
    }

    // Write
    await writeExtras(storeDomain, adminToken, productGid, merged);

    // Track recent hashes
    await markRecentHashes(picks.map(hashTemplate));

    await store.del(LOCK_KEY);

    console.log('[ob-reviews-add] added reviews', {
      count: newEntries.length,
      countries: newEntries.map(function (e) { return e.cc; }),
      totalInMetafield: merged.length,
      today: today
    });

    return res.status(200).json({
      ok: true,
      added: newEntries.length,
      totalInMetafield: merged.length,
      today: today,
      picks: newEntries.map(function (e) { return { id: e.id, cc: e.cc, t: e.t }; })
    });
  } catch (error) {
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    console.error('[ob-reviews-add] error', { message: error.message });
    return res.status(200).json({ ok: false, error: error.message });
  }
};
