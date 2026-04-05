/**
 * CALQIX Full System Audit Script
 * Phases 1-3: Queue cleanup, Workflow audit, Meta Pixel audit
 * 
 * Run: node scripts/audit-full.js
 * Requires: .env.local with all production env vars
 */
var path = require('path');
// Try multiple .env locations
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });

var store = require('../lib/store');
var https = require('https');
var http = require('http');

var BASE = 'https://calqix-capi.vercel.app';
var CRON_SECRET = process.env.CRON_SECRET;
var TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
var META_TOKEN = process.env.META_ACCESS_TOKEN;
var PIXEL_ID = process.env.META_PIXEL_ID || '934134615770602';
var SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
var SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

// Collect all results for final report
var report = {
  queue: { removed: 0, details: [] },
  endpoints: {},
  connections: {},
  qstash: null,
  pixel: {},
  checkout: null
};

// --- Helpers ---

function fetchJSON(url, opts) {
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var mod = parsed.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    var req = mod.request(reqOpts, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(55000, function () { req.destroy(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sendTelegram(text) {
  var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: text, parse_mode: 'HTML' })
  });
}

function todayKey() {
  var d = new Date();
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' });
    var formatted = fmt.format(d);
    var match = formatted.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
  } catch (e) {}
  var day = d.getDate().toString().padStart(2, '0');
  var month = (d.getMonth() + 1).toString().padStart(2, '0');
  return day + '-' + month + '-' + d.getFullYear();
}

function dateKeyDaysAgo(n) {
  var d = new Date(Date.now() - n * 86400000);
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' });
    var formatted = fmt.format(d);
    var match = formatted.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
  } catch (e) {}
  var day = d.getDate().toString().padStart(2, '0');
  var month = (d.getMonth() + 1).toString().padStart(2, '0');
  return day + '-' + month + '-' + d.getFullYear();
}

// ============================================================
// FASE 1: APPROVAL QUEUE LEEGMAKEN
// ============================================================

async function fase1() {
  console.log('\n=== FASE 1: APPROVAL QUEUE LEEGMAKEN ===\n');
  
  var totalRemoved = 0;
  var details = [];
  
  // Check pending lists for the last 14 days
  for (var i = 0; i < 14; i++) {
    var dateKey = dateKeyDaysAgo(i);
    var raw = await store.get('aq:pending:' + dateKey);
    if (!raw) continue;
    
    var ids;
    try { ids = JSON.parse(raw); } catch (e) { ids = []; }
    if (!ids || ids.length === 0) continue;
    
    console.log('Datum ' + dateKey + ': ' + ids.length + ' items in pending list');
    
    var pendingCount = 0;
    for (var j = 0; j < ids.length; j++) {
      var itemRaw = await store.get('aq:item:' + ids[j]);
      if (!itemRaw) continue;
      var item;
      try { item = JSON.parse(itemRaw); } catch (e) { continue; }
      
      if (item.state === 'pending' || item.state === 'approved') {
        console.log('  Verwijder: ' + ids[j] + ' (' + item.type + ': ' + item.entityName + ') state=' + item.state);
        await store.del('aq:item:' + ids[j]);
        pendingCount++;
        totalRemoved++;
      }
    }
    
    if (pendingCount > 0) {
      // Clear the pending list for this date
      await store.del('aq:pending:' + dateKey);
      details.push(dateKey + ': ' + pendingCount + ' items');
    }
  }
  
  // Also scan for orphaned aq:item keys using Redis SCAN
  var redis = store._getRedis();
  if (redis) {
    try {
      var cursor = 0;
      var orphanCount = 0;
      do {
        var result = await redis.scan(cursor, { match: 'aq:item:*', count: 100 });
        cursor = result[0];
        var keys = result[1] || [];
        for (var k = 0; k < keys.length; k++) {
          var val = await store.get(keys[k]);
          if (!val) continue;
          var parsed;
          try { parsed = JSON.parse(val); } catch (e) { continue; }
          if (parsed.state === 'pending' || parsed.state === 'approved') {
            console.log('  Orphan verwijderd: ' + keys[k] + ' state=' + parsed.state);
            await store.del(keys[k]);
            orphanCount++;
            totalRemoved++;
          }
        }
      } while (cursor && cursor !== 0 && cursor !== '0');
      if (orphanCount > 0) details.push('Orphans: ' + orphanCount);
    } catch (e) {
      console.log('  SCAN niet beschikbaar: ' + e.message);
    }
  }
  
  report.queue.removed = totalRemoved;
  report.queue.details = details;
  
  console.log('\nTotaal verwijderd: ' + totalRemoved + ' items');
  
  // Send Telegram confirmation
  var msg = '<b>CALQIX Systeem: Wachtrij geleegd.</b>\n\n' +
    totalRemoved + ' items verwijderd (waren in monitor-only mode aangemaakt).\n' +
    'Queue is nu leeg en klaar voor live executie.';
  if (details.length > 0) msg += '\n\nDetails:\n' + details.join('\n');
  
  await sendTelegram(msg);
  console.log('Telegram bevestiging verzonden.');
}

// ============================================================
// FASE 2: VOLLEDIGE WORKFLOW AUDIT
// ============================================================

async function fase2() {
  console.log('\n=== FASE 2: WORKFLOW AUDIT ===\n');
  
  // 2.1: Test all cron endpoints
  console.log('--- 2.1: Endpoints testen ---');
  var endpoints = [
    { path: '/api/cron/content-morning', method: 'POST' },
    { path: '/api/cron/content-review', method: 'POST' },
    { path: '/api/cron/content-publish?slot=post1', method: 'POST' },
    { path: '/api/cron/content-reflect', method: 'POST' },
    { path: '/api/cron/ad-morning', method: 'POST' },
    { path: '/api/cron/ad-midday-check', method: 'POST' },
    { path: '/api/cron/ad-daily-close', method: 'POST' },
    { path: '/api/ads/monitor', method: 'POST' },
    { path: '/api/recovery/run', method: 'POST' }
  ];
  
  for (var i = 0; i < endpoints.length; i++) {
    var ep = endpoints[i];
    var start = Date.now();
    try {
      var res = await fetchJSON(BASE + ep.path, {
        method: ep.method,
        headers: { 'Authorization': 'Bearer ' + CRON_SECRET, 'Content-Type': 'application/json' }
      });
      var duration = Date.now() - start;
      var status = res.status === 200 ? 'OK' : 'FOUT(' + res.status + ')';
      var warning = duration > 30000 ? ' TRAAG!' : '';
      console.log('  ' + ep.path + ': ' + status + ' (' + duration + 'ms)' + warning);
      report.endpoints[ep.path] = { status: res.status, duration: duration, ok: res.status === 200 };
      if (res.status !== 200) {
        console.log('    Body: ' + res.body.substring(0, 200));
      }
    } catch (e) {
      var duration2 = Date.now() - start;
      console.log('  ' + ep.path + ': FAILED - ' + e.message + ' (' + duration2 + 'ms)');
      report.endpoints[ep.path] = { status: 0, duration: duration2, ok: false, error: e.message };
    }
  }
  
  // 2.2: QStash schedules (we list via bootstrap.js)
  console.log('\n--- 2.2: QStash schedules ---');
  try {
    var qstashToken = process.env.QSTASH_TOKEN;
    var qRes = await fetchJSON('https://qstash.upstash.io/v2/schedules', {
      headers: { 'Authorization': 'Bearer ' + qstashToken }
    });
    var schedules = JSON.parse(qRes.body);
    console.log('  Actieve schedules: ' + schedules.length);
    for (var s = 0; s < schedules.length; s++) {
      var sched = schedules[s];
      console.log('    ' + (sched.scheduleId || sched.id) + ': ' + sched.cron + ' -> ' + (sched.destination || ''));
    }
    report.qstash = { count: schedules.length, schedules: schedules.map(function(s) { return { id: s.scheduleId || s.id, cron: s.cron, dest: s.destination }; }) };
  } catch (e) {
    console.log('  QStash check failed: ' + e.message);
    report.qstash = { count: 0, error: e.message };
  }
  
  // 2.3: Predis API
  console.log('\n--- 2.3: Predis API ---');
  try {
    var predisRes = await fetchJSON('https://brain.predis.ai/predis_api/v1/get_posts/?brand_id=' + process.env.PREDIS_BRAND_ID, {
      headers: { 'Authorization': process.env.PREDIS_API_KEY }
    });
    report.connections.predis = predisRes.status === 200 ? 'OK' : 'FOUT(' + predisRes.status + ')';
    console.log('  Predis API: ' + report.connections.predis);
  } catch (e) {
    report.connections.predis = 'FOUT: ' + e.message;
    console.log('  Predis API: ' + e.message);
  }
  
  // 2.4: Predis webhook check
  console.log('\n--- 2.4: Predis webhook ---');
  try {
    var whRes = await fetchJSON(BASE + '/api/webhook/predis-callback', { method: 'GET' });
    report.connections.predis_webhook = whRes.status < 500 ? 'Bereikbaar' : 'FOUT(' + whRes.status + ')';
    console.log('  Predis webhook endpoint: status ' + whRes.status);
  } catch (e) {
    report.connections.predis_webhook = 'FOUT';
    console.log('  Predis webhook: ' + e.message);
  }
  
  // 2.5: Claude API
  console.log('\n--- 2.5: Claude API ---');
  try {
    var claudeRes = await fetchJSON('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reply with only: OK' }]
      })
    });
    report.connections.claude = claudeRes.status === 200 ? 'OK' : 'FOUT(' + claudeRes.status + ')';
    console.log('  Claude API: ' + report.connections.claude);
  } catch (e) {
    report.connections.claude = 'FOUT: ' + e.message;
    console.log('  Claude API: ' + e.message);
  }
  
  // 2.6: Telegram Bot
  console.log('\n--- 2.6: Telegram Bot ---');
  try {
    var tgRes = await fetchJSON('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getWebhookInfo', {});
    var tgData = JSON.parse(tgRes.body);
    var tgResult = tgData.result || {};
    console.log('  Webhook URL: ' + (tgResult.url || 'Niet ingesteld'));
    console.log('  Pending updates: ' + (tgResult.pending_update_count || 0));
    console.log('  Last error: ' + (tgResult.last_error_message || 'Geen'));
    report.connections.telegram = tgRes.status === 200 ? 'OK' : 'FOUT';
    report.telegram_webhook = tgResult.url || 'Niet ingesteld';
    report.telegram_pending = tgResult.pending_update_count || 0;
    report.telegram_error = tgResult.last_error_message || 'Geen';
  } catch (e) {
    report.connections.telegram = 'FOUT: ' + e.message;
    console.log('  Telegram: ' + e.message);
  }
  
  // 2.7: Redis
  console.log('\n--- 2.7: Redis ---');
  try {
    await store.set('health:check', JSON.stringify({ timestamp: Date.now() }));
    var check = await store.get('health:check');
    report.connections.redis = check ? 'OK' : 'FOUT';
    console.log('  Redis: ' + (check ? 'OK' : 'FOUT'));
    
    var angleScores = await store.get('content:angle-scores');
    console.log('  Angle scores: ' + (angleScores ? 'Aanwezig' : 'Ontbreekt'));
    
    var limits = await store.get('config:limits');
    console.log('  Budget limieten: ' + (limits ? 'Aanwezig' : 'Ontbreekt (defaults)'));
    
    await store.del('health:check');
  } catch (e) {
    report.connections.redis = 'FOUT: ' + e.message;
    console.log('  Redis: ' + e.message);
  }
  
  // 2.8: Meta API (quick check)
  console.log('\n--- 2.8: Meta API ---');
  try {
    var metaRes = await fetchJSON(
      'https://graph.facebook.com/v21.0/' + PIXEL_ID + '?access_token=' + META_TOKEN + '&fields=name,id', {}
    );
    report.connections.meta = metaRes.status === 200 ? 'OK' : 'FOUT(' + metaRes.status + ')';
    console.log('  Meta API: ' + report.connections.meta);
    if (metaRes.status === 200) {
      var metaData = JSON.parse(metaRes.body);
      console.log('  Pixel: ' + metaData.name + ' (' + metaData.id + ')');
    }
  } catch (e) {
    report.connections.meta = 'FOUT: ' + e.message;
    console.log('  Meta API: ' + e.message);
  }
}

// ============================================================
// FASE 3: META PIXEL + CHECKOUT FLOW AUDIT
// ============================================================

async function fase3() {
  console.log('\n=== FASE 3: META PIXEL + CHECKOUT AUDIT ===\n');
  
  // 3.1: Pixel event stats (last 24h)
  console.log('--- 3.1: Pixel events (24u) ---');
  try {
    var now = Math.floor(Date.now() / 1000);
    var dayAgo = now - 86400;
    var statsUrl = 'https://graph.facebook.com/v21.0/' + PIXEL_ID + '/stats?' +
      'access_token=' + META_TOKEN +
      '&aggregation=event&start=' + dayAgo + '&end=' + now;
    var statsRes = await fetchJSON(statsUrl, {});
    if (statsRes.status === 200) {
      var statsData = JSON.parse(statsRes.body);
      console.log('  Events (24u):');
      var eventData = statsData.data || [];
      var eventMap = {};
      for (var i = 0; i < eventData.length; i++) {
        var ev = eventData[i];
        var name = ev.event || ev.value || 'unknown';
        var count = ev.count || ev.total || 0;
        eventMap[name] = count;
        console.log('    ' + name + ': ' + count);
      }
      report.pixel.events = eventMap;
      report.pixel.ok = true;
    } else {
      console.log('  Stats API response: ' + statsRes.status);
      console.log('  Body: ' + statsRes.body.substring(0, 300));
      report.pixel.ok = false;
      report.pixel.error = 'Status ' + statsRes.status;
      
      // Try alternative: test_events endpoint
      console.log('\n  Probeer alternatief: server_events check...');
      var altUrl = 'https://graph.facebook.com/v21.0/' + PIXEL_ID + '?access_token=' + META_TOKEN + '&fields=name,id,is_unavailable';
      var altRes = await fetchJSON(altUrl, {});
      console.log('  Pixel info: ' + altRes.body.substring(0, 200));
    }
  } catch (e) {
    console.log('  Pixel stats failed: ' + e.message);
    report.pixel.ok = false;
    report.pixel.error = e.message;
  }
  
  // 3.2: Check CAPI events in Redis
  console.log('\n--- 3.2: CAPI events in Redis ---');
  try {
    var redis = store._getRedis();
    if (redis) {
      var capiCount = 0;
      var cursor = 0;
      do {
        var result = await redis.scan(cursor, { match: 'meta:event:*', count: 100 });
        cursor = result[0];
        capiCount += (result[1] || []).length;
      } while (cursor && cursor !== 0 && cursor !== '0');
      console.log('  meta:event:* keys: ' + capiCount);
      
      // Also check dedup keys
      var dedupCount = 0;
      cursor = 0;
      do {
        var result2 = await redis.scan(cursor, { match: 'dedup:*', count: 100 });
        cursor = result2[0];
        dedupCount += (result2[1] || []).length;
      } while (cursor && cursor !== 0 && cursor !== '0');
      console.log('  dedup:* keys: ' + dedupCount);
      
      report.pixel.capiKeys = capiCount;
      report.pixel.dedupKeys = dedupCount;
    }
  } catch (e) {
    console.log('  Redis scan failed: ' + e.message);
  }
  
  // 3.3: Product pages check
  console.log('\n--- 3.3: Product paginas ---');
  var pages = [
    'https://www.calqix.com/products/oralbiome-pro-peach',
    'https://www.calqix.com/products/calqix-flowcore',
    'https://www.calqix.com/nl/products/oralbiome-pro-peach',
    'https://www.calqix.com/de/products/oralbiome-pro-peach'
  ];
  
  for (var p = 0; p < pages.length; p++) {
    try {
      var pageRes = await fetchJSON(pages[p], { method: 'GET' });
      var ok = pageRes.status === 200;
      console.log('  ' + pages[p] + ': ' + (ok ? 'OK' : pageRes.status));
      
      if (ok && p === 0) {
        // Quick CRO element check on first page
        var html = pageRes.body;
        var checks = {
          price: html.includes('price') || html.includes('Price'),
          add_to_cart: html.includes('add-to-cart') || html.includes('product-form'),
          reviews: html.includes('review') || html.includes('rating'),
          trust: html.includes('trust') || html.includes('badge') || html.includes('guarantee'),
          shipping: html.includes('shipping') || html.includes('verzending') || html.includes('Versand'),
          faq: html.includes('faq') || html.includes('FAQ'),
          social_proof: html.includes('customers') || html.includes('sold'),
          page_size_kb: Math.round(html.length / 1024)
        };
        console.log('  CRO elementen: ' + JSON.stringify(checks));
        report.cro_checks = checks;
      }
    } catch (e) {
      console.log('  ' + pages[p] + ': FOUT - ' + e.message);
    }
  }
  
  // 3.4: Recent checkouts via Shopify Admin API
  console.log('\n--- 3.4: Recente orders ---');
  if (SHOPIFY_DOMAIN && SHOPIFY_TOKEN) {
    try {
      var ordersRes = await fetchJSON(
        'https://' + SHOPIFY_DOMAIN + '/admin/api/2024-10/orders.json?limit=5&status=any',
        { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } }
      );
      if (ordersRes.status === 200) {
        var ordersData = JSON.parse(ordersRes.body);
        var orders = ordersData.orders || [];
        console.log('  Recente orders: ' + orders.length);
        for (var o = 0; o < orders.length; o++) {
          var order = orders[o];
          console.log('    #' + order.order_number + ' - ' + (order.currency || 'EUR') + ' ' + order.total_price + ' - ' + order.financial_status);
        }
        report.checkout = { ok: true, recentOrders: orders.length };
      } else {
        console.log('  Orders API: ' + ordersRes.status);
        report.checkout = { ok: false, error: 'Status ' + ordersRes.status };
      }
    } catch (e) {
      console.log('  Orders check failed: ' + e.message);
      report.checkout = { ok: false, error: e.message };
    }
  } else {
    console.log('  SHOPIFY_STORE_DOMAIN of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreekt');
    report.checkout = { ok: false, error: 'Missing credentials' };
  }
}

// ============================================================
// FASE 2.8 + FASE 3 EINDE: Audit rapport naar Telegram
// ============================================================

async function sendAuditReport() {
  console.log('\n=== AUDIT RAPPORT VERZENDEN ===\n');
  
  var today = todayKey();
  var lines = ['<b>CALQIX Systeem Audit - ' + today + '</b>\n'];
  
  // Queue
  lines.push('<b>QUEUE:</b>');
  lines.push('Wachtrij geleegd: ' + report.queue.removed + ' items verwijderd');
  lines.push('Status: Leeg, klaar voor live executie\n');
  
  // Endpoints
  lines.push('<b>ENDPOINTS:</b>');
  var epOk = 0, epTotal = 0;
  Object.keys(report.endpoints).forEach(function (ep) {
    epTotal++;
    var r = report.endpoints[ep];
    var status = r.ok ? 'OK' : 'FOUT';
    if (r.ok) epOk++;
    lines.push('- ' + ep.replace('/api/', '') + ': ' + status + ' (' + r.duration + 'ms)');
  });
  lines.push('Totaal: ' + epOk + '/' + epTotal + ' OK\n');
  
  // Connections
  lines.push('<b>VERBINDINGEN:</b>');
  Object.keys(report.connections).forEach(function (c) {
    lines.push('- ' + c.charAt(0).toUpperCase() + c.slice(1) + ': ' + report.connections[c]);
  });
  lines.push('');
  
  // QStash
  if (report.qstash) {
    lines.push('<b>QSTASH:</b> ' + report.qstash.count + ' schedules actief');
    if (report.qstash.schedules) {
      report.qstash.schedules.forEach(function (s) {
        lines.push('- ' + (s.id || '?') + ': ' + s.cron);
      });
    }
    lines.push('');
  }
  
  // Pixel
  lines.push('<b>META PIXEL:</b>');
  if (report.pixel.events) {
    Object.keys(report.pixel.events).forEach(function (e) {
      lines.push('- ' + e + ': ' + report.pixel.events[e]);
    });
  } else {
    lines.push('- Events: ' + (report.pixel.error || 'Geen data'));
  }
  if (report.pixel.capiKeys !== undefined) {
    lines.push('- CAPI keys in Redis: ' + report.pixel.capiKeys);
    lines.push('- Dedup keys: ' + report.pixel.dedupKeys);
  }
  lines.push('');
  
  // Checkout
  lines.push('<b>CHECKOUT:</b>');
  if (report.checkout) {
    lines.push(report.checkout.ok ? 'Recente orders: ' + report.checkout.recentOrders : 'FOUT: ' + report.checkout.error);
  }
  
  var text = lines.join('\n');
  console.log(text.replace(/<\/?b>/g, ''));
  
  // Telegram has 4096 char limit, truncate if needed
  if (text.length > 4000) text = text.substring(0, 3990) + '\n...(ingekort)';
  
  await sendTelegram(text);
  console.log('\nAudit rapport verzonden naar Telegram.');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('CALQIX Full System Audit - ' + todayKey());
  console.log('=========================================\n');
  
  // Check required env vars
  var required = ['CRON_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'META_ACCESS_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  var missing = required.filter(function (v) { return !process.env[v]; });
  if (missing.length > 0) {
    console.error('ONTBREKENDE ENV VARS: ' + missing.join(', '));
    console.error('Zorg dat .env.local aanwezig is met alle productie env vars.');
    process.exit(1);
  }
  
  try {
    await fase1();
  } catch (e) {
    console.error('FASE 1 FOUT:', e.message);
    report.queue.error = e.message;
  }
  
  try {
    await fase2();
  } catch (e) {
    console.error('FASE 2 FOUT:', e.message);
  }
  
  try {
    await fase3();
  } catch (e) {
    console.error('FASE 3 FOUT:', e.message);
  }
  
  try {
    await sendAuditReport();
  } catch (e) {
    console.error('RAPPORT FOUT:', e.message);
  }
  
  console.log('\n=========================================');
  console.log('Audit compleet. Check Telegram voor rapport.');
}

main().then(function () { process.exit(0); }).catch(function (e) { console.error('Fatal:', e); process.exit(1); });
