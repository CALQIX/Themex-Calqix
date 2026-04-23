/**
 * Daily Digest Cron — 08:00 Amsterdam
 *
 * ONE Telegram message per day that rolls up everything the operator needs
 * to know. Individual P1 alerts are buffered (see lib/alert-dedup.js digest
 * mode) and flushed here; P0 still fires immediately through its own path.
 *
 * Sections (kept short; section is skipped when empty):
 *   1. Overnight alerts          — flushed P1 buffer + yesterday P2 summary
 *   2. System health             — bridge capture, bridge version check, EMQ
 *   3. Events                    — 24h counts, dedup, webhook audit
 *   4. Ads radar                 — fatigue predictor + yesterday close state
 *   5. Growth loops              — lookalike feeder, catalog sync, resubmit
 *
 * Auth: CRON_SECRET bearer / ?secret=. Always returns HTTP 200.
 * Lock: cron:lock:daily-digest (30 min). Can be re-triggered manually without
 * double-posting because the P1 buffer is drained atomically.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var alertDedup = require('../../lib/alert-dedup');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:daily-digest';
var LOCK_TTL = 30 * 60;
var MAX_MESSAGE_CHARS = 4000;

function humanInt(n) {
  if (n == null) return '–';
  return String(Math.round(Number(n)));
}

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function yesterdayKey() {
  var d = new Date(Date.now() - 24 * 3600 * 1000);
  return dates.todayKey(d);
}

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Section builders --------------------------------------------------

async function buildAlertSection() {
  var buffered = await alertDedup.flushDigestQueue();
  var yesterday = yesterdayKey();
  var historyKey = 'alert:history:' + yesterday;
  var p2History = [];
  try {
    var raw = await store.get(historyKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) p2History = parsed.filter(function (a) { return a.priority === 'P2'; });
    }
  } catch (e) { p2History = []; }

  if (buffered.length === 0 && p2History.length === 0) return null;

  // Group buffered P1 by cron+issue for compactness.
  var groups = {};
  for (var i = 0; i < buffered.length; i++) {
    var b = buffered[i];
    var key = b.cron + '::' + b.issue;
    if (!groups[key]) groups[key] = { cron: b.cron, issue: b.issue, platform: b.platform, count: 0, last: b.timestamp };
    groups[key].count++;
    if (new Date(b.timestamp) > new Date(groups[key].last)) groups[key].last = b.timestamp;
  }
  var p1Rollup = Object.keys(groups).map(function (k) { return groups[k]; })
    .sort(function (a, b) { return b.count - a.count; });

  // Group P2 by cron for the daily bundle.
  var p2Groups = {};
  for (var j = 0; j < p2History.length; j++) {
    var e2 = p2History[j];
    var k2 = e2.cron;
    p2Groups[k2] = (p2Groups[k2] || 0) + 1;
  }
  var p2Summary = Object.keys(p2Groups)
    .map(function (k) { return { cron: k, count: p2Groups[k] }; })
    .sort(function (a, b) { return b.count - a.count; });

  var lines = ['<b>🚨 Overnight alerts</b>'];
  if (p1Rollup.length > 0) {
    lines.push('P1 buffered: ' + buffered.length + ' (' + p1Rollup.length + ' unique)');
    for (var p = 0; p < Math.min(6, p1Rollup.length); p++) {
      var g = p1Rollup[p];
      lines.push('• ' + g.cron + ' · ' + g.issue + ' ×' + g.count);
    }
    if (p1Rollup.length > 6) lines.push('  …and ' + (p1Rollup.length - 6) + ' more');
  } else {
    lines.push('P1 buffered: 0');
  }
  if (p2Summary.length > 0) {
    var p2Total = p2History.length;
    var top = p2Summary.slice(0, 3).map(function (x) { return x.cron + '×' + x.count; }).join(', ');
    lines.push('P2 yesterday: ' + p2Total + ' (' + top + (p2Summary.length > 3 ? ', …' : '') + ')');
  }
  return lines.join('\n');
}

async function buildSystemHealthSection() {
  var lines = ['<b>🧪 System health</b>'];
  var anyContent = false;

  // Bridge capture (latest hour bridge:health:*)
  try {
    var nowHour = new Date().toISOString().slice(0, 13);
    var prevHour = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 13);
    var hCur = await getJSON('bridge:health:' + nowHour);
    var hPrev = await getJSON('bridge:health:' + prevHour);
    var h = hCur || hPrev;
    if (h) {
      anyContent = true;
      lines.push('Bridge: ' + titleCase(h.status) + ' · cur=' + humanInt(h.current) + ' vs baseline=' + humanInt(h.baseline) +
        ' (Δ' + humanInt(h.dropPct) + '%)');
    }
  } catch (e) { /* skip */ }

  // Bridge version health
  try {
    var bvh = await getJSON('bridge:version_health:latest');
    if (bvh && bvh.latest) {
      anyContent = true;
      var stuck = bvh.stuck && bvh.stuck.length ? bvh.stuck.length : 0;
      var latestVer = bvh.latest.version;
      var age = bvh.latest.ageHours != null ? bvh.latest.ageHours + 'h' : '?';
      lines.push('Bridge version: ' + latestVer + ' (live ' + age + ')' +
        (stuck > 0 ? ' · ⚠️ ' + stuck + ' stuck cache' : ' · clean'));
    }
  } catch (e) { /* skip */ }

  // EMQ summary (last full-day or most recent)
  try {
    var diagKey = 'diag:summary:' + yesterdayKey();
    var emq = await getJSON(diagKey);
    if (!emq) emq = await getJSON('diag:summary:' + dates.todayKey());
    if (emq && emq.estimatedEMQ != null) {
      anyContent = true;
      lines.push('EMQ: ' + (Math.round(emq.estimatedEMQ * 10) / 10) +
        ' · em=' + humanInt((emq.coverage && emq.coverage.em) || 0) + '%' +
        ' · fbp=' + humanInt((emq.coverage && emq.coverage.fbp) || 0) + '%' +
        ' · ext=' + humanInt((emq.coverage && emq.coverage.external_id) || 0) + '%');
    }
  } catch (e) { /* skip */ }

  // Catalog match
  try {
    var catalog = await getJSON('catalog:sync:latest');
    if (catalog) {
      anyContent = true;
      var rate = catalog.match_rate != null
        ? humanInt(catalog.match_rate * (catalog.match_rate <= 1 ? 100 : 1))
        : '?';
      lines.push('Catalog: ' + (catalog.matched || '?') + '/' + (catalog.shopify_variants || '?') +
        ' matched (' + rate + '%)');
    }
  } catch (e) { /* skip */ }

  if (!anyContent) return null;
  return lines.join('\n');
}

async function buildEventsSection() {
  var lines = ['<b>📡 Events (24h)</b>'];
  var any = false;

  try {
    var today = dates.todayKey();
    var yesterday = yesterdayKey();
    var summaryKey = 'capi:counts:' + yesterday;
    var counts = await getJSON(summaryKey);
    if (!counts) counts = await getJSON('capi:counts:' + today);
    if (counts) {
      any = true;
      var parts = [];
      Object.keys(counts).slice(0, 5).forEach(function (k) {
        if (k.startsWith('_')) return;
        parts.push(k + '=' + humanInt(counts[k]));
      });
      if (parts.length) lines.push('Counts: ' + parts.join(' · '));
    }
  } catch (e) { /* skip */ }

  // Identity resubmit — scan latest run key by walking recent timestamp prefixes.
  try {
    var redis = store._getRedis();
    if (redis) {
      var cursor = '0';
      var recent = null;
      do {
        var res = await redis.scan(cursor, { match: 'backfill:resubmit:run:*', count: 50 });
        cursor = String(res[0]);
        var keys = res[1] || [];
        for (var i = 0; i < keys.length; i++) {
          var data = await getJSON(keys[i]);
          if (!data) continue;
          var t = new Date(data.timestamp || 0).getTime();
          if (!recent || t > new Date(recent.timestamp || 0).getTime()) recent = data;
        }
      } while (cursor !== '0');
      if (recent) {
        any = true;
        lines.push('Resubmit (latest run): scanned=' + (recent.scanned || 0) +
          ' · resubmitted=' + (recent.resubmitted || 0) +
          ' · failures=' + (recent.meta_failures || 0));
      }
    }
  } catch (e) { /* skip */ }

  if (!any) return null;
  return lines.join('\n');
}

async function buildAdsRadarSection() {
  var lines = ['<b>🎯 Ads radar</b>'];
  var any = false;

  try {
    var fp = await getJSON('fatigue_predictor:latest');
    if (fp && fp.totals) {
      any = true;
      var t = fp.totals;
      lines.push('Fatigue: at-risk=' + (t.atRisk || 0) + ' · fatigued=' + (t.alreadyFatigued || 0) +
        ' · forecasted=' + (t.forecasted || 0) + '/' + (t.scanned || 0));
      if (t.trends) {
        lines.push('Trends: sharp=' + (t.trends.sharp_decline || 0) +
          ' dec=' + (t.trends.declining || 0) +
          ' stable=' + (t.trends.stable || 0) +
          ' grow=' + (t.trends.growing || 0));
      }
      var sample = (fp.atRiskSample || []).slice(0, 3);
      if (sample.length > 0) {
        lines.push('Top at-risk:');
        for (var i = 0; i < sample.length; i++) {
          var s = sample[i];
          var name = (s.adName || s.adId || '').substring(0, 34);
          var prob = s.fatigueProbability != null ? Math.round(s.fatigueProbability * 100) + '%' : '–';
          lines.push('• ' + name + ' P=' + prob + ' · ' + (s.trend || '?'));
        }
      }
    }
  } catch (e) { /* skip */ }

  // Yesterday's ad optimization state
  try {
    var yKey = 'ad_optimization_state:' + yesterdayKey();
    var optState = await getJSON(yKey);
    if (optState) {
      any = true;
      lines.push('Yesterday ops: mode=' + (optState.mode || '?') +
        ' · exec=' + (optState.executed || 0) +
        ' · queued=' + (optState.queued || 0) +
        ' · proposals=' + (optState.proposals || 0));
    }
  } catch (e) { /* skip */ }

  if (!any) return null;
  return lines.join('\n');
}

async function buildGrowthLoopsSection() {
  var lines = ['<b>🌱 Growth loops</b>'];
  var any = false;

  try {
    var lal = await getJSON('lookalike:feeder:last_success');
    if (lal) {
      any = true;
      lines.push('Lookalike: rows=' + (lal.rows_sent || 0) +
        ' · received=' + (lal.num_received || '?') +
        ' · invalid=' + (lal.num_invalid_entries || 0));
    }
  } catch (e) { /* skip */ }

  if (!any) return null;
  return lines.join('\n');
}

function combineSections(sections) {
  var header = '📋 <b>CALQIX Daily Digest</b> · ' + dates.formatDateTimeAmsterdam();
  var out = [header, ''];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i]) {
      out.push(sections[i]);
      out.push('');
    }
  }
  var full = out.join('\n').trim();
  if (full.length > MAX_MESSAGE_CHARS) {
    full = full.substring(0, MAX_MESSAGE_CHARS - 20) + '\n… (truncated)';
  }
  return full;
}

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var existingLock = await store.get(LOCK_KEY);
    if (existingLock) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }
    await store.set(LOCK_KEY, '1', LOCK_TTL);

    try {
      var alertSection = await buildAlertSection();
      var systemSection = await buildSystemHealthSection();
      var eventsSection = await buildEventsSection();
      var adsSection = await buildAdsRadarSection();
      var growthSection = await buildGrowthLoopsSection();

      var anySections = !!(alertSection || systemSection || eventsSection || adsSection || growthSection);

      // Always send — even on a quiet day the operator gets a "✅ all clear"
      // ping, which is the single best signal that the digest pipeline itself
      // is healthy.
      var body;
      if (anySections) {
        body = combineSections([alertSection, systemSection, eventsSection, adsSection, growthSection]);
      } else {
        body = '📋 <b>CALQIX Daily Digest</b> · ' + dates.formatDateTimeAmsterdam() +
          '\n\n✅ Stille nacht — geen alerts, geen health issues, geen at-risk ads.';
      }

      // Honour dry_run for probes.
      var dryRun = !!(req.query && req.query.dry_run);
      var tg = { sent: false, reason: dryRun ? 'dry_run' : null };
      if (!dryRun) {
        tg = await sendTelegram(body);
      }

      // Persist last digest for audit + dashboard.
      await store.set('daily_digest:latest', JSON.stringify({
        timestamp: new Date().toISOString(),
        timestampLocal: dates.formatDateTimeAmsterdam(),
        sections: {
          alerts: !!alertSection,
          system: !!systemSection,
          events: !!eventsSection,
          ads: !!adsSection,
          growth: !!growthSection
        },
        length: body.length,
        telegramSent: !!(tg && tg.sent)
      }), 30 * 86400);

      return res.status(200).json({
        ok: true,
        sections: {
          alerts: !!alertSection,
          system: !!systemSection,
          events: !!eventsSection,
          ads: !!adsSection,
          growth: !!growthSection
        },
        message_length: body.length,
        telegram_sent: !!(tg && tg.sent),
        dry_run: dryRun,
        preview: dryRun ? body : undefined
      });
    } finally {
      await store.del(LOCK_KEY);
    }
  } catch (err) {
    console.error('[DailyDigest] Error:', err && err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err && err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
