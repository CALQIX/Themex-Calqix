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

// Priority order — Meta returns multiple overlapping rows per conversion.
// Pick the first present, never sum them (would double-count).
var PURCHASE_PRIORITY = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'];

function pickPurchaseCount(actions) {
  if (!Array.isArray(actions)) return 0;
  for (var i = 0; i < PURCHASE_PRIORITY.length; i++) {
    for (var j = 0; j < actions.length; j++) {
      if (actions[j].action_type === PURCHASE_PRIORITY[i]) {
        return parseInt(actions[j].value) || 0;
      }
    }
  }
  return 0;
}

function pickPurchaseRevenue(actionValues) {
  if (!Array.isArray(actionValues)) return 0;
  for (var i = 0; i < PURCHASE_PRIORITY.length; i++) {
    for (var j = 0; j < actionValues.length; j++) {
      if (actionValues[j].action_type === PURCHASE_PRIORITY[i]) {
        return parseFloat(actionValues[j].value) || 0;
      }
    }
  }
  return 0;
}

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
 * Detect product from ad/campaign/adset name.
 * @param {string} name
 * @returns {string|null}
 */
function detectProduct(name) {
  if (!name) return null;
  var lower = name.toLowerCase();

  if (lower.indexOf('flowcore') !== -1 || lower.indexOf('flosser') !== -1 || lower.indexOf('waterflosser') !== -1) return 'water_flosser';
  if (lower.indexOf('tablet') !== -1 || lower.indexOf('toothpaste') !== -1 || lower.indexOf('n-hap') !== -1 || lower.indexOf('tandpasta') !== -1) return 'toothpaste_tablets';
  if (lower.indexOf('oralbiome') !== -1 || lower.indexOf('biome') !== -1) return 'oralbiome_pro';
  if (lower.indexOf('bundle') !== -1 || lower.indexOf('routine') !== -1) return 'bundle';

  return null;
}

/**
 * Detect country/market from campaign or adset name.
 * Common patterns: "NL_Angle_1", "DE_Retargeting", "FR_TOF"
 * @param {string} name
 * @returns {string|null}
 */
function detectCountry(name) {
  if (!name) return null;
  var upper = name.toUpperCase();

  // Check for country prefix pattern (XX_ or XX-)
  var prefixMatch = upper.match(/^(NL|DE|FR|BE|AT|CH|UK|US|EU|INT)[_\-\s]/);
  if (prefixMatch) return prefixMatch[1];

  // Check for country mention anywhere
  var countries = { NL: ['netherlands', 'nederland', '_nl_', '_nl-'], DE: ['germany', 'deutschland', '_de_', '_de-'], FR: ['france', '_fr_', '_fr-'], BE: ['belgium', 'belgi', '_be_', '_be-'], AT: ['austria', 'österreich', '_at_', '_at-'], UK: ['united kingdom', '_uk_', '_uk-'], US: ['united states', '_us_', '_us-'] };
  var lower = name.toLowerCase();
  var keys = Object.keys(countries);
  for (var i = 0; i < keys.length; i++) {
    var patterns = countries[keys[i]];
    for (var j = 0; j < patterns.length; j++) {
      if (lower.indexOf(patterns[j]) !== -1) return keys[i];
    }
  }

  return null;
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

    // Priority-pick (not sum) to avoid double counting.
    ap.totalPurchases += pickPurchaseCount(ad.actions);
    ap.totalRevenue += pickPurchaseRevenue(ad.action_values);
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

  // --- Per-product performance ---
  var productPerf = {};
  ads.forEach(function (ad) {
    var productKey = detectProduct(ad.ad_name || ad.adset_name || ad.campaign_name || '');
    if (!productKey) return;
    if (!productPerf[productKey]) productPerf[productKey] = { spend: 0, purchases: 0, revenue: 0, clicks: 0, impressions: 0 };
    var pp = productPerf[productKey];
    pp.spend += parseFloat(ad.spend) || 0;
    pp.clicks += parseInt(ad.clicks) || 0;
    pp.impressions += parseInt(ad.impressions) || 0;
    pp.purchases += pickPurchaseCount(ad.actions);
    pp.revenue += pickPurchaseRevenue(ad.action_values);
  });

  signals.productPerformance = {};
  Object.keys(productPerf).forEach(function (key) {
    var pp = productPerf[key];
    signals.productPerformance[key] = {
      spend: pp.spend,
      purchases: pp.purchases,
      revenue: pp.revenue,
      roas: pp.spend > 0 ? Math.round(pp.revenue / pp.spend * 100) / 100 : 0,
      ctr: pp.impressions > 0 ? Math.round(pp.clicks / pp.impressions * 10000) / 100 : 0
    };
  });

  // --- Per-angle revenue/ROAS ---
  signals.anglePerformance = {};
  Object.keys(anglePerf).forEach(function (angle) {
    var ap = anglePerf[angle];
    signals.anglePerformance[angle] = {
      spend: ap.totalSpend,
      purchases: ap.totalPurchases,
      revenue: ap.totalRevenue,
      roas: ap.totalSpend > 0 ? Math.round(ap.totalRevenue / ap.totalSpend * 100) / 100 : 0,
      ctr: ap.totalImpressions > 0 ? Math.round(ap.totalClicks / ap.totalImpressions * 10000) / 100 : 0,
      adCount: ap.adCount
    };
  });

  // --- Country/market detection from campaign names ---
  var countryPerf = {};
  ads.forEach(function (ad) {
    var country = detectCountry(ad.campaign_name || ad.adset_name || '');
    if (!country) return;
    if (!countryPerf[country]) countryPerf[country] = { spend: 0, purchases: 0, revenue: 0 };
    countryPerf[country].spend += parseFloat(ad.spend) || 0;
    countryPerf[country].purchases += pickPurchaseCount(ad.actions);
    countryPerf[country].revenue += pickPurchaseRevenue(ad.action_values);
  });

  signals.countryPerformance = {};
  Object.keys(countryPerf).forEach(function (c) {
    var cp = countryPerf[c];
    signals.countryPerformance[c] = {
      spend: cp.spend,
      purchases: cp.purchases,
      revenue: cp.revenue,
      roas: cp.spend > 0 ? Math.round(cp.revenue / cp.spend * 100) / 100 : 0
    };
  });

  // --- Top converting ads (for creative learning) ---
  var convertingAds = ads.filter(function (ad) {
    return pickPurchaseCount(ad.actions) > 0;
  }).map(function (ad) {
    var purchases = pickPurchaseCount(ad.actions);
    var revenue = pickPurchaseRevenue(ad.action_values);
    var spend = parseFloat(ad.spend) || 0;
    return {
      name: ad.ad_name,
      id: ad.ad_id,
      angle: detectAngle(ad.ad_name || ad.adset_name || ad.campaign_name || ''),
      product: detectProduct(ad.ad_name || ad.adset_name || ad.campaign_name || ''),
      purchases: purchases,
      revenue: revenue,
      roas: spend > 0 ? Math.round(revenue / spend * 100) / 100 : 0,
      spend: spend
    };
  }).sort(function (a, b) { return b.roas - a.roas; }).slice(0, 10);

  signals.topConvertingAds = convertingAds;

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
    fatigued: signals.fatigued.length,
    productsTracked: Object.keys(signals.productPerformance).length,
    countriesTracked: Object.keys(signals.countryPerformance).length,
    topConverters: signals.topConvertingAds.length
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
  detectAngle: detectAngle,
  detectProduct: detectProduct,
  detectCountry: detectCountry
};
