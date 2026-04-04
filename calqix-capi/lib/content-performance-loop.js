/**
 * Content Performance Loop — connects Meta insights to content planning.
 *
 * Reads Meta ad performance data and converts it into:
 *   - Top performing angles
 *   - Weak angles
 *   - CTR trend per angle
 *   - ROAS trend
 *   - Fatigue signals
 *   - Spend-starved creatives
 *
 * Uses existing meta-insights-source.js for data fetching.
 */
var insights = require('./meta-insights-source');
var memory = require('./content-memory');
var store = require('./store');

var ANGLE_KEYWORDS = {
  enamel: ['enamel', 'reminerali', 'n-hap', 'hydroxyapatite', 'mineral'],
  gumline: ['gum', 'gumline', 'periodontal', 'floss', 'interdental'],
  breath_confidence: ['breath', 'fresh', 'halitosis', 'odor', 'confidence'],
  premium_daily_routine: ['routine', 'daily', 'morning', 'premium', 'ritual'],
  convenience: ['portable', 'cordless', 'travel', 'usb-c', 'waterproof', 'ipx7'],
  oral_microbiome: ['microbiome', 'bacteria', 'biome', 'ecosystem', 'flora'],
  objection_handling: ['fluoride', 'skeptic', 'myth', 'fact', 'vs', 'compare'],
  comparison_framing: ['vs', 'compared', 'traditional', 'string floss', 'drugstore'],
  authority: ['research', 'clinical', 'peer-reviewed', 'study', 'japan'],
  science_driven_reassurance: ['science', 'biocompatible', 'evidence', 'formulated', 'ingredient']
};

/**
 * Detect angle from ad name or campaign name.
 * @param {string} name
 * @returns {string|null}
 */
function detectAngle(name) {
  if (!name) return null;
  var lower = name.toLowerCase();

  // Direct angle name matches (e.g. "NL_Angle_1_Microbioom")
  if (lower.indexOf('microbioom') !== -1 || lower.indexOf('microbiome') !== -1) return 'oral_microbiome';
  if (lower.indexOf('slechte adem') !== -1 || lower.indexOf('bad breath') !== -1) return 'breath_confidence';
  if (lower.indexOf('routine') !== -1) return 'premium_daily_routine';
  if (lower.indexOf('autoriteit') !== -1 || lower.indexOf('authority') !== -1) return 'authority';
  if (lower.indexOf('wissenschaft') !== -1 || lower.indexOf('science') !== -1) return 'science_driven_reassurance';
  if (lower.indexOf('enamel') !== -1 || lower.indexOf('glazuur') !== -1) return 'enamel';
  if (lower.indexOf('flosser') !== -1 || lower.indexOf('gum') !== -1) return 'gumline';
  if (lower.indexOf('convenience') !== -1 || lower.indexOf('portable') !== -1) return 'convenience';
  if (lower.indexOf('objection') !== -1 || lower.indexOf('myth') !== -1) return 'objection_handling';
  if (lower.indexOf('comparison') !== -1 || lower.indexOf('vs') !== -1) return 'comparison_framing';

  // Keyword-based detection
  var bestAngle = null;
  var bestScore = 0;
  Object.keys(ANGLE_KEYWORDS).forEach(function (angle) {
    var keywords = ANGLE_KEYWORDS[angle];
    var score = 0;
    keywords.forEach(function (kw) {
      if (lower.indexOf(kw) !== -1) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  });

  return bestAngle;
}

/**
 * Analyze recent Meta ad performance and extract content planning signals.
 * @returns {Promise<object>} metaSignals for content planner
 */
async function analyzePerformance() {
  var now = new Date();
  var snap = await insights.fetchFullSnapshot(now);

  var ads = snap.ads || [];
  var signals = {
    topAngles: [],
    weakAngles: [],
    ctrByAngle: {},
    roasTrend: snap.sevenDays ? snap.sevenDays.roas : 0,
    cpcTrend: snap.sevenDays ? snap.sevenDays.cpc : 0,
    spendStarved: [],
    fatigued: [],
    totalSpend7d: snap.sevenDays ? snap.sevenDays.spend : 0,
    totalPurchases7d: snap.sevenDays ? snap.sevenDays.purchases : 0,
    analyzedAt: now.toISOString()
  };

  // Analyze ads by detected angle
  var anglePerf = {};
  ads.forEach(function (ad) {
    var angle = detectAngle(ad.ad_name || ad.adset_name || ad.campaign_name || '');
    if (!angle) return;

    if (!anglePerf[angle]) anglePerf[angle] = { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalPurchases: 0, adCount: 0, totalRevenue: 0 };
    var ap = anglePerf[angle];
    ap.totalSpend += parseFloat(ad.spend) || 0;
    ap.totalClicks += parseInt(ad.clicks) || 0;
    ap.totalImpressions += parseInt(ad.impressions) || 0;
    ap.adCount++;

    // Parse actions
    var actions = ad.actions || [];
    var actionValues = ad.action_values || [];
    actions.forEach(function (a) {
      if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
        ap.totalPurchases += parseInt(a.value) || 0;
      }
    });
    actionValues.forEach(function (a) {
      if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
        ap.totalRevenue += parseFloat(a.value) || 0;
      }
    });
  });

  // Calculate CTR per angle and classify
  Object.keys(anglePerf).forEach(function (angle) {
    var ap = anglePerf[angle];
    var ctr = ap.totalImpressions > 0 ? (ap.totalClicks / ap.totalImpressions * 100) : 0;
    signals.ctrByAngle[angle] = Math.round(ctr * 100) / 100;
    var roas = ap.totalSpend > 0 ? ap.totalRevenue / ap.totalSpend : 0;

    if (ctr > 2.0 || roas > 2.0) {
      signals.topAngles.push(angle);
    }
    if (ctr < 0.8 && ap.totalImpressions > 500) {
      signals.weakAngles.push(angle);
    }
  });

  // Detect spend-starved and fatigued
  ads.forEach(function (ad) {
    var spend = parseFloat(ad.spend) || 0;
    var impressions = parseInt(ad.impressions) || 0;
    var frequency = parseFloat(ad.frequency) || 0;
    var ctr = parseFloat(ad.ctr) || 0;

    if (spend < 2 && impressions < 100) {
      signals.spendStarved.push({ name: ad.ad_name, id: ad.ad_id, spend: spend, impressions: impressions });
    }
    if (frequency > 3.0) {
      signals.fatigued.push({ name: ad.ad_name, id: ad.ad_id, frequency: frequency, ctr: ctr });
    }
  });

  // Store signals in Redis for other agents
  await store.set('cm:meta_signals', JSON.stringify(signals), 86400);

  console.log('[PerformanceLoop] Analysis complete', {
    topAngles: signals.topAngles,
    weakAngles: signals.weakAngles,
    spendStarved: signals.spendStarved.length,
    fatigued: signals.fatigued.length
  });

  return signals;
}

/**
 * Get cached meta signals (from last analysis run).
 * @returns {Promise<object|null>}
 */
async function getCachedSignals() {
  var raw = await store.get('cm:meta_signals');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * Update content memory with winning/losing angles based on Meta data.
 * Called during content-reflect phase.
 */
async function reflectOnPerformance() {
  var signals = await getCachedSignals();
  if (!signals) return;

  // Reward winning angles
  for (var i = 0; i < signals.topAngles.length; i++) {
    await memory.recordAngleWin(signals.topAngles[i]);
  }

  // Decay all fatigue scores daily
  await memory.decayAngleFatigue();

  console.log('[PerformanceLoop] Reflection complete — rewarded', signals.topAngles.length, 'winning angles');
}

module.exports = {
  analyzePerformance: analyzePerformance,
  getCachedSignals: getCachedSignals,
  reflectOnPerformance: reflectOnPerformance,
  detectAngle: detectAngle
};
