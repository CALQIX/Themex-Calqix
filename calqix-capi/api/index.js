/**
 * CALQIX CAPI Dashboard - root endpoint.
 *
 * Shows platform connections, EMQ diagnostics, funnel coverage and tracking
 * analysis for Shopify, Meta CAPI, Web Pixel and server recovery.
 */
var store = require('../lib/store');
var googleOAuth = require('../lib/google-oauth');
var capiDiag = require('../lib/capi-diagnostics');
var eventStats = require('../lib/event-stats');
var shopifyAdmin = require('../lib/shopify-admin');

var DASHBOARD_LAYOUT_VERSION = 'tracking-intelligence-2026-05-15';

module.exports = async function (req, res) {
  var qs = (req.query && req.query.secret) || '';
  var wantsJson = req.query && (req.query.format === 'json' || req.query.live === '1');

  try {
    // --- Gather all platform statuses ---
    var meta = getMetaStatus();
    var ga4 = getGA4Status();
    var gads = await getGoogleAdsStatus();
    var tiktok = getTikTokStatus();
    var google = getGoogleEnabledStatus();

    // --- EMQ diagnostics ---
    var today = new Date().toISOString().split('T')[0];
    var yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    var emqToday = await capiDiag.getDailySummary(today);
    var emqYesterday = await capiDiag.getDailySummary(yesterday);

    // --- Event counts from Redis ---
    var eventCounts = await getEventCounts();
    var trackingHub = await getTrackingHubStatus();
    var comparison = await getShopifyMetaComparison(today, emqToday);

    var data = {
      meta: meta,
      ga4: ga4,
      googleAds: gads,
      tiktok: tiktok,
      googleEnabled: google,
      emq: { today: emqToday, yesterday: emqYesterday, todayDate: today, yesterdayDate: yesterday },
      events: eventCounts,
      trackingHub: trackingHub,
      comparison: comparison,
      dashboardLayoutVersion: DASHBOARD_LAYOUT_VERSION,
      timestamp: new Date().toISOString()
    };

    setDashboardHeaders(res);

    if (wantsJson) {
      return res.status(200).json(renderDashboard(data, qs, true));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderDashboard(data, qs));
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function setDashboardHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-CALQIX-Dashboard-Layout', DASHBOARD_LAYOUT_VERSION);
}

function getMetaStatus() {
  var pixelId = process.env.META_PIXEL_ID || '';
  var hasToken = Boolean(process.env.META_ACCESS_TOKEN);
  var enabled = process.env.CAPI_ENABLED !== 'false';
  return {
    connected: Boolean(pixelId && hasToken),
    enabled: enabled,
    pixelId: pixelId ? pixelId.substring(0, 4) + '***' + pixelId.slice(-3) : null,
    hasAccessToken: hasToken
  };
}

function getGA4Status() {
  var mid = process.env.GA4_MEASUREMENT_ID || '';
  var hasSecret = Boolean(process.env.GA4_API_SECRET);
  var enabled = (process.env.GA4_ENABLED || '').trim() === 'true';
  return {
    connected: Boolean(mid && hasSecret),
    enabled: enabled,
    measurementId: mid ? mid.substring(0, 4) + '***' + mid.slice(-3) : null,
    propertyId: process.env.GA4_PROPERTY_ID || null,
    streamId: process.env.GA4_STREAM_ID || null
  };
}

async function getGoogleAdsStatus() {
  var custId = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
  var hasDevToken = Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  var convAction = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || '';
  var enabled = (process.env.GOOGLE_ADS_ENABLED || '').trim() === 'true';
  var oauthHealth = await googleOAuth.getHealthStatus();
  return {
    connected: Boolean(custId && hasDevToken && oauthHealth.has_refresh_token),
    enabled: enabled,
    customerId: custId ? custId.substring(0, 3) + '***' + custId.slice(-3) : null,
    conversionAction: convAction || null,
    hasOAuth: oauthHealth.has_refresh_token,
    hasAccessToken: oauthHealth.has_access_token,
    managerId: process.env.GOOGLE_ADS_MANAGER_ID ? 'set' : null
  };
}

function getTikTokStatus() {
  var pixelId = process.env.TIKTOK_PIXEL_ID || '';
  var hasToken = Boolean(process.env.TIKTOK_ACCESS_TOKEN);
  var enabled = (process.env.TIKTOK_ENABLED || '').trim() === 'true';
  return {
    connected: Boolean(pixelId && hasToken),
    enabled: enabled,
    pixelId: pixelId ? pixelId.substring(0, 4) + '***' : null
  };
}

function getGoogleEnabledStatus() {
  return (process.env.GOOGLE_ENABLED || '').trim() === 'true';
}

async function getEventCounts() {
  var counts = {};
  try {
    var redis = store._getRedis();
    if (!redis) return counts;
    var keys = ['stats:events:sent', 'stats:events:today'];
    for (var i = 0; i < keys.length; i++) {
      var val = await redis.get(keys[i]);
      if (val) counts[keys[i]] = val;
    }
  } catch (e) {}
  return counts;
}

async function getTrackingHubStatus() {
  try {
    var raw = await store.get('tracking_hub:latest');
    if (!raw) return { available: false };
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.assign({ available: true }, data);
  } catch (e) {
    return { available: false, error: e.message };
  }
}

async function getShopifyMetaComparison(today, emqToday) {
  var cacheKey = 'dashboard:shopify_meta_comparison:' + today;
  try {
    var cached = await store.get(cacheKey);
    if (cached) {
      var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      parsed.cached = true;
      return parsed;
    }
  } catch (e) { /* cache miss */ }

  var events = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];
  var statsToday = {};
  var lifecycle = {};
  var shopifyOrders = null;
  var shopifyError = null;

  try {
    var stats = await eventStats.getEventStats(1);
    statsToday = (stats[0] && stats[0].events) || {};
  } catch (e) {
    statsToday = {};
  }

  try {
    lifecycle = await withTimeout(getMetaLifecycleCounts(today), 2500, {});
  } catch (e) {
    lifecycle = {};
  }

  try {
    shopifyOrders = await withTimeout(getShopifyOrdersCount(today), 1800, null);
  } catch (e) {
    shopifyError = e.message;
  }

  var rows = events.map(function (eventName) {
    var stat = statsToday[eventName] || {};
    var sourceCount = Math.max(Number(stat.browser) || 0, Number(stat.server) || 0);
    var meta = lifecycle[eventName] || {};
    var emqCount = emqToday && emqToday[eventName] ? Number(emqToday[eventName].total) || 0 : 0;
    var metaConfirmed = Math.max(Number(meta.confirmed) || 0, emqCount);
    var shopifyCount = eventName === 'Purchase' && typeof shopifyOrders === 'number'
      ? shopifyOrders
      : sourceCount;
    var delta = shopifyCount - metaConfirmed;
    var metaForAdvice = Object.assign({}, meta, { confirmed: metaConfirmed, emq: emqCount });
    return {
      event: eventName,
      shopify: shopifyCount,
      shopify_source: eventName === 'Purchase' && typeof shopifyOrders === 'number'
        ? 'Shopify Admin orders'
        : 'Shopify pixel/webhook ingang',
      capi_browser: Number(stat.browser) || 0,
      capi_server: Number(stat.server) || 0,
      meta_confirmed: metaConfirmed,
      meta_emq: emqCount,
      meta_lifecycle_confirmed: Number(meta.confirmed) || 0,
      meta_received: Number(meta.received) || 0,
      retry_pending: Number(meta.retry_pending) || 0,
      failed_terminal: Number(meta.failed_terminal) || 0,
      difference: delta,
      status: delta === 0 ? 'match' : delta > 0 ? 'shopify_hoger' : 'meta_hoger',
      advice: comparisonAdvice(eventName, delta, metaForAdvice, stat)
    };
  });

  var result = {
    date: today,
    rows: rows,
    shopify_order_count: shopifyOrders,
    shopify_error: shopifyError
  };
  try { await store.set(cacheKey, JSON.stringify(result), 15); } catch (e) { /* non-fatal */ }
  return result;
}

function withTimeout(promise, ms, fallback) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(function (value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }).catch(function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

async function getShopifyOrdersCount(today) {
  if (!process.env.SHOPIFY_STORE_DOMAIN) return null;
  var query = 'created_at:>=' + today;
  var gql = 'query OrdersCount($query: String!) { ordersCount(query: $query) { count } }';
  var data = await shopifyAdmin.graphql(gql, { query: query });
  if (!data || !data.ordersCount) return null;
  return Number(data.ordersCount.count) || 0;
}

async function getMetaLifecycleCounts(today) {
  var redis = store._getRedis();
  if (!redis) return {};
  var cursor = '0';
  var counts = {};
  var scanned = 0;
  var started = Date.now();
  do {
    var result = await redis.scan(cursor, { match: 'meta:event:*', count: 200 });
    cursor = String(result[0]);
    var keys = result[1] || [];
    for (var i = 0; i < keys.length; i++) {
      scanned++;
      var raw = await redis.get(keys[i]);
      var item;
      try { item = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { item = null; }
      if (!item || !item.event_name) continue;
      var stamp = item.created_at || item.updated_at || '';
      if (stamp && stamp.indexOf(today) !== 0) continue;
      if (!counts[item.event_name]) {
        counts[item.event_name] = { received: 0, confirmed: 0, retry_pending: 0, failed_terminal: 0 };
      }
      counts[item.event_name].received++;
      if (item.state === 'confirmed' || item.state === 'recovered') counts[item.event_name].confirmed++;
      if (item.state === 'retry_pending') counts[item.event_name].retry_pending++;
      if (item.state === 'failed_terminal') counts[item.event_name].failed_terminal++;
    }
  } while (cursor !== '0' && scanned < 1500 && Date.now() - started < 2200);
  return counts;
}

function comparisonAdvice(eventName, delta, meta, stat) {
  if (delta === 0) return 'Shopify ingang en Meta CAPI bevestigd zijn gelijk voor deze event.';
  if (delta > 0) {
    if (meta && meta.retry_pending) return 'Meta loopt achter door retry_pending events; recovery job moet deze oppakken.';
    if (meta && meta.confirmed) return 'Shopify ligt hoger dan Meta gemeten: controleer events zonder EMQ registratie, dedup of geblokkeerde browser calls.';
    if (!meta || !meta.received) return 'Shopify ziet activiteit, maar Meta lifecycle ziet niets: controleer pixel/webhook firing en endpoint delivery.';
    return 'Shopify ligt hoger: controleer dedup, Meta response errors, consent/adblockers en match-key coverage.';
  }
  if ((stat && stat.browser) && (stat && stat.server)) {
    return 'Meta ligt hoger: waarschijnlijk browser + server overlap; controleer event_id deduplicatie.';
  }
  return 'Meta ligt hoger dan Shopify-bron: controleer dubbele sends of verkeerde event_id.';
}

function renderDashboard(data, querySecret, fragmentsOnly) {
  var m = data.meta;
  var g = data.ga4;
  var ga = data.googleAds;
  var tt = data.tiktok;

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badge(connected, enabled) {
    if (connected && enabled) return '<span class="badge badge-live">LIVE</span>';
    if (connected && !enabled) return '<span class="badge badge-ready">READY</span>';
    return '<span class="badge badge-off">NOT CONNECTED</span>';
  }

  var matchFields = [
    { key: 'em', label: 'Email', critical: ['InitiateCheckout', 'AddPaymentInfo', 'Purchase'] },
    { key: 'ph', label: 'Phone', critical: ['Purchase'] },
    { key: 'fn', label: 'First', critical: ['Purchase'] },
    { key: 'ln', label: 'Last', critical: ['Purchase'] },
    { key: 'ct', label: 'City', critical: ['Purchase'] },
    { key: 'st', label: 'State', critical: ['Purchase'] },
    { key: 'zp', label: 'ZIP', critical: ['Purchase'] },
    { key: 'country', label: 'Country', critical: ['Purchase'] },
    { key: 'fbp', label: 'FBP', critical: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'] },
    { key: 'fbc', label: 'FBC', critical: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'] },
    { key: 'external_id', label: 'ExtID', critical: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'] },
    { key: 'client_ip_address', label: 'IP', critical: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'] },
    { key: 'client_user_agent', label: 'UA', critical: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'] }
  ];

  function emqTable(emqData, dateLabel) {
    emqData = emqData || {};
    var events = orderedEventNames(emqData);

    var html = '<table class="emq-table"><thead><tr>' +
      '<th>Event</th><th>Total</th>' +
      matchFields.map(function (field) { return '<th>' + esc(field.label) + '</th>'; }).join('') +
      '<th>Actie</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var s = emqData[ev] || {};
      var total = s.total || 1;
      html += '<tr>' +
        '<td class="ev-name">' + esc(ev) + '</td>' +
        '<td class="ev-total">' + esc(s.total || 0) + '</td>' +
        matchFields.map(function (field) { return emqCell(s[field.key], total); }).join('') +
        '<td class="emq-action">' + esc(eventActionAdvice(ev, s)) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    html += '<div class="emq-legend">' + matchFields.map(function (field) {
      return '<span><strong>' + esc(field.label) + '</strong> ' + esc(fieldMeaning(field.key)) + '</span>';
    }).join('') + '</div>';
    return html;
  }

  function emqCell(count, total) {
    var pct = total > 0 ? Math.round(((count || 0) / total) * 100) : 0;
    var cls = pct >= 80 ? 'emq-high' : pct >= 40 ? 'emq-mid' : pct > 0 ? 'emq-low' : 'emq-zero';
    return '<td class="' + cls + '">' + pct + '%</td>';
  }

  function coverageFor(eventName, field) {
    var row = data.emq && data.emq.today && data.emq.today[eventName];
    if (!row || !row.total) return null;
    return pctFor(row, field);
  }

  function pctFor(row, field) {
    if (!row || !row.total) return null;
    return Math.round(((row[field] || 0) / row.total) * 100);
  }

  function orderedEventNames(emqData) {
    var preferred = funnel.map(function (step) { return step.name; });
    var seen = {};
    var out = [];
    preferred.forEach(function (name) {
      out.push(name);
      seen[name] = true;
    });
    Object.keys(emqData || {}).sort().forEach(function (name) {
      if (!seen[name]) out.push(name);
    });
    return out;
  }

  function fieldMeaning(key) {
    var map = {
      em: 'gehashte email',
      ph: 'gehashte telefoon',
      fn: 'voornaam',
      ln: 'achternaam',
      ct: 'plaats',
      st: 'provincie/staat',
      zp: 'postcode',
      country: 'land',
      fbp: 'Meta browser-id',
      fbc: 'Meta click-id',
      external_id: 'klant/order-id',
      client_ip_address: 'IP signaal',
      client_user_agent: 'browser signaal'
    };
    return map[key] || key;
  }

  function eventActionAdvice(eventName, row) {
    if (!row || !row.total) return 'Geen events gezien vandaag: controleer of deze funnelstap vuurt.';
    var fbp = pctFor(row, 'fbp');
    var fbc = pctFor(row, 'fbc');
    var ext = pctFor(row, 'external_id');
    var em = pctFor(row, 'em');
    var ph = pctFor(row, 'ph');
    var ip = pctFor(row, 'client_ip_address');
    var ua = pctFor(row, 'client_user_agent');
    var actions = [];
    if (fbp !== null && fbp < 80) actions.push('_fbp aansluiten via bridge/custom pixel');
    if (fbc !== null && fbc < 40) actions.push('fbclid/_fbc bewaren vanaf landing');
    if (ext !== null && ext < 95) actions.push('external_id verplicht meesturen');
    if ((eventName === 'Purchase' || eventName === 'InitiateCheckout' || eventName === 'AddPaymentInfo') && em !== null && em < 80) actions.push('checkout email enrichment koppelen');
    if (eventName === 'Purchase' && ph !== null && ph < 40) actions.push('telefoon/adresvelden uit order webhook aanvullen');
    if (ip !== null && ip < 90) actions.push('client_ip_address uit request headers doorgeven');
    if (ua !== null && ua < 90) actions.push('client_user_agent uit request headers doorgeven');
    return actions.length ? actions.join('; ') : 'Aangesloten: match keys zijn toereikend voor deze event.';
  }

  function eventScore(row) {
    if (!row || !row.total) return 0;
    var fields = ['fbp', 'fbc', 'external_id', 'em', 'ph', 'client_ip_address', 'client_user_agent'];
    var sum = 0;
    fields.forEach(function (field) { sum += pctFor(row, field) || 0; });
    return Math.round(sum / fields.length);
  }

  function criticalItems() {
    var items = funnel.map(function (step) {
      var row = data.emq && data.emq.today && data.emq.today[step.name];
      var cmpRows = data.comparison && data.comparison.rows || [];
      var cmpRow = cmpRows.filter(function (r) { return r.event === step.name; })[0] || {};
      var score = eventScore(row);
      var level = !row || !row.total ? 'P1' : score >= 80 ? 'OK' : score >= 55 ? 'P2' : 'P1';
      var weak = matchFields.map(function (field) {
        return { label: field.label, pct: pctFor(row, field.key) };
      }).filter(function (field) {
        return field.pct !== null && field.pct < 80;
      }).slice(0, 4);
      return {
        level: level,
        title: step.name + ' match quality check',
        text: row && row.total
          ? 'Vandaag ' + row.total + ' event(s). Zwakste signalen: ' + (weak.length ? weak.map(function (field) { return field.label + ' ' + field.pct + '%'; }).join(', ') : 'geen directe zwakke match key') + '.'
          : (cmpRow.shopify > 0
            ? 'Shopify/CAPI zag vandaag ' + cmpRow.shopify + ' ingangssignaal/signalen, maar EMQ had hiervoor nog geen match-key registratie.'
            : 'Deze funnelstap is vandaag nog niet gemeten in de EMQ diagnostics.'),
        action: row && row.total ? eventActionAdvice(step.name, row) : (cmpRow.shopify > 0
          ? 'EMQ-registratie is nu aangesloten voor dit pad; controleer het volgende echte event op match keys.'
          : 'Geen events gezien vandaag: controleer of deze funnelstap vuurt.')
      };
    });

    if (!m.connected || !m.enabled) {
      items.unshift({
        level: 'P0',
        title: 'Meta delivery staat niet volledig live',
        text: 'Zonder actieve Pixel ID, access token en CAPI_ENABLED worden Shopify events niet betrouwbaar naar Meta gestuurd.',
        action: 'Controleer META_PIXEL_ID, META_ACCESS_TOKEN en CAPI_ENABLED in Vercel env.'
      });
    }
    if (!items.length) {
      items.push({
        level: 'OK',
        title: 'Geen directe P0/P1 tracking breuk zichtbaar',
        text: 'De kritieke laag lijkt live. Blijf vooral verschillen tussen Shopify orders en Meta attributed purchases monitoren.',
        action: 'Gebruik EMQ, FBP/FBC coverage en Purchase dedup als dagelijkse radar.'
      });
    }
    return items;
  }

  function criticalCards() {
    return criticalItems().map(function (item) {
      return '<article class="analysis-card priority-' + esc(item.level) + '">' +
        '<div class="analysis-top"><span class="priority-pill">' + esc(item.level) + '</span><span>GPT-5.5 analyse</span></div>' +
        '<h3>' + esc(item.title) + '</h3>' +
        '<p>' + esc(item.text) + '</p>' +
        '<div class="action-line">' + esc(item.action) + '</div>' +
        '</article>';
    }).join('');
  }

  var funnel = [
    {
      name: 'ViewContent',
      source: 'Theme browser bridge',
      endpoint: '/api/view-content',
      eventId: 'vc_{product/variant}_{time}',
      data: 'variant_id, sku, price, currency, source_url, fbp, fbc, em, ph, external_id, IP, UA',
      risk: 'Wordt vooral gemist door adblockers, JavaScript blokkades of ontbrekende product identifiers.'
    },
    {
      name: 'AddToCart',
      source: 'Theme browser bridge',
      endpoint: '/api/add-to-cart',
      eventId: 'atc_{variant}_{time}',
      data: 'content_ids, contents, value, currency, fbp, fbc, em, ph, external_id, IP, UA',
      risk: 'Shopify cart acties kunnen hoger zijn dan Meta als browser calls geblokkeerd worden.'
    },
    {
      name: 'InitiateCheckout',
      source: 'Shopify Custom Pixel + CAPI',
      endpoint: '/api/checkout-event',
      eventId: 'ic_{checkout_token}',
      data: 'checkout_token, line_items, value, currency, fbp, fbc, email, phone, address, external_id',
      risk: 'Verschil ontstaat wanneer checkout_started wel in Shopify gebeurt maar pixel sandbox of network call faalt.'
    },
    {
      name: 'AddPaymentInfo',
      source: 'Shopify Custom Pixel + CAPI',
      endpoint: '/api/checkout-event',
      eventId: 'add_payment_info_{checkout_token}',
      data: 'payment step, enriched contact data, line_items, browser identifiers',
      risk: 'Niet elke betaalmethode of express checkout vuurt dit event even consistent.'
    },
    {
      name: 'Purchase',
      source: 'Custom Pixel + orders-paid webhook',
      endpoint: '/api/checkout-event + /api/webhook/orders-paid',
      eventId: 'purchase_{checkout_token}',
      data: 'order_id, value, currency, contents, email, phone, address, fbp, fbc, external_id, order_type',
      risk: 'Shopify is order-bron; Meta telt gededupte, matchbare en toegewezen purchases binnen attributievenster.'
    }
  ];

  function funnelMarkup() {
    return funnel.map(function (step, i) {
      return '<article class="funnel-step">' +
        '<div class="step-index">' + (i + 1) + '</div>' +
        '<div class="step-body">' +
        '<h3>' + esc(step.name) + '</h3>' +
        '<div class="step-meta"><span>' + esc(step.source) + '</span><span>' + esc(step.endpoint) + '</span></div>' +
        '<p><strong>Event ID:</strong> ' + esc(step.eventId) + '</p>' +
        '<p><strong>Data:</strong> ' + esc(step.data) + '</p>' +
        '<p class="risk"><strong>Let op:</strong> ' + esc(step.risk) + '</p>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  function trackingHubMarkup() {
    var hub = data.trackingHub || {};
    if (!hub.available) {
      return '<article class="diff-panel"><h3>Nog geen Tracking Hub run</h3><p>De 15-minuten OpenAI/QStash job vult dit blok zodra `/api/cron/tracking-hub` heeft gedraaid.</p></article>';
    }
    var ads = hub.ad_recommendations || [];
    var tracking = hub.tracking_recommendations || [];
    var queued = hub.queued || [];
    var rows = [];
    ads.slice(0, 4).forEach(function (rec) {
      rows.push('<li><strong>' + esc(rec.title || rec.type || 'Ad advies') + '</strong><span>' + esc(rec.recommendation || rec.reason || '-') + '</span></li>');
    });
    if (!rows.length) rows.push('<li><strong>Geen ad actie nodig</strong><span>Geen spend-starved of scale kandidaat in laatste run.</span></li>');
    var trackingRows = tracking.slice(0, 3).map(function (rec) {
      return '<li><strong>' + esc(rec.priority || 'P2') + ' ' + esc(rec.title || 'Tracking') + '</strong><span>' + esc(rec.action || rec.metric || '-') + '</span></li>';
    }).join('');
    return '<article class="trackinghub-panel">' +
      '<div class="hub-head"><div><h3>Trackinghub Performance</h3><p>' + esc(hub.summary_nl || 'Laatste tracking en ad performance analyse.') + '</p></div><span>' + esc(hub.source || 'unknown') + '</span></div>' +
      '<div class="hub-grid">' +
      '<div><h4>Tracking kwaliteit</h4><ul>' + (trackingRows || '<li><strong>Stabiel</strong><span>Geen kritisch trackingpunt.</span></li>') + '</ul></div>' +
      '<div><h4>Advertentie performance</h4><ul>' + rows.join('') + '</ul></div>' +
      '<div><h4>Approval</h4><p>' + queued.length + ' voorstel(len) in wachtrij. Budgetacties worden pas na Telegram akkoord uitgevoerd.</p></div>' +
      '</div>' +
      '</article>';
  }

  function comparisonMarkup() {
    var cmp = data.comparison || {};
    var rows = cmp.rows || [];
    if (!rows.length) {
      return '<article class="diff-panel"><h3>Nog geen vergelijkingsdata</h3><p>De Shopify-vs-Meta vergelijking wordt gevuld zodra Redis lifecycle data of Shopify orderdata beschikbaar is.</p></article>';
    }
    var body = rows.map(function (row) {
      return '<tr class="cmp-' + esc(row.status) + '">' +
        '<td><strong>' + esc(row.event) + '</strong><span>' + esc(row.shopify_source) + '</span></td>' +
        '<td>' + esc(row.shopify) + '</td>' +
        '<td>' + esc(row.capi_browser) + ' / ' + esc(row.capi_server) + '</td>' +
        '<td>' + esc(row.meta_confirmed) + '<span>EMQ ' + esc(row.meta_emq) + ' / lifecycle ' + esc(row.meta_lifecycle_confirmed) + '</span></td>' +
        '<td>' + esc(row.difference > 0 ? '+' + row.difference : row.difference) + '</td>' +
        '<td>' + esc(row.retry_pending) + '</td>' +
        '<td class="cmp-advice">' + esc(row.advice) + '</td>' +
        '</tr>';
    }).join('');
    var note = cmp.shopify_error
      ? '<p class="cmp-note">Shopify Admin ordercount niet beschikbaar: ' + esc(cmp.shopify_error) + '</p>'
      : '<p class="cmp-note">Purchase gebruikt Shopify Admin orders als commerciele bron. Andere funnelstappen gebruiken Shopify pixel/webhook ingangssignalen tegenover Meta CAPI lifecycle.</p>';
    if (cmp.cached) note += '<p class="cmp-note">Vergelijking komt uit korte dashboardcache zodat de 1-seconde refresh snel blijft.</p>';
    return '<article class="comparison-panel">' +
      '<div class="comparison-head"><div><h3>Shopify vs Meta Dataverschil</h3><p>Per event: wat Shopify/CAPI binnen ziet versus wat Meta CAPI bevestigd heeft.</p></div><span>' + esc(cmp.date || data.emq.todayDate) + '</span></div>' +
      '<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Event</th><th>Shopify bron</th><th>CAPI browser/server</th><th>Meta gemeten</th><th>Verschil</th><th>Retry</th><th>Diagnose</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      note +
      '</article>';
  }

  if (fragmentsOnly) {
    return {
      timestamp: data.timestamp,
      layoutVersion: data.dashboardLayoutVersion || DASHBOARD_LAYOUT_VERSION,
      critical: criticalCards(),
      comparison: comparisonMarkup(),
      trackingHub: trackingHubMarkup(),
      emqToday: emqTable(data.emq.today, data.emq.todayDate),
      emqYesterday: emqTable(data.emq.yesterday, data.emq.yesterdayDate),
      todayDate: data.emq.todayDate,
      yesterdayDate: data.emq.yesterdayDate
    };
  }

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="calqix-dashboard-layout" content="${esc(data.dashboardLayoutVersion || DASHBOARD_LAYOUT_VERSION)}">
  <link rel="icon" href="data:,">
  <title>CALQIX Tracking Intelligence</title>
  <style>
    :root{--ink:#102033;--ink-2:#23364d;--muted:#65758b;--line:#dbe5ee;--panel:#fff;--navy:#0e1a2a;--navy-2:#15263b;--gold:#c9a84c;--gold-2:#ecd98d;--cyan:#64d8e8;--green:#18b26b;--yellow:#d99a16;--red:#d64747;--blue:#3a7bf7;--shadow:0 22px 60px rgba(20,38,60,.14);--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;background:linear-gradient(180deg,#eef5f8 0%,#f8fafb 46%,#eef4f0 100%);color:var(--ink);font-family:var(--font);line-height:1.5}
    .shell{max-width:1240px;margin:0 auto;padding:26px 18px 42px}
    .hero{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.58);border-radius:28px;background:linear-gradient(135deg,#102033 0%,#132b43 54%,#17344f 100%);box-shadow:var(--shadow);padding:28px 30px;color:#fff}
    .hero:before{content:"";position:absolute;inset:-35% -10% auto 55%;height:260px;background:radial-gradient(circle,rgba(100,216,232,.32),transparent 68%);filter:blur(2px);animation:pulseGlow 6s ease-in-out infinite}
    .hero-top{position:relative;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.logo{font-size:30px;font-weight:900;letter-spacing:2px;color:var(--gold-2)}.logo-sub{font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#b9cbe0;margin-top:3px}
    .hero h1{position:relative;max-width:780px;font-size:42px;line-height:1.03;letter-spacing:0;margin:38px 0 12px}.hero-copy{position:relative;max-width:780px;color:#c9d9e8;font-size:15px}.hero-actions{position:relative;display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
    .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;border:1px solid rgba(255,255,255,.22);padding:10px 16px;color:#fff;text-decoration:none;font-weight:800;font-size:13px;background:rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.16);transition:transform .22s ease,box-shadow .22s ease,background .22s ease}.button.primary{background:linear-gradient(135deg,var(--gold-2),var(--gold));color:#101b2a;border-color:transparent}.button:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(0,0,0,.18);background:rgba(255,255,255,.13)}.button.primary:hover{box-shadow:0 16px 36px rgba(201,168,76,.28)}
    .status-cluster{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.status-chip{border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:8px 12px;background:rgba(255,255,255,.07);font-size:12px;color:#d8e6f5;backdrop-filter:blur(12px)}
    .section{margin-top:26px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.section-title h2{font-size:18px;letter-spacing:.2px}.section-title span{font-size:12px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
    .card,.analysis-card,.emq-section,.funnel-step,.diff-panel{background:rgba(255,255,255,.82);border:1px solid rgba(205,218,228,.9);border-radius:20px;box-shadow:0 18px 44px rgba(37,55,76,.09);backdrop-filter:blur(18px)}
    .card{grid-column:span 3;padding:20px;min-height:188px;transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}.card:hover,.analysis-card:hover,.funnel-step:hover,.diff-panel:hover{transform:translateY(-3px);border-color:rgba(201,168,76,.72);box-shadow:0 24px 60px rgba(37,55,76,.14)}
    .card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}.card-title{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1.3px;color:var(--muted)}.platform-icon{font-size:24px;font-weight:800;color:var(--blue)}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.9px;text-transform:uppercase}.badge:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.badge-live{background:rgba(24,178,107,.11);color:var(--green);border:1px solid rgba(24,178,107,.25)}.badge-ready{background:rgba(217,154,22,.12);color:var(--yellow);border:1px solid rgba(217,154,22,.25)}.badge-off{background:rgba(214,71,71,.1);color:var(--red);border:1px solid rgba(214,71,71,.22)}
    .detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-top:14px}.detail-item{min-width:0;font-size:12px}.detail-label{display:block;color:var(--muted)}.detail-val{display:block;font-weight:800;color:var(--ink-2);word-break:break-word}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px}.dot-green{background:var(--green)}.dot-red{background:var(--red)}
    .analysis-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.analysis-card{padding:18px;transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}.analysis-top{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:900}.priority-pill{border-radius:999px;padding:4px 8px;background:var(--navy);color:#fff}.priority-P0 .priority-pill{background:var(--red)}.priority-P1 .priority-pill{background:var(--yellow)}.priority-P2 .priority-pill{background:var(--blue)}.priority-OK .priority-pill{background:var(--green)}.analysis-card h3{font-size:16px;line-height:1.2;margin:16px 0 8px;color:var(--ink)}.analysis-card p{font-size:13px;color:var(--ink-2)}.action-line{margin-top:14px;border-top:1px solid var(--line);padding-top:12px;font-size:12px;color:var(--muted);font-weight:700}
    .funnel{display:grid;grid-template-columns:1fr;gap:12px}.funnel-step{display:grid;grid-template-columns:48px 1fr;gap:14px;padding:16px;transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}.step-index{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:var(--gold-2);font-weight:900;box-shadow:0 12px 24px rgba(16,32,51,.18)}.step-body h3{font-size:17px;margin-bottom:6px}.step-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.step-meta span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:#31516d;background:#edf4f8;border:1px solid #dce9f0;border-radius:999px;padding:5px 9px}.step-body p{font-size:12px;color:var(--ink-2);margin-top:5px}.risk{color:#744719!important}
    .diff-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.diff-panel{padding:18px;transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}.diff-panel h3{font-size:15px;margin-bottom:10px}.diff-panel p{font-size:13px;color:var(--ink-2)}
    .trackinghub-panel,.comparison-panel{background:rgba(255,255,255,.88);border:1px solid rgba(205,218,228,.9);border-radius:20px;box-shadow:0 18px 44px rgba(37,55,76,.09);padding:18px}.hub-head,.comparison-head{display:flex;justify-content:space-between;gap:16px;margin-bottom:16px}.hub-head h3,.comparison-head h3{font-size:17px}.hub-head p,.comparison-head p{font-size:13px;color:var(--ink-2);margin-top:4px}.hub-head span,.comparison-head span{align-self:flex-start;border-radius:999px;background:#edf4f8;color:#31516d;font-size:11px;font-weight:900;text-transform:uppercase;padding:6px 10px}.hub-grid{display:grid;grid-template-columns:1fr 1fr .7fr;gap:16px}.hub-grid h4{font-size:12px;text-transform:uppercase;letter-spacing:.9px;color:var(--muted);margin-bottom:8px}.hub-grid ul{list-style:none;display:grid;gap:8px}.hub-grid li{border-top:1px solid var(--line);padding-top:8px}.hub-grid strong{display:block;font-size:13px}.hub-grid span,.hub-grid p{font-size:12px;color:var(--ink-2)}.comparison-scroll{overflow-x:auto}.comparison-table{width:100%;min-width:1060px;border-collapse:collapse;font-size:12px}.comparison-table th{text-align:left;padding:11px 10px;background:#edf4f8;color:#58708a;font-weight:900;font-size:10px;text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid #dce8f0}.comparison-table td{padding:12px 10px;border-bottom:1px solid #edf1f4;vertical-align:top}.comparison-table td span{display:block;color:var(--muted);font-size:10px;margin-top:3px}.cmp-advice{min-width:280px;color:var(--ink-2)}.cmp-match td:nth-child(5){color:var(--green);font-weight:900}.cmp-shopify_hoger td:nth-child(5){color:var(--yellow);font-weight:900}.cmp-meta_hoger td:nth-child(5){color:var(--red);font-weight:900}.cmp-note{font-size:12px;color:var(--muted);margin-top:12px}
    .emq-section{padding:18px;overflow:hidden}.tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}.tab{border:1px solid #d8e5ef;border-radius:999px;background:#f7fafc;color:var(--ink-2);padding:9px 14px;font-size:12px;font-weight:900;cursor:pointer;transition:all .22s ease}.tab:hover{transform:translateY(-1px);border-color:var(--gold);box-shadow:0 10px 22px rgba(37,55,76,.1)}.tab.active{background:linear-gradient(135deg,var(--gold-2),var(--gold));color:#112033;border-color:transparent}.tab-content{display:none;overflow-x:auto}.tab-content.active{display:block}.emq-table{width:100%;border-collapse:collapse;font-size:12px;min-width:1500px}.emq-table th{text-align:left;padding:11px 10px;background:#edf4f8;color:#58708a;font-weight:900;font-size:10px;text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid #dce8f0}.emq-table td{padding:11px 10px;border-bottom:1px solid #edf1f4;vertical-align:top}.emq-table tr:hover{background:#f7fafc}.ev-name{font-weight:900;position:sticky;left:0;background:inherit}.ev-total{color:#9a7520;font-weight:900}.emq-action{min-width:260px;color:var(--ink-2);font-size:11px;line-height:1.35}.emq-high{color:var(--green);font-weight:900}.emq-mid{color:var(--yellow);font-weight:900}.emq-low{color:var(--red);font-weight:900}.emq-zero{color:#b8c4cf}.emq-empty{color:var(--muted);font-size:13px;padding:12px 0}.emq-legend{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}.emq-legend span{border:1px solid #dce8f0;border-radius:12px;background:#f8fbfd;padding:8px 10px;color:var(--muted);font-size:11px}.emq-legend strong{color:var(--ink);margin-right:4px}
    .quick-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.quick-card{padding:16px;text-decoration:none;color:inherit}.quick-card strong{display:block;color:#9a7520;margin-bottom:4px}.quick-card span{font-size:12px;color:var(--muted)}.footer{text-align:center;padding:26px 12px;color:var(--muted);font-size:11px}
    @keyframes pulseGlow{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}@media(max-width:980px){.card{grid-column:span 6}.analysis-grid,.diff-grid,.hub-grid{grid-template-columns:1fr 1fr}.emq-legend{grid-template-columns:1fr 1fr}.hero h1{font-size:34px}}@media(max-width:640px){.shell{padding:12px}.hero{border-radius:22px;padding:22px}.hero-top{display:block}.status-cluster{justify-content:flex-start;margin-top:16px}.hero h1{font-size:29px}.card{grid-column:span 12}.analysis-grid,.diff-grid,.quick-grid,.hub-grid,.emq-legend{grid-template-columns:1fr}.hub-head{display:block}.detail-grid{grid-template-columns:1fr}.funnel-step{grid-template-columns:1fr}.step-index{width:36px;height:36px}}
  </style>
</head>
<body data-dashboard-layout="${esc(data.dashboardLayoutVersion || DASHBOARD_LAYOUT_VERSION)}">
  <main class="shell">
    <section class="hero">
      <div class="hero-top">
        <div><div class="logo">CALQIX</div><div class="logo-sub">Tracking Intelligence Dashboard</div></div>
        <div class="status-cluster"><span class="status-chip">Shopify source of truth</span><span class="status-chip">Meta CAPI + Web Pixel</span><span class="status-chip">Server recovery radar</span></div>
      </div>
      <h1>GPT-5.5 analyse voor Shopify, Meta en server-side tracking.</h1>
      <p class="hero-copy">Dit overzicht laat zien welke funnel-stappen worden gemeten, welke data per stap naar Meta gaat, en waarom Shopify orderdata niet 1-op-1 gelijk hoeft te zijn aan Meta attributed purchases.</p>
      <div class="hero-actions"><a class="button primary" href="#critical">Bekijk kritieke punten</a><a class="button" href="#funnel">Open funnel</a><a class="button" href="#emq">Bekijk EMQ</a></div>
    </section>

    <section class="section">
      <div class="section-title"><h2>Platform Connections</h2><span>Live configuratie, zonder secrets te tonen</span></div>
      <div class="grid">
        <div class="card"><div class="card-header"><span class="card-title">Meta CAPI</span><span class="platform-icon">Meta</span></div>${badge(m.connected, m.enabled)}<div class="detail-grid"><div class="detail-item"><span class="detail-label">Pixel ID</span><span class="detail-val">${esc(m.pixelId || '-')}</span></div><div class="detail-item"><span class="detail-label">Access Token</span><span class="detail-val">${m.hasAccessToken ? '<span class="dot dot-green"></span>Set' : '<span class="dot dot-red"></span>Missing'}</span></div><div class="detail-item"><span class="detail-label">CAPI Enabled</span><span class="detail-val">${m.enabled ? 'Yes' : 'No'}</span></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Google Analytics 4</span><span class="platform-icon" style="color:var(--gold)">GA4</span></div>${badge(g.connected, g.enabled)}<div class="detail-grid"><div class="detail-item"><span class="detail-label">Measurement ID</span><span class="detail-val">${esc(g.measurementId || '-')}</span></div><div class="detail-item"><span class="detail-label">API Secret</span><span class="detail-val">${g.connected ? '<span class="dot dot-green"></span>Set' : '<span class="dot dot-red"></span>Missing'}</span></div><div class="detail-item"><span class="detail-label">Property</span><span class="detail-val">${esc(g.propertyId || '-')}</span></div><div class="detail-item"><span class="detail-label">Stream</span><span class="detail-val">${esc(g.streamId || '-')}</span></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Google Ads OCI</span><span class="platform-icon">Ads</span></div>${badge(ga.connected, ga.enabled)}<div class="detail-grid"><div class="detail-item"><span class="detail-label">Customer ID</span><span class="detail-val">${esc(ga.customerId || '-')}</span></div><div class="detail-item"><span class="detail-label">Conversion</span><span class="detail-val">${esc(ga.conversionAction || '-')}</span></div><div class="detail-item"><span class="detail-label">OAuth Token</span><span class="detail-val">${ga.hasOAuth ? '<span class="dot dot-green"></span>Active' : '<span class="dot dot-red"></span>Missing'}</span></div><div class="detail-item"><span class="detail-label">Manager ID</span><span class="detail-val">${esc(ga.managerId || '-')}</span></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">TikTok Events</span><span class="platform-icon" style="color:#ff2f71">TT</span></div>${badge(tt.connected, tt.enabled)}<div class="detail-grid"><div class="detail-item"><span class="detail-label">Pixel ID</span><span class="detail-val">${esc(tt.pixelId || '-')}</span></div><div class="detail-item"><span class="detail-label">Enabled</span><span class="detail-val">${tt.enabled ? 'Yes' : 'No'}</span></div></div></div>
      </div>
    </section>

    <section class="section" id="critical"><div class="section-title"><h2>Kritieke Tracking Punten</h2><span>Wat moet worden verricht en hoe</span></div><div class="analysis-grid" id="critical-grid">${criticalCards()}</div></section>
    <section class="section" id="funnel"><div class="section-title"><h2>Funnel Die Het Dashboard Volgt</h2><span>Shopify events, Meta CAPI, web pixel en server fallback</span></div><div class="funnel">${funnelMarkup()}</div></section>

    <section class="section"><div class="section-title"><h2>Waarom Shopify en Meta Verschillen</h2><span>Diagnosekaart voor afwijkingen</span></div><div class="diff-grid"><article class="diff-panel"><h3>Shopify meet commerciele waarheid</h3><p>Shopify telt alle orders en checkout acties in het commerce systeem. Meta telt alleen events die ontvangen, gededupliceerd, gematcht en eventueel aan advertenties toegewezen worden.</p></article><article class="diff-panel"><h3>Meta dedupe en attributie filteren</h3><p>Browser pixel en CAPI gebruiken dezelfde event_id voor IC en Purchase. Als een browser event ontbreekt maar server CAPI wel komt, telt Meta mogelijk nog steeds, maar met lagere match quality.</p></article><article class="diff-panel"><h3>Niet goed opgemeten signalen</h3><p>Lage email, phone, fbp of fbc coverage betekent niet altijd geen event, maar wel minder herkenning. Express checkout, Safari, adblockers, consent en subscription renewals zijn de grootste verschilmakers.</p></article></div></section>
    <section class="section"><div class="section-title"><h2>Shopify vs Meta Data</h2><span>Verschil tussen brondata, CAPI ontvangst en Meta bevestiging</span></div><div id="comparison-wrap">${comparisonMarkup()}</div></section>

    <section class="section"><div class="section-title"><h2>Trackinghub Ad Performance</h2><span>15-minuten analyse voor spend, scaling en creative refresh</span></div><div id="trackinghub-wrap">${trackingHubMarkup()}</div></section>

    <section class="section" id="emq"><div class="section-title"><h2>Event Match Quality</h2><span>Velden die Meta gebruikt om events aan mensen en clicks te koppelen</span></div><div class="emq-section"><div class="tabs"><button class="tab active" id="tab-btn-today" type="button" onclick="switchTab('today', this)">Vandaag (${esc(data.emq.todayDate)})</button><button class="tab" id="tab-btn-yesterday" type="button" onclick="switchTab('yesterday', this)">Gisteren (${esc(data.emq.yesterdayDate)})</button></div><div id="tab-today" class="tab-content active">${emqTable(data.emq.today, data.emq.todayDate)}</div><div id="tab-yesterday" class="tab-content">${emqTable(data.emq.yesterday, data.emq.yesterdayDate)}</div></div></section>

    <section class="section"><div class="section-title"><h2>Quick Links</h2><span>Onderhoud en health checks</span></div><div class="quick-grid"><a href="/api/google/oauth/health" class="card quick-card ql"><strong>Google OAuth Health</strong><span>Check OAuth token status</span></a><a href="/api/google/oauth/start" class="card quick-card ql"><strong>Google OAuth Start</strong><span>Start OAuth consent flow</span></a></div></section>
    <div class="footer" id="dashboard-footer">CALQIX Conversions API - ${esc(data.timestamp)}</div>
  </main>
  <script>
    function switchTab(t, btn){
      document.querySelectorAll(".tab").forEach(function(el){el.classList.remove("active")});
      document.querySelectorAll(".tab-content").forEach(function(el){el.classList.remove("active")});
      if(btn) btn.classList.add("active");
      document.getElementById("tab-"+t).classList.add("active");
      try{sessionStorage.setItem("calqixDashTab",t)}catch(e){}
    }
    (function(){
      var s=new URLSearchParams(location.search).get("secret");
      if(s){document.querySelectorAll("a.ql").forEach(function(a){a.href+=a.href.indexOf("?")>-1?"&":"?";a.href+="secret="+encodeURIComponent(s)})}
      try{
        var active=sessionStorage.getItem("calqixDashTab");
        if(active&&document.getElementById("tab-"+active)){
          var btn=[].slice.call(document.querySelectorAll(".tab")).find(function(el){return el.getAttribute("onclick").indexOf("'" + active + "'")>-1});
          switchTab(active,btn);
        }
      }catch(e){}
      var busy=false;
      function setHtml(id, html){
        var el=document.getElementById(id);
        if(el&&typeof html==="string"&&el.innerHTML!==html) el.innerHTML=html;
      }
      function refreshNumbers(){
        if(document.hidden||busy) return;
        busy=true;
        var u=new URL(location.href);
        u.searchParams.set("format","json");
        u.searchParams.set("_",String(Date.now()));
        fetch(u.toString(),{cache:"no-store",headers:{"Accept":"application/json"}})
          .then(function(r){return r.ok?r.json():null})
          .then(function(d){
            if(!d) return;
            setHtml("critical-grid",d.critical);
            setHtml("comparison-wrap",d.comparison);
            setHtml("trackinghub-wrap",d.trackingHub);
            setHtml("tab-today",d.emqToday);
            setHtml("tab-yesterday",d.emqYesterday);
            var today=document.getElementById("tab-btn-today");
            var yesterday=document.getElementById("tab-btn-yesterday");
            if(today&&d.todayDate) today.textContent="Vandaag ("+d.todayDate+")";
            if(yesterday&&d.yesterdayDate) yesterday.textContent="Gisteren ("+d.yesterdayDate+")";
            var footer=document.getElementById("dashboard-footer");
            if(footer&&d.timestamp) footer.textContent="CALQIX Conversions API - "+d.timestamp;
          })
          .catch(function(){})
          .finally(function(){busy=false});
      }
      setInterval(function(){
        refreshNumbers();
      },1000);
    })();
  </script>
</body>
</html>`;
}
