/**
 * Content Planner — Strategy + Research Agent.
 *
 * Decides daily content mix:
 *   - Selects platform objective
 *   - Chooses product focus
 *   - Chooses funnel stage
 *   - Chooses angle (avoiding overuse)
 *   - Uses Meta performance signals to inform decisions
 *
 * Produces a daily plan with 2 main posts + 1 reserve.
 */
var scorer = require('./content-scorer');
var memory = require('./content-memory');
var dates = require('./dates');

var MARKET_LANGUAGE_MAP = {
  DE: { output_language: 'german', label: 'Duits', code: 'de', locale: 'de' },
  AT: { output_language: 'german', label: 'Duits', code: 'de', locale: 'de' },
  NL: { output_language: 'dutch', label: 'Nederlands', code: 'nl', locale: 'nl' },
  BE: { output_language: 'dutch', label: 'Nederlands', code: 'nl', locale: 'nl' },
  FR: { output_language: 'french', label: 'Frans', code: 'fr', locale: 'fr' },
  UK: { output_language: 'english', label: 'Engels', code: 'en', locale: 'en' },
  US: { output_language: 'english', label: 'Engels', code: 'en', locale: 'en' },
  CH: { output_language: 'german', label: 'Duits', code: 'de', locale: 'de' },
  LU: { output_language: 'french', label: 'Frans', code: 'fr', locale: 'fr' },
  SE: { output_language: 'swedish', label: 'Zweeds', code: 'sv', locale: 'sv' },
  NO: { output_language: 'norwegian', label: 'Noors', code: 'nb', locale: 'nb' },
  DK: { output_language: 'danish', label: 'Deens', code: 'da', locale: 'da' },
  FI: { output_language: 'finnish', label: 'Fins', code: 'fi', locale: 'fi' },
  IS: { output_language: 'english', label: 'Engels', code: 'en', locale: 'en' }
};

function getMarketLanguage(country) {
  return MARKET_LANGUAGE_MAP[country] || MARKET_LANGUAGE_MAP.NL;
}

/**
 * Get ad-specific language for a country (native language for paid ads).
 * Content posts always use English; ads use the target market language.
 */
function getAdLanguage(country) {
  var ml = MARKET_LANGUAGE_MAP[country] || MARKET_LANGUAGE_MAP.NL;
  return { output_language: ml.output_language, label: ml.label, code: ml.code, locale: ml.locale };
}

/**
 * Get content language (always English for organic posts).
 */
function getContentLanguage() {
  return { output_language: 'english', label: 'Engels', code: 'en', locale: 'en' };
}

var DEFAULT_MARKET = { country: 'NL', output_language: 'dutch', label: 'Nederlands', code: 'nl', locale: 'nl' };

var SLOT_CONFIGS = {
  post1: {
    time: '08:30',
    purpose: 'awareness',
    funnelStage: 'top_of_funnel',
    description: 'Education, trust, oral microbiome, enamel, premium hygiene',
    preferredPillars: ['education', 'lifestyle_premium', 'product_mechanism']
  },
  post2: {
    time: '18:30',
    purpose: 'conversion',
    funnelStage: 'bottom_of_funnel',
    description: 'Product-led, problem-solution, water flosser benefit, CTA',
    preferredPillars: ['conversion', 'pain_agitation', 'objection_handling']
  },
  reserve: {
    time: null,
    purpose: 'backup',
    funnelStage: 'mid_funnel',
    description: 'Reserve post in case main assets fail QA',
    preferredPillars: ['education', 'product_mechanism', 'lifestyle_premium']
  }
};

/**
 * Generate a daily content plan.
 * @param {object} [metaSignals] - Performance signals from Meta insights
 * @param {string} [dateStr] - YYYY-MM-DD, defaults to today
 * @returns {Promise<object>} Daily plan with 3 post briefs
 */
async function generateDailyPlan(metaSignals, dateStr) {
  var date = dateStr || dates.todayKey();

  // Check for existing plan
  var existing = await memory.getDailyPlan(date);
  if (existing && existing.status !== 'draft') {
    console.log('[ContentPlanner] Plan already exists for', date);
    return existing;
  }

  // Score everything
  var angleScores = await scorer.scoreAngles(metaSignals);
  var pillarScores = await scorer.scorePillars();
  var productScores = await scorer.scoreProducts();

  // Enrich product scores with conversion data from Meta signals
  if (metaSignals && metaSignals.productPerformance) {
    productScores = enrichProductScores(productScores, metaSignals.productPerformance);
  }

  // Enrich angle scores with revenue/ROAS data
  if (metaSignals && metaSignals.anglePerformance) {
    angleScores = enrichAngleScores(angleScores, metaSignals.anglePerformance);
  }

  // Get recent hooks/topics to avoid
  var recentHooks = await memory.getPostedHooks(20);
  var recentTopics = await memory.getPostedTopics(20);

  // Assign content slots
  var usedAngles = [];
  var usedPillars = [];
  var usedProducts = [];

  // Determine target markets from performance data
  var markets = pickMarkets(metaSignals);

  var post1 = assignSlot('post1', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals, markets[0]);
  var post2 = assignSlot('post2', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals, markets[1]);
  var reserve = assignSlot('reserve', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals, markets[2] || DEFAULT_MARKET);

  var plan = {
    date: date,
    status: 'planned',
    createdAt: new Date().toISOString(),
    metaSignalsUsed: Boolean(metaSignals),
    posts: {
      post1: post1,
      post2: post2,
      reserve: reserve
    },
    scoringSnapshot: {
      topAngles: angleScores.slice(0, 5),
      topPillars: pillarScores.slice(0, 3),
      topProducts: productScores.slice(0, 3)
    },
    dataEnrichment: {
      productPerformance: (metaSignals && metaSignals.productPerformance) || {},
      anglePerformance: (metaSignals && metaSignals.anglePerformance) || {},
      topConvertingAds: (metaSignals && metaSignals.topConvertingAds) ? metaSignals.topConvertingAds.slice(0, 3) : [],
      countryPerformance: (metaSignals && metaSignals.countryPerformance) || {}
    }
  };

  await memory.setDailyPlan(date, plan);
  console.log('[ContentPlanner] Generated plan for', date, {
    post1: post1.angle + '/' + post1.pillar,
    post2: post2.angle + '/' + post2.pillar,
    reserve: reserve.angle + '/' + reserve.pillar
  });

  return plan;
}

/**
 * Assign a content slot with best available angle/pillar/product.
 */
function assignSlot(slotName, angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals, market) {
  var config = SLOT_CONFIGS[slotName];

  // Pick best pillar (prefer slot-aligned pillars)
  var pillar = pickBestPillar(pillarScores, config.preferredPillars, usedPillars);
  usedPillars.push(pillar);

  // Pick best angle (avoid already-used)
  var angle = pickBestAngle(angleScores, usedAngles);
  usedAngles.push(angle);

  // Pick best product (balance usage)
  var product = pickBestProduct(productScores, usedProducts);
  usedProducts.push(product);

  // Determine if meta-backed
  var metaBacked = false;
  if (metaSignals && metaSignals.topAngles && metaSignals.topAngles.indexOf(angle) !== -1) {
    metaBacked = true;
  }

  var confidence = scorer.calculateConfidence({
    angle: angle,
    pillar: pillar,
    product: product,
    metaBacked: metaBacked,
    pillarScore: (pillarScores.find(function (p) { return p.pillar === pillar; }) || {}).score
  }, angleScores);

  // Check if product is also meta-backed (has conversion data)
  var productMetaBacked = false;
  if (metaSignals && metaSignals.productPerformance && metaSignals.productPerformance[product]) {
    var pp = metaSignals.productPerformance[product];
    if (pp.roas > 1.5 || pp.purchases > 2) productMetaBacked = true;
  }

  return {
    slot: slotName,
    time: config.time,
    purpose: config.purpose,
    funnelStage: config.funnelStage,
    angle: angle,
    pillar: pillar,
    product: product,
    confidence: confidence,
    metaBacked: metaBacked,
    productMetaBacked: productMetaBacked,
    market: market ? market.country : DEFAULT_MARKET.country,
    language: 'en',
    output_language: 'english',
    locale: 'en',
    ad_output_language: market ? market.output_language : DEFAULT_MARKET.output_language,
    ad_locale: market ? market.locale : DEFAULT_MARKET.locale,
    platform: 'instagram',
    status: 'planned'
  };
}

function pickBestAngle(angleScores, used) {
  for (var i = 0; i < angleScores.length; i++) {
    if (used.indexOf(angleScores[i].angle) === -1) return angleScores[i].angle;
  }
  return angleScores[0].angle;
}

function pickBestPillar(pillarScores, preferred, used) {
  // First try preferred pillars not yet used
  for (var i = 0; i < pillarScores.length; i++) {
    var p = pillarScores[i].pillar;
    if (preferred.indexOf(p) !== -1 && used.indexOf(p) === -1) return p;
  }
  // Then any unused pillar
  for (var j = 0; j < pillarScores.length; j++) {
    if (used.indexOf(pillarScores[j].pillar) === -1) return pillarScores[j].pillar;
  }
  return pillarScores[0].pillar;
}

function pickBestProduct(productScores, used) {
  for (var i = 0; i < productScores.length; i++) {
    if (used.indexOf(productScores[i].product) === -1) return productScores[i].product;
  }
  return productScores[0].product;
}

/**
 * Enrich product scores with Meta conversion data.
 * Products with higher ROAS get a boost, low performers get penalized.
 */
function enrichProductScores(productScores, productPerformance) {
  return productScores.map(function (ps) {
    var perf = productPerformance[ps.product];
    if (!perf) return ps;

    var bonus = 0;
    // ROAS bonus: >2x = +15, >1.5x = +10, >1x = +5
    if (perf.roas > 2.0) bonus += 15;
    else if (perf.roas > 1.5) bonus += 10;
    else if (perf.roas > 1.0) bonus += 5;

    // Purchase volume bonus: more purchases = more confidence
    if (perf.purchases > 5) bonus += 10;
    else if (perf.purchases > 2) bonus += 5;

    // Low performance penalty
    if (perf.spend > 20 && perf.purchases === 0) bonus -= 10;

    return {
      product: ps.product,
      score: Math.round((ps.score + bonus) * 10) / 10,
      uses: ps.uses,
      metaBonus: bonus,
      roas: perf.roas,
      purchases: perf.purchases
    };
  }).sort(function (a, b) { return b.score - a.score; });
}

/**
 * Enrich angle scores with Meta revenue/ROAS data.
 * High-revenue angles get a boost proportional to their ROAS.
 */
function enrichAngleScores(angleScores, anglePerformance) {
  return angleScores.map(function (as) {
    var perf = anglePerformance[as.angle];
    if (!perf) return as;

    var revenueBonus = 0;
    // Revenue-based bonus
    if (perf.roas > 3.0) revenueBonus += 12;
    else if (perf.roas > 2.0) revenueBonus += 8;
    else if (perf.roas > 1.0) revenueBonus += 4;

    // Volume bonus
    if (perf.purchases > 3) revenueBonus += 5;

    // Penalty for expensive no-converters
    if (perf.spend > 30 && perf.purchases === 0) revenueBonus -= 8;

    var newFactors = Object.assign({}, as.factors, { metaRevenue: revenueBonus });

    return {
      angle: as.angle,
      score: Math.round((as.score + revenueBonus) * 10) / 10,
      factors: newFactors
    };
  }).sort(function (a, b) { return b.score - a.score; });
}

/**
 * Determine target markets from country performance data.
 * Returns array of 3 market objects: top 2 performers + a diverse third.
 */
function pickMarkets(metaSignals) {
  var deDef = { country: 'DE', output_language: 'german', label: 'Duits', code: 'de', locale: 'de' };
  if (!metaSignals || !metaSignals.countryPerformance) {
    return [DEFAULT_MARKET, deDef, DEFAULT_MARKET];
  }

  var cp = metaSignals.countryPerformance;
  var countries = Object.keys(cp);

  // Sort by revenue, then by spend
  countries.sort(function (a, b) {
    var ra = cp[a].revenue || 0;
    var rb = cp[b].revenue || 0;
    if (rb !== ra) return rb - ra;
    return (cp[b].spend || 0) - (cp[a].spend || 0);
  });

  var result = [];
  var usedCodes = [];
  for (var i = 0; i < countries.length && result.length < 3; i++) {
    var c = countries[i];
    var ml = MARKET_LANGUAGE_MAP[c];
    if (!ml) continue;
    if (result.length < 2 || usedCodes.indexOf(ml.code) === -1) {
      result.push({ country: c, output_language: ml.output_language, label: ml.label, code: ml.code, locale: ml.locale });
      if (usedCodes.indexOf(ml.code) === -1) usedCodes.push(ml.code);
    }
  }

  while (result.length < 3) {
    result.push(result.length === 0 ? DEFAULT_MARKET : deDef);
  }

  return result;
}

module.exports = {
  SLOT_CONFIGS: SLOT_CONFIGS,
  MARKET_LANGUAGE_MAP: MARKET_LANGUAGE_MAP,
  getMarketLanguage: getMarketLanguage,
  getAdLanguage: getAdLanguage,
  getContentLanguage: getContentLanguage,
  generateDailyPlan: generateDailyPlan
};
