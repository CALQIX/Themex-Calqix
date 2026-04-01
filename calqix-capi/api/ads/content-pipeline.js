var { authDiagnostics } = require('../../lib/meta-ads');

var contentSuggestions = [
  {
    type: 'static_ad',
    platform: 'Predis.ai',
    angle: 'Before/After',
    hook: 'What 30 days of nano-hydroxyapatite actually looks like',
    product_description: 'CALQIX OralBiome tablets with nano-hydroxyapatite remineralise enamel, reduce sensitivity, and restore your smile — without fluoride.',
    format: 'square',
    ad_concept: 'Outcome-led',
    predis_instructions: {
      media_type: 'single_image',
      color_palette_type: 'brand',
      output_language: 'english'
    },
    auto_create_url: '/api/content/create-predis-ad',
    auto_create_body: {
      suggestion: {
        angle: 'Before/After',
        hook: 'What 30 days of nano-hydroxyapatite actually looks like',
        product_description: 'CALQIX OralBiome tablets with nano-hydroxyapatite remineralise enamel, reduce sensitivity, and restore your smile — without fluoride.',
        format: 'square',
        ad_concept: 'Outcome-led'
      },
      include_ai_image: true,
      ai_image_prompt: 'Split-screen before/after of tooth enamel. Left: rough, porous enamel with micro-lesions. Right: smooth, restored enamel. Clinical, clean. No text.'
    }
  },
  {
    type: 'static_ad',
    platform: 'Predis.ai',
    angle: 'Science/Authority',
    hook: 'Your toothpaste is missing 97% of what your teeth are made of',
    product_description: 'Nano-hydroxyapatite is identical to 97% of your tooth enamel. CALQIX OralBiome delivers it directly where it is needed.',
    format: 'square',
    ad_concept: 'Knowledge gap',
    predis_instructions: {
      media_type: 'single_image',
      color_palette_type: 'brand',
      output_language: 'english'
    },
    auto_create_url: '/api/content/create-predis-ad',
    auto_create_body: {
      suggestion: {
        angle: 'Science/Authority',
        hook: 'Your toothpaste is missing 97% of what your teeth are made of',
        product_description: 'Nano-hydroxyapatite is identical to 97% of your tooth enamel. CALQIX OralBiome delivers it directly where it is needed.',
        format: 'square',
        ad_concept: 'Knowledge gap'
      },
      include_ai_image: true,
      ai_image_prompt: 'Extreme macro of nano-hydroxyapatite crystals with hexagonal structure. Blue-white glow. Scientific, futuristic. Dark background.'
    }
  },
  {
    type: 'static_ad',
    platform: 'Predis.ai',
    angle: 'Routine/Lifestyle',
    hook: 'The 2-minute morning upgrade 4,000+ people switched to',
    product_description: 'Replace your toothpaste with a probiotic tablet. Chew, brush, done. CALQIX OralBiome — science-backed oral care.',
    format: 'square',
    ad_concept: 'Social proof + simplicity',
    predis_instructions: {
      media_type: 'single_image',
      color_palette_type: 'brand',
      output_language: 'english'
    },
    auto_create_url: '/api/content/create-predis-ad',
    auto_create_body: {
      suggestion: {
        angle: 'Routine/Lifestyle',
        hook: 'The 2-minute morning upgrade 4,000+ people switched to',
        product_description: 'Replace your toothpaste with a probiotic tablet. Chew, brush, done. CALQIX OralBiome — science-backed oral care.',
        format: 'square',
        ad_concept: 'Social proof + simplicity'
      },
      include_ai_image: true,
      ai_image_prompt: 'Modern bathroom countertop. Hand placing white tablet on tongue. Soft morning light. Minimalist. Premium lifestyle. No face visible.'
    }
  },
  {
    type: 'static_ad',
    platform: 'Predis.ai',
    angle: 'Problem/Solution (Bad Breath)',
    hook: 'Mouthwash kills 99% of bacteria. That is the problem.',
    product_description: 'Bad breath is caused by bacterial imbalance, not too few bacteria. CALQIX OralBiome uses probiotics to restore balance — not destroy it.',
    format: 'square',
    ad_concept: 'Contrarian',
    predis_instructions: {
      media_type: 'single_image',
      color_palette_type: 'brand',
      output_language: 'english'
    },
    auto_create_url: '/api/content/create-predis-ad',
    auto_create_body: {
      suggestion: {
        angle: 'Problem/Solution (Bad Breath)',
        hook: 'Mouthwash kills 99% of bacteria. That is the problem.',
        product_description: 'Bad breath is caused by bacterial imbalance, not too few bacteria. CALQIX OralBiome uses probiotics to restore balance — not destroy it.',
        format: 'square',
        ad_concept: 'Contrarian'
      },
      include_ai_image: false,
      ai_image_prompt: null
    }
  },
  {
    type: 'static_ad',
    platform: 'Predis.ai',
    angle: 'Fluoride Alternative',
    hook: 'Japan banned fluoride in toothpaste decades ago. Here is what they use instead.',
    product_description: 'Nano-hydroxyapatite has been the gold standard in Japan since 1993. Now available in Europe via CALQIX OralBiome tablets.',
    format: 'square',
    ad_concept: 'Curiosity + authority',
    predis_instructions: {
      media_type: 'single_image',
      color_palette_type: 'brand',
      output_language: 'english'
    },
    auto_create_url: '/api/content/create-predis-ad',
    auto_create_body: {
      suggestion: {
        angle: 'Fluoride Alternative',
        hook: 'Japan banned fluoride in toothpaste decades ago. Here is what they use instead.',
        product_description: 'Nano-hydroxyapatite has been the gold standard in Japan since 1993. Now available in Europe via CALQIX OralBiome tablets.',
        format: 'square',
        ad_concept: 'Curiosity + authority'
      },
      include_ai_image: true,
      ai_image_prompt: 'Scientific diagram: left fluoride coating ON TOP of enamel, right nano-HA filling INTO enamel structure. Clean schematic, navy and white.'
    }
  }
];

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  var filterType = req.query && req.query.type;
  var suggestions = filterType
    ? contentSuggestions.filter(function (s) { return s.type === filterType; })
    : contentSuggestions;

  return res.status(200).json({
    status: 'OK',
    total: suggestions.length,
    note: 'POST de auto_create_body naar auto_create_url om een Predis ad aan te maken. Vergeet dual auth niet (key + action_key).',
    suggestions: suggestions
  });
}

module.exports = handler;
