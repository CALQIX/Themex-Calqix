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

  // Get recent hooks/topics to avoid
  var recentHooks = await memory.getPostedHooks(20);
  var recentTopics = await memory.getPostedTopics(20);

  // Assign content slots
  var usedAngles = [];
  var usedPillars = [];
  var usedProducts = [];

  var post1 = assignSlot('post1', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals);
  var post2 = assignSlot('post2', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals);
  var reserve = assignSlot('reserve', angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals);

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
function assignSlot(slotName, angleScores, pillarScores, productScores, usedAngles, usedPillars, usedProducts, metaSignals) {
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

module.exports = {
  SLOT_CONFIGS: SLOT_CONFIGS,
  generateDailyPlan: generateDailyPlan
};
