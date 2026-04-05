/**
 * Caption Writer — Copy Agent for CALQIX content.
 *
 * Generates hooks, captions, CTAs, headlines, value claims, badge text.
 * Adapts to awareness vs conversion posts.
 * Keeps language native, premium, and concise.
 *
 * Uses template-based generation with angle/pillar/product awareness.
 */
var guardrails = require('./brand-guardrails');

// --- Hook Templates by Angle ---

var HOOKS = {
  enamel: [
    'Your enamel doesn\'t regenerate on its own. But it can be rebuilt.',
    'The mineral your dentist never told you about.',
    'Enamel loss starts silently. Here\'s how to reverse it.',
    'What if your toothpaste could actually rebuild what brushing wears away?'
  ],
  gumline: [
    'The space between your teeth is where disease begins.',
    'Brushing alone misses 40% of tooth surfaces.',
    'Your gumline needs more than bristles can reach.',
    'The area your toothbrush can\'t clean is the one that matters most.'
  ],
  breath_confidence: [
    'Confidence starts with a clean oral microbiome.',
    'Fresh breath isn\'t about masking. It\'s about balance.',
    'The science behind breath you never have to think about.',
    'Bad breath is a microbiome problem, not a mouthwash problem.'
  ],
  premium_daily_routine: [
    'A routine designed for people who take health seriously.',
    'Premium oral care, simplified.',
    'The daily ritual that changes everything about your smile.',
    'Elevate your morning. Start with the right formula.'
  ],
  convenience: [
    'Professional-grade clean. No appointment needed.',
    'Three modes. One device. Anywhere you go.',
    'Oral care that fits in your carry-on.',
    'USB-C charging. 300ml tank. IPX7 waterproof. Done.'
  ],
  oral_microbiome: [
    'Your mouth hosts 700+ bacterial species. Balance is everything.',
    'The oral microbiome is the gateway to systemic health.',
    'Disrupting your mouth\'s ecosystem does more harm than good.',
    'Feed the good bacteria. Starve the bad ones.'
  ],
  objection_handling: [
    'Fluoride-free doesn\'t mean less effective. Here\'s the science.',
    'Tablets instead of tubes? There\'s a reason.',
    'Why premium oral care costs less than you think.',
    'Skeptical about nano-hydroxyapatite? Let the research speak.'
  ],
  comparison_framing: [
    'Traditional toothpaste vs. what science actually recommends.',
    'String floss compliance: 30%. Water flosser compliance: 80%.',
    'The ingredient dentists in Japan have used for decades.',
    'What separates clinical oral care from drugstore products.'
  ],
  authority: [
    'Backed by peer-reviewed research on enamel remineralization.',
    'The same mineral found naturally in your teeth.',
    'Used in clinical settings across Japan and Europe.',
    'When science meets daily routine.'
  ],
  science_driven_reassurance: [
    'Nano-hydroxyapatite: the biocompatible mineral your enamel is made of.',
    'Clinically studied. Naturally derived. Deliberately formulated.',
    'The evidence behind every ingredient we chose.',
    'No fillers. No unnecessary chemicals. Just science.'
  ]
};

// --- CTA Templates by Funnel Stage ---

var CTAS = {
  top_of_funnel: [
    'Discover the science →',
    'Learn more about your oral microbiome',
    'See what makes CALQIX different',
    'Explore the routine'
  ],
  mid_funnel: [
    'Try CALQIX today',
    'Start your 30-day reset',
    'Experience the difference',
    'See the full collection'
  ],
  bottom_of_funnel: [
    'Shop now — free shipping on orders over €50',
    'Add to your routine',
    'Get yours today',
    'Start rebuilding your enamel'
  ]
};

// --- Caption Templates by Pillar ---

var CAPTION_TEMPLATES = {
  education: '{hook}\n\n{body}\n\nThe oral microbiome is complex — but caring for it doesn\'t have to be.\n\n{cta}',
  pain_agitation: '{hook}\n\n{body}\n\nMost people don\'t realize this until damage is visible.\n\n{cta}',
  product_mechanism: '{hook}\n\n{body}\n\nEvery ingredient serves a purpose. Nothing more, nothing less.\n\n{cta}',
  objection_handling: '{hook}\n\n{body}\n\nWe understand the skepticism. The research doesn\'t lie.\n\n{cta}',
  lifestyle_premium: '{hook}\n\n{body}\n\nElevate your daily routine.\n\n{cta}',
  conversion: '{hook}\n\n{body}\n\n{cta}'
};

// --- Body Templates by Product ---

var BODY_TEMPLATES = {
  toothpaste_tablets: {
    education: 'Nano-hydroxyapatite is the same mineral that makes up 97% of your tooth enamel. Unlike fluoride, it works by directly depositing minerals back into demineralized areas — rebuilding what daily wear strips away.',
    pain_agitation: 'Every time you eat, acids attack your enamel. Traditional toothpaste can only slow the damage. CALQIX tablets actively rebuild the mineral structure your teeth are losing.',
    product_mechanism: 'Each tablet delivers a precise dose of nano-hydroxyapatite directly to tooth surfaces. No water waste, no tube waste, no guesswork. Chew, brush, rebuild.',
    objection_handling: 'Fluoride works by creating a protective layer. Nano-hydroxyapatite goes further — it integrates into enamel structure itself. Decades of Japanese clinical research confirm this.',
    lifestyle_premium: 'A single tablet. A clean brush. Two minutes. That\'s all it takes to rebuild enamel, freshen breath, and protect your microbiome.',
    conversion: 'CALQIX toothpaste tablets. Fluoride-free. Vegan. Nano-hydroxyapatite powered. Rebuild your enamel with every brush.'
  },
  water_flosser: {
    education: 'Water flossing removes up to 99.9% of plaque from treated areas. It reaches spaces that brushing and string floss simply cannot.',
    pain_agitation: 'If you\'re only brushing, you\'re only cleaning 60% of tooth surfaces. The remaining 40% is where gum disease starts.',
    product_mechanism: 'Three pressure modes — Clean, Soft, Massage — adapt to your sensitivity. A 300ml tank means no mid-session refills. IPX7 waterproof for shower use. USB-C charging.',
    objection_handling: 'String floss compliance is notoriously low. Water flossers are easier to use, gentler on gums, and clinically more effective at reducing gingivitis.',
    lifestyle_premium: 'Cordless. Waterproof. Travel-ready. A professional clean that fits anywhere your life takes you.',
    conversion: 'CALQIX water flosser. 3 modes. 300ml tank. IPX7. USB-C. The clean your dentist recommends — at home.'
  },
  oralbiome_pro: {
    education: 'Complete oral care isn\'t one product. It\'s a system. OralBiome Pro combines nano-hydroxyapatite remineralization with precision water flossing.',
    pain_agitation: 'Your mouth is an ecosystem. One product can\'t manage it. A routine designed around the oral microbiome can.',
    product_mechanism: 'Rebuild enamel with nano-hydroxyapatite tablets. Clean below the gumline with a precision water flosser. Protect the microbiome with every step.',
    objection_handling: 'Premium oral care pays for itself. Fewer cavities, healthier gums, and confidence that doesn\'t depend on mouthwash.',
    lifestyle_premium: 'The complete CALQIX routine. Designed for people who treat health as an investment, not an afterthought.',
    conversion: 'OralBiome Pro. The complete CALQIX oral care system. Rebuild. Clean. Protect. Every day.'
  }
};

// --- Badge Templates ---

var BADGES = {
  toothpaste_tablets: ['Fluoride-free', 'Vegan', 'n-HAp powered', 'Zero waste'],
  water_flosser: ['3 modes', 'IPX7', 'USB-C', 'Cordless'],
  oralbiome_pro: ['Complete system', 'Science-backed', 'Premium', 'Daily routine']
};

// --- Value Claim Templates ---

var VALUE_CLAIMS = {
  toothpaste_tablets: ['Rebuilds enamel naturally', 'Biocompatible mineral formula', 'No harsh chemicals', 'Precise dosing per tablet'],
  water_flosser: ['Removes 99.9% plaque', 'Reaches below the gumline', 'Gentle on sensitive gums', 'Professional-grade clean'],
  oralbiome_pro: ['Complete oral ecosystem care', 'Rebuild + Clean + Protect', 'Science-driven formulation', 'Premium daily routine']
};

/**
 * Generate copy for a content brief.
 * @param {object} plan - { angle, pillar, product, funnelStage, purpose }
 * @returns {object} { hook, caption, cta, header, valueClaims, badge }
 */
function generateCopy(plan) {
  var angle = plan.angle || 'enamel';
  var pillar = plan.pillar || 'education';
  var product = plan.product || 'toothpaste_tablets';
  var funnelStage = plan.funnelStage || 'top_of_funnel';

  // Pick hook (rotate based on date to avoid same pick)
  var hookOptions = HOOKS[angle] || HOOKS.enamel;
  var hookIndex = hashToIndex(plan.date || '', hookOptions.length);
  var hook = hookOptions[hookIndex];

  // Pick CTA
  var ctaOptions = CTAS[funnelStage] || CTAS.top_of_funnel;
  var ctaIndex = hashToIndex((plan.date || '') + pillar, ctaOptions.length);
  var cta = ctaOptions[ctaIndex];

  // Build body
  var bodyTemplates = BODY_TEMPLATES[product] || BODY_TEMPLATES.toothpaste_tablets;
  var body = bodyTemplates[pillar] || bodyTemplates.education;

  // Build caption from template
  var template = CAPTION_TEMPLATES[pillar] || CAPTION_TEMPLATES.education;
  var caption = template
    .replace('{hook}', hook)
    .replace('{body}', body)
    .replace('{cta}', cta);

  // Header (shorter version of hook)
  var header = hook.length > 60 ? hook.substring(0, 57) + '...' : hook;

  // Badge and value claims
  var badges = BADGES[product] || [];
  var badge = badges[hashToIndex(angle, badges.length)] || '';
  var valueClaims = (VALUE_CLAIMS[product] || []).join(' | ');

  return {
    hook: hook,
    caption: caption,
    cta: cta,
    header: header,
    valueClaims: valueClaims,
    badge: badge,
    body: body
  };
}

/**
 * Simple deterministic index from a string seed.
 */
function hashToIndex(seed, length) {
  if (length <= 0) return 0;
  var hash = 0;
  for (var i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % length;
}

module.exports = {
  generateCopy: generateCopy,
  HOOKS: HOOKS,
  CTAS: CTAS,
  CAPTION_TEMPLATES: CAPTION_TEMPLATES,
  BODY_TEMPLATES: BODY_TEMPLATES,
  BADGES: BADGES,
  VALUE_CLAIMS: VALUE_CLAIMS
};
