/**
 * Creative Fatigue Predictor — Bayesian CTR forecast for proactive rotation.
 *
 * Complements the reactive detector in lib/ad-fatigue-tracker.js. While the
 * tracker flags fatigue only *after* CTR has already dropped ≥30% from peak
 * (with ≥1000 impressions), this predictor estimates *when* that threshold
 * will be crossed so operators can refresh creatives before performance
 * collapses.
 *
 * Model — weighted Bayesian linear regression on log(CTR):
 *   y_i = log(ctr_i + ε)   for i = 0..n-1 (oldest → newest)
 *   y_i = α + β·i + e_i,  weights w_i = impressions_i
 *
 *   Prior on slope β: N(0, τ²)   (τ = PRIOR_SLOPE_STD, default 0.3)
 *   Posterior β:      normal with mean = (Sxy/σ²) / (1/τ² + Sxx/σ²)
 *                          std  = sqrt(1 / (1/τ² + Sxx/σ²))
 *   σ² is the residual variance of the ML fit (unbiased estimator).
 *
 * Forecast k days ahead (default k = 3):
 *   y_hat  = α + β·(n-1+k)
 *   CTR    = exp(y_hat) - ε
 *   stdErr = sqrt(σ² + (slopeStd · (n-1+k))²)
 *   Probability of ≥30% decline from peak:
 *     threshold_y = log(peakCtr · 0.7 + ε)
 *     P(decline) = Φ((threshold_y - y_hat) / stdErr)
 *
 * Trend classification (slope in log-CTR units per day):
 *   sharp_decline ≤ -0.20
 *   declining     ∈ (-0.20, -0.05]
 *   stable        ∈ (-0.05, 0.05)
 *   growing       ≥  0.05
 *
 * Edge cases:
 *   - n < MIN_HISTORY_DAYS (3)          → insufficient_data
 *   - total impressions < MIN_TOTAL_IMP → low_signal (confidence capped)
 *   - all CTRs zero                     → zero_ctr (no forecast)
 *   - peak CTR = 0                      → no threshold, P = 0
 *
 * Pure module — no Redis, no IO. Makes it easy to unit-test the math.
 */

var EPSILON = 0.01;                   // log(0) guard; CTR in percent, so 0.01 = 1 bp
var PRIOR_SLOPE_STD = 0.3;            // τ, prior belief that slope ≈ 0
var FORECAST_HORIZON_DAYS = 3;        // k, how many days ahead we forecast
var DECLINE_THRESHOLD_PCT = 30;       // % drop from peak that counts as "fatigued"
var MIN_HISTORY_DAYS = 3;
var MIN_TOTAL_IMPRESSIONS = 500;      // below this, predictions are marked low-confidence
var AT_RISK_PROBABILITY = 0.6;        // default cutoff for Telegram alerts / rules engine
var SHARP_DECLINE_SLOPE = -0.20;
var DECLINING_SLOPE = -0.05;
var GROWING_SLOPE = 0.05;

// --- Math helpers ---

/**
 * Abramowitz-Stegun 7.1.26 rational approximation for erf(x).
 * Accurate to ~1.5e-7.
 */
function erf(x) {
  var a1 = 0.254829592;
  var a2 = -0.284496736;
  var a3 = 1.421413741;
  var a4 = -1.453152027;
  var a5 = 1.061405429;
  var p = 0.3275911;
  var sign = x < 0 ? -1 : 1;
  var ax = Math.abs(x);
  var t = 1.0 / (1.0 + p * ax);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function classifyTrend(slope) {
  if (slope <= SHARP_DECLINE_SLOPE) return 'sharp_decline';
  if (slope <= DECLINING_SLOPE) return 'declining';
  if (slope >= GROWING_SLOPE) return 'growing';
  return 'stable';
}

/**
 * Weighted Bayesian linear regression on log(CTR + ε) vs day index.
 * @param {Array<{ctr:number, impressions:number}>} history — oldest → newest
 * @param {object} [opts]
 * @param {number} [opts.priorSlopeStd]
 * @returns {{
 *   n:number, slope:number, slopeStd:number, intercept:number,
 *   residualStd:number, totalImpressions:number, fitOk:boolean
 * }|null}
 */
function fitTrend(history, opts) {
  opts = opts || {};
  var tau = opts.priorSlopeStd || PRIOR_SLOPE_STD;
  if (!history || history.length < 2) return null;

  var n = history.length;
  var xs = [];
  var ys = [];
  var ws = [];
  var totalImp = 0;
  var allZero = true;

  for (var i = 0; i < n; i++) {
    var h = history[i];
    var ctr = Number(h.ctr) || 0;
    var imp = Math.max(0, Number(h.impressions) || 0);
    if (ctr > 0) allZero = false;
    xs.push(i);
    ys.push(Math.log(ctr + EPSILON));
    // Weight by sqrt(impressions) so a day with 10k impressions doesn't
    // completely drown a day with 200. Plus 1 to avoid zero-weight rows.
    ws.push(Math.sqrt(imp + 1));
    totalImp += imp;
  }

  if (allZero) {
    return {
      n: n, slope: 0, slopeStd: tau, intercept: Math.log(EPSILON),
      residualStd: 0, totalImpressions: totalImp, fitOk: false
    };
  }

  var sumW = 0;
  for (var a = 0; a < n; a++) sumW += ws[a];
  if (sumW <= 0) return null;

  var xMean = 0;
  var yMean = 0;
  for (var b = 0; b < n; b++) {
    xMean += ws[b] * xs[b];
    yMean += ws[b] * ys[b];
  }
  xMean /= sumW;
  yMean /= sumW;

  var sxx = 0;
  var sxy = 0;
  for (var c = 0; c < n; c++) {
    var dx = xs[c] - xMean;
    var dy = ys[c] - yMean;
    sxx += ws[c] * dx * dx;
    sxy += ws[c] * dx * dy;
  }

  if (sxx <= 1e-9) {
    // All data collapses to a single x — no slope info, stick with prior.
    return {
      n: n, slope: 0, slopeStd: tau,
      intercept: yMean, residualStd: 0,
      totalImpressions: totalImp, fitOk: false
    };
  }

  var slopeMl = sxy / sxx;
  var interceptMl = yMean - slopeMl * xMean;

  // Residual variance (weighted, small-n correction k=2 params).
  var rss = 0;
  for (var d = 0; d < n; d++) {
    var pred = interceptMl + slopeMl * xs[d];
    var res = ys[d] - pred;
    rss += ws[d] * res * res;
  }
  var effectiveN = Math.max(1, n - 2);
  var sigma2 = Math.max(rss / effectiveN / (sumW / n), 1e-4);

  // Bayesian posterior for slope: combine prior N(0, τ²) with data likelihood.
  var precisionData = sxx / sigma2;
  var precisionPrior = 1 / (tau * tau);
  var posteriorPrecision = precisionPrior + precisionData;
  var slopeBayes = (sxy / sigma2) / posteriorPrecision;
  var slopeStd = Math.sqrt(1 / posteriorPrecision);

  // Recompute intercept given shrunken slope (weighted-mean identity).
  var interceptBayes = yMean - slopeBayes * xMean;

  return {
    n: n,
    slope: slopeBayes,
    slopeStd: slopeStd,
    intercept: interceptBayes,
    residualStd: Math.sqrt(sigma2),
    totalImpressions: totalImp,
    fitOk: true
  };
}

/**
 * Forecast CTR and fatigue probability for a single ad's history.
 *
 * @param {Array<{date:string, ctr:number, impressions:number, frequency?:number}>} history
 * @param {object} [opts]
 * @param {number} [opts.horizonDays]       — forecast horizon (days ahead)
 * @param {number} [opts.declineThreshold]  — percent decline that counts as fatigue
 * @param {number} [opts.priorSlopeStd]
 * @returns {object} prediction
 */
function predict(history, opts) {
  opts = opts || {};
  var horizon = opts.horizonDays || FORECAST_HORIZON_DAYS;
  var declineThreshold = opts.declineThreshold || DECLINE_THRESHOLD_PCT;

  if (!history || history.length < MIN_HISTORY_DAYS) {
    return {
      status: 'insufficient_data',
      n: history ? history.length : 0,
      horizonDays: horizon,
      trend: 'unknown',
      confidence: 'none',
      fatigueProbability: 0
    };
  }

  var fit = fitTrend(history, opts);
  if (!fit) {
    return { status: 'fit_failed', horizonDays: horizon, trend: 'unknown', confidence: 'none', fatigueProbability: 0 };
  }
  if (!fit.fitOk) {
    return {
      status: 'degenerate_fit',
      n: fit.n,
      horizonDays: horizon,
      trend: 'stable',
      confidence: 'low',
      fatigueProbability: 0,
      totalImpressions: fit.totalImpressions
    };
  }

  var peakCtr = 0;
  var currentCtr = history[history.length - 1].ctr || 0;
  for (var i = 0; i < history.length; i++) {
    if (history[i].ctr > peakCtr) peakCtr = history[i].ctr;
  }

  // Project k days beyond the last observed day.
  var lastIndex = history.length - 1;
  var projectedIndex = lastIndex + horizon;
  var yForecast = fit.intercept + fit.slope * projectedIndex;
  var forecastCtr = Math.max(0, Math.exp(yForecast) - EPSILON);

  // Predictive std at projected index: residual std + slope uncertainty propagated.
  var centeredX = projectedIndex; // approximation; xMean absorbed into intercept
  var stdForecast = Math.sqrt(
    fit.residualStd * fit.residualStd +
    (fit.slopeStd * centeredX) * (fit.slopeStd * centeredX)
  );
  stdForecast = Math.max(stdForecast, 1e-3); // guard against zero

  // Probability CTR falls below (1 - declineThreshold%) * peak within horizon.
  var fatigueProbability = 0;
  var thresholdCtr = 0;
  if (peakCtr > 0) {
    thresholdCtr = peakCtr * (1 - declineThreshold / 100);
    var thresholdY = Math.log(thresholdCtr + EPSILON);
    var z = (thresholdY - yForecast) / stdForecast;
    fatigueProbability = normCdf(z);
  }

  var forecastDeclinePct = peakCtr > 0 ? ((peakCtr - forecastCtr) / peakCtr) * 100 : 0;

  // Days-to-fatigue: solve y(k) = thresholdY for k, given slope.
  var daysToFatigue = null;
  if (peakCtr > 0 && fit.slope < -1e-4) {
    var thresholdY2 = Math.log(thresholdCtr + EPSILON);
    // y_current = intercept + slope * lastIndex
    var yCurrent = fit.intercept + fit.slope * lastIndex;
    if (yCurrent > thresholdY2) {
      daysToFatigue = Math.ceil((thresholdY2 - yCurrent) / fit.slope);
      if (daysToFatigue < 0) daysToFatigue = 0;
      if (daysToFatigue > 60) daysToFatigue = null; // too far out to be meaningful
    } else {
      daysToFatigue = 0; // already below threshold
    }
  }

  var confidence = 'high';
  if (fit.totalImpressions < MIN_TOTAL_IMPRESSIONS) confidence = 'low';
  else if (fit.n < 5) confidence = 'medium';

  return {
    status: 'ok',
    n: fit.n,
    horizonDays: horizon,
    declineThresholdPct: declineThreshold,
    peakCtr: peakCtr,
    currentCtr: currentCtr,
    forecastCtr: forecastCtr,
    forecastDeclinePct: forecastDeclinePct,
    fatigueProbability: fatigueProbability,
    daysToFatigue: daysToFatigue,
    trend: classifyTrend(fit.slope),
    slope: fit.slope,
    slopeStd: fit.slopeStd,
    residualStd: fit.residualStd,
    totalImpressions: fit.totalImpressions,
    confidence: confidence,
    atRisk: fatigueProbability >= AT_RISK_PROBABILITY && peakCtr > 0,
    computedAt: new Date().toISOString()
  };
}

/**
 * Batch-predict for a map of { adId: fatigueRecord } where each record follows
 * the shape produced by lib/ad-fatigue-tracker.js (has `ctrHistory`).
 *
 * @param {object} fatigueMap — { [adId]: { ctrHistory: [...], adName, ... } }
 * @param {object} [opts]
 * @returns {object} { [adId]: prediction }
 */
function predictAll(fatigueMap, opts) {
  var out = {};
  if (!fatigueMap) return out;
  var ids = Object.keys(fatigueMap);
  for (var i = 0; i < ids.length; i++) {
    var rec = fatigueMap[ids[i]];
    if (!rec || !rec.ctrHistory) continue;
    var pred = predict(rec.ctrHistory, opts);
    pred.adId = ids[i];
    pred.adName = rec.adName || ids[i];
    pred.alreadyFatigued = !!rec.fatigued;
    out[ids[i]] = pred;
  }
  return out;
}

/**
 * Filter predictions to those that are at-risk but not yet reactively fatigued.
 * These are the ads the operator should rotate *proactively*.
 */
function filterAtRisk(predictions, minProbability) {
  var cutoff = typeof minProbability === 'number' ? minProbability : AT_RISK_PROBABILITY;
  var out = [];
  var ids = Object.keys(predictions || {});
  for (var i = 0; i < ids.length; i++) {
    var p = predictions[ids[i]];
    if (!p || p.status !== 'ok') continue;
    if (p.alreadyFatigued) continue;
    if (p.fatigueProbability < cutoff) continue;
    out.push(p);
  }
  out.sort(function (a, b) { return b.fatigueProbability - a.fatigueProbability; });
  return out;
}

module.exports = {
  predict: predict,
  predictAll: predictAll,
  fitTrend: fitTrend,
  classifyTrend: classifyTrend,
  filterAtRisk: filterAtRisk,
  normCdf: normCdf,
  erf: erf,
  EPSILON: EPSILON,
  PRIOR_SLOPE_STD: PRIOR_SLOPE_STD,
  FORECAST_HORIZON_DAYS: FORECAST_HORIZON_DAYS,
  DECLINE_THRESHOLD_PCT: DECLINE_THRESHOLD_PCT,
  MIN_HISTORY_DAYS: MIN_HISTORY_DAYS,
  MIN_TOTAL_IMPRESSIONS: MIN_TOTAL_IMPRESSIONS,
  AT_RISK_PROBABILITY: AT_RISK_PROBABILITY
};
