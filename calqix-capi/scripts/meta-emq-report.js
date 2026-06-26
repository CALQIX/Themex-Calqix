/**
 * CALQIX — Meta EMQ / Dataset Quality report (READ-ONLY CLI).
 *
 * Pulls the REAL receive-side EMQ from Meta (composite_score + per-identifier
 * coverage) plus 7d event_source / had_pii / volume. Shared logic lives in
 * lib/dataset-quality.js (also used by api/cron/emq-quality.js weekly cron).
 *
 * Run it BEFORE and AFTER any tracking change to backtest real EMQ/coverage lift.
 *
 *   node scripts/meta-emq-report.js            # human report
 *   node scripts/meta-emq-report.js --json     # raw JSON (machine/diff)
 *   node scripts/meta-emq-report.js --save     # also write a timestamped snapshot
 *
 * Requires env: META_ACCESS_TOKEN, META_PIXEL_ID (+ optional META_API_VERSION).
 */
var path = require('path');
var fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });
var { fetchEmqReport } = require('../lib/dataset-quality');

var ARGS = process.argv.slice(2);
var WANT_JSON = ARGS.indexOf('--json') > -1;
var WANT_SAVE = ARGS.indexOf('--save') > -1;

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

(async function () {
  if (!process.env.META_ACCESS_TOKEN) { console.error('META_ACCESS_TOKEN missing'); process.exit(1); }
  var report = await fetchEmqReport();

  if (WANT_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('================ CALQIX Meta EMQ / Dataset Quality ================');
    console.log('pixel ' + report.pixel_id + '  api ' + report.api_version + '  captured ' + report.captured_at);
    if (report.dq_error) console.log('DQ error: ' + report.dq_error);

    console.log('\n--- EVENT MATCH QUALITY (Dataset Quality API, Meta receive-side) ---');
    if (!report.events.length) console.log('  (no data)');
    report.events.forEach(function (e) {
      if (e.score == null) { console.log('\n  ' + pad(e.event_name, 22) + ' EMQ: (not scored)'); return; }
      console.log('\n  ' + pad(e.event_name, 22) + ' EMQ composite_score: ' + e.score + ' / 10');
      e.keys.forEach(function (k) {
        var flag = k.pct >= 99.5 ? '' : (k.pct >= 50 ? '  <- partial' : '  <- LOW (lever)');
        console.log('      ' + pad(k.id, 14) + pad(k.pct + '%', 8) + flag);
      });
    });

    var s = report.event_source_7d, tot = (s.SERVER || 0) + (s.BROWSER || 0);
    console.log('\n--- EVENT SOURCE last 7d ---');
    console.log('  SERVER:  ' + (s.SERVER || 0));
    console.log('  BROWSER: ' + (s.BROWSER || 0) + (tot ? '   (browser share ' + Math.round((s.BROWSER || 0) / tot * 100) + '%)' : ''));

    console.log('\n--- PII PRESENCE last 7d (had_pii by event) ---');
    Object.keys(report.had_pii_7d).forEach(function (ev) {
      var d = report.had_pii_7d[ev], has = d.has_pii || 0, no = d.not_has_pii || 0, t = has + no;
      console.log('  ' + pad(ev, 22) + ' has_pii ' + has + ' / no ' + no + (t ? '  (' + Math.round(has / t * 100) + '% with PII)' : ''));
    });

    console.log('\n--- EVENT VOLUME last 7d ---');
    (report.event_total_counts || []).forEach(function (r) { console.log('  ' + pad(r.value, 22) + r.count); });

    console.log('\nNote: coverage % is the lever (research). Re-run before/after changes to backtest real lift.');
  }

  if (WANT_SAVE) {
    var dir = path.join(__dirname, 'emq-snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var fn = path.join(dir, 'emq-' + report.captured_at.replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(fn, JSON.stringify(report, null, 2));
    console.log('\nsnapshot saved: ' + fn);
  }
  process.exit(0);
})().catch(function (e) { console.error('FATAL', e.message); process.exit(1); });
