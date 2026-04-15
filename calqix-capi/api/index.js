/**
 * CALQIX CAPI Dashboard — root endpoint.
 *
 * Shows all platform connections, EMQ diagnostics, and system health.
 * Protected by CRON_SECRET or DIAGNOSTICS_KEY.
 */
var store = require('../lib/store');
var googleOAuth = require('../lib/google-oauth');
var capiDiag = require('../lib/capi-diagnostics');

module.exports = async function (req, res) {
  // Auth check
  var secret = process.env.CRON_SECRET || '';
  var diagKey = process.env.DIAGNOSTICS_KEY || '';
  var qs = (req.query && req.query.secret) || '';
  var authHeader = req.headers['authorization'] || '';

  if (secret && qs !== secret && authHeader !== 'Bearer ' + secret) {
    if (!diagKey || qs !== diagKey) {
      return res.status(401).json({ error: 'Unauthorized — add ?secret=CRON_SECRET' });
    }
  }

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

    var data = {
      meta: meta,
      ga4: ga4,
      googleAds: gads,
      tiktok: tiktok,
      googleEnabled: google,
      emq: { today: emqToday, yesterday: emqYesterday, todayDate: today, yesterdayDate: yesterday },
      events: eventCounts,
      timestamp: new Date().toISOString()
    };

    // Return HTML dashboard
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderDashboard(data));
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

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
    // Check recent event processing via known patterns
    var keys = ['stats:events:sent', 'stats:events:today'];
    for (var i = 0; i < keys.length; i++) {
      var val = await redis.get(keys[i]);
      if (val) counts[keys[i]] = val;
    }
  } catch (e) {}
  return counts;
}

function renderDashboard(data) {
  var m = data.meta;
  var g = data.ga4;
  var ga = data.googleAds;
  var tt = data.tiktok;

  function badge(connected, enabled) {
    if (connected && enabled) return '<span class="badge badge-live">LIVE</span>';
    if (connected && !enabled) return '<span class="badge badge-ready">READY</span>';
    return '<span class="badge badge-off">NOT CONNECTED</span>';
  }

  function emqTable(emqData, dateLabel) {
    if (!emqData) return '<p class="emq-empty">Geen data voor ' + dateLabel + '</p>';
    var events = Object.keys(emqData);
    if (events.length === 0) return '<p class="emq-empty">Geen events voor ' + dateLabel + '</p>';

    var html = '<table class="emq-table"><thead><tr>' +
      '<th>Event</th><th>Total</th><th>Email</th><th>Phone</th><th>FBP</th><th>FBC</th><th>ExtID</th><th>Name</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var s = emqData[ev];
      var total = s.total || 1;
      html += '<tr>' +
        '<td class="ev-name">' + ev + '</td>' +
        '<td class="ev-total">' + s.total + '</td>' +
        emqCell(s.em, total) +
        emqCell(s.ph, total) +
        emqCell(s.fbp, total) +
        emqCell(s.fbc, total) +
        emqCell(s.external_id, total) +
        emqCell((s.fn || 0) + (s.ln || 0), total * 2) +
        '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function emqCell(count, total) {
    var pct = total > 0 ? Math.round((count / total) * 100) : 0;
    var cls = pct >= 80 ? 'emq-high' : pct >= 40 ? 'emq-mid' : pct > 0 ? 'emq-low' : 'emq-zero';
    return '<td class="' + cls + '">' + pct + '%</td>';
  }

  return '<!DOCTYPE html><html lang="nl"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>CALQIX CAPI Dashboard</title>' +
    '<style>' +
    ':root{--navy:#0F1B2D;--navy-light:#1A2B42;--navy-card:#162236;--gold:#C9A84C;--gold-light:#E0C97A;--white:#F5F5F5;--gray:#8A9AB5;--green:#22C55E;--yellow:#EAB308;--red:#EF4444;--blue:#3B82F6;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:var(--navy);color:var(--white);font-family:var(--font);min-height:100vh}' +
    '.header{background:linear-gradient(135deg,var(--navy-light),var(--navy));border-bottom:2px solid var(--gold);padding:24px 32px;display:flex;align-items:center;gap:16px}' +
    '.logo{font-size:28px;font-weight:800;letter-spacing:2px;color:var(--gold)}' +
    '.logo-sub{font-size:13px;color:var(--gray);letter-spacing:1px;margin-top:2px}' +
    '.container{max-width:1200px;margin:0 auto;padding:24px 16px}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:32px}' +
    '.card{background:var(--navy-card);border:1px solid rgba(201,168,76,0.15);border-radius:12px;padding:20px 24px;transition:border-color .2s}' +
    '.card:hover{border-color:var(--gold)}' +
    '.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}' +
    '.card-title{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--gray)}' +
    '.platform-icon{font-size:24px}' +
    '.card-value{font-size:18px;font-weight:600;margin-bottom:4px}' +
    '.card-detail{font-size:12px;color:var(--gray);margin-top:4px}' +
    '.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px}' +
    '.badge-live{background:rgba(34,197,94,0.15);color:var(--green);border:1px solid rgba(34,197,94,0.3)}' +
    '.badge-ready{background:rgba(234,179,8,0.15);color:var(--yellow);border:1px solid rgba(234,179,8,0.3)}' +
    '.badge-off{background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.2)}' +
    '.section-title{font-size:18px;font-weight:700;color:var(--gold);margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid rgba(201,168,76,0.2);letter-spacing:1px}' +
    '.emq-table{width:100%;border-collapse:collapse;font-size:13px}' +
    '.emq-table th{text-align:left;padding:10px 12px;background:var(--navy-light);color:var(--gray);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid rgba(201,168,76,0.1)}' +
    '.emq-table td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04)}' +
    '.emq-table tr:hover{background:rgba(201,168,76,0.04)}' +
    '.ev-name{font-weight:600;color:var(--white)}' +
    '.ev-total{color:var(--gold);font-weight:700}' +
    '.emq-high{color:var(--green);font-weight:600}' +
    '.emq-mid{color:var(--yellow);font-weight:600}' +
    '.emq-low{color:var(--red);font-weight:600}' +
    '.emq-zero{color:rgba(255,255,255,0.15)}' +
    '.emq-empty{color:var(--gray);font-style:italic;font-size:13px;padding:12px 0}' +
    '.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}' +
    '.detail-item{display:flex;justify-content:space-between;font-size:12px;padding:4px 0}' +
    '.detail-label{color:var(--gray)}' +
    '.detail-val{color:var(--white);font-weight:500}' +
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}' +
    '.dot-green{background:var(--green)}' +
    '.dot-yellow{background:var(--yellow)}' +
    '.dot-red{background:var(--red)}' +
    '.footer{text-align:center;padding:24px;color:var(--gray);font-size:11px;border-top:1px solid rgba(201,168,76,0.1);margin-top:32px}' +
    '.emq-section{background:var(--navy-card);border:1px solid rgba(201,168,76,0.15);border-radius:12px;padding:24px;margin-bottom:24px}' +
    '.emq-section:hover{border-color:var(--gold)}' +
    '.tabs{display:flex;gap:8px;margin-bottom:16px}' +
    '.tab{padding:6px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(201,168,76,0.2);background:transparent;color:var(--gray);transition:all .2s}' +
    '.tab.active{background:var(--gold);color:var(--navy);border-color:var(--gold)}' +
    '.tab-content{display:none}' +
    '.tab-content.active{display:block}' +
    '@media(max-width:640px){.grid{grid-template-columns:1fr}.container{padding:16px 8px}.detail-grid{grid-template-columns:1fr}}' +
    '</style></head><body>' +

    '<div class="header"><div>' +
    '<div class="logo">CALQIX</div>' +
    '<div class="logo-sub">Conversions API Dashboard</div>' +
    '</div></div>' +

    '<div class="container">' +

    // --- Platform Cards ---
    '<div class="section-title">Platform Connections</div>' +
    '<div class="grid">' +

    // Meta
    '<div class="card">' +
    '<div class="card-header"><span class="card-title">Meta CAPI</span><span class="platform-icon">&#xf09a;</span></div>' +
    badge(m.connected, m.enabled) +
    '<div class="detail-grid">' +
    '<div class="detail-item"><span class="detail-label">Pixel ID</span><span class="detail-val">' + (m.pixelId || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Access Token</span><span class="detail-val">' + (m.hasAccessToken ? '<span class="dot dot-green"></span>Set' : '<span class="dot dot-red"></span>Missing') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">CAPI Enabled</span><span class="detail-val">' + (m.enabled ? 'Yes' : 'No') + '</span></div>' +
    '</div></div>' +

    // GA4
    '<div class="card">' +
    '<div class="card-header"><span class="card-title">Google Analytics 4</span><span class="platform-icon" style="color:var(--gold)">GA</span></div>' +
    badge(g.connected, g.enabled) +
    '<div class="detail-grid">' +
    '<div class="detail-item"><span class="detail-label">Measurement ID</span><span class="detail-val">' + (g.measurementId || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">API Secret</span><span class="detail-val">' + (g.connected ? '<span class="dot dot-green"></span>Set' : '<span class="dot dot-red"></span>Missing') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Property</span><span class="detail-val">' + (g.propertyId || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Stream</span><span class="detail-val">' + (g.streamId || '—') + '</span></div>' +
    '</div></div>' +

    // Google Ads
    '<div class="card">' +
    '<div class="card-header"><span class="card-title">Google Ads OCI</span><span class="platform-icon" style="color:var(--blue)">Ads</span></div>' +
    badge(ga.connected, ga.enabled) +
    '<div class="detail-grid">' +
    '<div class="detail-item"><span class="detail-label">Customer ID</span><span class="detail-val">' + (ga.customerId || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Conversion</span><span class="detail-val">' + (ga.conversionAction || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">OAuth Token</span><span class="detail-val">' + (ga.hasOAuth ? '<span class="dot dot-green"></span>Active' : '<span class="dot dot-red"></span>Missing') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Manager ID</span><span class="detail-val">' + (ga.managerId || '—') + '</span></div>' +
    '</div></div>' +

    // TikTok
    '<div class="card">' +
    '<div class="card-header"><span class="card-title">TikTok Events</span><span class="platform-icon" style="color:#FF004F">TT</span></div>' +
    badge(tt.connected, tt.enabled) +
    '<div class="detail-grid">' +
    '<div class="detail-item"><span class="detail-label">Pixel ID</span><span class="detail-val">' + (tt.pixelId || '—') + '</span></div>' +
    '<div class="detail-item"><span class="detail-label">Enabled</span><span class="detail-val">' + (tt.enabled ? 'Yes' : 'No') + '</span></div>' +
    '</div></div>' +

    '</div>' +

    // --- EMQ Section ---
    '<div class="section-title">Event Match Quality (EMQ)</div>' +
    '<div class="emq-section">' +
    '<div class="tabs">' +
    '<div class="tab active" onclick="switchTab(\'today\')">Vandaag (' + data.emq.todayDate + ')</div>' +
    '<div class="tab" onclick="switchTab(\'yesterday\')">Gisteren (' + data.emq.yesterdayDate + ')</div>' +
    '</div>' +
    '<div id="tab-today" class="tab-content active">' + emqTable(data.emq.today, data.emq.todayDate) + '</div>' +
    '<div id="tab-yesterday" class="tab-content">' + emqTable(data.emq.yesterday, data.emq.yesterdayDate) + '</div>' +
    '</div>' +

    // --- Quick Links ---
    '<div class="section-title">Quick Links</div>' +
    '<div class="grid">' +
    '<div class="card"><a href="/api/google/oauth/health?secret=' + qs + '" style="color:var(--gold);text-decoration:none;font-weight:600">Google OAuth Health</a><div class="card-detail">Check OAuth token status</div></div>' +
    '<div class="card"><a href="/api/google/oauth/start?secret=' + qs + '" style="color:var(--gold);text-decoration:none;font-weight:600">Google OAuth Start</a><div class="card-detail">Initiate OAuth consent flow</div></div>' +
    '</div>' +

    '</div>' +

    '<div class="footer">CALQIX Conversions API &middot; ' + data.timestamp + '</div>' +

    '<script>' +
    'function switchTab(t){document.querySelectorAll(".tab").forEach(function(el){el.classList.remove("active")});document.querySelectorAll(".tab-content").forEach(function(el){el.classList.remove("active")});event.target.classList.add("active");document.getElementById("tab-"+t).classList.add("active")}' +
    '</script>' +

    '</body></html>';
}
