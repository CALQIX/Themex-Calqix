/**
 * Probe for the creative fatigue predictor.
 *
 * Usage:
 *   node scripts/test-fatigue-predictor.js           # local: compute predictions from live Redis data
 *   node scripts/test-fatigue-predictor.js --live    # hit the deployed cron endpoint too
 *   node scripts/test-fatigue-predictor.js --synth   # run against synthetic histories only
 *
 * What it does:
 *   1. Prints the ad_fatigue:* records currently in Redis and what the Bayesian
 *      model predicts for each (3-day forecast by default).
 *   2. Flags which ads are at-risk but not yet reactively fatigued.
 *   3. Optionally calls /api/cron/fatigue-predictor in production so you can
 *      verify the persisted snapshot (fatigue_predictor:latest).
 */
require('dotenv').config();
var store = require('../lib/store');
var predictor = require('../lib/creative-fatigue-predictor');

var API_BASE = process.env.CAPI_BASE_URL || 'https://calqix-capi.vercel.app';
var redis = store._getRedis();

function argFlag(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function humanProb(p) {
  return (Math.round(p * 1000) / 10).toFixed(1) + '%';
}

function humanCtr(c) {
  return (Math.round(c * 1000) / 1000).toFixed(3);
}

function padRight(str, len) {
  str = String(str == null ? '' : str);
  if (str.length >= len) return str.substring(0, len);
  return str + new Array(len - str.length + 1).join(' ');
}

async function scanFatigueRecords() {
  if (!redis) {
    console.error('Redis niet beschikbaar — check UPSTASH_REDIS_REST_URL / TOKEN');
    process.exit(1);
  }
  var cursor = '0';
  var records = {};
  do {
    var res = await redis.scan(cursor, { match: 'ad_fatigue:*', count: 100 });
    cursor = String(res[0]);
    var keys = res[1] || [];
    for (var i = 0; i < keys.length; i++) {
      var raw = await redis.get(keys[i]);
      var rec;
      if (typeof raw === 'object') rec = raw;
      else { try { rec = JSON.parse(raw); } catch (e) { rec = null; } }
      if (!rec || !rec.ctrHistory) continue;
      var adId = keys[i].replace('ad_fatigue:', '');
      records[adId] = rec;
    }
  } while (cursor !== '0');
  return records;
}

function syntheticCases() {
  return {
    declining_ad: {
      adName: 'Synthetic | Routine v1 (declining)',
      fatigued: false,
      ctrHistory: [
        { date: '1', ctr: 3.2, impressions: 2400 },
        { date: '2', ctr: 2.9, impressions: 2100 },
        { date: '3', ctr: 2.5, impressions: 1900 },
        { date: '4', ctr: 2.2, impressions: 1700 },
        { date: '5', ctr: 1.9, impressions: 1500 }
      ]
    },
    stable_ad: {
      adName: 'Synthetic | Autoriteit (stable)',
      fatigued: false,
      ctrHistory: [
        { date: '1', ctr: 2.6, impressions: 1800 },
        { date: '2', ctr: 2.5, impressions: 1900 },
        { date: '3', ctr: 2.7, impressions: 1700 },
        { date: '4', ctr: 2.5, impressions: 1800 },
        { date: '5', ctr: 2.6, impressions: 1900 }
      ]
    },
    cliff_ad: {
      adName: 'Synthetic | Slechte Adem (cliff)',
      fatigued: false,
      ctrHistory: [
        { date: '1', ctr: 4.1, impressions: 3000 },
        { date: '2', ctr: 4.0, impressions: 2800 },
        { date: '3', ctr: 3.2, impressions: 2500 },
        { date: '4', ctr: 2.4, impressions: 2200 },
        { date: '5', ctr: 1.6, impressions: 1800 }
      ]
    },
    growing_ad: {
      adName: 'Synthetic | UGC (growing)',
      fatigued: false,
      ctrHistory: [
        { date: '1', ctr: 1.8, impressions: 1200 },
        { date: '2', ctr: 2.0, impressions: 1500 },
        { date: '3', ctr: 2.3, impressions: 1900 },
        { date: '4', ctr: 2.5, impressions: 2100 },
        { date: '5', ctr: 2.7, impressions: 2300 }
      ]
    },
    sparse_ad: {
      adName: 'Synthetic | Nieuwe ad (sparse)',
      fatigued: false,
      ctrHistory: [
        { date: '1', ctr: 2.0, impressions: 100 },
        { date: '2', ctr: 1.8, impressions: 120 }
      ]
    }
  };
}

function printPredictions(title, predictions) {
  console.log('\n=== ' + title + ' ===');
  console.log(padRight('Ad', 42), padRight('n', 3), padRight('peak', 8), padRight('cur', 8),
    padRight('forecast', 10), padRight('Δ%', 8), padRight('P(fatigue)', 12),
    padRight('days', 6), padRight('trend', 14), 'status');
  var ids = Object.keys(predictions);
  for (var i = 0; i < ids.length; i++) {
    var p = predictions[ids[i]];
    if (!p) continue;
    var name = (p.adName || ids[i]).substring(0, 41);
    console.log(
      padRight(name, 42),
      padRight(p.n || '-', 3),
      padRight(p.peakCtr != null ? humanCtr(p.peakCtr) : '-', 8),
      padRight(p.currentCtr != null ? humanCtr(p.currentCtr) : '-', 8),
      padRight(p.forecastCtr != null ? humanCtr(p.forecastCtr) : '-', 10),
      padRight(p.forecastDeclinePct != null ? Math.round(p.forecastDeclinePct) + '%' : '-', 8),
      padRight(p.fatigueProbability != null ? humanProb(p.fatigueProbability) : '-', 12),
      padRight(p.daysToFatigue == null ? '-' : (p.daysToFatigue + 'd'), 6),
      padRight(p.trend || '-', 14),
      p.status + (p.alreadyFatigued ? ' (already-fatigued)' : '') + (p.atRisk ? ' [AT-RISK]' : '')
    );
  }
}

async function main() {
  console.log('=== creative-fatigue-predictor probe ===');
  console.log('Horizon days:', predictor.FORECAST_HORIZON_DAYS);
  console.log('Decline threshold:', predictor.DECLINE_THRESHOLD_PCT + '%');
  console.log('At-risk cutoff:', predictor.AT_RISK_PROBABILITY);

  if (argFlag('--synth')) {
    var synth = syntheticCases();
    var synthPreds = predictor.predictAll(synth);
    printPredictions('Synthetic', synthPreds);
    return;
  }

  var records = await scanFatigueRecords();
  console.log('\nScanned', Object.keys(records).length, 'ad_fatigue:* records from Redis');

  if (Object.keys(records).length === 0) {
    console.log('No live records — running synthetic cases instead.');
    var synth2 = syntheticCases();
    var synth2Preds = predictor.predictAll(synth2);
    printPredictions('Synthetic', synth2Preds);
    return;
  }

  var predictions = predictor.predictAll(records);
  printPredictions('Live predictions', predictions);

  var atRisk = predictor.filterAtRisk(predictions);
  console.log('\nAt-risk ads (not yet reactively fatigued):', atRisk.length);
  for (var i = 0; i < Math.min(5, atRisk.length); i++) {
    var p = atRisk[i];
    console.log('  • ' + (p.adName || p.adId) +
      '  P(fatigue)=' + humanProb(p.fatigueProbability) +
      '  days-to-fatigue=' + (p.daysToFatigue == null ? 'n/a' : p.daysToFatigue));
  }

  if (argFlag('--live')) {
    var secret = process.env.CRON_SECRET;
    if (!secret) {
      console.log('\nSkipping --live call: CRON_SECRET not set');
      return;
    }
    var url = API_BASE + '/api/cron/fatigue-predictor?secret=' + encodeURIComponent(secret);
    console.log('\nCalling', url.replace(secret, '<redacted>'));
    var res = await fetch(url);
    var data = await res.json();
    console.log('HTTP:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    var latest = await store.get('fatigue_predictor:latest');
    if (latest) {
      var parsed;
      try { parsed = JSON.parse(latest); } catch (e) { parsed = null; }
      if (parsed) {
        console.log('\nfatigue_predictor:latest totals:', JSON.stringify(parsed.totals));
        console.log('atRiskSample:', (parsed.atRiskSample || []).length);
      }
    }
  }
}

main().catch(function (e) {
  console.error('[error]', e && e.stack ? e.stack : e);
  process.exit(1);
});
