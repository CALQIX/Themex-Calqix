/**
 * CALQIX Meta CAPI EMQ Audit
 *
 * 1. Collects all CAPI-related code files
 * 2. Sends to OpenAI for comprehensive EMQ analysis
 * 3. Parses results and applies critical fixes automatically
 * 4. Sends readable audit summary to Telegram
 *
 * Run: node scripts/emq-audit.js
 */
var path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });
var fs = require('fs');
var fetch = require('node-fetch');
var { sendTelegram } = require('../lib/telegram');

var OPENAI_URL = 'https://api.openai.com/v1/responses';
var OPENAI_MODEL = process.env.OPENAI_EMQ_AUDIT_MODEL || process.env.OPENAI_TRACKING_MODEL || 'gpt-5.5';
var OPENAI_FALLBACK_MODEL = process.env.OPENAI_EMQ_AUDIT_FALLBACK_MODEL || process.env.OPENAI_TRACKING_FALLBACK_MODEL || 'gpt-5.2';
var OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_EMQ_AUDIT_TIMEOUT_MS || '120000', 10);

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Key CAPI files to audit
var CAPI_FILES = [
  'lib/meta-capi.js',
  'lib/hash.js',
  'lib/dedup-guard.js',
  'lib/event-state.js',
  'lib/webhook-utils.js',
  'lib/capi-diagnostics.js',
  'api/add-to-cart.js',
  'api/view-content.js',
  'api/checkout-event.js',
  'api/webhook/orders-paid.js',
  'api/webhook/checkouts-create.js',
  'api/recovery/run.js'
];

// Bridge file (in assets)
var BRIDGE_FILE = path.join(__dirname, '..', '..', 'assets', 'calqix-meta-bridge.js');

/**
 * Read all CAPI-related files and build a code digest.
 */
function collectCapiCode() {
  var digest = [];
  var baseDir = path.join(__dirname, '..');

  for (var i = 0; i < CAPI_FILES.length; i++) {
    var filePath = path.join(baseDir, CAPI_FILES[i]);
    try {
      var content = fs.readFileSync(filePath, 'utf8');
      // Truncate very large files to keep the model request bounded.
      if (content.length > 5000) {
        content = content.substring(0, 5000) + '\n// ... truncated (' + content.length + ' total chars)';
      }
      digest.push('=== ' + CAPI_FILES[i] + ' ===\n' + content);
    } catch (err) {
      digest.push('=== ' + CAPI_FILES[i] + ' === [FILE NOT FOUND]');
    }
  }

  // Also include bridge if it exists
  try {
    var bridgeContent = fs.readFileSync(BRIDGE_FILE, 'utf8');
    if (bridgeContent.length > 5000) {
      bridgeContent = bridgeContent.substring(0, 5000) + '\n// ... truncated';
    }
    digest.push('=== assets/calqix-meta-bridge.js ===\n' + bridgeContent);
  } catch (err) {
    digest.push('=== assets/calqix-meta-bridge.js === [FILE NOT FOUND]');
  }

  return digest.join('\n\n');
}

/**
 * Send code to OpenAI for EMQ audit.
 */
async function auditWithOpenAI(codeDigest) {
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    return null;
  }

  var pixelId = process.env.META_PIXEL_ID || '[NOT SET]';

  var instructions = [
    'You are a Meta Conversions API (CAPI) expert performing an Event Match Quality (EMQ) audit.',
    'Output strict JSON only. Do not include markdown.',
    'Do not expose raw PII. Discuss identifier presence, hashing, and coverage only.',
    'Never recommend fake or redundant Meta events. Only recommend retrying truly failed events.'
  ].join('\n');

  var prompt = 'CONTEXT:\n'
    + '- Brand: CALQIX (premium oral care, Shopify store)\n'
    + '- Pixel ID: ' + pixelId + '\n'
    + '- Server: Vercel serverless functions\n'
    + '- State store: Upstash Redis\n'
    + '- Events: ViewContent, AddToCart, InitiateCheckout, Purchase\n'
    + '- Two delivery paths: browser bridge (Custom Pixel) + Shopify webhooks\n'
    + '- Recovery job: 1-minute QStash schedule retries failed events\n\n'
    + 'AUDIT THE FOLLOWING CODE FOR EMQ ISSUES:\n\n'
    + codeDigest + '\n\n'
    + 'AUDIT CRITERIA (score each 1-10):\n'
    + '1. USER_DATA COVERAGE: Are em, ph, fn, ln, ct, st, zp, country, external_id, fbc, fbp all properly collected and hashed?\n'
    + '2. EVENT_ID DEDUP: Are event_ids deterministic and shared between browser+server for proper dedup?\n'
    + '3. HASHING: Is SHA256 normalization correct per Meta specs (lowercase, trim, E.164 phone)?\n'
    + '4. CUSTOM_DATA: Are content_ids, content_type, value, currency, num_items properly set per event?\n'
    + '5. ACTION_SOURCE: Is it always "website"?\n'
    + '6. EVENT_TIME: Is it Unix timestamp in seconds (not ms)?\n'
    + '7. RECOVERY: Does the recovery system correctly retry only genuinely failed events?\n'
    + '8. PII SAFETY: Is raw PII never logged? Only hashed presence flags?\n'
    + '9. TEST_EVENT_CODE: Is test_event_code properly handled?\n'
    + '10. ERROR HANDLING: Are webhooks always returning 200 even on internal errors?\n\n'
    + 'Respond ONLY in JSON:\n'
    + '{\n'
    + '  "overall_score": 1-100,\n'
    + '  "emq_grade": "A" | "B" | "C" | "D" | "F",\n'
    + '  "scores": {\n'
    + '    "user_data_coverage": { "score": 1-10, "detail": "..." },\n'
    + '    "event_id_dedup": { "score": 1-10, "detail": "..." },\n'
    + '    "hashing": { "score": 1-10, "detail": "..." },\n'
    + '    "custom_data": { "score": 1-10, "detail": "..." },\n'
    + '    "action_source": { "score": 1-10, "detail": "..." },\n'
    + '    "event_time": { "score": 1-10, "detail": "..." },\n'
    + '    "recovery": { "score": 1-10, "detail": "..." },\n'
    + '    "pii_safety": { "score": 1-10, "detail": "..." },\n'
    + '    "test_event_code": { "score": 1-10, "detail": "..." },\n'
    + '    "error_handling": { "score": 1-10, "detail": "..." }\n'
    + '  },\n'
    + '  "critical_issues": [\n'
    + '    { "file": "...", "line_hint": "...", "issue": "...", "fix": "...", "auto_fixable": true|false }\n'
    + '  ],\n'
    + '  "warnings": [\n'
    + '    { "file": "...", "issue": "...", "recommendation": "..." }\n'
    + '  ],\n'
    + '  "strengths": ["..."],\n'
    + '  "top_3_improvements": ["..."]\n'
    + '}';

  console.log('Sending ' + Math.round(codeDigest.length / 1024) + 'KB code to OpenAI for EMQ audit...');

  async function call(model) {
    var res;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          instructions: instructions,
          input: prompt,
          text: {
            format: {
              type: 'json_object'
            }
          },
          max_output_tokens: 4096
        }),
        timeout: Math.max(10000, OPENAI_TIMEOUT_MS)
      });
    } catch (err) {
      return { ok: false, error: err.message || 'OpenAI request failed', model: model };
    }

    var data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ? data.error.message : res.statusText, model: model };
    }

    var content = data.output_text || extractOutputText(data);
    var jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: 'Could not parse OpenAI audit JSON', model: model, raw: content.substring(0, 500) };
    }

    try {
      return { ok: true, audit: JSON.parse(jsonMatch[0]), model: model };
    } catch (err) {
      return { ok: false, error: 'Could not parse OpenAI audit JSON: ' + err.message, model: model, raw: content.substring(0, 500) };
    }
  }

  try {
    var first = await call(OPENAI_MODEL);
    if (first.ok) {
      console.log('OpenAI audit model: ' + first.model);
      return first.audit;
    }
    if (OPENAI_MODEL !== OPENAI_FALLBACK_MODEL && /model|not found|does not exist|unsupported|timeout|network|parse/i.test(first.error || '')) {
      var second = await call(OPENAI_FALLBACK_MODEL);
      if (second.ok) {
        console.log('OpenAI audit fallback model: ' + second.model);
        return second.audit;
      }
      console.error('OpenAI API error:', second.error);
      if (second.raw) console.log('Raw response:', second.raw);
      return null;
    }
    console.error('OpenAI API error:', first.error);
    if (first.raw) console.log('Raw response:', first.raw);
    return null;
  } catch (err) {
    console.error('OpenAI audit exception:', err.message);
    return null;
  }
}

function extractOutputText(data) {
  var out = [];
  var output = data && data.output;
  if (!Array.isArray(output)) return '';
  output.forEach(function (item) {
    var content = item && item.content;
    if (!Array.isArray(content)) return;
    content.forEach(function (part) {
      if (part && typeof part.text === 'string') out.push(part.text);
      if (part && typeof part.output_text === 'string') out.push(part.output_text);
    });
  });
  return out.join('\n');
}

/**
 * Apply auto-fixable critical issues.
 */
async function applyAutoFixes(audit) {
  if (!audit || !audit.critical_issues) return [];

  var applied = [];
  var baseDir = path.join(__dirname, '..');

  for (var i = 0; i < audit.critical_issues.length; i++) {
    var issue = audit.critical_issues[i];
    if (!issue.auto_fixable) continue;

    console.log('\n[AUTO-FIX] ' + issue.file + ': ' + issue.issue);
    console.log('  Fix: ' + issue.fix);

    // Safety check: only apply fixes to known CAPI files
    var isKnownFile = false;
    for (var f = 0; f < CAPI_FILES.length; f++) {
      if (issue.file && issue.file.indexOf(CAPI_FILES[f]) > -1) {
        isKnownFile = true;
        break;
      }
    }

    if (!isKnownFile) {
      console.log('  SKIPPED: Not a known CAPI file');
      continue;
    }

    // Log the fix but don't auto-apply potentially dangerous changes
    // Instead, store them for manual review
    applied.push({
      file: issue.file,
      issue: issue.issue,
      fix: issue.fix,
      status: 'logged_for_review'
    });
  }

  return applied;
}

/**
 * Send audit report to Telegram.
 */
async function sendAuditReport(audit, fixes) {
  if (!audit) {
    await sendTelegram('CALQIX Meta CAPI EMQ Audit\n\nAudit mislukt - OpenAI analyse niet beschikbaar.');
    return;
  }

  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + now.getFullYear();

  // Grade emoji
  var gradeEmoji = audit.emq_grade === 'A' ? '\u2705'
    : audit.emq_grade === 'B' ? '\ud83d\udfe2'
    : audit.emq_grade === 'C' ? '\ud83d\udfe1'
    : '\ud83d\udd34';

  var lines = [
    '<b>CALQIX Meta CAPI EMQ Audit - ' + dateStr + '</b>',
    '',
    gradeEmoji + ' <b>EMQ Score: ' + audit.overall_score + '/100 (Grade ' + audit.emq_grade + ')</b>',
    ''
  ];

  // Category scores
  lines.push('<b>Scores per categorie:</b>');
  var categories = audit.scores || {};
  var catKeys = Object.keys(categories);
  for (var c = 0; c < catKeys.length; c++) {
    var cat = categories[catKeys[c]];
    var scoreBar = cat.score >= 8 ? '\u2705' : cat.score >= 6 ? '\ud83d\udfe1' : '\ud83d\udd34';
    lines.push(scoreBar + ' ' + catKeys[c].replace(/_/g, ' ') + ': ' + cat.score + '/10');
  }
  lines.push('');

  // Critical issues
  var criticals = audit.critical_issues || [];
  if (criticals.length > 0) {
    lines.push('<b>Kritieke problemen (' + criticals.length + '):</b>');
    for (var ci = 0; ci < Math.min(criticals.length, 5); ci++) {
      lines.push('\u274c ' + escapeHtml(criticals[ci].issue));
      if (criticals[ci].fix) {
        lines.push('  Fix: ' + escapeHtml(criticals[ci].fix.substring(0, 100)));
      }
    }
    if (criticals.length > 5) {
      lines.push('... en ' + (criticals.length - 5) + ' meer');
    }
    lines.push('');
  }

  // Warnings
  var warnings = audit.warnings || [];
  if (warnings.length > 0) {
    lines.push('<b>Waarschuwingen (' + warnings.length + '):</b>');
    for (var wi = 0; wi < Math.min(warnings.length, 3); wi++) {
      lines.push('\u26a0\ufe0f ' + escapeHtml(warnings[wi].issue));
    }
    if (warnings.length > 3) {
      lines.push('... en ' + (warnings.length - 3) + ' meer');
    }
    lines.push('');
  }

  // Strengths
  var strengths = audit.strengths || [];
  if (strengths.length > 0) {
    lines.push('<b>Sterke punten:</b>');
    for (var si = 0; si < Math.min(strengths.length, 3); si++) {
      lines.push('\u2705 ' + escapeHtml(strengths[si]));
    }
    lines.push('');
  }

  // Top improvements
  var improvements = audit.top_3_improvements || [];
  if (improvements.length > 0) {
    lines.push('<b>Top verbeteringen:</b>');
    for (var ii = 0; ii < improvements.length; ii++) {
      lines.push((ii + 1) + '. ' + escapeHtml(improvements[ii]));
    }
    lines.push('');
  }

  // Applied fixes
  if (fixes && fixes.length > 0) {
    lines.push('<b>Auto-fixes (' + fixes.length + '):</b>');
    for (var fi = 0; fi < fixes.length; fi++) {
      lines.push('- ' + escapeHtml(fixes[fi].file) + ': ' + escapeHtml(fixes[fi].status));
    }
  }

  var msg = lines.join('\n');

  // Telegram has a 4096 char limit, split if needed
  if (msg.length > 4000) {
    var half = Math.floor(lines.length / 2);
    await sendTelegram(lines.slice(0, half).join('\n'));
    await sleep(500);
    await sendTelegram(lines.slice(half).join('\n'));
  } else {
    await sendTelegram(msg);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('====================================================');
  console.log('CALQIX Meta CAPI EMQ Audit');
  console.log('====================================================\n');

  // Step 1: Collect code
  console.log('Stap 1: CAPI code verzamelen...');
  var codeDigest = collectCapiCode();
  console.log('Code verzameld: ' + Math.round(codeDigest.length / 1024) + 'KB\n');

  // Step 2: OpenAI audit
  console.log('Stap 2: OpenAI EMQ analyse...');
  var audit = await auditWithOpenAI(codeDigest);

  if (audit) {
    console.log('\nEMQ Score: ' + audit.overall_score + '/100 (Grade ' + audit.emq_grade + ')');
    console.log('Kritieke problemen: ' + (audit.critical_issues ? audit.critical_issues.length : 0));
    console.log('Waarschuwingen: ' + (audit.warnings ? audit.warnings.length : 0));
    console.log('Sterke punten: ' + (audit.strengths ? audit.strengths.length : 0));

    // Step 3: Apply auto-fixes
    console.log('\nStap 3: Auto-fixes toepassen...');
    var fixes = await applyAutoFixes(audit);
    console.log('Fixes toegepast/gelogd: ' + fixes.length);

    // Step 4: Send report
    console.log('\nStap 4: Telegram rapport versturen...');
    await sendAuditReport(audit, fixes);
  } else {
    console.error('Audit mislukt');
    await sendTelegram('CALQIX Meta CAPI EMQ Audit\n\nAudit mislukt - OpenAI analyse niet beschikbaar.');
  }

  // Save audit result to file
  var auditPath = path.join(__dirname, '_emq-audit-result.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit || { error: 'audit_failed' }, null, 2));
  console.log('\nAudit resultaat opgeslagen: ' + auditPath);
}

main().catch(function (err) {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
