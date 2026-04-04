/**
 * Predis Payload Builder — maps creative briefs into Predis-ready payloads.
 *
 * Transforms the internal brief format into the specific payload structure
 * expected by the Predis.ai API (or future providers).
 */
var guardrails = require('./brand-guardrails');

var PLATFORM_MAP = {
  instagram: 'instagram',
  facebook: 'facebook',
  both: 'instagram,facebook'
};

var ASPECT_RATIO_MAP = {
  '1:1': 'square',
  '4:5': 'portrait',
  '9:16': 'story',
  '16:9': 'landscape'
};

/**
 * Build a Predis-compatible payload from a creative brief.
 * @param {object} brief - from creative-brief-builder
 * @returns {object} Predis API payload
 */
function buildPayload(brief) {
  var productInfo = guardrails.getProduct(brief.product) || guardrails.BRAND.products[0];

  return {
    // Predis core fields
    text: brief.caption || '',
    product_description: brief.productDescription || productInfo.name,
    special_instructions: brief.specialInstructions || '',
    aspect_ratio: ASPECT_RATIO_MAP[brief.aspectRatio] || 'square',
    platform: PLATFORM_MAP[brief.platform] || 'instagram',

    // Creative direction
    ad_concept: brief.adConcept || '',
    header: brief.header || '',
    cta_text: brief.cta || '',
    badge_text: brief.badge || '',
    value_claims: brief.valueClaims || '',

    // Language
    language: brief.language || 'nl',

    // Brand overrides
    brand_name: guardrails.BRAND.name,
    brand_color: guardrails.BRAND.primaryColor,
    secondary_color: guardrails.BRAND.secondaryColor,

    // Metadata (not sent to Predis, used for tracking)
    _meta: {
      slot: brief.slot,
      date: brief.date,
      angle: brief.angle,
      pillar: brief.pillar,
      product: brief.product,
      funnelStage: brief.funnelStage,
      confidence: brief.confidence,
      metaBacked: brief.metaBacked,
      market: brief.market || 'NL',
      language: brief.language || 'nl'
    }
  };
}

/**
 * Build payloads for all briefs in a daily set.
 * @param {object} briefs - { post1: brief, post2: brief, reserve: brief }
 * @returns {object} { post1: payload, post2: payload, reserve: payload }
 */
function buildAllPayloads(briefs) {
  return {
    post1: buildPayload(briefs.post1),
    post2: buildPayload(briefs.post2),
    reserve: buildPayload(briefs.reserve)
  };
}

/**
 * Validate a payload before submission.
 * @param {object} payload
 * @returns {{valid: boolean, errors: string[]}}
 */
function validatePayload(payload) {
  var errors = [];
  if (!payload.text && !payload.product_description) {
    errors.push('Missing text or product_description');
  }
  if (!payload.platform) {
    errors.push('Missing platform');
  }
  if (payload.special_instructions && payload.special_instructions.length > guardrails.MAX_SPECIAL_INSTRUCTIONS_LENGTH) {
    errors.push('special_instructions exceeds ' + guardrails.MAX_SPECIAL_INSTRUCTIONS_LENGTH + ' chars');
  }
  return { valid: errors.length === 0, errors: errors };
}

module.exports = {
  buildPayload: buildPayload,
  buildAllPayloads: buildAllPayloads,
  validatePayload: validatePayload
};
