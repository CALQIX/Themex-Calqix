/**
 * Weekly REAL Event Match Quality report (Meta receive-side).
 *
 * Schedule: weekly Mon 08:30 Amsterdam (calqix-emq-quality)
 * Endpoint: /api/cron/emq-quality
 *
 * Complements api/cron/emq-deep.js (which estimates EMQ from our SEND-side field
 * coverage hourly) by pulling Meta's ACTUAL composite_score via the Dataset
 * Quality API. Sends a concise Telegram digest + flags week-over-week drift.
 * Read-only: no events sent, no tracking state mutated.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');
var { fetchEmqReport, fbcLow } = require('../../lib/dataset-quality');

var DROP_ALERT = 1.0; // composite_score drop (pts) week-over-week that triggers a P1.

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var report = await fetchEmqReport();
    var scored = (report.events || []).filter(function (e) { return e.score != null; });

    // Week-over-week drift vs the previous run's scores.
    var prev = {};
    try { prev = JSON.parse(await store.get('emq_quality:prev') || '{}') || {}; } catch (e) { prev = {}; }
    var drift = [];
    var curScores = {};
    scored.forEach(function (e) {
      curScores[e.event_name] = e.score;
      if (typeof prev[e.event_name] === 'number') {
        var delta = e.score - prev[e.event_name];
        if (delta <= -DROP_ALERT) drift.push({ event: e.event_name, from: prev[e.event_name], to: e.score, delta: delta });
      }
    });

    // Persist current scores + a dated snapshot for trending.
    var stamp = report.captured_at.slice(0, 10);
    try {
      await store.set('emq_quality:prev', JSON.stringify(curScores), 60 * 86400);
      await store.set('emq_quality_weekly:' + stamp, JSON.stringify(report), 180 * 86400);
    } catch (e) { /* non-fatal */ }

    // Build the digest.
    var src = report.event_source_7d || {};
    var srvN = src.SERVER || 0, brwN = src.BROWSER || 0, totN = srvN + brwN;
    var low = fbcLow(report);

    var lines = ['<b>📊 Wekelijkse EMQ (Meta receive-side) — ' + stamp + '</b>', ''];
    if (report.dq_error) lines.push('⚠️ Dataset Quality API: ' + esc(report.dq_error));
    if (!scored.length) lines.push('(geen gescoorde events in venster)');
    scored.forEach(function (e) {
      var emoji = e.score >= 8 ? '🟢' : e.score >= 6 ? '🟡' : '🔴';
      lines.push(emoji + ' ' + esc(e.event_name) + ': <b>' + e.score + '</b>/10');
    });
    lines.push('');
    if (low) lines.push('Lever (fbc-coverage, laagste): ' + low.pct + '% op ' + esc(low.event));
    lines.push('Bron 7d: ' + srvN + ' server / ' + brwN + ' browser' + (totN ? ' (' + Math.round(brwN / totN * 100) + '% browser)' : ''));
    if (drift.length) {
      lines.push('');
      lines.push('⚠️ <b>Drift t.o.v. vorige meting:</b>');
      drift.forEach(function (d) { lines.push('• ' + esc(d.event) + ': ' + d.from + ' → ' + d.to + ' (' + d.delta.toFixed(1) + ')'); });
    }

    // P1 alert (dedup-gated) only when a real drop is detected.
    var alerted = false;
    if (drift.length) {
      var ar = await alertDedup.shouldAlert('emq-quality', 'meta', '*', 'emq_score_drop', 'P1');
      if (ar.send) {
        await sendTelegram(alertDedup.formatAlertPrefix('P1', ar.suppressed) + ' Meta EMQ daling\n\n' +
          drift.map(function (d) { return d.event + ': ' + d.from + ' → ' + d.to; }).join('\n'));
        alerted = true;
      }
    }

    await sendTelegram(lines.join('\n'));

    return res.status(200).json({ ok: true, scored: scored.length, drift: drift, alerted: alerted, report: report });
  } catch (err) {
    console.error('[emq-quality] error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
