/**
 * Creative Briefs Library — predefined content briefs for CALQIX products.
 *
 * Used by the content planner to select briefs for daily generation.
 * Each brief has a unique id, product, angle, media_type, and text.
 */

var BRIEFS = [
  {
    id: 'flowcore_product_first',
    product: 'FlowCore',
    angle: 'ProductFirst',
    media_type: 'single_image',
    text: 'Premium cordless water flosser with 3 pressure modes. Deep clean in 60 seconds. IPX7 waterproof, USB-C rechargeable. CALQIX FlowCore. Shop now at calqix.com'
  },
  {
    id: 'flowcore_problem_solution',
    product: 'FlowCore',
    angle: 'ProblemSolution',
    media_type: 'single_image',
    text: 'String floss misses 40% of tooth surfaces. Water flossing reaches every gap. 3 modes for sensitive to deep clean. CALQIX FlowCore - Precision Oral Care.'
  },
  {
    id: 'flowcore_comparison',
    product: 'FlowCore',
    angle: 'Comparison',
    media_type: 'single_image',
    text: 'Traditional floss vs CALQIX FlowCore. Manual threading vs 1400 pulses per minute. Painful gums vs gentle pressure modes. Old routine vs precision oral care.'
  },
  {
    id: 'flowcore_routine',
    product: 'FlowCore',
    angle: 'PremiumRoutine',
    media_type: 'single_image',
    text: '60 seconds. That is all it takes. Fill the tank, choose your mode, let FlowCore do the work. Your evening routine, upgraded. CALQIX - Precision Oral Care.'
  },
  {
    id: 'oralbiome_product_first',
    product: 'OralBiome',
    angle: 'ProductFirst',
    media_type: 'single_image',
    text: 'Nano-hydroxyapatite toothpaste tablets. No fluoride, no plastic tubes, no mess. Just bite, brush, smile. CALQIX OralBiome - Precision Oral Care.'
  },
  {
    id: 'oralbiome_problem_solution',
    product: 'OralBiome',
    angle: 'ProblemSolution',
    media_type: 'single_image',
    text: 'Your toothpaste tube is 80% water and plastic. Switch to nano-hydroxyapatite tablets. The mineral your enamel is actually made of. CALQIX OralBiome.'
  },
  {
    id: 'oralbiome_science',
    product: 'OralBiome',
    angle: 'ClinicalProof',
    media_type: 'single_image',
    text: 'Nano-hydroxyapatite: the clinically studied mineral that mirrors your natural tooth enamel. Fluoride-free. Vegan. Effective. CALQIX OralBiome tablets.'
  },
  {
    id: 'oralbiome_subscription',
    product: 'OralBiome',
    angle: 'OfferLed',
    media_type: 'single_image',
    text: 'Never run out of toothpaste again. Subscribe to CALQIX OralBiome tablets. Fresh supply delivered monthly. Save 15% on every refill.'
  },
  {
    id: 'bundle_routine',
    product: 'Bundle',
    angle: 'PremiumRoutine',
    media_type: 'single_image',
    text: 'The complete CALQIX routine. FlowCore water flosser + OralBiome tablets. Two products. One precision oral care system. Upgrade your daily routine.'
  }
];

/**
 * Get all briefs.
 * @returns {Array}
 */
function getAll() {
  return BRIEFS;
}

/**
 * Get briefs filtered by product and/or angle.
 * @param {object} [filter] - { product, angle }
 * @returns {Array}
 */
function filter(opts) {
  var result = BRIEFS;
  if (opts && opts.product) {
    result = result.filter(function (b) { return b.product === opts.product; });
  }
  if (opts && opts.angle) {
    result = result.filter(function (b) { return b.angle === opts.angle; });
  }
  return result;
}

/**
 * Get a brief by id.
 * @param {string} id
 * @returns {object|null}
 */
function getById(id) {
  return BRIEFS.find(function (b) { return b.id === id; }) || null;
}

/**
 * Get briefs excluding specific ids (for repeat avoidance).
 * @param {string[]} excludeIds
 * @returns {Array}
 */
function getExcluding(excludeIds) {
  return BRIEFS.filter(function (b) { return excludeIds.indexOf(b.id) === -1; });
}

module.exports = {
  BRIEFS: BRIEFS,
  getAll: getAll,
  filter: filter,
  getById: getById,
  getExcluding: getExcluding
};
