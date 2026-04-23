/**
 * Anthropic-based OralBiome Pro review generator.
 *
 * Generates unique, human-sounding product reviews in the native language of
 * a randomly selected EU/UK market. Output matches the existing pool schema
 * in `data/ob-review-pool.json`:
 *
 *   { cc, co, n, r, t, b, tg }
 *
 * Individual failures (timeout, rate-limit, malformed JSON) are surfaced to
 * the caller so the cron can fall back to the handcrafted pool for missing
 * entries. We never return half-filled records.
 */
'use strict';

var MODEL = 'claude-sonnet-4-20250514';
var API_URL = 'https://api.anthropic.com/v1/messages';
var TIMEOUT_MS = 30000;

// Curated EU/UK markets CALQIX ships to. Names are common first-names in each
// market; the model uses one verbatim so output stays culturally plausible.
var MARKETS = [
  { cc: 'NL', co: 'Netherlands',    lang: 'Dutch',      names: ['Sanne','Thijs','Lieke','Daan','Iris','Bram','Noor','Sven','Fleur','Jeroen','Maud','Koen','Emma','Lucas','Roos','Tess','Mart'] },
  { cc: 'BE', co: 'Belgium',        lang: 'Dutch',      names: ['Elise','Matthias','Jana','Lars','Marieke','Seppe','Tine','Kobe','Fien','Wout','Lotte','Arne'] },
  { cc: 'DE', co: 'Germany',        lang: 'German',     names: ['Lena','Moritz','Hannah','Felix','Greta','Jonas','Lara','Paul','Sophie','Niklas','Clara','Max','Lina','Finn','Leonie','Jana','Tim'] },
  { cc: 'AT', co: 'Austria',        lang: 'German',     names: ['Verena','Florian','Magdalena','Simon','Teresa','Lukas','Andreas','Johanna','Stefan'] },
  { cc: 'CH', co: 'Switzerland',    lang: 'German',     names: ['Livia','Matthias','Selina','Adrian','Nina','Sandro','Anja','Reto','Noemi','Fabian'] },
  { cc: 'FR', co: 'France',         lang: 'French',     names: ['Camille','Arthur','Léa','Hugo','Chloé','Théo','Manon','Antoine','Juliette','Maxime','Clémence','Gabriel','Inès','Louis'] },
  { cc: 'IT', co: 'Italy',          lang: 'Italian',    names: ['Giulia','Lorenzo','Martina','Matteo','Sofia','Francesco','Chiara','Alessandro','Giorgia','Andrea','Elena','Marco'] },
  { cc: 'ES', co: 'Spain',          lang: 'Spanish',    names: ['Lucía','Hugo','Martina','Mateo','Sofía','Daniel','Valeria','Pablo','Paula','Álvaro','Carla','Javier'] },
  { cc: 'PT', co: 'Portugal',       lang: 'Portuguese', names: ['Mariana','Rodrigo','Leonor','Tiago','Beatriz','Gonçalo','Matilde','Afonso'] },
  { cc: 'DK', co: 'Denmark',        lang: 'Danish',     names: ['Freja','Oscar','Ida','Magnus','Alma','Lucas','Agnes','Noah'] },
  { cc: 'SE', co: 'Sweden',         lang: 'Swedish',    names: ['Alice','Oscar','Wilma','Hugo','Ebba','Liam','Alma','Elias'] },
  { cc: 'NO', co: 'Norway',         lang: 'Norwegian',  names: ['Nora','Emil','Ingrid','Jakob','Sofie','Aksel','Maja','Lukas'] },
  { cc: 'FI', co: 'Finland',        lang: 'Finnish',    names: ['Aino','Eino','Helmi','Onni','Sofia','Väinö','Ilona','Elias'] },
  { cc: 'IE', co: 'Ireland',        lang: 'English',    names: ['Aoife','Conor','Saoirse','Cillian','Niamh','Oisín','Ciara','Eoin','Róisín','Liam'] },
  { cc: 'GB', co: 'United Kingdom', lang: 'English',    names: ['Amelia','Oliver','Isla','Harry','Ava','George','Poppy','Jack','Grace','Charlie'] }
];

var TAG_POOL = [
  'breath','plaque','gums','sensitivity','whitening','dental','kids','family','travel','pregnancy',
  'braces','coffee','morning','evening','xylitol','probiotic','freshmint','peach','grape','orange',
  'consistency','routine','results','gentle','luxurious','subscription','value','flavor','taste',
  'packaging','trust','science','dentist'
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function pickRating() {
  // Weight toward 5★, small 4★ minority, very rare 3★ — mirrors real DTC review curves.
  var r = Math.random();
  if (r < 0.75) return 5;
  if (r < 0.96) return 4;
  return 3;
}

function buildPrompt(market, rating, flavorHint) {
  var name = pickRandom(market.names);
  return [
    'You are generating ONE authentic product review for CALQIX OralBiome Pro, an oral-care probiotic',
    'lozenge (ingredients: L. reuteri DSM 17938, L. paracasei ATCC 11379, S. salivarius K12, S. salivarius',
    'M18, xylitol, natural flavoring). It is a daily lozenge, not a medicine.',
    '',
    'Write as if posted by a real customer. Absolutely no AI-speak, no hashtags, no emoji, no marketing',
    'buzzwords, no health claims. Casual, sincere, specific. Include at least one concrete detail',
    '(daily routine, taste, who recommended it, when they first noticed something, etc.).',
    '',
    'Return STRICT JSON only — no code fences, no preamble. Schema:',
    '{"n":"<first name>","t":"<short title, max 60 chars>","b":"<body, 2-4 sentences, 140-320 chars>","tg":["<tag>","<tag>","<tag>"]}',
    '',
    'Constraints:',
    '- Language: ' + market.lang + ' (country: ' + market.co + '). Write title AND body entirely in this language.',
    '- Reviewer first name: "' + name + '" (use exactly as given, no surname).',
    '- Star rating context: ' + rating + '/5 — tone must match (5=enthusiastic; 4=positive with one small reservation; 3=mixed but fair).',
    '- If flavor is mentioned, use: ' + flavorHint + '. Only mention if natural.',
    '- Tags: pick 2-4 short lowercase English keywords from: ' + TAG_POOL.join(', ') + '.',
    '- Avoid "game-changer", "miracle", "life-changing", "cure". Do not claim to treat disease.',
    '- Prefer subjective observations ("breath feels fresher", "teeth feel smoother after brushing").'
  ].join('\n');
}

function parseReviewJson(text) {
  if (!text) return null;
  var cleaned = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  var start = cleaned.indexOf('{');
  var end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { return null; }
}

async function generateOne(flavorHint) {
  var apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  var market = pickRandom(MARKETS);
  var rating = pickRating();
  var prompt = buildPrompt(market, rating, flavorHint || 'fresh mint');

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      var text = await res.text().catch(function () { return ''; });
      throw new Error('Anthropic HTTP ' + res.status + ': ' + text.slice(0, 200));
    }

    var data = await res.json();
    var content = data && data.content && data.content[0] && data.content[0].text;
    var parsed = parseReviewJson(content);
    if (!parsed || !parsed.n || !parsed.t || !parsed.b || !Array.isArray(parsed.tg) || parsed.tg.length === 0) {
      throw new Error('Anthropic response malformed');
    }

    return {
      cc: market.cc,
      co: market.co,
      n: String(parsed.n).slice(0, 40),
      r: rating,
      t: String(parsed.t).slice(0, 80),
      b: String(parsed.b).slice(0, 400),
      tg: parsed.tg.slice(0, 4).map(function (t) { return String(t).toLowerCase().slice(0, 20); }),
      src: 'anthropic'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate N reviews. Individual failures are swallowed and returned in
 * `errors`; callers should top up from the pool to reach the target count.
 */
async function generateBatch(n, flavorHint) {
  var reviews = [];
  var errors = [];
  for (var i = 0; i < n; i++) {
    try {
      var r = await generateOne(flavorHint);
      reviews.push(r);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  return { reviews: reviews, errors: errors };
}

module.exports = {
  generateOne: generateOne,
  generateBatch: generateBatch,
  MARKETS: MARKETS
};
