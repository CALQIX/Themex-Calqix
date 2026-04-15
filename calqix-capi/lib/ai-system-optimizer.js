/**
 * AI System Optimizer — Claude Sonnet 4 integration for tracking system health.
 *
 * NOT the same as lib/ad-advisor.js (which handles ad strategy).
 * This module analyzes observability telemetry and recommends optimizations
 * for EMQ, dedup rates, cross-platform consistency, and pipeline health.
 *
 * Run modes:
 *   tactical      — every 30 min, ~5K tokens, quick health scan
 *   strategic     — daily 06:00, ~30K tokens, deep 24h analysis
 *   architectural — weekly Sun 06:00, ~60K tokens, structural review
 *   incident      — triggered by P0/P1, ~15K tokens, root cause analysis
 *
 * Env vars:
 *   AI_OPTIMIZER_ENABLED    — 'true' to enable (default: true)
 *   AI_TOKEN_BUDGET_DAILY   — max input tokens per day (default: 200000)
 *   ANTHROPIC_API_KEY       — required
 *
 * Redis keys:
 *   ai:token_usage:{date}                — daily token counter
 *   ai:recommendations:applied:{hour}    — accepted recommendations
 *   ai:recommendations:rejected:{hour}   — rejected recommendations
 *   ai:impact:{rec_id}:{window}          — impact measurements (15m/1h/6h/24h)
 *   ai:policy-memory:active              — compact summary of what works/doesn't
 *   ai:auto_applied:{date}               — list of auto-applied changes
 *   ai:last_run:{mode}                   — timestamp of last run per mode
 *   ai:incident:ratelimit:{type}         — incident analysis rate limit (5 min)
 *
 * Safety:
 *   - Token budget hardcoded, kill switch via AI_OPTIMIZER_ENABLED
 *   - No auto-apply beyond threshold tunes ±20%
 *   - No recommendations that disable feature flags, flush Redis, or touch secrets
 *   - No recommendations that modify ad budgets (ad-advisor domain)
 */
var rlFetch = require('./rate-limited-fetch');
var store = require('./store');
var dates = require('./dates');
var crypto = require('crypto');

var ENABLED = function () { return process.env.AI_OPTIMIZER_ENABLED !== 'false'; };
var TOKEN_BUDGET = function () { return parseInt(process.env.AI_TOKEN_BUDGET_DAILY || '200000', 10); };
var API_KEY = function () { return process.env.ANTHROPIC_API_KEY || ''; };
var MODEL = 'claude-sonnet-4-20250514';
var API_URL = 'https://api.anthropic.com/v1/messages';

var SYSTEM_PROMPT = [
  'You are the CALQIX Tracking Intelligence Agent. You analyze observability',
  'telemetry from a multi-platform Meta/Google/TikTok event pipeline and',
  'recommend optimizations to improve Event Match Quality, dedup rates,',
  'and cross-platform consistency.',
  '',
  'Output STRICT JSON (no markdown fences, no extra text):',
  '{',
  '  "summary_nl": "2 sentence Dutch summary for Telegram",',
  '  "system_health_score": 0-100,',
  '  "recommendations": [',
  '    {',
  '      "id": "rec_xxx",',
  '      "priority": "P0|P1|P2|P3",',
  '      "category": "emq|dedup|anomaly|identity|cross_platform|infra",',
  '      "hypothesis_nl": "Wat denkt het model dat er aan de hand is",',
  '      "evidence": ["specifiek datapunt 1", "datapunt 2"],',
  '      "proposed_action_nl": "Concrete actie in het Nederlands",',
  '      "action_type": "code_change|config_change|threshold_tune|investigate|monitor",',
  '      "code_diff": "indien action_type=code_change, unified diff",',
  '      "config_change": {},',
  '      "auto_apply_safe": true|false,',
  '      "confidence": 0.0-1.0,',
  '      "estimated_impact": "korte beschrijving"',
  '    }',
  '  ],',
  '  "no_action_needed": false,',
  '  "next_focus_area": "wat het model wil monitoren in volgende run"',
  '}',
  '',
  'Rules:',
  '- Never recommend disabling safety features',
  '- Never recommend bypassing approval queue',
  '- auto_apply_safe = true ONLY for: threshold adjustments within ±20%',
  '  of current value, log verbosity changes, alert dedup TTL changes',
  '- Maximum 5 recommendations per run, ranked by priority',
  '- If system is healthy, return no_action_needed=true with empty recommendations',
  '- Never recommend changes to ad budgets (that is ad-advisor domain)',
  '- Never recommend flushing Redis namespaces',
  '- Never recommend changes to API keys or secrets'
].join('\n');

/**
 * Run the AI optimizer in a specific mode.
 *
 * @param {string} mode — 'tactical' | 'strategic' | 'architectural' | 'incident'
 * @param {object} context — telemetry context bundle
 * @returns {Promise<{ok: boolean, result: object|null, error: string|null, tokensUsed: number}>}
 */
async function run(mode, context) {
  if (!ENABLED()) {
    return { ok: false, result: null, error: 'AI optimizer uitgeschakeld (AI_OPTIMIZER_ENABLED=false)', tokensUsed: 0 };
  }

  if (!API_KEY()) {
    return { ok: false, result: null, error: 'ANTHROPIC_API_KEY ontbreekt', tokensUsed: 0 };
  }

  // Check daily token budget
  var budgetOk = await checkTokenBudget(0);
  if (!budgetOk) {
    return { ok: false, result: null, error: 'Dagelijks tokenbudget bereikt (' + TOKEN_BUDGET() + ')', tokensUsed: 0 };
  }

  // Build context message
  var feedbackContext = await buildFeedbackContext();
  var policyMemory = await getPolicyMemory();

  var contextMessage = buildContextMessage(mode, context, feedbackContext, policyMemory);

  // Estimate tokens (rough: 4 chars per token)
  var estimatedTokens = Math.ceil(contextMessage.length / 4);

  var budgetStillOk = await checkTokenBudget(estimatedTokens);
  if (!budgetStillOk) {
    return { ok: false, result: null, error: 'Context te groot voor resterend tokenbudget', tokensUsed: 0 };
  }

  try {
    var response = await rlFetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contextMessage }]
      }),
      label: 'AI-Optimizer',
      maxRetries: 2,
      timeout: 60000
    });

    if (!response.ok) {
      return { ok: false, result: null, error: 'Anthropic API fout: ' + (response.error || response.status), tokensUsed: 0 };
    }

    var data = response.data;
    var inputTokens = data.usage ? data.usage.input_tokens : estimatedTokens;
    var outputTokens = data.usage ? data.usage.output_tokens : 0;
    var totalTokens = inputTokens + outputTokens;

    // Track token usage
    await trackTokenUsage(inputTokens, outputTokens);

    // Parse response
    var text = data.content && data.content[0] ? data.content[0].text : '';
    var parsed = parseResponse(text);

    if (!parsed) {
      return { ok: false, result: null, error: 'Kon AI response niet parsen', tokensUsed: totalTokens };
    }

    // Store run metadata
    await store.set('ai:last_run:' + mode, JSON.stringify({
      timestamp: new Date().toISOString(),
      health_score: parsed.system_health_score,
      recommendations_count: parsed.recommendations ? parsed.recommendations.length : 0,
      tokens: totalTokens
    }), 7 * 86400);

    // Generate recommendation IDs if missing
    if (parsed.recommendations) {
      for (var i = 0; i < parsed.recommendations.length; i++) {
        if (!parsed.recommendations[i].id) {
          parsed.recommendations[i].id = 'rec_' + crypto.randomBytes(4).toString('hex');
        }
      }
    }

    return { ok: true, result: parsed, error: null, tokensUsed: totalTokens };

  } catch (err) {
    return { ok: false, result: null, error: 'AI optimizer fout: ' + err.message, tokensUsed: 0 };
  }
}

/**
 * Process recommendations — auto-apply safe ones, queue others.
 *
 * @param {Array} recommendations — from AI response
 * @param {string} mode — run mode for logging
 * @returns {Promise<{autoApplied: Array, queued: Array, skipped: Array}>}
 */
async function processRecommendations(recommendations, mode) {
  var approvalQueue = require('./approval-queue');
  var autoApplied = [];
  var queued = [];
  var skipped = [];

  if (!recommendations || recommendations.length === 0) {
    return { autoApplied: autoApplied, queued: queued, skipped: skipped };
  }

  for (var i = 0; i < recommendations.length; i++) {
    var rec = recommendations[i];

    // Safety validation
    if (!isRecommendationSafe(rec)) {
      skipped.push({ rec: rec, reason: 'Veiligheidscontrole gefaald' });
      continue;
    }

    // Auto-apply safe threshold tunes
    if (rec.auto_apply_safe === true && rec.action_type === 'threshold_tune' && rec.config_change) {
      var applied = await autoApplyThresholdTune(rec);
      if (applied) {
        autoApplied.push(rec);
        await recordApplied(rec);
      } else {
        skipped.push({ rec: rec, reason: 'Auto-apply mislukt of buiten safe bounds' });
      }
      continue;
    }

    // Everything else → approval queue
    var queueItem = await approvalQueue.createItem({
      type: 'ai_recommendation',
      entityName: rec.category + ' — ' + (rec.hypothesis_nl || '').substring(0, 60),
      entityId: rec.id,
      reason: rec.hypothesis_nl || '',
      metrics: {
        confidence: rec.confidence,
        priority: rec.priority,
        category: rec.category,
        estimated_impact: rec.estimated_impact
      },
      expectedEffect: rec.proposed_action_nl || '',
      sourceRule: 'ai_optimizer_' + mode,
      payload: {
        rec_id: rec.id,
        action_type: rec.action_type,
        code_diff: rec.code_diff || null,
        config_change: rec.config_change || null,
        evidence: rec.evidence || [],
        confidence: rec.confidence,
        auto_apply_safe: rec.auto_apply_safe
      }
    });

    queued.push({ rec: rec, queueId: queueItem.id });
    await recordQueued(rec);
  }

  return { autoApplied: autoApplied, queued: queued, skipped: skipped };
}

/**
 * Record impact measurement for a recommendation.
 */
async function recordImpact(recId, window, metrics) {
  var key = 'ai:impact:' + recId + ':' + window;
  await store.set(key, JSON.stringify({
    timestamp: new Date().toISOString(),
    window: window,
    metrics: metrics
  }), 30 * 86400);
}

/**
 * Get impact data for a recommendation across all windows.
 */
async function getImpactHistory(recId) {
  var windows = ['15m', '1h', '6h', '24h'];
  var impacts = {};
  for (var i = 0; i < windows.length; i++) {
    var raw = await store.get('ai:impact:' + recId + ':' + windows[i]);
    if (raw) {
      try { impacts[windows[i]] = JSON.parse(raw); } catch (e) { /* skip */ }
    }
  }
  return impacts;
}

/**
 * Update policy memory with latest learnings.
 */
async function updatePolicyMemory(summary) {
  var existing = await getPolicyMemory();
  var updated = {
    lastUpdated: new Date().toISOString(),
    recentLearnings: (existing.recentLearnings || []).slice(-20),
    effectivePatterns: existing.effectivePatterns || [],
    ineffectivePatterns: existing.ineffectivePatterns || []
  };

  if (summary) {
    updated.recentLearnings.push({
      timestamp: new Date().toISOString(),
      summary: summary
    });
  }

  await store.set('ai:policy-memory:active', JSON.stringify(updated), 90 * 86400);
  return updated;
}

/**
 * Check if incident analysis is rate-limited.
 */
async function isIncidentRateLimited(incidentType) {
  var key = 'ai:incident:ratelimit:' + incidentType;
  var existing = await store.get(key);
  return Boolean(existing);
}

/**
 * Set incident rate limit (5 min per type).
 */
async function setIncidentRateLimit(incidentType) {
  var key = 'ai:incident:ratelimit:' + incidentType;
  await store.set(key, '1', 5 * 60);
}

// --- Internal helpers ---

function buildContextMessage(mode, context, feedbackContext, policyMemory) {
  var parts = [];

  parts.push('=== CALQIX Tracking System — ' + mode.toUpperCase() + ' Analysis ===');
  parts.push('Timestamp: ' + dates.formatDateTimeAmsterdam());
  parts.push('Mode: ' + mode);
  parts.push('');

  // Policy memory (what worked / didn't work before)
  if (policyMemory && policyMemory.recentLearnings && policyMemory.recentLearnings.length > 0) {
    parts.push('=== POLICY MEMORY (recent learnings) ===');
    var learnings = policyMemory.recentLearnings.slice(-10);
    for (var i = 0; i < learnings.length; i++) {
      parts.push('- [' + learnings[i].timestamp + '] ' + learnings[i].summary);
    }
    parts.push('');
  }

  // Recent feedback (applied/rejected recommendations)
  if (feedbackContext) {
    parts.push('=== RECENT FEEDBACK ===');
    if (feedbackContext.applied && feedbackContext.applied.length > 0) {
      parts.push('Geaccepteerde aanbevelingen:');
      for (var j = 0; j < feedbackContext.applied.length; j++) {
        parts.push('  ✅ ' + JSON.stringify(feedbackContext.applied[j]));
      }
    }
    if (feedbackContext.rejected && feedbackContext.rejected.length > 0) {
      parts.push('Afgewezen aanbevelingen:');
      for (var k = 0; k < feedbackContext.rejected.length; k++) {
        parts.push('  ❌ ' + JSON.stringify(feedbackContext.rejected[k]));
      }
    }
    if (feedbackContext.impacts && feedbackContext.impacts.length > 0) {
      parts.push('Impact metingen:');
      for (var m = 0; m < feedbackContext.impacts.length; m++) {
        parts.push('  📊 ' + JSON.stringify(feedbackContext.impacts[m]));
      }
    }
    parts.push('');
  }

  // Main context data
  if (context) {
    parts.push('=== TELEMETRY DATA ===');
    parts.push(JSON.stringify(context, null, 2));
  }

  return parts.join('\n');
}

async function buildFeedbackContext() {
  var now = new Date();
  var feedback = { applied: [], rejected: [], impacts: [] };

  // Look back 24h for feedback
  for (var h = 0; h < 24; h++) {
    var checkTime = new Date(now.getTime() - h * 3600000);
    var hourKey = checkTime.toISOString().slice(0, 13).replace('T', '-');

    var appliedRaw = await store.get('ai:recommendations:applied:' + hourKey);
    if (appliedRaw) {
      try {
        var applied = JSON.parse(appliedRaw);
        if (Array.isArray(applied)) feedback.applied = feedback.applied.concat(applied);
      } catch (e) { /* skip */ }
    }

    var rejectedRaw = await store.get('ai:recommendations:rejected:' + hourKey);
    if (rejectedRaw) {
      try {
        var rejected = JSON.parse(rejectedRaw);
        if (Array.isArray(rejected)) feedback.rejected = feedback.rejected.concat(rejected);
      } catch (e) { /* skip */ }
    }
  }

  // Trim to last 20 each
  feedback.applied = feedback.applied.slice(-20);
  feedback.rejected = feedback.rejected.slice(-20);

  return feedback;
}

async function getPolicyMemory() {
  var raw = await store.get('ai:policy-memory:active');
  if (!raw) return { recentLearnings: [], effectivePatterns: [], ineffectivePatterns: [] };
  try { return JSON.parse(raw); } catch (e) { return { recentLearnings: [], effectivePatterns: [], ineffectivePatterns: [] }; }
}

async function checkTokenBudget(additionalTokens) {
  var key = 'ai:token_usage:' + dates.todayKey();
  var raw = await store.get(key);
  var current = raw ? parseInt(raw, 10) : 0;
  return (current + additionalTokens) <= TOKEN_BUDGET();
}

async function trackTokenUsage(inputTokens, outputTokens) {
  var key = 'ai:token_usage:' + dates.todayKey();
  try {
    var redis = store._getRedis();
    if (redis) {
      await redis.incrby(key, inputTokens + outputTokens);
      await redis.expire(key, 2 * 86400);
    }
  } catch (e) {
    console.warn('[AI-Optimizer] Token tracking mislukt:', e.message);
  }
}

function parseResponse(text) {
  if (!text) return null;
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch (e) {
    // Try extracting JSON from markdown fences
    var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { return JSON.parse(match[1]); } catch (e2) { /* fall through */ }
    }
    // Try finding first { to last }
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try { return JSON.parse(text.substring(start, end + 1)); } catch (e3) { /* give up */ }
    }
    return null;
  }
}

function isRecommendationSafe(rec) {
  if (!rec) return false;

  // Block dangerous patterns
  var unsafePatterns = [
    'feature_flag', 'FLUSH', 'DEL *', 'FLUSHALL', 'FLUSHDB',
    'API_KEY', 'SECRET', 'TOKEN', 'ad_budget', 'MAX_DAILY_BUDGET',
    'MAX_ADSET_BUDGET', 'MAX_DAILY_SPEND'
  ];

  var checkStr = JSON.stringify(rec).toUpperCase();
  for (var i = 0; i < unsafePatterns.length; i++) {
    if (rec.auto_apply_safe === true && checkStr.indexOf(unsafePatterns[i].toUpperCase()) !== -1) {
      console.warn('[AI-Optimizer] Veiligheidsovertreding: auto_apply met onveilig patroon:', unsafePatterns[i]);
      return false;
    }
  }

  return true;
}

async function autoApplyThresholdTune(rec) {
  if (!rec.config_change) return false;

  var keys = Object.keys(rec.config_change);
  for (var i = 0; i < keys.length; i++) {
    var configKey = keys[i];
    var newValue = rec.config_change[configKey];

    // Read current value
    var currentRaw = await store.get('config:' + configKey);
    if (currentRaw !== null) {
      var current = parseFloat(currentRaw);
      if (!isNaN(current) && current !== 0) {
        var change = Math.abs(newValue - current) / current;
        if (change > 0.20) {
          console.warn('[AI-Optimizer] Threshold tune buiten ±20% bounds:', configKey, current, '->', newValue);
          return false;
        }
      }
    }

    // Apply
    await store.set('config:' + configKey, String(newValue), 30 * 86400);
    console.log('[AI-Optimizer] Auto-applied threshold tune:', configKey, '->', newValue);
  }

  // Log auto-apply
  var logKey = 'ai:auto_applied:' + dates.todayKey();
  var existing = await store.get(logKey);
  var log = existing ? JSON.parse(existing) : [];
  log.push({
    rec_id: rec.id,
    config_change: rec.config_change,
    timestamp: new Date().toISOString()
  });
  await store.set(logKey, JSON.stringify(log), 30 * 86400);

  return true;
}

async function recordApplied(rec) {
  var hourKey = new Date().toISOString().slice(0, 13).replace('T', '-');
  var key = 'ai:recommendations:applied:' + hourKey;
  var existing = await store.get(key);
  var list = existing ? JSON.parse(existing) : [];
  list.push({
    rec_id: rec.id,
    category: rec.category,
    action_type: rec.action_type,
    timestamp: new Date().toISOString()
  });
  await store.set(key, JSON.stringify(list), 48 * 3600);
}

async function recordQueued(rec) {
  // Track queued items for feedback loop (they'll become applied/rejected later)
  var hourKey = new Date().toISOString().slice(0, 13).replace('T', '-');
  var key = 'ai:recommendations:queued:' + hourKey;
  var existing = await store.get(key);
  var list = existing ? JSON.parse(existing) : [];
  list.push({
    rec_id: rec.id,
    category: rec.category,
    priority: rec.priority,
    timestamp: new Date().toISOString()
  });
  await store.set(key, JSON.stringify(list), 48 * 3600);
}

/**
 * Record a rejected recommendation for feedback loop.
 */
async function recordRejected(rec, reason) {
  var hourKey = new Date().toISOString().slice(0, 13).replace('T', '-');
  var key = 'ai:recommendations:rejected:' + hourKey;
  var existing = await store.get(key);
  var list = existing ? JSON.parse(existing) : [];
  list.push({
    rec_id: rec.id || rec.rec_id,
    category: rec.category,
    reason: reason || 'operator_rejected',
    timestamp: new Date().toISOString()
  });
  await store.set(key, JSON.stringify(list), 48 * 3600);
}

module.exports = {
  run: run,
  processRecommendations: processRecommendations,
  recordImpact: recordImpact,
  getImpactHistory: getImpactHistory,
  updatePolicyMemory: updatePolicyMemory,
  isIncidentRateLimited: isIncidentRateLimited,
  setIncidentRateLimit: setIncidentRateLimit,
  recordRejected: recordRejected,
  ENABLED: ENABLED,
  TOKEN_BUDGET: TOKEN_BUDGET
};
