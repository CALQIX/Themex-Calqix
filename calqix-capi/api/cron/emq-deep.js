/**
 * EMQ Deep-Dive — hourly per-field breakdown.
 *
 * Schedule: hourly (calqix-emq-deep)
 * Endpoint: /api/cron/emq-deep
 *
 * Per match key breakdown, identifies top 1-2 missing keys.
 * Persists emq_hourly:{DD-MM-YYYY-HH} for trending.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');

var EMQ_FIELDS = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'fbc', 'fbp', 'external_id'];

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

    var fieldCounts = {};
    var totalEvents = 0;

    for (var f = 0; f < EMQ_FIELDS.length; f++) {
      fieldCounts[EMQ_FIELDS[f]] = 0;
    }

    // Scan recent event payloads
    var cursor = '0';
    do {
      var scanResult = await redis.scan(cursor, { match: 'meta:payload:*', count: 50 });
      cursor = scanResult[0];
      var keys = scanResult[1] || [];

      for (var i = 0; i < keys.length && totalEvents < 500; i++) {
        var raw = await redis.get(keys[i]);
        if (!raw) continue;

        var payload;
        try { payload = JSON.parse(raw); } catch (e) { continue; }
        if (!payload.user_data) continue;

        totalEvents++;
        var ud = payload.user_data;
        for (var fi = 0; fi < EMQ_FIELDS.length; fi++) {
          var field = EMQ_FIELDS[fi];
          if (ud[field] && (!Array.isArray(ud[field]) || ud[field].length > 0)) {
            fieldCounts[field]++;
          }
        }
      }
    } while (cursor !== '0' && totalEvents < 500);

    // Calculate coverage percentages
    var coverage = {};
    var missingRank = [];
    for (var fc = 0; fc < EMQ_FIELDS.length; fc++) {
      var field2 = EMQ_FIELDS[fc];
      var pct = totalEvents > 0 ? Math.round(fieldCounts[field2] / totalEvents * 100) : 0;
      coverage[field2] = pct;
      missingRank.push({ field: field2, coverage: pct, missing: 100 - pct });
    }

    // Sort by most missing
    missingRank.sort(function (a, b) { return b.missing - a.missing; });

    // Calculate weighted EMQ estimate (simplified)
    var highValueFields = ['em', 'ph', 'fn', 'ln', 'external_id', 'fbc', 'fbp'];
    var totalWeighted = 0;
    var weightSum = 0;
    for (var w = 0; w < highValueFields.length; w++) {
      var weight = w < 2 ? 3 : (w < 4 ? 2 : 1); // em/ph weighted 3x, fn/ln 2x
      totalWeighted += (coverage[highValueFields[w]] || 0) * weight;
      weightSum += 100 * weight;
    }
    var estimatedEMQ = weightSum > 0 ? Math.round(totalWeighted / weightSum * 10 * 10) / 10 : 0;

    var result = {
      timestamp: dates.formatDateTimeAmsterdam(),
      totalEvents: totalEvents,
      coverage: coverage,
      estimatedEMQ: estimatedEMQ,
      topMissing: missingRank.slice(0, 3).map(function (m) { return m.field + ' (' + m.missing + '% ontbreekt)'; })
    };

    // Persist hourly
    var hourKey = 'emq_hourly:' + dates.formatDateTimeAmsterdam().replace(/[\s:]/g, '-').slice(0, 13);
    await store.set(hourKey, JSON.stringify(result), 14 * 86400);

    return res.status(200).json({ ok: true, result: result });

  } catch (err) {
    console.error('[EMQDeep] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
