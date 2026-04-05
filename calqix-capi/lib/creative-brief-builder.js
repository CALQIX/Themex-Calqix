/**
 * Creative Brief Builder — transforms strategy into production-ready Predis payload fields.
 *
 * Chooses format, aspect ratio, ad concept, and special instructions.
 * Outputs fields suitable for Predis generation.
 */
var guardrails = require('./brand-guardrails');
var captionWriter = require('./caption-writer');
var dates = require('./dates');
var shopifyProducts = require('./shopify-products');
var planner = require('./content-planner');

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
 * @returns {Promise<object>} Complete brief ready for Predis payload builder
 */
async function buildBrief(planSlot, dateStr) {
  var productInfo = guardrails.getProduct(planSlot.product) || guardrails.BRAND.products[0];
  var copy = captionWriter.generateCopy(Object.assign({}, planSlot, { date: dateStr || '' }));
  var language = planSlot.language || 'nl';
  var marketInfo = planner.getMarketLanguage(planSlot.market || 'NL');
  var formatConfig = FORMAT_MAP[planSlot.funnelStage] || FORMAT_MAP.top_of_funnel;
  var adConcept = AD_CONCEPTS[planSlot.pillar] || AD_CONCEPTS.education;

  // Fetch Shopify product data for enrichment
  var shopifyData = await getShopifyEnrichment(planSlot.product);

  // Build special instructions (max 200 chars by default)
  var specialInstructions = buildSpecialInstructions(planSlot, productInfo, shopifyData);

  // Product description for Predis — enriched with Shopify data
  var productDescription = buildProductDescription(productInfo, shopifyData);

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

    // Shopify enrichment
    shopifyProduct: shopifyData ? {
      title: shopifyData.title,
      handle: shopifyData.handle,
      price: shopifyData.price,
      hasImages: shopifyData.images && shopifyData.images.length > 0
    } : null,

    // Scheduling
    publishTime: planSlot.time || null,

    // Market/Language
    market: planSlot.market || 'NL',
    language: language,
    output_language: marketInfo.output_language,
    locale: marketInfo.locale,

    // State
    status: 'brief_ready',
    createdAt: new Date().toISOString()
  };
}

/**
 * Fetch Shopify product data for brief enrichment.
 */
async function getShopifyEnrichment(productId) {
  try {
    var handle = shopifyProducts.resolveHandle(productId);
    if (!handle) return null;
    var product = await shopifyProducts.getProductByHandle(handle);
    return product;
  } catch (err) {
    console.warn('[BriefBuilder] Shopify enrichment failed:', err.message);
    return null;
  }
}

/**
 * Build enriched product description using Shopify data + brand guardrails.
 */
function buildProductDescription(productInfo, shopifyData) {
  var parts = [];

  // Use Shopify title if available, otherwise brand guardrails name
  if (shopifyData && shopifyData.title) {
    parts.push(shopifyData.title);
  } else {
    parts.push(productInfo.name);
  }

  parts.push(productInfo.tagline);

  // Add price if available
  if (shopifyData && shopifyData.price) {
    parts.push('From EUR ' + shopifyData.price);
  }

  // Add key attributes
  parts.push(productInfo.attributes.join(', '));

  return parts.join('. ') + '.';
}

/**
 * Build special instructions for Predis (max 200 chars).
 */
function buildSpecialInstructions(planSlot, productInfo, shopifyData) {
  var parts = [];
  var mktInfo = planner.getMarketLanguage(planSlot.market || 'NL');
  parts.push('Language: ' + mktInfo.label + '. CALQIX brand: minimalist, clinical, dark navy #0A1628 and white');

  // Use Shopify title if available for more accurate product reference
  if (shopifyData && shopifyData.title) {
    parts.push(shopifyData.title);
  } else {
    parts.push(productInfo.name);
  }

  if (planSlot.pillar === 'education') parts.push('educational tone');
  if (planSlot.pillar === 'conversion') parts.push('bold CTA');
  if (planSlot.pillar === 'lifestyle_premium') parts.push('premium aesthetic');
  if (planSlot.pillar === 'pain_agitation') parts.push('problem-solution focus');
  if (planSlot.pillar === 'objection_handling') parts.push('myth vs fact');
  if (planSlot.pillar === 'product_mechanism') parts.push('ingredient science');

  // Add price point if conversion-focused
  if (planSlot.purpose === 'conversion' && shopifyData && shopifyData.price) {
    parts.push('EUR ' + shopifyData.price);
  }

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
async function buildAllBriefs(plan) {
  var post1 = await buildBrief(plan.posts.post1, plan.date);
  var post2 = await buildBrief(plan.posts.post2, plan.date);
  var reserve = await buildBrief(plan.posts.reserve, plan.date);
  return {
    post1: post1,
    post2: post2,
    reserve: reserve
  };
}

module.exports = {
  buildBrief: buildBrief,
  buildAllBriefs: buildAllBriefs,
  FORMAT_MAP: FORMAT_MAP,
  AD_CONCEPTS: AD_CONCEPTS
};
