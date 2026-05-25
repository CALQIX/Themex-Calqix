/**
 * ABO Budget Regulator
 *
 * Optional helper for ABO adset budget regulation. It can auto-adjust adset
 * budgets for ABO campaigns within strict caps and cooldowns when explicitly
 * enabled. CBO campaigns stay suggestion-only because budget distribution is
 * campaign-level there.
 */
var metaApi = require('./meta-api-client');
var rulesEngine = require('./ad-rules-engine');
var store = require('./store');
var dates = require('./dates');
var insights = require('./meta-insights-source');

var DEFAULT_CAMPAIGN_ID = '120250886895070715';
var DEFAULT_CAMPAIGN_NAME = 'ABO - FlowCore | 80 Static Ads LIVE | Purchase | 2026-05-18 V3';

function envBool(name, defaultValue) {
  var raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return Boolean(defaultValue);
  return String(raw).trim().toLowerCase() === 'true';
}

function envFloat(name, fallback) {
  var n = parseFloat(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envInt(name, fallback) {
  var n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getConfig() {
  try {
    await rulesEngine.initLimits();
  } catch (e) {
    console.warn('[ABORegulator] initLimits failed:', e.message);
  }

  var monitoredBudget = envFloat('ADS_MONITOR_DAILY_BUDGET_EUR', 40);
  var maxTotalDefault = monitoredBudget > 0 ? monitoredBudget : rulesEngine.MAX_DAILY_SPEND();

  return {
    campaignId: process.env.ADS_MONITOR_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
    campaignName: process.env.ADS_MONITOR_CAMPAIGN_NAME || DEFAULT_CAMPAIGN_NAME,
    enabled: envBool('META_OPTIMIZER_AUTO_BUDGET_ADJUST', false),
    allowTotalIncrease: envBool('ADS_AUTO_ABO_ALLOW_TOTAL_INCREASE', false),
    notifyNoAction: envBool('ADS_AUTO_ABO_NOTIFY_NO_ACTION', false),
    targetCpa: envFloat('TARGET_CPA', 15),
    minAdsetBudgetEur: envFloat('ADS_AUTO_ABO_MIN_ADSET_BUDGET_EUR', 1),
    minStepEur: envFloat('ADS_AUTO_ABO_MIN_STEP_EUR', 1),
    maxChangePct: envFloat('ADS_AUTO_ABO_MAX_CHANGE_PCT', 0.15),
    maxChangesPerRun: envInt('ADS_AUTO_ABO_MAX_CHANGES_PER_RUN', 2),
    cooldownMinutes: envInt('ADS_AUTO_ABO_BUDGET_COOLDOWN_MINUTES', 240),
    maxAdsetBudgetEur: rulesEngine.MAX_ADSET_BUDGET(),
    maxTotalBudgetEur: Math.min(rulesEngine.MAX_DAILY_SPEND(), envFloat('ADS_AUTO_ABO_MAX_TOTAL_BUDGET_EUR', maxTotalDefault)),
    writesEnabled: process.env.ENABLE_AD_WRITES === 'true'
  };
}

async function run(snapshot, now) {
  var cfg = await getConfig();
  var lockKey = 'lock:abo_budget_regulator:' + cfg.campaignId;
  var lockAcquired = await store.setnx(lockKey, '1', 10 * 60);
  if (!lockAcquired) {
    return {
      ok: true,
      skipped: true,
      reason: 'lock_held',
      shouldNotify: false,
      message: null,
      executed: [],
      suggestions: []
    };
  }

  try {
    return await runLocked(snapshot, now || new Date(), cfg);
  } finally {
    await store.del(lockKey);
  }
}

async function runLocked(snapshot, now, cfg) {
  snapshot = snapshot || {};

  var activeAdsets = (snapshot.activeAdsets || []).filter(function (adset) {
    return String(adset.campaign_id || '') === String(cfg.campaignId);
  });

  if (!activeAdsets.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_active_adsets_for_campaign',
      shouldNotify: false,
      message: null,
      executed: [],
      suggestions: []
    };
  }

  var campaign = await fetchCampaign(cfg.campaignId);
  var campaignBudgetEur = campaign && campaign.daily_budget ? parseInt(campaign.daily_budget, 10) / 100 : 0;
  var hasAdsetBudgets = activeAdsets.some(function (adset) { return Boolean(adset.daily_budget); });
  var allHaveAdsetBudgets = activeAdsets.every(function (adset) { return Boolean(adset.daily_budget); });
  var isCbo = campaignBudgetEur > 0 && !hasAdsetBudgets;
  var isAbo = allHaveAdsetBudgets && campaignBudgetEur === 0;

  var metrics = buildAdsetMetrics(snapshot, activeAdsets, cfg);
  var plan = buildBudgetPlan(metrics, cfg);

  if (isCbo || !isAbo) {
    if (isCbo && plan.actions.length === 0) {
      plan.actions = buildCboSuggestionActions(metrics, cfg);
    }
    var suggestionMsg = formatRegulatorMessage({
      now: now,
      cfg: cfg,
      mode: isCbo ? 'CBO_SUGGEST_ONLY' : 'MIXED_SUGGEST_ONLY',
      campaign: campaign,
      metrics: metrics,
      plan: plan,
      executed: [],
      skippedActions: plan.actions,
      note: isCbo
        ? 'CBO gedetecteerd: budgetverdeling zit op campagneniveau, dus geen adset-budget writes.'
        : 'Gemengde/onduidelijke budgetstructuur: geen automatische writes.'
    });

    return {
      ok: true,
      campaignType: isCbo ? 'CBO' : 'MIXED',
      shouldNotify: plan.actions.length > 0,
      message: suggestionMsg,
      executed: [],
      suggestions: plan.actions,
      skipped: false
    };
  }

  var executed = [];
  var skippedActions = [];
  var downActions = plan.actions.filter(function (action) { return action.direction === 'down'; });
  var upActions = plan.actions.filter(function (action) { return action.direction === 'up'; });
  var otherActions = plan.actions.filter(function (action) { return action.direction !== 'down' && action.direction !== 'up'; });
  var executedDecreaseEur = 0;

  for (var i = 0; i < downActions.length; i++) {
    var action = downActions[i];
    if (executed.length >= cfg.maxChangesPerRun) {
      skippedActions.push(Object.assign({}, action, { skippedReason: 'max_changes_per_run' }));
      continue;
    }

    var changeResult = await maybeExecuteBudgetChange(action, cfg, now);
    if (changeResult.executed) {
      executed.push(Object.assign({}, action, { result: changeResult.result }));
      executedDecreaseEur += Math.abs(action.deltaEur || 0);
    } else {
      skippedActions.push(Object.assign({}, action, { skippedReason: changeResult.reason }));
    }
  }

  var currentTotalBudgetEur = plan.summary && plan.summary.totalCurrentBudgetEur ? plan.summary.totalCurrentBudgetEur : 0;
  var allowedTotalIncreaseEur = cfg.allowTotalIncrease ? Math.max(0, cfg.maxTotalBudgetEur - currentTotalBudgetEur) : 0;
  var increasePoolEur = roundMoney(executedDecreaseEur + allowedTotalIncreaseEur);

  for (var u = 0; u < upActions.length; u++) {
    var upAction = upActions[u];
    if (executed.length >= cfg.maxChangesPerRun) {
      skippedActions.push(Object.assign({}, upAction, { skippedReason: 'max_changes_per_run' }));
      continue;
    }
    if ((upAction.deltaEur || 0) > increasePoolEur) {
      skippedActions.push(Object.assign({}, upAction, { skippedReason: 'funding_not_available' }));
      continue;
    }

    var upResult = await maybeExecuteBudgetChange(upAction, cfg, now);
    if (upResult.executed) {
      executed.push(Object.assign({}, upAction, { result: upResult.result }));
      increasePoolEur = roundMoney(increasePoolEur - (upAction.deltaEur || 0));
    } else {
      skippedActions.push(Object.assign({}, upAction, { skippedReason: upResult.reason }));
    }
  }

  otherActions.forEach(function (action) {
    skippedActions.push(Object.assign({}, action, { skippedReason: 'not_an_auto_budget_action' }));
  });

  var hasDecision = executed.length > 0 || skippedActions.length > 0 || plan.suggestions.length > 0;
  var shouldNotify = hasDecision || cfg.notifyNoAction;
  var message = null;
  if (shouldNotify) {
    message = formatRegulatorMessage({
      now: now,
      cfg: cfg,
      mode: cfg.enabled ? 'ABO_AUTO_BUDGET' : 'ABO_SUGGEST_ONLY',
      campaign: campaign,
      metrics: metrics,
      plan: plan,
      executed: executed,
      skippedActions: skippedActions,
      note: cfg.enabled
        ? 'ABO gedetecteerd: adset-budgetten mogen automatisch binnen caps en cooldowns worden gereguleerd.'
        : 'ABO gedetecteerd, maar auto-budget staat uit. Alleen suggesties.'
    });
  }

  return {
    ok: true,
    campaignType: 'ABO',
    shouldNotify: shouldNotify,
    message: message,
    executed: executed,
    suggestions: skippedActions.concat(plan.suggestions),
    skipped: false,
    plan: plan.summary
  };
}

async function fetchCampaign(campaignId) {
  try {
    var res = await metaApi.graphRequest('GET', campaignId, {
      fields: 'name,id,status,effective_status,daily_budget,lifetime_budget,budget_remaining'
    });
    if (!res.ok) return null;
    return res.data || null;
  } catch (e) {
    console.warn('[ABORegulator] campaign fetch failed:', e.message);
    return null;
  }
}

function buildAdsetMetrics(snapshot, activeAdsets, cfg) {
  var rows3d = indexBy(snapshot.adsetInsights3d || [], 'adset_id');
  var rowsToday = indexBy(snapshot.todayAdsets || [], 'adset_id');

  return activeAdsets.map(function (adset) {
    var row3d = rows3d[adset.id] || {};
    var rowToday = rowsToday[adset.id] || {};
    var spend3d = parseFloat(row3d.spend) || 0;
    var spendToday = parseFloat(rowToday.spend) || 0;
    var purchases3d = insights.pickActionValue(row3d.actions || [], insights.PURCHASE_PRIORITY);
    var purchasesToday = insights.pickActionValue(rowToday.actions || [], insights.PURCHASE_PRIORITY);
    var revenue3d = insights.pickActionValue(row3d.action_values || [], insights.PURCHASE_PRIORITY);
    var atc3d = insights.parseActionValue(row3d.actions || [], insights.ATC_TYPES);
    var ic3d = insights.parseActionValue(row3d.actions || [], insights.IC_TYPES);
    var impressions3d = parseInt(row3d.impressions, 10) || 0;
    var clicks3d = parseInt(row3d.clicks, 10) || 0;
    var budgetEur = adset.daily_budget ? parseInt(adset.daily_budget, 10) / 100 : 0;
    var cpa = purchases3d > 0 ? spend3d / purchases3d : 0;
    var roas = spend3d > 0 ? revenue3d / spend3d : 0;
    var ctr = impressions3d > 0 ? (clicks3d / impressions3d) * 100 : 0;

    var score = 0;
    if (purchases3d > 0) score += 3;
    if (purchases3d >= 2) score += 2;
    if (cpa > 0 && cpa <= cfg.targetCpa) score += 2;
    if (roas >= 2) score += 2;
    if (ctr >= 1.0) score += 1;
    if (spend3d >= cfg.targetCpa && purchases3d === 0) score -= 2;
    if (spend3d >= cfg.targetCpa && purchases3d === 0 && atc3d === 0 && ic3d === 0) score -= 2;

    return {
      id: adset.id,
      name: adset.name || adset.id,
      status: adset.effective_status || adset.status || '',
      currentBudgetEur: budgetEur,
      spend3d: spend3d,
      spendToday: spendToday,
      purchases3d: purchases3d,
      purchasesToday: purchasesToday,
      revenue3d: revenue3d,
      cpa: cpa,
      roas: roas,
      ctr: ctr,
      atc3d: atc3d,
      ic3d: ic3d,
      score: score
    };
  }).sort(function (a, b) {
    return b.score - a.score || b.purchases3d - a.purchases3d || b.roas - a.roas;
  });
}

function buildBudgetPlan(metrics, cfg) {
  var totalCurrent = sum(metrics.map(function (m) { return m.currentBudgetEur; }));
  var availableTotalIncrease = cfg.allowTotalIncrease ? Math.max(0, cfg.maxTotalBudgetEur - totalCurrent) : 0;
  var maxChangePct = Math.max(0.01, Math.min(cfg.maxChangePct, 0.25));

  var winners = metrics.filter(function (m) {
    if (m.currentBudgetEur <= 0) return false;
    if (m.purchases3d >= 2 && m.cpa > 0 && m.cpa <= cfg.targetCpa * 1.15) return true;
    if (m.purchases3d >= 1 && m.roas >= 2.0 && m.cpa > 0 && m.cpa <= cfg.targetCpa * 1.25) return true;
    return false;
  });

  var losers = metrics.filter(function (m) {
    if (m.currentBudgetEur <= cfg.minAdsetBudgetEur) return false;
    if (m.spend3d >= Math.max(cfg.targetCpa, m.currentBudgetEur * 1.2) && m.purchases3d === 0 && m.atc3d === 0 && m.ic3d === 0) return true;
    if (m.spendToday >= m.currentBudgetEur * 0.85 && m.purchasesToday === 0 && m.purchases3d === 0 && m.atc3d === 0) return true;
    return false;
  }).sort(function (a, b) {
    return b.spend3d - a.spend3d;
  });

  var actions = [];
  var suggestions = [];
  var releasedBudget = 0;

  losers.forEach(function (m) {
    var decrease = roundMoney(Math.max(cfg.minStepEur, m.currentBudgetEur * maxChangePct));
    var newBudget = roundMoney(Math.max(cfg.minAdsetBudgetEur, m.currentBudgetEur - decrease));
    var actualDecrease = roundMoney(m.currentBudgetEur - newBudget);
    if (actualDecrease < cfg.minStepEur) return;
    releasedBudget += actualDecrease;
    actions.push({
      type: 'adjust_adset_budget',
      direction: 'down',
      adsetId: m.id,
      adsetName: m.name,
      currentBudgetEur: m.currentBudgetEur,
      newBudgetEur: newBudget,
      newBudgetCents: Math.round(newBudget * 100),
      deltaEur: -actualDecrease,
      reason: 'Geen purchase/funnel-signaal na EUR ' + m.spend3d.toFixed(2) + ' spend in 3d.',
      metrics: metricSummary(m)
    });
  });

  var scalePool = roundMoney(releasedBudget + availableTotalIncrease);
  winners.forEach(function (m) {
    if (scalePool < cfg.minStepEur) return;
    var capIncrease = Math.max(0, cfg.maxAdsetBudgetEur - m.currentBudgetEur);
    var desiredIncrease = roundMoney(Math.min(Math.max(cfg.minStepEur, m.currentBudgetEur * maxChangePct), capIncrease, scalePool));
    if (desiredIncrease < cfg.minStepEur) return;
    var newBudget = roundMoney(m.currentBudgetEur + desiredIncrease);
    if (newBudget > cfg.maxAdsetBudgetEur) newBudget = cfg.maxAdsetBudgetEur;
    actions.push({
      type: 'scale_adset',
      direction: 'up',
      adsetId: m.id,
      adsetName: m.name,
      currentBudgetEur: m.currentBudgetEur,
      newBudgetEur: newBudget,
      newBudgetCents: Math.round(newBudget * 100),
      deltaEur: roundMoney(newBudget - m.currentBudgetEur),
      reason: m.purchases3d + ' purchases in 3d met CPA EUR ' + (m.cpa || 0).toFixed(2) + ' en ROAS ' + (m.roas || 0).toFixed(2) + 'x.',
      metrics: metricSummary(m)
    });
    scalePool = roundMoney(scalePool - desiredIncrease);
  });

  metrics.forEach(function (m) {
    if (actions.some(function (a) { return a.adsetId === m.id; })) return;
    if (m.purchases3d > 0 || m.score >= 2) {
      suggestions.push({
        type: 'keep_running',
        adsetId: m.id,
        adsetName: m.name,
        reason: 'Signaal is positief of nog niet negatief genoeg voor budgetwijziging.',
        metrics: metricSummary(m)
      });
    }
  });

  actions = guardTotalBudget(actions, metrics, cfg);

  return {
    actions: actions,
    suggestions: suggestions,
    summary: {
      totalCurrentBudgetEur: roundMoney(totalCurrent),
      maxTotalBudgetEur: cfg.maxTotalBudgetEur,
      releasedBudgetEur: roundMoney(releasedBudget),
      winners: winners.length,
      losers: losers.length
    }
  };
}

function buildCboSuggestionActions(metrics, cfg) {
  var winners = metrics.filter(function (m) {
    if (m.spend3d < cfg.targetCpa * 0.5) return false;
    if (m.purchases3d >= 2 && m.cpa > 0 && m.cpa <= cfg.targetCpa * 1.15) return true;
    if (m.purchases3d >= 1 && m.roas >= 2.0) return true;
    return false;
  }).slice(0, 2).map(function (m) {
    return {
      type: 'cbo_suggestion',
      direction: 'up',
      adsetId: m.id,
      adsetName: m.name,
      reason: 'CBO: dit adset-segment presteert relatief sterk; verhoog niet op adsetniveau, maar overweeg campaign-level schaal pas na review.',
      metrics: metricSummary(m)
    };
  });

  var losers = metrics.filter(function (m) {
    if (m.spend3d < cfg.targetCpa) return false;
    return m.purchases3d === 0 && m.atc3d === 0 && m.ic3d === 0;
  }).slice(0, 2).map(function (m) {
    return {
      type: 'cbo_suggestion',
      direction: 'down',
      adsetId: m.id,
      adsetName: m.name,
      reason: 'CBO: zwak segment; geen adset-budget write mogelijk. Review targeting/creative mix of campaign-level structuur handmatig.',
      metrics: metricSummary(m)
    };
  });

  return winners.concat(losers);
}

function guardTotalBudget(actions, metrics, cfg) {
  var currentById = {};
  metrics.forEach(function (m) { currentById[m.id] = m.currentBudgetEur; });

  var projected = metrics.map(function (m) {
    var action = actions.find(function (a) { return a.adsetId === m.id; });
    return action ? action.newBudgetEur : m.currentBudgetEur;
  });
  var projectedTotal = roundMoney(sum(projected));

  if (projectedTotal <= cfg.maxTotalBudgetEur) return actions;

  var excess = roundMoney(projectedTotal - cfg.maxTotalBudgetEur);
  return actions.map(function (action) {
    if (excess <= 0 || action.direction !== 'up') return action;
    var reducible = Math.max(0, action.newBudgetEur - currentById[action.adsetId]);
    var reduceBy = Math.min(excess, reducible);
    var newBudget = roundMoney(action.newBudgetEur - reduceBy);
    excess = roundMoney(excess - reduceBy);
    if (newBudget - currentById[action.adsetId] < cfg.minStepEur) {
      return Object.assign({}, action, { blocked: true, blockedReason: 'total_budget_cap' });
    }
    return Object.assign({}, action, {
      newBudgetEur: newBudget,
      newBudgetCents: Math.round(newBudget * 100),
      deltaEur: roundMoney(newBudget - currentById[action.adsetId])
    });
  }).filter(function (action) {
    return !action.blocked;
  });
}

async function maybeExecuteBudgetChange(action, cfg, now) {
  if (!cfg.enabled) return { executed: false, reason: 'auto_budget_disabled' };
  if (action.newBudgetEur > cfg.maxAdsetBudgetEur) return { executed: false, reason: 'adset_cap' };
  if (action.newBudgetEur < cfg.minAdsetBudgetEur) return { executed: false, reason: 'min_budget_floor' };

  var cooldownKey = 'ads:auto_budget:last_change:' + action.adsetId;
  var lastRaw = await store.get(cooldownKey);
  if (lastRaw) {
    try {
      var last = JSON.parse(lastRaw);
      var minutesSince = (now.getTime() - new Date(last.timestamp).getTime()) / 60000;
      if (minutesSince < cfg.cooldownMinutes) {
        return { executed: false, reason: 'cooldown_' + Math.ceil(cfg.cooldownMinutes - minutesSince) + 'm' };
      }
    } catch (e) {
      return { executed: false, reason: 'cooldown_parse_error' };
    }
  }

  var idemKey = 'ads:auto_budget:idem:' + dates.todayKey(now) + ':' + action.adsetId + ':' + action.newBudgetCents;
  var first = await store.setnx(idemKey, '1', 24 * 3600);
  if (!first) return { executed: false, reason: 'already_attempted_today' };

  var reason = '[15m ABO regulator] ' + action.reason + ' Budget EUR ' +
    action.currentBudgetEur.toFixed(2) + ' -> EUR ' + action.newBudgetEur.toFixed(2) + '.';
  var result = await metaApi.adjustAdsetBudget(action.adsetId, action.newBudgetCents, reason, false);

  if (result && result.ok) {
    await store.set(cooldownKey, JSON.stringify({
      timestamp: now.toISOString(),
      from: action.currentBudgetEur,
      to: action.newBudgetEur,
      reason: action.reason,
      dryRun: Boolean(result.dryRun)
    }), cfg.cooldownMinutes * 60);
    return { executed: true, result: result };
  }

  return { executed: false, reason: result && result.error ? result.error : 'meta_write_failed', result: result };
}

function formatRegulatorMessage(args) {
  var now = args.now;
  var cfg = args.cfg;
  var plan = args.plan || { actions: [], suggestions: [], summary: {} };
  var executed = args.executed || [];
  var skippedActions = args.skippedActions || [];
  var campaignName = (args.campaign && args.campaign.name) || cfg.campaignName;

  var lines = [
    '<b>CALQIX 15m Budget Check</b> - ' + dates.formatDateTimeAmsterdam(now),
    '',
    'Campagne: ' + escapeHtml(truncate(campaignName, 70)),
    'Mode: ' + args.mode + ' | Max totaal: EUR ' + cfg.maxTotalBudgetEur.toFixed(2) + ' | Max adset: EUR ' + cfg.maxAdsetBudgetEur.toFixed(2),
    args.note || '',
    ''
  ];

  if (executed.length) {
    lines.push('<b>Automatisch uitgevoerd:</b>');
    executed.forEach(function (a) {
      lines.push('- ' + directionLabel(a.direction) + ' ' + escapeHtml(truncate(a.adsetName, 42)) +
        ': EUR ' + a.currentBudgetEur.toFixed(2) + ' -> EUR ' + a.newBudgetEur.toFixed(2) +
        ' | ' + formatMetrics(a.metrics));
    });
    lines.push('');
  }

  var actionableSkipped = skippedActions.filter(function (a) { return a.type !== 'keep_running'; });
  if (actionableSkipped.length) {
    lines.push('<b>Suggesties / niet uitgevoerd:</b>');
    actionableSkipped.slice(0, 5).forEach(function (a) {
      if (a.type === 'cbo_suggestion') {
        lines.push('- ' + directionLabel(a.direction) + ' ' + escapeHtml(truncate(a.adsetName, 42)) +
          ': ' + escapeHtml(a.reason || 'suggestie') + ' | ' + formatMetrics(a.metrics));
      } else {
        lines.push('- ' + directionLabel(a.direction) + ' ' + escapeHtml(truncate(a.adsetName, 42)) +
          ': EUR ' + Number(a.currentBudgetEur || 0).toFixed(2) + ' -> EUR ' + Number(a.newBudgetEur || 0).toFixed(2) +
          (a.skippedReason ? ' (' + escapeHtml(a.skippedReason) + ')' : '') +
          ' | ' + formatMetrics(a.metrics));
      }
    });
    lines.push('');
  }

  if (!executed.length && !actionableSkipped.length) {
    lines.push('<b>Beslissing:</b> geen budgetwijziging.');
    lines.push('Reden: geen sterk genoeg winner/loser-paar binnen caps, cooldowns en datadrempels.');
    lines.push('');
  }

  var keep = (plan.suggestions || []).filter(function (s) { return s.type === 'keep_running'; }).slice(0, 4);
  if (keep.length) {
    lines.push('<b>Laten lopen:</b>');
    keep.forEach(function (s) {
      lines.push('- ' + escapeHtml(truncate(s.adsetName, 42)) + ' | ' + formatMetrics(s.metrics));
    });
    lines.push('');
  }

  var summary = plan.summary || {};
  lines.push('Huidig ABO totaal: EUR ' + Number(summary.totalCurrentBudgetEur || 0).toFixed(2));
  lines.push('Cooldown: ' + cfg.cooldownMinutes + 'm | Max wijzigingen/run: ' + cfg.maxChangesPerRun);

  return lines.filter(function (line) { return line !== null && line !== undefined; }).join('\n');
}

function metricSummary(m) {
  return {
    spend3d: roundMoney(m.spend3d),
    purchases3d: m.purchases3d,
    cpa: roundMoney(m.cpa || 0),
    roas: roundMoney(m.roas || 0),
    ctr: roundMoney(m.ctr || 0),
    atc3d: m.atc3d,
    ic3d: m.ic3d,
    todaySpend: roundMoney(m.spendToday || 0)
  };
}

function formatMetrics(m) {
  if (!m) return 'geen metrics';
  return '3d spend EUR ' + Number(m.spend3d || 0).toFixed(2) +
    ', purch ' + (m.purchases3d || 0) +
    ', CPA ' + (m.cpa > 0 ? 'EUR ' + Number(m.cpa).toFixed(2) : 'n/a') +
    ', ROAS ' + Number(m.roas || 0).toFixed(2) + 'x';
}

function directionLabel(direction) {
  if (direction === 'up') return 'Meer budget';
  if (direction === 'down') return 'Minder budget';
  return 'Budget';
}

function indexBy(rows, key) {
  var out = {};
  (rows || []).forEach(function (row) {
    if (row && row[key]) out[row[key]] = row;
  });
  return out;
}

function sum(values) {
  return (values || []).reduce(function (s, v) { return s + (parseFloat(v) || 0); }, 0);
}

function roundMoney(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(value, len) {
  var s = String(value || '');
  return s.length > len ? s.substring(0, len - 3) + '...' : s;
}

module.exports = {
  run: run,
  buildBudgetPlan: buildBudgetPlan,
  buildAdsetMetrics: buildAdsetMetrics
};
