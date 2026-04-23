/**
 * Bridge Version Check Cron — every 30 min
 *
 * Detects stuck theme caches. Every hit from the browser bridge (see
 * assets/calqix-meta-bridge.js) carries a `bridge_version` field that the
 * CAPI endpoints push through lib/bridge-version-tracker. Here we read the
 * rolling version distribution and flag the situation where an *older*
 * bridge version keeps reporting in after a newer version has gone live.
 *
 * Stuck-cache heuristic:
 *   - Canonical `latest` version = the one with the most recent `first_seen`.
 *   - For every other version seen in the last 30 min, compute its share.
 *   - If share ≥ STUCK_SHARE_THRESHOLD (15%) AND the latest version has been
 *     live for ≥ STUCK_MIN_HOURS (2h), we treat it as a stuck cache.
 *   - P1 Telegram alert (dedup-gated at 4h) with the exact versions and
 *     remediation tips (shopify theme publish / cache purge / hard refresh).
 *
 * Also persists a snapshot at `bridge:version_health:latest` (14d) so the
 * daily digest and dashboard can surface it without rerunning the scan.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var bridgeVersionTracker = require('../../lib/bridge-version-tracker');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

var LOCK_KEY = 'cron:lock:bridge-version-check';
var LOCK_TTL = 10 * 60;
var SNAPSHOT_TTL = 14 * 86400;
var RECENT_WINDOW_HOURS = 1;
var HISTORY_WINDOW_HOURS = 6;
var STUCK_SHARE_THRESHOLD_PCT = 15;
var STUCK_MIN_HOURS = 2;
var MIN_RECENT_EVENTS = 20;   // below this, stats are too noisy to alert on

function truncate(str, n) {
  if (!str) return '';
  var s = String(str);
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

function buildStuckAlert(latest, stuck, stats) {
  var lines = [];
  lines.push('Bridge Version Check');
  lines.push('');
  lines.push('Latest:  ' + latest.version + '  (live ' + latest.ageHours + 'h)');
  lines.push('Events last ' + RECENT_WINDOW_HOURS + 'h: ' + stats.recentTotal);
  lines.push('');
  lines.push('Stuck cache (older versions still reporting):');
  for (var i = 0; i < stuck.length; i++) {
    var s = stuck[i];
    lines.push('• ' + truncate(s.version, 20) +
      '  share=' + Math.round(s.sharePct) + '%' +
      '  (' + s.count + ' events)' +
      (s.ageHours != null ? '  age=' + s.ageHours + 'h' : '')
    );
  }
  lines.push('');
  lines.push('Actions:');
  lines.push('1. Re-publish theme in Shopify admin (forces CDN purge).');
  lines.push('2. Bump asset_url cache-busting (commit whitespace-only).');
  lines.push('3. Ask visitors to hard-refresh (Ctrl/Cmd+Shift+R).');
  lines.push('Tijdstip: ' + dates.formatDateTimeAmsterdam());
  return lines.join('\n');
}

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var redis = store._getRedis();
    if (!redis) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Redis niet beschikbaar' });
    }

    var existingLock = await store.get(LOCK_KEY);
    if (existingLock) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }
    await store.set(LOCK_KEY, '1', LOCK_TTL);

    try {
      // Recent (alerting window) and history (for dashboards).
      var recentStats = await bridgeVersionTracker.getVersionStats(RECENT_WINDOW_HOURS);
      var historyStats = await bridgeVersionTracker.getVersionStats(HISTORY_WINDOW_HOURS);

      var versions = recentStats.versions;
      var summary = {
        scanned: versions.length,
        recentTotal: recentStats.totalEvents,
        historyTotal: historyStats.totalEvents,
        latest: null,
        stuck: [],
        status: 'ok',
        timestamp: new Date().toISOString(),
        timestampLocal: dates.formatDateTimeAmsterdam()
      };

      // Attach ageHours helper fields from historyStats as fallback (some
      // versions may have first_seen but zero recent hits).
      var historyMap = {};
      for (var h = 0; h < historyStats.versions.length; h++) {
        historyMap[historyStats.versions[h].version] = historyStats.versions[h];
      }

      // Identify canonical latest: the version with the most recent first_seen
      // across the *known* list (uses historyStats since it covers the same
      // known set as recentStats — the known list is the union).
      var latest = null;
      for (var i = 0; i < historyStats.versions.length; i++) {
        var v = historyStats.versions[i];
        if (!v.firstSeen) continue;
        if (!latest || new Date(v.firstSeen).getTime() > new Date(latest.firstSeen).getTime()) {
          latest = v;
        }
      }
      if (latest) summary.latest = latest;

      // Detect stuck cache only when (a) there's enough recent traffic,
      // (b) we have a latest version, and (c) it's been live long enough.
      if (
        latest &&
        latest.ageHours != null &&
        latest.ageHours >= STUCK_MIN_HOURS &&
        recentStats.totalEvents >= MIN_RECENT_EVENTS
      ) {
        for (var j = 0; j < versions.length; j++) {
          var cand = versions[j];
          if (cand.version === latest.version) continue;
          if (cand.count === 0) continue;
          if (cand.sharePct < STUCK_SHARE_THRESHOLD_PCT) continue;
          summary.stuck.push({
            version: cand.version,
            count: cand.count,
            sharePct: Math.round(cand.sharePct * 10) / 10,
            ageHours: cand.ageHours
          });
        }
      }

      if (summary.stuck.length > 0) summary.status = 'stuck_cache';

      // Persist snapshot for dashboard + daily digest.
      await store.set('bridge:version_health:latest',
        JSON.stringify(Object.assign({}, summary, { history: historyStats.versions })),
        SNAPSHOT_TTL
      );

      // Alert.
      var telegramSent = false;
      if (summary.stuck.length > 0) {
        var issueId = 'stuck_' + summary.stuck.map(function (s) { return s.version; }).sort().join('_');
        var decision = await alertDedup.shouldAlert(
          'bridge-version-check',
          'system',
          'bridge_version',
          issueId,
          'P1'
        );
        if (decision.send) {
          var body = alertDedup.formatAlertPrefix('P1', decision.suppressed) +
            ' ' + buildStuckAlert(latest, summary.stuck, summary);
          var tg = await sendTelegram(body);
          telegramSent = !!(tg && tg.sent);
        }
      }

      return res.status(200).json({
        ok: true,
        status: summary.status,
        recent_total: summary.recentTotal,
        history_total: summary.historyTotal,
        latest: summary.latest ? {
          version: summary.latest.version,
          age_hours: summary.latest.ageHours,
          first_seen: summary.latest.firstSeen,
          share_pct: Math.round((summary.latest.sharePct || 0) * 10) / 10
        } : null,
        stuck: summary.stuck,
        telegram_sent: telegramSent,
        timestamp: summary.timestamp
      });
    } finally {
      await store.del(LOCK_KEY);
    }
  } catch (err) {
    console.error('[BridgeVersionCheck] Error:', err && err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err && err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
