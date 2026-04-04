/**
 * Creative Brief Builder — transforms strategy into production-ready Predis payload fields.
 *
 * Chooses format, aspect ratio, ad concept, and special instructions.
 * Outputs fields suitable for Predis generation.
 */
var guardrails = require('./brand-guardrails');
var captionWriter = require('./caption-writer');
var dates = require('./dates');

var FORMAT_MAP = {
  top_of_funnel: { format: 'single_image', aspectRatio: '1:1' },
  mid_funnel: { format: 'carousel', aspectRatio: '1:1' },
  bottom_of_funnel: { format: 'single_image', aspectRatio: '4:5' }
};

var AD_CONCEPTS = {
  education: 'educational infographic with clean typography',
  pain_agitation: 'problem-solution split visual',
  product_mechanism: 'product close-up with ingredient callouts',
  objection_handling: 'myth vs fact comparison layout',
  lifestyle_premium: 'lifestyle product photography with minimal styling',
  conversion: 'hero product shot with bold CTA overlay'
};

/**
 * Build a complete creative brief from a content plan slot.
 * @param {object} planSlot - { angle, pillar, product, funnelStage, purpose, confidence, time }
 * @param {string} [dateStr] - YYYY-MM-DD
 * @returns {object} Complete brief ready for Predis payload builder
 */
function buildBrief(planSlot, dateStr) {
  var productInfo = guardrails.getProduct(planSlot.product) || guardrails.BRAND.products[0];
  var copy = captionWriter.generateCopy(Object.assign({}, planSlot, { date: dateStr || '' }));
  var formatConfig = FORMAT_MAP[planSlot.funnelStage] || FORMAT_MAP.top_of_funnel;
  var adConcept = AD_CONCEPTS[planSlot.pillar] || AD_CONCEPTS.education;

  // Build special instructions (max 200 chars by default)
  var specialInstructions = buildSpecialInstructions(planSlot, productInfo);

  // Product description for Predis
  var productDescription = productInfo.name + '. ' + productInfo.tagline + '. ' + productInfo.attributes.join(', ') + '.';

  return {
    // Identity
    slot: planSlot.slot,
    date: dateStr || dates.todayKey(),

    // Strategy
    angle: planSlot.angle,
    pillar: planSlot.pillar,
    product: planSlot.product,
    funnelStage: planSlot.funnelStage,
    purpose: planSlot.purpose,
    confidence: planSlot.confidence,
    metaBacked: planSlot.metaBacked || false,

    // Creative
    format: formatConfig.format,
    aspectRatio: formatConfig.aspectRatio,
    adConcept: adConcept,
    platform: planSlot.platform || 'instagram',

    // Copy
    hook: copy.hook,
    header: copy.header,
    caption: copy.caption,
    cta: copy.cta,
    valueClaims: copy.valueClaims,
    badge: copy.badge,
    body: copy.body,

    // Predis fields
    productDescription: productDescription,
    specialInstructions: specialInstructions,

    // Scheduling
    publishTime: planSlot.time || null,

    // State
    status: 'brief_ready',
    createdAt: new Date().toISOString()
  };
}

/**
 * Build special instructions for Predis (max 200 chars).
 */
function buildSpecialInstructions(planSlot, productInfo) {
  var parts = [];
  parts.push('CALQIX brand: minimalist, clinical, dark navy #0A1628 and white');
  parts.push(productInfo.name);

  if (planSlot.pillar === 'education') parts.push('educational tone');
  if (planSlot.pillar === 'conversion') parts.push('bold CTA');
  if (planSlot.pillar === 'lifestyle_premium') parts.push('premium aesthetic');

  var result = parts.join('. ');
  if (result.length > guardrails.MAX_SPECIAL_INSTRUCTIONS_LENGTH) {
    result = result.substring(0, guardrails.MAX_SPECIAL_INSTRUCTIONS_LENGTH - 3) + '...';
  }
  return result;
}

/**
 * Build briefs for all posts in a daily plan.
 * @param {object} plan - from content-planner
 * @returns {object} { post1: brief, post2: brief, reserve: brief }
 */
function buildAllBriefs(plan) {
  return {
    post1: buildBrief(plan.posts.post1, plan.date),
    post2: buildBrief(plan.posts.post2, plan.date),
    reserve: buildBrief(plan.posts.reserve, plan.date)
  };
}

module.exports = {
  buildBrief: buildBrief,
  buildAllBriefs: buildAllBriefs,
  FORMAT_MAP: FORMAT_MAP,
  AD_CONCEPTS: AD_CONCEPTS
};
