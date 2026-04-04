/**
 * Content Scorer — ranks daily content angle opportunities.
 *
 * Scoring factors:
 *   - Angle fatigue (lower fatigue = higher score)
 *   - Winning angle history (more wins = higher score)
 *   - Days since last use (more days = higher score)
 *   - Meta performance signals (high CTR angles boosted)
 *   - Product rotation balance (underused products boosted)
 *   - Pillar distribution (underused pillars boosted)
 */
var memory = require('./content-memory');

var PILLARS = ['education', 'pain_agitation', 'product_mechanism', 'objection_handling', 'lifestyle_premium', 'conversion'];

var ANGLES = [
  'enamel', 'gumline', 'breath_confidence', 'premium_daily_routine',
  'convenience', 'oral_microbiome', 'objection_handling', 'comparison_framing',
  'authority', 'science_driven_reassurance'
];

var PRODUCTS = ['toothpaste_tablets', 'water_flosser', 'oralbiome_pro'];

/**
 * Score all angles for today's content planning.
 * @param {object} [metaSignals] - { topAngles: [], weakAngles: [], ctrByAngle: {} }
 * @returns {Promise<Array<{angle: string, score: number, factors: object}>>}
 */
async function scoreAngles(metaSignals) {
  var angleScores = await memory.getAngleScores();
  var signals = metaSignals || {};
  var today = new Date();
  var results = [];

  ANGLES.forEach(function (angle) {
    var data = angleScores[angle] || { uses: 0, lastUsed: null, wins: 0, fatigue: 0 };
    var factors = {};

    // Base score
    var score = 50;

    // Fatigue penalty (0-100 fatigue maps to 0-40 penalty)
    var fatiguePenalty = (data.fatigue / 100) * 40;
    score -= fatiguePenalty;
    factors.fatigue = -fatiguePenalty;

    // Winning bonus (each win adds 3 points, max 15)
    var winBonus = Math.min(15, data.wins * 3);
    score += winBonus;
    factors.wins = winBonus;

    // Recency bonus (days since last use, max 20 points at 7+ days)
    var daysSinceUse = 30; // default if never used
    if (data.lastUsed) {
      var lastDate = new Date(data.lastUsed);
      daysSinceUse = Math.floor((today - lastDate) / 86400000);
    }
    var recencyBonus = Math.min(20, daysSinceUse * 3);
    score += recencyBonus;
    factors.recency = recencyBonus;

    // Meta signals
    if (signals.topAngles && signals.topAngles.indexOf(angle) !== -1) {
      score += 10;
      factors.metaTop = 10;
    }
    if (signals.weakAngles && signals.weakAngles.indexOf(angle) !== -1) {
      score -= 5;
      factors.metaWeak = -5;
    }
    if (signals.ctrByAngle && signals.ctrByAngle[angle]) {
      var ctrBonus = Math.min(10, signals.ctrByAngle[angle] * 2);
      score += ctrBonus;
      factors.metaCtr = ctrBonus;
    }

    // Under-tested bonus (fewer than 3 uses gets bonus)
    if (data.uses < 3) {
      var undertestedBonus = (3 - data.uses) * 5;
      score += undertestedBonus;
      factors.undertested = undertestedBonus;
    }

    results.push({ angle: angle, score: Math.round(score * 10) / 10, factors: factors });
  });

  results.sort(function (a, b) { return b.score - a.score; });
  return results;
}

/**
 * Score pillars based on recent usage distribution.
 * @returns {Promise<Array<{pillar: string, score: number}>>}
 */
async function scorePillars() {
  var topics = await memory.getPostedTopics(30);
  var pillarCounts = {};
  PILLARS.forEach(function (p) { pillarCounts[p] = 0; });

  topics.forEach(function (t) {
    if (t.meta && t.meta.pillar && pillarCounts[t.meta.pillar] !== undefined) {
      pillarCounts[t.meta.pillar]++;
    }
  });

  var total = topics.length || 1;
  var results = PILLARS.map(function (pillar) {
    var usage = pillarCounts[pillar] / total;
    // Lower usage = higher score (we want to balance)
    var score = 50 + (0.167 - usage) * 200; // 0.167 = 1/6 ideal distribution
    return { pillar: pillar, score: Math.round(score * 10) / 10, usage: pillarCounts[pillar] };
  });

  results.sort(function (a, b) { return b.score - a.score; });
  return results;
}

/**
 * Score products based on rotation balance.
 * @returns {Promise<Array<{product: string, score: number}>>}
 */
async function scoreProducts() {
  var rotation = await memory.getProductRotation();
  var results = PRODUCTS.map(function (product) {
    var data = rotation[product] || { count: 0, lastUsed: null };
    var score = 50;
    // Fewer uses = higher score
    score += Math.max(0, 20 - data.count * 2);
    // More days since use = higher score
    if (data.lastUsed) {
      var days = Math.floor((new Date() - new Date(data.lastUsed)) / 86400000);
      score += Math.min(20, days * 3);
    } else {
      score += 20;
    }
    return { product: product, score: Math.round(score * 10) / 10, uses: data.count };
  });
  results.sort(function (a, b) { return b.score - a.score; });
  return results;
}

/**
 * Calculate overall confidence score for a content plan.
 * @param {object} plan - { angle, pillar, product, metaBacked }
 * @param {Array} angleScores - from scoreAngles
 * @returns {number} 0-100
 */
function calculateConfidence(plan, angleScores) {
  var confidence = 50;

  // Angle score contribution (find selected angle score)
  var angleEntry = angleScores.find(function (a) { return a.angle === plan.angle; });
  if (angleEntry) {
    confidence += (angleEntry.score - 50) * 0.5; // scale contribution
  }

  // Meta-backed boost
  if (plan.metaBacked) confidence += 15;

  // Pillar freshness
  if (plan.pillarScore) confidence += (plan.pillarScore - 50) * 0.3;

  return Math.round(Math.max(0, Math.min(100, confidence)));
}

module.exports = {
  PILLARS: PILLARS,
  ANGLES: ANGLES,
  PRODUCTS: PRODUCTS,
  scoreAngles: scoreAngles,
  scorePillars: scorePillars,
  scoreProducts: scoreProducts,
  calculateConfidence: calculateConfidence
};
