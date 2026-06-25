var fs = require('fs');
var path = require('path');
var dotenv = require('dotenv');
var fetch = require('node-fetch');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local'), override: true });

var API_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
var ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
var AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_2108393566376667';
var IG_USER_ID = process.env.META_INSTAGRAM_USER_ID || '17841444868510454';
var REPORT_BASE = process.env.ADS_AUTOMATION_DRIVE_PATH ||
  'G:\\Mijn Drive\\Zakelijk\\5-5. Businesses en Themes\\E-Commerce\\Stores\\33. Calqix\\1. MKT Content calender\\0. Ads automation';

var COPY_RULES = {
  primary_texts: 5,
  headlines: 5,
  descriptions: 5,
  emoji_required: true,
  native_language_required: true,
  verify_after_publish: true,
  reject_bad_encoding: true
};

function u(code) {
  return String.fromCodePoint(code);
}

var E = {
  heart: u(0x1F49B),
  coffee: u(0x2615),
  moon: u(0x1F319),
  bolt: u(0x26A1),
  book: u(0x1F4D6),
  spark: u(0x2728),
  check: u(0x2705),
  mint: u(0x1F33F)
};

function qs(params) {
  var out = new URLSearchParams();
  Object.keys(params || {}).forEach(function (key) {
    var val = params[key];
    out.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
  });
  out.set('access_token', ACCESS_TOKEN);
  return out.toString();
}

async function apiGet(edge, params) {
  var res = await fetch('https://graph.facebook.com/' + API_VERSION + '/' + edge + '?' + qs(params || {}));
  return res.json();
}

async function apiPost(edge, body) {
  var payload = Object.assign({}, body || {}, { access_token: ACCESS_TOKEN });
  var res = await fetch('https://graph.facebook.com/' + API_VERSION + '/' + edge, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return { status: res.status, data: await res.json() };
}

function parseArgs(argv) {
  var args = {
    date: new Date().toISOString().slice(0, 10),
    pattern: 'Static [FGHIJ] -',
    dryRun: false
  };

  argv.slice(2).forEach(function (arg) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.indexOf('--date=') === 0) args.date = arg.substring('--date='.length);
    else if (arg.indexOf('--pattern=') === 0) args.pattern = arg.substring('--pattern='.length);
  });

  return args;
}

function parseAdName(adName) {
  var match = String(adName || '').match(/Static ([FGHIJ]) - .* \| (NL|DE|ENG|FR) \|/);
  if (!match) return null;
  return { angle: match[1], language: match[2] };
}

function cleanText(text) {
  return String(text || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function assertCopySet(copySet, context) {
  ['bodies', 'titles', 'descriptions'].forEach(function (key) {
    if (!Array.isArray(copySet[key]) || copySet[key].length !== 5) {
      throw new Error(context + ': ' + key + ' must contain exactly 5 variants');
    }
    copySet[key].forEach(function (text, index) {
      var value = cleanText(text);
      if (!value) throw new Error(context + ': empty ' + key + '[' + index + ']');
      if (/(\?\?|�)/.test(value)) throw new Error(context + ': bad encoding in ' + key + '[' + index + ']');
    });
  });
  if (!copySet.bodies.some(function (text) { return /[\u2600-\u27BF]|\uD83C|\uD83D|\uD83E/.test(text); })) {
    throw new Error(context + ': at least one primary text must include a fitting emoji');
  }
}

function copyFor(language, angle) {
  var data = COPY_BANK[language] && COPY_BANK[language][angle];
  if (!data) throw new Error('No copy bank entry for ' + language + ' angle ' + angle);
  var localized = localizeCopySet(data, language);
  assertCopySet(localized, language + ' ' + angle);
  return localized;
}

function localizeCopySet(copySet, language) {
  return {
    bodies: copySet.bodies.map(function (text) { return localizeText(text, language); }),
    titles: copySet.titles.map(function (text) { return localizeText(text, language); }),
    descriptions: copySet.descriptions.map(function (text) { return localizeText(text, language); })
  };
}

function localizeText(text, language) {
  var value = String(text || '');
  var replacements = [];

  if (language === 'DE') {
    replacements = [
      ['Naehe', 'N\u00E4he'],
      ['naehe', 'n\u00E4he'],
      ['fuehlt', 'f\u00FChlt'],
      ['fuer', 'f\u00FCr'],
      ['Fuer', 'F\u00FCr'],
      ['zaehlt', 'z\u00E4hlt'],
      ['Zaehneputzen', 'Z\u00E4hneputzen'],
      ['ergaenzt', 'erg\u00E4nzt'],
      ['Gespraeche', 'Gespr\u00E4che'],
      ['Gespraech', 'Gespr\u00E4ch'],
      ['Gefuehl', 'Gef\u00FChl'],
      ['gehoert', 'geh\u00F6rt'],
      ['schoensten', 'sch\u00F6nsten'],
      ['unterstuetzt', 'unterst\u00FCtzt'],
      ['taegliche', 't\u00E4gliche'],
      ['Praesentationen', 'Pr\u00E4sentationen'],
      ['verlaesst', 'verl\u00E4sst'],
      ['naeher', 'n\u00E4her'],
      ['fuehlen', 'f\u00FChlen'],
      ['fuehlen', 'f\u00FChlen']
    ];
  } else if (language === 'FR') {
    replacements = [
      ['preparent', 'pr\u00E9parent'],
      ['Preparez', 'Pr\u00E9parez'],
      ['preparee', 'pr\u00E9par\u00E9e'],
      ['Preparee', 'Pr\u00E9par\u00E9e'],
      ['s integre', "s'int\u00E8gre"],
      ['l instant', "l'instant"],
      ['a votre', '\u00E0 votre'],
      ['a rester', '\u00E0 rester'],
      ['a entrer', '\u00E0 entrer'],
      ['a la maison', '\u00E0 la maison'],
      ['a votre', '\u00E0 votre'],
      ['fraicheur', 'fra\u00EEcheur'],
      ['Fraicheur', 'Fra\u00EEcheur'],
      ['fraiche', 'fra\u00EEche'],
      ['Frais', 'Frais'],
      ['diner', 'd\u00EEner'],
      ['etape', '\u00E9tape'],
      ['soiree', 'soir\u00E9e'],
      ['deja', 'd\u00E9j\u00E0'],
      ['prevue', 'pr\u00E9vue'],
      ['Cafe', 'Caf\u00E9'],
      ['seche', 's\u00E8che'],
      ['meritent', 'm\u00E9ritent'],
      ['qu un', "qu'un"],
      ['reunions', 'r\u00E9unions'],
      ['journee', 'journ\u00E9e'],
      ['n est', "n'est"],
      ['presentations', 'pr\u00E9sentations'],
      ['poignee', 'poign\u00E9e'],
      ['Gerez', 'G\u00E9rez'],
      ['derniere', 'derni\u00E8re'],
      ['echanges', '\u00E9changes'],
      ['Pret', 'Pr\u00EAt'],
      ['pre-reunion', 'pr\u00E9-r\u00E9union'],
      ['proximite', 'proximit\u00E9'],
      ['Proximite', 'Proximit\u00E9'],
      ['meme', 'm\u00EAme'],
      ['pres', 'pr\u00E8s'],
      ['debut', 'd\u00E9but']
    ];
  }

  replacements.forEach(function (pair) {
    value = value.split(pair[0]).join(pair[1]);
  });

  return value;
}

function buildCreative(ad, copySet) {
  var story = ad.creative && ad.creative.object_story_spec;
  var linkData = story && story.link_data;
  if (!story || !linkData || !linkData.link || !linkData.image_hash) {
    throw new Error('Missing object_story_spec.link_data for ad ' + ad.id);
  }

  return {
    name: ad.name + ' | 5-copy native emoji refresh ' + new Date().toISOString().slice(0, 10),
    object_story_spec: {
      page_id: story.page_id,
      instagram_user_id: story.instagram_user_id || IG_USER_ID,
      link_data: {
        link: linkData.link,
        caption: linkData.caption || 'calqix.com',
        image_hash: linkData.image_hash,
        call_to_action: linkData.call_to_action || { type: 'SHOP_NOW', value: { link: linkData.link } }
      }
    },
    asset_feed_spec: {
      bodies: copySet.bodies.map(function (text) { return { text: cleanText(text) }; }),
      titles: copySet.titles.map(function (text) { return { text: cleanText(text) }; }),
      descriptions: copySet.descriptions.map(function (text) { return { text: cleanText(text) }; }),
      optimization_type: 'DEGREES_OF_FREEDOM'
    }
  };
}

function hasBadEncoding(assetFeedSpec) {
  return /(\?\?|�)/.test(JSON.stringify(assetFeedSpec || {}));
}

async function verifyAds(adIds) {
  var rows = [];
  for (var i = 0; i < adIds.length; i++) {
    var data = await apiGet(adIds[i], {
      fields: 'id,name,status,effective_status,creative{id,asset_feed_spec}'
    });
    if (data.error) {
      rows.push({ id: adIds[i], ok: false, error: data.error });
      continue;
    }
    var spec = (data.creative && data.creative.asset_feed_spec) || {};
    rows.push({
      id: data.id,
      name: data.name,
      status: data.status,
      effective_status: data.effective_status,
      creative_id: data.creative && data.creative.id,
      bodies: (spec.bodies || []).length,
      titles: (spec.titles || []).length,
      descriptions: (spec.descriptions || []).length,
      has_bad_encoding: hasBadEncoding(spec),
      ok: data.status === 'ACTIVE' &&
        (spec.bodies || []).length === 5 &&
        (spec.titles || []).length === 5 &&
        (spec.descriptions || []).length === 5 &&
        !hasBadEncoding(spec)
    });
  }
  return rows;
}

async function run() {
  if (!ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN not set');
  var args = parseArgs(process.argv);
  var pattern = new RegExp(args.pattern);
  var fields = 'id,name,status,effective_status,created_time,creative{id,name,object_story_spec,image_hash,asset_feed_spec}';
  var adsResult = await apiGet(AD_ACCOUNT_ID + '/ads', { fields: fields, limit: 200 });
  if (adsResult.error) throw new Error(JSON.stringify(adsResult.error));

  var ads = (adsResult.data || []).filter(function (ad) {
    return pattern.test(ad.name || '') && String(ad.created_time || '').indexOf(args.date) === 0;
  });

  var results = [];
  var updatedIds = [];

  for (var i = 0; i < ads.length; i++) {
    var ad = ads[i];
    try {
      var parsed = parseAdName(ad.name);
      if (!parsed) {
        results.push({ id: ad.id, name: ad.name, skipped: true, reason: 'name_parse_failed' });
        continue;
      }

      var copySet = copyFor(parsed.language, parsed.angle);
      var creative = buildCreative(ad, copySet);

      if (args.dryRun) {
        results.push({ id: ad.id, name: ad.name, dryRun: true, language: parsed.language, angle: parsed.angle });
        continue;
      }

      var createResult = await apiPost(AD_ACCOUNT_ID + '/adcreatives', creative);
      if (createResult.data.error || !createResult.data.id) {
        results.push({ id: ad.id, name: ad.name, ok: false, step: 'create_creative', error: createResult.data.error || createResult.data });
        continue;
      }

      var newCreativeId = createResult.data.id;
      var updateResult = await apiPost(ad.id, {
        creative: { creative_id: newCreativeId },
        status: 'ACTIVE'
      });

      if (updateResult.data.error || updateResult.data.success !== true) {
        results.push({ id: ad.id, name: ad.name, ok: false, step: 'update_ad', newCreativeId: newCreativeId, error: updateResult.data.error || updateResult.data });
        continue;
      }

      updatedIds.push(ad.id);
      results.push({
        id: ad.id,
        name: ad.name,
        ok: true,
        language: parsed.language,
        angle: parsed.angle,
        oldCreativeId: ad.creative && ad.creative.id,
        newCreativeId: newCreativeId
      });
    } catch (err) {
      results.push({ id: ad.id, name: ad.name, ok: false, error: err.message });
    }
  }

  var verification = args.dryRun ? [] : await verifyAds(updatedIds);
  var reportDir = path.join(REPORT_BASE, 'Update', 'Meta Launch Fixes');
  fs.mkdirSync(reportDir, { recursive: true });
  var reportPath = path.join(reportDir, args.date + '_static_copy_native_emoji_refresh.json');
  var report = {
    generated_at: new Date().toISOString(),
    setup_rules: COPY_RULES,
    date: args.date,
    pattern: args.pattern,
    dry_run: args.dryRun,
    target_count: ads.length,
    updated: results.filter(function (r) { return r.ok; }).length,
    failed: results.filter(function (r) { return r.ok === false; }).length,
    skipped: results.filter(function (r) { return r.skipped; }).length,
    verification_ok: verification.every(function (row) { return row.ok; }),
    results: results,
    verification: verification
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    reportPath: reportPath,
    target_count: report.target_count,
    updated: report.updated,
    failed: report.failed,
    skipped: report.skipped,
    verification_ok: report.verification_ok,
    verification_statuses: verification.reduce(function (acc, row) {
      acc[row.effective_status] = (acc[row.effective_status] || 0) + 1;
      return acc;
    }, {})
  }, null, 2));
}

var COPY_BANK = {
  ENG: {
    F: {
      bodies: [
        E.heart + ' Close moments feel easier when your routine is already done. Take OralBiome Pro before the moment matters.',
        E.spark + ' Before the date, the dinner, or the close moment. A small fresh step can make the evening feel easier.',
        E.check + ' Confidence is easier when freshness is already handled. Make OralBiome Pro part of the moment before the moment.',
        E.moon + ' A tiny step before you leave the bathroom. A fresher feeling when the evening gets closer.',
        E.mint + ' Plan freshness before it matters. OralBiome Pro fits into your evening routine in seconds.'
      ],
      titles: ['Fresh confidence, planned', 'Before close moments', 'Ready before the moment', 'A fresher evening routine', 'Freshness before you go'],
      descriptions: ['A small evening routine for closer moments.', 'Fresh routine support before the evening starts.', 'Simple freshness before important moments.', 'Built for evenings, dates and close conversations.', 'OralBiome Pro Fresh Mint routine']
    },
    G: {
      bodies: [
        E.coffee + ' Coffee, stress, dry mouth. Some mornings need more than a quick brush. Build a fresher routine with OralBiome Pro.',
        E.bolt + ' Work mornings get close fast: coffee, meetings, quick conversations. Make freshness part of the routine before you start.',
        E.check + ' A quick brush is not always the whole routine. OralBiome Pro adds a small fresh step before the day gets close.',
        E.mint + ' For coffee breath, dry mouth and morning meetings. A simple routine for feeling fresher around people.',
        E.spark + ' Start the day with your mouth already handled. OralBiome Pro belongs next to your morning essentials.'
      ],
      titles: ['Built for close mornings', 'Fresh before the first meeting', 'Coffee mornings, handled', 'Morning freshness routine', 'Before the day gets close'],
      descriptions: ['Fresh routine support for work, coffee and conversations.', 'A cleaner-feeling start to your morning.', 'For meetings, coffee and close conversations.', 'A small routine before the workday begins.', 'OralBiome Pro morning routine']
    },
    H: {
      bodies: [
        E.moon + ' The best moments are often the quiet ones. OralBiome Pro helps keep your routine fresh before the day begins.',
        E.spark + ' Morning closeness starts the night before. Add OralBiome Pro to the routine before the first conversation.',
        E.coffee + ' Before the first coffee, first word, first close moment. A small evening step can help the morning feel easier.',
        E.check + ' Quiet mornings feel better when freshness is already part of the routine.',
        E.heart + ' Keep the close moments easy. OralBiome Pro fits into the evening before tomorrow starts.'
      ],
      titles: ['Keep close moments easy', 'Fresh before the first word', 'The evening step for mornings', 'Quiet mornings, fresher', 'Before tomorrow begins'],
      descriptions: ['A fresh routine before the first conversation.', 'Evening routine support for close mornings.', 'A small step before tomorrow starts.', 'Freshness prepared the night before.', 'OralBiome Pro evening routine']
    },
    I: {
      bodies: [
        E.bolt + ' Three minutes before the pitch. One small routine can help you walk in feeling fresher and more ready.',
        E.check + ' Before the room, the handshake, and the pitch. Handle freshness before it can distract you.',
        E.spark + ' The last mirror check should not be about your mouth. Build the routine before the moment.',
        E.mint + ' For presentations, interviews and close conversations. One small routine can make you feel more ready.',
        E.heart + ' A fresher feeling before high-pressure moments. OralBiome Pro fits into the minutes before you leave.'
      ],
      titles: ['One small advantage', 'Fresh before the pitch', 'Ready before the room', 'For confident close talks', 'The pre-meeting routine'],
      descriptions: ['Fresh confidence for the moments that matter.', 'A small routine before high-pressure moments.', 'For meetings, pitches and interviews.', 'Freshness before important conversations.', 'OralBiome Pro before the moment']
    },
    J: {
      bodies: [
        E.book + ' Bedtime stories, tiny talks, close moments. OralBiome Pro belongs in the evening routine before they happen.',
        E.heart + ' The closest moments at home are often the smallest. Make freshness part of the evening before them.',
        E.moon + ' Before the last story, the goodnight kiss, the tiny question. A fresh evening routine can make closeness easier.',
        E.spark + ' Home moments deserve a routine that feels simple, calm and fresh.',
        E.check + ' A small evening step for the small moments that matter most.'
      ],
      titles: ['Made for small moments', 'Freshness for home', 'Before goodnight moments', 'Evening routine, simplified', 'For closeness at home'],
      descriptions: ['A fresh evening routine for home and closeness.', 'Simple freshness before close family moments.', 'A small routine for the end of the day.', 'Freshness before tiny talks and goodnights.', 'OralBiome Pro evening freshness']
    }
  },
  NL: {
    F: {
      bodies: [
        E.heart + ' Dichtbij voelt beter als je routine al klaar is. Neem OralBiome Pro voordat het moment telt en stap frisser je avond in.',
        E.spark + ' Voor je date, diner of close moment. Een kleine frisse stap kan je avond net makkelijker laten voelen.',
        E.check + ' Frisheid voelt beter als je er niet meer over hoeft na te denken. Maak OralBiome Pro onderdeel van je avondroutine.',
        E.moon + ' Een kleine stap voordat je de badkamer uitloopt. Een frisser gevoel zodra de avond dichterbij komt.',
        E.mint + ' Plan frisheid voordat het telt. OralBiome Pro past in seconden in je avondroutine.'
      ],
      titles: ['Fris dichtbij beginnen', 'Voor momenten dichtbij', 'Klaar voor het moment', 'Een frissere avondroutine', 'Fris voordat je gaat'],
      descriptions: ['Een kleine avondroutine voor meer frisse zekerheid.', 'Frisse routine voordat de avond begint.', 'Simpele frisheid voor belangrijke momenten.', 'Voor avonden, dates en gesprekken dichtbij.', 'OralBiome Pro Fresh Mint routine']
    },
    G: {
      bodies: [
        E.coffee + ' Koffie, stress, een droge mond. Sommige ochtenden vragen om meer dan snel poetsen. Maak je routine slimmer met OralBiome Pro.',
        E.bolt + ' Werkdagen komen snel dichtbij: koffie, meetings, korte gesprekken. Maak frisheid onderdeel van je ochtendroutine.',
        E.check + ' Snel poetsen is niet altijd je hele routine. OralBiome Pro voegt een kleine frisse stap toe voordat je dag begint.',
        E.mint + ' Voor koffieadem, droge mond en ochtendmeetings. Een simpele routine om je frisser te voelen bij mensen.',
        E.spark + ' Begin je dag met je mond al geregeld. OralBiome Pro hoort naast je ochtendessentials.'
      ],
      titles: ['Voor ochtenden dichtbij', 'Fris voor je eerste meeting', 'Koffie-ochtenden, geregeld', 'Ochtendfrisheid routine', 'Voordat de dag dichtbij komt'],
      descriptions: ['Frisse mondroutine voor werk, koffie en gesprekken.', 'Een frisser begin van je ochtend.', 'Voor meetings, koffie en gesprekken dichtbij.', 'Een kleine routine voordat je werkdag begint.', 'OralBiome Pro ochtendroutine']
    },
    H: {
      bodies: [
        E.moon + ' De mooiste momenten zijn vaak klein. OralBiome Pro helpt je routine fris en rustig te houden, ook van dichtbij.',
        E.spark + ' Ochtendmomenten dichtbij beginnen de avond ervoor. Voeg OralBiome Pro toe voor het eerste gesprek.',
        E.coffee + ' Voor de eerste koffie, het eerste woord, het eerste moment dichtbij. Een kleine avondstap helpt je ochtend makkelijker voelen.',
        E.check + ' Rustige ochtenden voelen beter als frisheid al in je routine zit.',
        E.heart + ' Houd kleine momenten makkelijk. OralBiome Pro past in je avond voordat morgen begint.'
      ],
      titles: ['Houd kleine momenten fris', 'Fris voor het eerste woord', 'De avondstap voor ochtenden', 'Rustige ochtenden, frisser', 'Voordat morgen begint'],
      descriptions: ['Voor een routine die al klaar is voordat je dag begint.', 'Avondroutine voor ochtenden dichtbij.', 'Een kleine stap voordat morgen begint.', 'Frisheid voorbereid in de avond.', 'OralBiome Pro avondroutine']
    },
    I: {
      bodies: [
        E.bolt + ' Drie minuten voor je pitch. Een kleine routine kan precies genoeg zijn om zekerder de ruimte in te stappen.',
        E.check + ' Voor de ruimte, de handdruk, de pitch. Regel frisheid voordat het je afleidt.',
        E.spark + ' Je laatste spiegelcheck zou niet over je mond moeten gaan. Bouw de routine voor het moment.',
        E.mint + ' Voor presentaties, interviews en gesprekken dichtbij. Een kleine routine kan je net zekerder laten voelen.',
        E.heart + ' Een frisser gevoel voor momenten met druk. OralBiome Pro past in de minuten voordat je vertrekt.'
      ],
      titles: ['Een kleine voorsprong', 'Fris voor je pitch', 'Klaar voor de ruimte', 'Voor gesprekken dichtbij', 'De pre-meeting routine'],
      descriptions: ['Frisse zekerheid voor de momenten waarop het telt.', 'Een kleine routine voor drukke momenten.', 'Voor meetings, pitches en interviews.', 'Frisheid voor belangrijke gesprekken.', 'OralBiome Pro voor het moment']
    },
    J: {
      bodies: [
        E.book + ' Verhaaltjes, knuffels, nog een vraag. OralBiome Pro hoort bij de avondroutine voor de kleine momenten dichtbij.',
        E.heart + ' De momenten thuis dichtbij zijn vaak het kleinst. Maak frisheid onderdeel van de avond ervoor.',
        E.moon + ' Voor het laatste verhaal, de welterusten-kus, die ene kleine vraag. Een frisse avondroutine maakt dichtbij makkelijker.',
        E.spark + ' Thuismomenten verdienen een routine die simpel, rustig en fris voelt.',
        E.check + ' Een kleine avondstap voor de kleine momenten die het meest tellen.'
      ],
      titles: ['Voor kleine momenten dichtbij', 'Frisheid voor thuis', 'Voor welterusten-momenten', 'Avondroutine, simpel', 'Voor dichtbij thuis'],
      descriptions: ['Maak je avondroutine fris, simpel en klaar.', 'Simpele frisheid voor familiemomenten dichtbij.', 'Een kleine routine aan het einde van de dag.', 'Frisheid voor verhaaltjes en welterusten.', 'OralBiome Pro avondfrisheid']
    }
  },
  DE: {
    F: {
      bodies: [
        E.heart + ' Naehe fuehlt sich besser an, wenn die Routine vorher stimmt. OralBiome Pro passt in den Abend, bevor der Moment zaehlt.',
        E.spark + ' Vor dem Date, dem Dinner, dem nahen Moment. Ein kleiner frischer Schritt kann den Abend leichter machen.',
        E.check + ' Frische fuehlt sich besser an, wenn du nicht mehr daran denken musst. Mach OralBiome Pro zum Teil deiner Abendroutine.',
        E.moon + ' Ein kleiner Schritt, bevor du das Bad verlaesst. Ein frischeres Gefuehl, wenn der Abend naeher kommt.',
        E.mint + ' Plane Frische, bevor sie zaehlt. OralBiome Pro passt in Sekunden in deine Abendroutine.'
      ],
      titles: ['Frischer in den Moment', 'Vor nahen Momenten', 'Bereit bevor es zaehlt', 'Eine frischere Abendroutine', 'Frisch bevor du gehst'],
      descriptions: ['Die kleine Routine vor den wichtigen Augenblicken.', 'Frische Routine bevor der Abend beginnt.', 'Einfache Frische fuer wichtige Momente.', 'Fuer Abende, Dates und nahe Gespraeche.', 'OralBiome Pro Fresh Mint Routine']
    },
    G: {
      bodies: [
        E.coffee + ' Kaffee, Stress, trockener Mund. Manche Morgen brauchen mehr als schnelles Zaehneputzen. Starte smarter mit OralBiome Pro.',
        E.bolt + ' Arbeitstage werden schnell nah: Kaffee, Meetings, kurze Gespraeche. Mach Frische zum Teil deiner Morgenroutine.',
        E.check + ' Schnelles Putzen ist nicht immer die ganze Routine. OralBiome Pro ergaenzt den Morgen um einen kleinen frischen Schritt.',
        E.mint + ' Fuer Kaffeeatem, trockenen Mund und Morgenmeetings. Eine einfache Routine fuer ein frischeres Gefuehl unter Menschen.',
        E.spark + ' Starte den Tag mit einem guten Mundgefuehl. OralBiome Pro gehoert zu deinen Morgen-Essentials.'
      ],
      titles: ['Fuer Naehe am Morgen', 'Frisch vor dem ersten Meeting', 'Kaffee-Morgen im Griff', 'Morgenfrische Routine', 'Bevor der Tag nah wird'],
      descriptions: ['Die frische Routine fuer Kaffee, Arbeit und Gespraeche.', 'Ein frischeres Gefuehl am Morgen.', 'Fuer Meetings, Kaffee und nahe Gespraeche.', 'Eine kleine Routine vor dem Arbeitstag.', 'OralBiome Pro Morgenroutine']
    },
    H: {
      bodies: [
        E.moon + ' Die schoensten Momente sind oft leise. OralBiome Pro unterstuetzt deine taegliche Mundpflege, auch wenn Naehe zaehlt.',
        E.spark + ' Naehe am Morgen beginnt am Abend davor. Ergaenze OralBiome Pro vor dem ersten Gespraech.',
        E.coffee + ' Vor dem ersten Kaffee, dem ersten Wort, dem ersten nahen Moment. Ein kleiner Abendschritt kann den Morgen leichter machen.',
        E.check + ' Leise Morgen fuehlen sich besser an, wenn Frische schon Teil deiner Routine ist.',
        E.heart + ' Mach nahe Momente einfacher. OralBiome Pro passt in den Abend, bevor morgen beginnt.'
      ],
      titles: ['Naehe beginnt vorher', 'Frisch vor dem ersten Wort', 'Der Abendschritt fuer morgens', 'Leise Morgen, frischer', 'Bevor morgen beginnt'],
      descriptions: ['Fuer eine Routine, die vor dem Tag schon sitzt.', 'Abendroutine fuer Naehe am Morgen.', 'Ein kleiner Schritt vor morgen.', 'Frische am Abend vorbereitet.', 'OralBiome Pro Abendroutine']
    },
    I: {
      bodies: [
        E.bolt + ' Drei Minuten vor dem Pitch. Eine kleine Routine kann reichen, um sicherer in den Raum zu gehen.',
        E.check + ' Vor dem Raum, dem Handschlag, dem Pitch. Klaere Frische, bevor sie dich ablenkt.',
        E.spark + ' Der letzte Spiegelcheck sollte nicht deinem Mund gelten. Baue die Routine vor dem Moment.',
        E.mint + ' Fuer Praesentationen, Interviews und nahe Gespraeche. Eine kleine Routine kann dich sicherer fuehlen lassen.',
        E.heart + ' Ein frischeres Gefuehl vor Momenten mit Druck. OralBiome Pro passt in die Minuten vor dem Losgehen.'
      ],
      titles: ['Dein kleiner Vorsprung', 'Frisch vor dem Pitch', 'Bereit fuer den Raum', 'Fuer sichere Gespraeche', 'Die Pre-Meeting Routine'],
      descriptions: ['Frische Sicherheit fuer die Momente, die zaehlen.', 'Eine kleine Routine vor wichtigen Momenten.', 'Fuer Meetings, Pitches und Interviews.', 'Frische vor wichtigen Gespraechen.', 'OralBiome Pro vor dem Moment']
    },
    J: {
      bodies: [
        E.book + ' Vorlesen, Naehe, noch eine Frage. OralBiome Pro gehoert in die Abendroutine vor den kleinen Momenten.',
        E.heart + ' Die nahen Momente zu Hause sind oft die kleinsten. Mach Frische vorher zum Teil des Abends.',
        E.moon + ' Vor der letzten Geschichte, dem Gute-Nacht-Kuss, der kleinen Frage. Eine frische Abendroutine macht Naehe leichter.',
        E.spark + ' Momente zu Hause verdienen eine Routine, die einfach, ruhig und frisch wirkt.',
        E.check + ' Ein kleiner Abendschritt fuer die kleinen Momente, die am meisten zaehlen.'
      ],
      titles: ['Fuer die kleinen Momente', 'Frische fuer zu Hause', 'Vor Gute-Nacht-Momenten', 'Abendroutine, einfach', 'Fuer Naehe zu Hause'],
      descriptions: ['Die frische Abendroutine fuer Naehe zu Hause.', 'Einfache Frische vor nahen Familienmomenten.', 'Eine kleine Routine am Ende des Tages.', 'Frische vor Vorlesen und Gute Nacht.', 'OralBiome Pro Abendfrische']
    }
  },
  FR: {
    F: {
      bodies: [
        E.heart + ' Les moments proches se preparent avant. OralBiome Pro s integre a votre routine avant que l instant compte.',
        E.spark + ' Avant le rendez-vous, le diner ou le moment proche. Une petite etape fraiche peut rendre la soiree plus simple.',
        E.check + ' La fraicheur est plus facile quand elle est deja prevue. Ajoutez OralBiome Pro a votre routine du soir.',
        E.moon + ' Une petite etape avant de quitter la salle de bain. Une sensation plus fraiche quand la soiree se rapproche.',
        E.mint + ' Preparez la fraicheur avant que le moment compte. OralBiome Pro s integre en quelques secondes.'
      ],
      titles: ['Fraicheur preparee', 'Avant les moments proches', 'Pret avant l instant', 'Une routine du soir fraiche', 'Fraicheur avant de partir'],
      descriptions: ['Une petite routine avant les moments importants.', 'Une routine fraiche avant le debut de la soiree.', 'Fraicheur simple pour les moments importants.', 'Pour les soirees, rendez-vous et echanges proches.', 'OralBiome Pro routine Fresh Mint']
    },
    G: {
      bodies: [
        E.coffee + ' Cafe, stress, bouche seche. Certains matins meritent plus qu un brossage rapide. Ajoutez OralBiome Pro a votre routine.',
        E.bolt + ' Les matins de travail arrivent vite : cafe, reunions, conversations proches. Preparez la fraicheur avant de commencer.',
        E.check + ' Un brossage rapide n est pas toujours toute la routine. OralBiome Pro ajoute une petite etape fraiche avant la journee.',
        E.mint + ' Pour le cafe, la bouche seche et les reunions du matin. Une routine simple pour se sentir plus frais.',
        E.spark + ' Commencez la journee avec une bouche deja prete. OralBiome Pro rejoint vos essentiels du matin.'
      ],
      titles: ['Pour les matins proches', 'Frais avant la premiere reunion', 'Les matins cafe, prepares', 'Routine fraiche du matin', 'Avant que la journee se rapproche'],
      descriptions: ['Une routine fraiche pour le cafe, le travail et les echanges.', 'Un debut de matinee plus frais.', 'Pour les reunions, le cafe et les conversations proches.', 'Une petite routine avant la journee de travail.', 'OralBiome Pro routine matin']
    },
    H: {
      bodies: [
        E.moon + ' Les plus beaux moments sont souvent les plus simples. OralBiome Pro aide votre routine a rester fraiche, meme de pres.',
        E.spark + ' Les moments proches du matin commencent la veille. Ajoutez OralBiome Pro avant la premiere conversation.',
        E.coffee + ' Avant le premier cafe, le premier mot, le premier moment proche. Une petite etape du soir peut simplifier le matin.',
        E.check + ' Les matins calmes sont plus simples quand la fraicheur fait deja partie de la routine.',
        E.heart + ' Gardez les moments proches plus faciles. OralBiome Pro s integre le soir avant demain.'
      ],
      titles: ['La proximite commence avant', 'Frais avant le premier mot', 'L etape du soir pour le matin', 'Matins calmes, plus frais', 'Avant que demain commence'],
      descriptions: ['Une routine fraiche avant les premiers moments du jour.', 'Routine du soir pour les matins proches.', 'Une petite etape avant demain.', 'Fraicheur preparee la veille.', 'OralBiome Pro routine du soir']
    },
    I: {
      bodies: [
        E.bolt + ' Trois minutes avant de prendre la parole. Une petite routine peut aider a entrer plus frais et plus pret.',
        E.check + ' Avant la salle, la poignee de main, la prise de parole. Gerez la fraicheur avant qu elle vous distraie.',
        E.spark + ' Le dernier regard dans le miroir ne devrait pas concerner votre bouche. Preparez la routine avant le moment.',
        E.mint + ' Pour les presentations, entretiens et conversations proches. Une petite routine peut aider a se sentir plus pret.',
        E.heart + ' Une sensation plus fraiche avant les moments sous pression. OralBiome Pro s integre avant de partir.'
      ],
      titles: ['Un petit avantage', 'Frais avant la prise de parole', 'Pret avant d entrer', 'Pour parler de pres', 'La routine pre-reunion'],
      descriptions: ['Une fraicheur preparee pour les moments qui comptent.', 'Une petite routine avant les moments importants.', 'Pour reunions, prises de parole et entretiens.', 'Fraicheur avant les conversations importantes.', 'OralBiome Pro avant le moment']
    },
    J: {
      bodies: [
        E.book + ' Histoires du soir, petits echanges, moments proches. OralBiome Pro accompagne la routine avant ces instants.',
        E.heart + ' Les moments proches a la maison sont souvent les plus petits. Faites de la fraicheur une etape du soir.',
        E.moon + ' Avant la derniere histoire, le bisou du soir, la petite question. Une routine fraiche rend la proximite plus simple.',
        E.spark + ' Les moments a la maison meritent une routine simple, calme et fraiche.',
        E.check + ' Une petite etape du soir pour les petits moments qui comptent le plus.'
      ],
      titles: ['Pour les petits moments', 'Fraicheur a la maison', 'Avant les moments du soir', 'Routine du soir simplifiee', 'Pour la proximite a la maison'],
      descriptions: ['Une routine du soir fraiche, simple et prete.', 'Fraicheur simple avant les moments en famille.', 'Une petite routine en fin de journee.', 'Fraicheur avant les histoires et bonne nuit.', 'OralBiome Pro fraicheur du soir']
    }
  }
};

run().catch(function (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
});
