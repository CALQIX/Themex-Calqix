/**
 * Creative Fatigue Predictor Cron — 09:15 Amsterdam (daily)
 *
 * Reads the fatigue tracker's rolling 7-day CTR history (ad_fatigue:*) and
 * fits a Bayesian decay model per ad to predict when CTR will fall ≥30%
 * from peak. Results are persisted so the operator — and, in a future pass,
 * the rules engine — can rotate creatives *before* performance collapses.
 *
 * Runs after the ad-morning chain (09:00) so it picks up the freshest
 * fatigue records written by ad-performance-sync inside that chain.
 *
 * Redis keys:
 *   ad_fatigue_forecast:{ad_id}      → JSON  TTL 14d  — per-ad prediction
 *   fatigue_predictor:run:{iso_ts}   → JSON  TTL 14d  — run snapshot
 *   fatigue_predictor:latest         → JSON  TTL 14d  — last summary (dashboard)
 *
 * Telegram:
 *   Fires a P1 alert (dedup-gated via lib/alert-dedup) when ≥2 ads
 *   cross AT_RISK_PROBABILITY but are not yet reactively fatigued.
 *   Kill switch: FATIGUE_PREDICTOR_ALERT_ENABLED (default true).
 *
 * Safety:
 *   - 10-min Redis lock prevents overlapping invocations
 *   - Auth via CRON_SECRET bearer / ?secret= query param
 *   - Always returns HTTP 200 (observability cron — never fail the schedule)
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var predictor = require('../../lib/creative-fatigue-predictor');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

var LOCK_KEY = 'cron:lock:fatigue-predictor';
var LOCK_TTL = 10 * 60;
var FORECAST_TTL = 14 * 86400;
var RUN_TTL = 14 * 86400;
var SCAN_BATCH = 100;
var AT_RISK_MIN_COUNT_FOR_ALERT = 2;

function shouldAlert() {
  return process.env.FATIGUE_PREDICTOR_ALERT_ENABLED !== 'false';
}

function parseRecord(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function scanAllFatigueRecords(redis) {
  return new Promise(async function (resolve, reject) {
    try {
      var cursor = '0';
      var records = {};
      do {
        var res = await redis.scan(cursor, { match: 'ad_fatigue:*', count: SCAN_BATCH });
        cursor = String(res[0]);
        var keys = res[1] || [];
        for (var i = 0; i < keys.length; i++) {
          var raw = await redis.get(keys[i]);
          var rec = parseRecord(raw);
          if (!rec || !rec.ctrHistory) continue;
          var adId = keys[i].replace('ad_fatigue:', '');
          records[adId] = rec;
        }
      } while (cursor !== '0');
      resolve(records);
    } catch (e) { reject(e); }
  });
}

function summarize(predictions) {
  var totals = {
    scanned: 0,
    forecasted: 0,
    insufficient: 0,
    atRisk: 0,
    alreadyFatigued: 0,
    trends: { sharp_decline: 0, declining: 0, stable: 0, growing: 0, unknown: 0 }
  };
  var ids = Object.keys(predictions);
  for (var i = 0; i < ids.length; i++) {
    totals.scanned++;
    var p = predictions[ids[i]];
    if (!p) continue;
    if (p.status !== 'ok') {
      totals.insufficient++;
      continue;
    }
    totals.forecasted++;
    if (p.alreadyFatigued) totals.alreadyFatigued++;
    if (p.atRisk && !p.alreadyFatigued) totals.atRisk++;
    if (p.trend && totals.trends[p.trend] !== undefined) totals.trends[p.trend]++;
  }
  return totals;
}

function formatAlert(atRiskList, totals) {
  var lines = [];
  lines.push('Creative Fatigue Predictor');
  lines.push('');
  lines.push('At-risk ads: ' + atRiskList.length + ' (not yet fatigued reactive)');
  lines.push('Already fatigued: ' + totals.alreadyFatigued);
  lines.push('Forecasted: ' + totals.forecasted + '/' + totals.scanned);
  lines.push('');
  lines.push('Top at-risk (3d forecast):');
  var top = atRiskList.slice(0, 5);
  for (var i = 0; i < top.length; i++) {
    var p = top[i];
    var name = p.adName || p.adId;
    if (name.length > 40) name = name.substring(0, 37) + '...';
    var prob = Math.round(p.fatigueProbability * 100);
    var decline = Math.round(p.forecastDeclinePct);
    var dtf = p.daysToFatigue !== null && p.daysToFatigue !== undefined
      ? (p.daysToFatigue + 'd')
      : 'n/a';
    lines.push('• ' + name);
    lines.push('  P(fatigue)=' + prob + '%  ΔCTR=-' + decline + '%  t=' + dtf + '  trend=' + p.trend);
  }
  lines.push('');
  lines.push('Rotate winners, refresh losers — before CTR collapse.');
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

    var runTs = new Date().toISOString();
    var stats = { scanned: 0, forecasted: 0, insufficient: 0, atRisk: 0, alreadyFatigued: 0 };

    try {
      var records = await scanAllFatigueRecords(redis);
      var predictions = predictor.predictAll(records);

      // Persist per-ad forecasts.
      var adIds = Object.keys(predictions);
      for (var i = 0; i < adIds.length; i++) {
        var pred = predictions[adIds[i]];
        if (!pred) continue;
        await store.set(
          'ad_fatigue_forecast:' + adIds[i],
          JSON.stringify(pred),
          FORECAST_TTL
        );
      }

      var summary = summarize(predictions);
      Object.assign(stats, summary);

      var atRiskList = predictor.filterAtRisk(predictions);

      var runSnapshot = {
        timestamp: runTs,
        timestampLocal: dates.formatDateTimeAmsterdam(),
        horizonDays: predictor.FORECAST_HORIZON_DAYS,
        declineThresholdPct: predictor.DECLINE_THRESHOLD_PCT,
        atRiskProbability: predictor.AT_RISK_PROBABILITY,
        totals: summary,
        atRiskSample: atRiskList.slice(0, 10)
      };

      var runKey = 'fatigue_predictor:run:' + runTs.replace(/[:.]/g, '-');
      await store.set(runKey, JSON.stringify(runSnapshot), RUN_TTL);
      await store.set('fatigue_predictor:latest', JSON.stringify(runSnapshot), RUN_TTL);

      // Telegram alert when we have ≥2 at-risk ads.
      var telegramSent = false;
      if (shouldAlert() && atRiskList.length >= AT_RISK_MIN_COUNT_FOR_ALERT) {
        var decision = await alertDedup.shouldAlert(
          'fatigue-predictor',
          'meta',
          'ad_ctr_forecast',
          'at_risk_' + atRiskList.length,
          'P1'
        );
        if (decision.send) {
          var body = alertDedup.formatAlertPrefix('P1', decision.suppressed) +
            ' ' + formatAlert(atRiskList, summary);
          var tg = await sendTelegram(body);
          telegramSent = !!(tg && tg.sent);
        }
      }

      return res.status(200).json({
        ok: true,
        stats: stats,
        atRiskSample: atRiskList.slice(0, 5).map(function (p) {
          return {
            ad_id: p.adId, ad_name: p.adName,
            probability: Math.round(p.fatigueProbability * 100) / 100,
            forecast_decline_pct: Math.round(p.forecastDeclinePct * 10) / 10,
            days_to_fatigue: p.daysToFatigue,
            trend: p.trend
          };
        }),
        telegram_sent: telegramSent,
        timestamp: runTs
      });
    } finally {
      await store.del(LOCK_KEY);
    }
  } catch (err) {
    console.error('[FatiguePredictor] Error:', err && err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err && err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
