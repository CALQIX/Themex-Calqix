/**
 * Brand & Compliance Agent — enforces CALQIX voice and aesthetics.
 *
 * Rules:
 *   - English only
 *   - Scientific but accessible, clinical but not cold
 *   - Never loud, never shouty (no ALL CAPS, no excessive !, no emoji spam)
 *   - Minimalist, medical/clinical, dark navy (#0A1628) and white
 *   - No spammy ad language ("BUY NOW!!!", "HURRY", "LIMITED TIME")
 *   - No unsubstantiated health claims
 *   - Products: nano-hydroxyapatite toothpaste tablets, white cordless water flosser
 *   - Audience: health-conscious 25-45, international
 */

var BLOCKED_PHRASES = [
  'buy now', 'hurry', 'limited time only', 'act fast', 'don\'t miss out',
  'once in a lifetime', 'guaranteed results', 'miracle', 'cure',
  'doctor recommended', 'clinically proven', 'fda approved',
  'kills 99%', 'destroys bacteria', '100% effective',
  'free gift', 'no risk', 'risk free', 'money back',
  'click here', 'subscribe now', 'order now',
  'biggest sale', 'massive discount', 'insane deal',
  'you won\'t believe', 'shocking', 'mind-blowing',
  'guaranteed', 'proven results', 'dentist-approved', 'act now',
  'unbelievable', 'cheap', 'bargain', 'instant results', 'overnight'
];

var RISKY_HEALTH_CLAIMS = [
  'prevents cavities', 'cures gum disease', 'whitens teeth guaranteed',
  'replaces dentist', 'medical grade', 'prescription strength',
  'treats periodontal', 'eliminates plaque', 'reverses decay',
  'heals gums', 'stops bleeding gums', 'removes tartar',
  'repairs cavities', 'as seen on tv', 'celebrity endorsed'
];

var ALLOWED_CLAIMS = [
  'nano-hydroxyapatite is a naturally occurring mineral found in tooth enamel',
  'clinically studied ingredient', 'fluoride-free alternative',
  '3 pressure modes: gentle, normal, deep clean', 'IPX7 waterproof rated',
  'USB-C rechargeable', '300ml water tank', '1400 pulses per minute',
  'vegan and cruelty-free'
];

var APPROVED_CTAS = [
  'Shop Now', 'Try It Risk-Free', 'Discover FlowCore',
  'Start Your Routine', 'Upgrade Your Routine', 'Learn More', 'Subscribe & Save'
];

var MAX_HEADLINE_CHARS = 40;
var MAX_PRIMARY_TEXT_CHARS = 125;

var CAPS_THRESHOLD = 0.3; // max 30% uppercase chars
var EXCLAMATION_THRESHOLD = 2; // max 2 exclamation marks
var EMOJI_THRESHOLD = 3; // max 3 emoji per text block
var MAX_SPECIAL_INSTRUCTIONS_LENGTH = 200;

var BRAND = {
  name: 'CALQIX',
  primaryColor: '#0A1628',
  secondaryColor: '#FFFFFF',
  tagline: 'Precision Oral Care.',
  tone: 'scientific, accessible, clinical, premium, minimalist',
  language: 'English',
  products: [
    {
      id: 'toothpaste_tablets',
      name: 'Nano-hydroxyapatite toothpaste tablets',
      tagline: 'Rebuild your enamel',
      attributes: ['fluoride-free', 'vegan', 'nano-hydroxyapatite']
    },
    {
      id: 'water_flosser',
      name: 'White cordless water flosser',
      tagline: 'Professional clean, anywhere',
      attributes: ['3 modes', '300ml tank', 'IPX7', 'USB-C', 'cordless']
    },
    {
      id: 'oralbiome_pro',
      name: 'OralBiome Pro',
      tagline: 'Complete oral care',
      attributes: ['oral microbiome', 'daily routine', 'premium']
    }
  ],
  audience: {
    ageRange: '25-45',
    psychographic: 'health-conscious consumers',
    markets: ['international'],
    languages: ['English']
  }
};

/**
 * Check text for brand compliance violations.
 * @param {string} text
 * @returns {{pass: boolean, violations: string[]}}
 */
function checkText(text) {
  if (!text || typeof text !== 'string') return { pass: true, violations: [] };
  var violations = [];
  var lower = text.toLowerCase();

  // Check blocked phrases
  BLOCKED_PHRASES.forEach(function (phrase) {
    if (lower.indexOf(phrase) !== -1) {
      violations.push('Blocked phrase: "' + phrase + '"');
    }
  });

  // Check risky health claims
  RISKY_HEALTH_CLAIMS.forEach(function (claim) {
    if (lower.indexOf(claim) !== -1) {
      violations.push('Risky health claim: "' + claim + '"');
    }
  });

  // Check for excessive caps (excluding short texts < 20 chars)
  if (text.length >= 20) {
    var upperCount = (text.match(/[A-Z]/g) || []).length;
    var letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 0 && upperCount / letterCount > CAPS_THRESHOLD) {
      violations.push('Too much uppercase (' + Math.round(upperCount / letterCount * 100) + '%)');
    }
  }

  // Check exclamation marks
  var exclamations = (text.match(/!/g) || []).length;
  if (exclamations > EXCLAMATION_THRESHOLD) {
    violations.push('Too many exclamation marks (' + exclamations + ')');
  }

  // Check emoji count
  var emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  var emojis = (text.match(emojiRegex) || []).length;
  if (emojis > EMOJI_THRESHOLD) {
    violations.push('Too many emoji (' + emojis + ')');
  }

  // Check for non-English (basic heuristic — flag if obviously non-English)
  // Only flag if there are words with special chars that aren't English
  var nonAsciiWords = text.match(/[^\x00-\x7F]{3,}/g);
  if (nonAsciiWords && nonAsciiWords.length > 2) {
    violations.push('Possible non-English content detected');
  }

  return {
    pass: violations.length === 0,
    violations: violations
  };
}

/**
 * Check a full content brief for brand compliance.
 * @param {object} brief
 * @returns {{pass: boolean, violations: string[], warnings: string[]}}
 */
function checkBrief(brief) {
  var allViolations = [];
  var warnings = [];

  // Check all text fields
  var textFields = ['caption', 'header', 'hook', 'cta', 'valueClaims', 'badge', 'specialInstructions', 'productDescription'];
  textFields.forEach(function (field) {
    if (brief[field]) {
      var result = checkText(brief[field]);
      if (!result.pass) {
        result.violations.forEach(function (v) {
          allViolations.push(field + ': ' + v);
        });
      }
    }
  });

  // Check special instructions length
  if (brief.specialInstructions && brief.specialInstructions.length > MAX_SPECIAL_INSTRUCTIONS_LENGTH) {
    warnings.push('Special instructions exceed ' + MAX_SPECIAL_INSTRUCTIONS_LENGTH + ' chars (' + brief.specialInstructions.length + ')');
  }

  // Check that product is valid
  if (brief.product) {
    var validProducts = BRAND.products.map(function (p) { return p.id; });
    if (validProducts.indexOf(brief.product) === -1) {
      warnings.push('Unknown product: ' + brief.product);
    }
  }

  return {
    pass: allViolations.length === 0,
    violations: allViolations,
    warnings: warnings
  };
}

/**
 * Get product info by ID.
 */
function getProduct(productId) {
  return BRAND.products.find(function (p) { return p.id === productId; }) || null;
}

module.exports = {
  BRAND: BRAND,
  BLOCKED_PHRASES: BLOCKED_PHRASES,
  RISKY_HEALTH_CLAIMS: RISKY_HEALTH_CLAIMS,
  checkText: checkText,
  checkBrief: checkBrief,
  getProduct: getProduct,
  MAX_SPECIAL_INSTRUCTIONS_LENGTH: MAX_SPECIAL_INSTRUCTIONS_LENGTH
};
