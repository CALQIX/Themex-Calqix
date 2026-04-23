/**
 * OB Reviews Add — daily QStash cron.
 *
 * Schedule: daily at 03:10 Europe/Amsterdam (calqix-ob-reviews-add)
 * Endpoint: /api/cron/ob-reviews-add
 *
 * Generates 2-5 fresh reviews via Anthropic Claude (with the handcrafted pool
 * in `data/ob-review-pool.json` as a fallback), assigns a today-date + unique
 * id to each, and PREPENDS them — distributed across all OralBiome Pro flavor
 * variants — to each product's `calqix.ob_extra_reviews` metafield
 * (type: json_string).
 *
 * A short Telegram summary is posted after each successful run.
 *
 * Safety:
 *   - Redis lock (10 min TTL) prevents overlapping runs on retry storms.
 *   - Cap metafield to MAX_METAFIELD_ENTRIES (200) per product — rotates
 *     oldest out so the section bundle stays bounded.
 *   - Skips pool entries used in the last REPEAT_WINDOW_DAYS (30).
 *   - Uses the self-healing shopify-admin client (Redis token cache +
 *     client_credentials re-mint on 401), so a stale env token never blocks.
 *
 * Product resolution (first match wins):
 *   1. Env `OB_PRODUCT_IDS` — comma-separated numeric ids or GIDs.
 *   2. Env `OB_PRODUCT_ID` — single numeric id (back-compat).
 *   3. Fallback: resolve the known flavor handles via GraphQL.
 *
 * Required env:
 *   SHOPIFY_STORE_DOMAIN, SHOPIFY_API_KEY, SHOPIFY_API_SECRET
 *     (or SHOPIFY_ADMIN_ACCESS_TOKEN as legacy bootstrap),
 *   ANTHROPIC_API_KEY (optional — falls back to pool if absent),
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ENABLED=true (optional),
 *   CRON_SECRET (QStash bearer auth).
 *
 * Manual trigger (ops):
 *   GET /api/cron/ob-reviews-add?secret=<CRON_SECRET>
 *   Add &dry=1 to skip the Shopify write and only preview picks.
 */
'use strict';

var path = require('path');
var crypto = require('crypto');
var store = require('../../lib/store');
var shopifyAdmin = require('../../lib/shopify-admin');
var anthropicReviews = require('../../lib/anthropic-reviews');

var POOL_PATH = path.join(__dirname, '..', '..', 'data', 'ob-review-pool.json');
var LOCK_KEY = 'cron:lock:ob-reviews-add';
var LOCK_TTL = 10 * 60; // 10 minutes
var RECENT_HASH_KEY = 'cron:ob-reviews-add:recent-hashes';
var REPEAT_WINDOW_DAYS = 30;
var MIN_PER_DAY = 2;
var MAX_PER_DAY = 5;
var MAX_METAFIELD_ENTRIES = 200;
var METAFIELD_NAMESPACE = 'calqix';
var METAFIELD_KEY = 'ob_extra_reviews';

// Known OralBiome Pro flavor handles — used only if no numeric ids are provided.
var PRODUCT_HANDLES = [
  'oralbiome-pro-freshmint',
  'oralbiome-pro-cool-mint',
  'oralbiome-pro-citrus-orange',
  'oralbiome-pro-peach',
  'oralbiome-pro-grape'
];

// Flavor hint used in the Anthropic prompt when the assigned product is that flavor.
var FLAVOR_HINTS = {
  'oralbiome-pro-freshmint':     'fresh mint',
  'oralbiome-pro-cool-mint':     'cool mint',
  'oralbiome-pro-citrus-orange': 'citrus orange',
  'oralbiome-pro-peach':         'peach',
  'oralbiome-pro-grape':         'grape'
};

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
  // Stable hash of the immutable content — used to block pool reuse within the window.
  var s = [tpl.cc, tpl.n, tpl.t, tpl.b].join('|');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function amsterdamTodayIso() {
  try {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date());
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

function toProductGid(idOrGid) {
  var s = String(idOrGid).trim();
  if (!s) return null;
  if (s.indexOf('gid://shopify/Product/') === 0) return s;
  var num = s.replace(/\D/g, '');
  if (!num) return null;
  return 'gid://shopify/Product/' + num;
}

/**
 * Resolve the list of OralBiome Pro product GIDs.
 * Returns [{ gid, handle }].
 */
async function resolveProducts() {
  // 1) OB_PRODUCT_IDS csv
  var csv = (process.env.OB_PRODUCT_IDS || '').trim();
  if (csv) {
    var parts = csv.split(/[,\s]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var gid = toProductGid(parts[i]);
      if (gid) out.push({ gid: gid, handle: null });
    }
    if (out.length) return out;
  }

  // 2) Legacy single OB_PRODUCT_ID
  var single = (process.env.OB_PRODUCT_ID || '').trim();
  if (single) {
    var sGid = toProductGid(single);
    if (sGid) return [{ gid: sGid, handle: null }];
  }

  // 3) Fallback: resolve the 5 known handles via GraphQL
  var q = 'query($h: String!) { productByHandle(handle: $h) { id handle } }';
  var resolved = [];
  for (var h = 0; h < PRODUCT_HANDLES.length; h++) {
    try {
      var data = await shopifyAdmin.graphql(q, { h: PRODUCT_HANDLES[h] });
      if (data && data.productByHandle && data.productByHandle.id) {
        resolved.push({ gid: data.productByHandle.id, handle: data.productByHandle.handle });
      }
    } catch (e) {
      console.warn('[ob-reviews-add] handle resolve failed', PRODUCT_HANDLES[h], e.message);
    }
  }
  return resolved;
}

async function fetchExistingExtras(productGid) {
  var query = 'query($id: ID!, $ns: String!, $key: String!) {' +
    ' product(id: $id) { handle metafield(namespace: $ns, key: $key) { value } } }';
  var data = await shopifyAdmin.graphql(query, {
    id: productGid, ns: METAFIELD_NAMESPACE, key: METAFIELD_KEY
  });
  var handle = data && data.product && data.product.handle || null;
  var raw = data && data.product && data.product.metafield && data.product.metafield.value;
  if (!raw) return { handle: handle, arr: [] };
  try {
    var parsed = JSON.parse(raw);
    return { handle: handle, arr: Array.isArray(parsed) ? parsed : [] };
  } catch (e) {
    console.warn('[ob-reviews-add] existing metafield not valid JSON, starting fresh', productGid);
    return { handle: handle, arr: [] };
  }
}

async function writeExtras(productGid, arr) {
  var mutation = 'mutation($m: [MetafieldsSetInput!]!) {' +
    ' metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }';
  var variables = {
    m: [{
      ownerId: productGid,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: 'json_string',
      value: JSON.stringify(arr)
    }]
  };
  var data = await shopifyAdmin.graphql(mutation, variables);
  var errs = data && data.metafieldsSet && data.metafieldsSet.userErrors;
  if (errs && errs.length) {
    throw new Error('metafieldsSet errors: ' + JSON.stringify(errs).slice(0, 300));
  }
}

async function loadRecentHashes() {
  var redis = store._getRedis();
  if (!redis) return new Set();
  var cutoffMs = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  try {
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
    var trimCutoff = nowMs - 2 * REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    await redis.zremrangebyscore(RECENT_HASH_KEY, '-inf', trimCutoff);
  } catch (e) {
    console.warn('[ob-reviews-add] zadd/trim failed (non-fatal)', { msg: e.message });
  }
}

/**
 * Assign each review to one of the resolved products, roughly round-robin
 * with a shuffle so a given day doesn't always start on the same flavor.
 */
function assignToProducts(reviews, products) {
  var order = products.slice();
  shuffleInPlace(order);
  var groups = {};
  order.forEach(function (p) { groups[p.gid] = []; });
  reviews.forEach(function (rev, i) {
    var p = order[i % order.length];
    groups[p.gid].push(rev);
  });
  return order.map(function (p) { return { product: p, reviews: groups[p.gid] }; });
}

async function sendTelegramSummary(reportRows, totalAdded, sourceBreakdown, dry) {
  var lines = [];
  lines.push((dry ? '🧪 <b>[DRY RUN]</b> ' : '⭐ ') + '<b>OralBiome Pro — reviews added</b>');
  lines.push('Date: ' + amsterdamTodayIso());
  lines.push('Total: <b>' + totalAdded + '</b>  ·  Anthropic: ' + sourceBreakdown.anthropic + '  ·  Pool: ' + sourceBreakdown.pool);
  lines.push('');
  reportRows.forEach(function (row) {
    if (!row.reviews || row.reviews.length === 0) return;
    var label = row.product.handle || row.product.gid.replace('gid://shopify/Product/', '#');
    lines.push('<b>' + label + '</b>  (' + row.reviews.length + ')');
    row.reviews.forEach(function (r) {
      var star = '★'.repeat(r.r);
      var title = String(r.t).replace(/[<>&]/g, '');
      if (title.length > 50) title = title.slice(0, 50) + '…';
      lines.push('  ' + star + ' [' + r.cc + '] ' + title);
    });
  });
  var msg = lines.join('\n');
  await sendTelegramDirect(msg);
}

/**
 * Direct Telegram sender — bypasses the global `TELEGRAM_ENABLED` kill switch
 * because this report was explicitly requested for the ob-reviews cron. A
 * feature-scoped opt-out `TELEGRAM_OB_REVIEWS=false` is available for silence.
 */
async function sendTelegramDirect(message) {
  if ((process.env.TELEGRAM_OB_REVIEWS || '').toLowerCase() === 'false') return;
  var token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  var chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) {
    console.log('[ob-reviews-add] telegram env missing, skipping report');
    return;
  }
  try {
    var res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!res.ok) {
      var body = await res.text().catch(function () { return ''; });
      console.warn('[ob-reviews-add] telegram HTTP ' + res.status + ': ' + body.slice(0, 160));
    }
  } catch (e) {
    console.warn('[ob-reviews-add] telegram send failed', e.message);
  }
}

module.exports = async function (req, res) {
  var lockAcquired = false;
  try {
    // QStash bearer auth or ?secret= querystring.
    var secret = (process.env.CRON_SECRET || '').trim();
    var authHeader = req.headers && req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var dry = !!(req.query && (req.query.dry === '1' || req.query.dry === 'true'));
    var forceN = req.query && req.query.n ? parseInt(req.query.n, 10) : null;

    var locked = await store.set(LOCK_KEY, '1', LOCK_TTL, true);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'lock active' });
    }
    lockAcquired = true;

    // Load template pool (fallback source)
    var poolModule = require(POOL_PATH);
    var pool = Array.isArray(poolModule.pool) ? poolModule.pool : [];
    var validPool = pool.filter(validateTemplate);

    // Exclude recently used
    var recentHashes = await loadRecentHashes();
    var eligiblePool = validPool.filter(function (t) { return !recentHashes.has(hashTemplate(t)); });
    if (eligiblePool.length < MAX_PER_DAY) {
      console.warn('[ob-reviews-add] eligible pool small, falling back to full pool', {
        eligible: eligiblePool.length, total: validPool.length
      });
      eligiblePool = validPool.slice();
    }
    shuffleInPlace(eligiblePool);

    // Resolve products (all 5 flavor variants, unless env overrides)
    var products = await resolveProducts();
    if (!products.length) {
      if (lockAcquired) await store.del(LOCK_KEY);
      return res.status(200).json({ ok: false, reason: 'no OralBiome products resolved' });
    }

    // Enrich products with their handle (used for flavor hint + telegram label)
    for (var p = 0; p < products.length; p++) {
      if (!products[p].handle) {
        try {
          var handleQ = 'query($id: ID!) { product(id: $id) { handle } }';
          var hd = await shopifyAdmin.graphql(handleQ, { id: products[p].gid });
          if (hd && hd.product && hd.product.handle) products[p].handle = hd.product.handle;
        } catch (e) { /* non-fatal — telegram will show gid */ }
      }
    }

    // Target count (2-5 total for the day across all products)
    var N = forceN && forceN > 0 ? Math.min(forceN, 10) : pickRandomInt(MIN_PER_DAY, MAX_PER_DAY);

    // Pre-assign products so we know which flavor to hint at per review.
    // Round-robin across shuffled products → 5 reviews across 5 flavors = 1 each.
    var productOrder = products.slice();
    shuffleInPlace(productOrder);

    var reviews = [];
    var anthropicCount = 0;
    var poolCount = 0;
    var anthropicErrors = [];

    for (var i = 0; i < N; i++) {
      var targetProduct = productOrder[i % productOrder.length];
      var flavorHint = (targetProduct.handle && FLAVOR_HINTS[targetProduct.handle]) || 'fresh mint';

      var got = null;
      // Try Anthropic first (unless key missing)
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          got = await anthropicReviews.generateOne(flavorHint);
          anthropicCount++;
        } catch (e) {
          anthropicErrors.push(e.message || String(e));
          got = null;
        }
      }
      // Pool fallback
      if (!got && eligiblePool.length > 0) {
        var tpl = eligiblePool.shift();
        got = {
          cc: tpl.cc, co: tpl.co, n: tpl.n, r: tpl.r,
          t: tpl.t, b: tpl.b, tg: tpl.tg.slice(), src: 'pool',
          _poolHash: hashTemplate(tpl)
        };
        poolCount++;
      }
      if (got) {
        got._targetGid = targetProduct.gid;
        got._targetHandle = targetProduct.handle;
        reviews.push(got);
      }
    }

    if (reviews.length === 0) {
      if (lockAcquired) await store.del(LOCK_KEY);
      return res.status(200).json({
        ok: false, reason: 'no reviews generated',
        anthropicErrors: anthropicErrors
      });
    }

    // Group by target product
    var byGid = {};
    reviews.forEach(function (r) {
      if (!byGid[r._targetGid]) byGid[r._targetGid] = [];
      byGid[r._targetGid].push(r);
    });

    var today = amsterdamTodayIso();
    var reportRows = [];
    var totalAdded = 0;
    var poolHashesToMark = [];

    // Write per product
    for (var g = 0; g < productOrder.length; g++) {
      var prod = productOrder[g];
      var batch = byGid[prod.gid];
      if (!batch || !batch.length) {
        reportRows.push({ product: prod, reviews: [] });
        continue;
      }

      var ex = { handle: prod.handle, arr: [] };
      try {
        ex = await fetchExistingExtras(prod.gid);
        if (ex.handle && !prod.handle) prod.handle = ex.handle;
      } catch (e) {
        console.warn('[ob-reviews-add] fetch existing failed', prod.gid, e.message);
      }

      var maxId = 120;
      ex.arr.forEach(function (r) {
        if (r && typeof r.id === 'number' && r.id > maxId) maxId = r.id;
      });

      var newEntries = batch.map(function (rev, idx) {
        return {
          id: maxId + 1 + idx,
          n: rev.n,
          cc: rev.cc,
          co: rev.co,
          r: rev.r,
          t: rev.t,
          b: rev.b,
          tg: Array.isArray(rev.tg) ? rev.tg.slice() : [],
          d: today
        };
      });

      var merged = newEntries.concat(ex.arr);
      if (merged.length > MAX_METAFIELD_ENTRIES) merged = merged.slice(0, MAX_METAFIELD_ENTRIES);

      if (!dry) {
        try {
          await writeExtras(prod.gid, merged);
        } catch (e) {
          console.error('[ob-reviews-add] write failed', prod.gid, e.message);
          reportRows.push({ product: prod, reviews: [], error: e.message });
          continue;
        }
      }

      totalAdded += newEntries.length;
      reportRows.push({ product: prod, reviews: newEntries });

      // Collect pool hashes to mark (only for pool-sourced picks we just wrote)
      batch.forEach(function (rev) {
        if (rev._poolHash) poolHashesToMark.push(rev._poolHash);
      });
    }

    if (!dry && poolHashesToMark.length) {
      await markRecentHashes(poolHashesToMark);
    }

    if (lockAcquired) await store.del(LOCK_KEY);

    // Telegram summary (fire and forget)
    await sendTelegramSummary(reportRows, totalAdded, {
      anthropic: anthropicCount,
      pool: poolCount
    }, dry);

    console.log('[ob-reviews-add] done', {
      added: totalAdded,
      anthropic: anthropicCount,
      pool: poolCount,
      products: reportRows.length,
      today: today,
      dry: dry,
      anthropicErrors: anthropicErrors.length
    });

    return res.status(200).json({
      ok: true,
      dry: dry,
      added: totalAdded,
      sourceBreakdown: { anthropic: anthropicCount, pool: poolCount },
      today: today,
      anthropicErrors: anthropicErrors,
      products: reportRows.map(function (row) {
        return {
          gid: row.product.gid,
          handle: row.product.handle,
          added: row.reviews.length,
          error: row.error || null,
          picks: row.reviews.map(function (e) { return { id: e.id, cc: e.cc, r: e.r, t: e.t }; })
        };
      })
    });
  } catch (error) {
    if (lockAcquired) { try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ } }
    console.error('[ob-reviews-add] error', { message: error.message, stack: error.stack });
    return res.status(200).json({ ok: false, error: error.message });
  }
};
