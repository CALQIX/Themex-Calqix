/**
 * Ad Rules Engine - evaluates Meta ad performance and returns safe proposals.
 *
 * Important safety posture:
 * - This layer does not create native Meta automated rules that can bypass approval.
 * - Pause and budget changes are always approval-required proposals.
 * - Read-only review/fatigue/spend-starved flags may be monitor-only.
 *
 * Env vars:
 *   TARGET_CPA                  - target cost per acquisition (default: 15)
 *   MAX_ADSET_BUDGET            - max adset daily budget EUR (default: 50)
 *   MAX_DAILY_SPEND             - max total daily account spend EUR (default: 100)
 *   MIN_PURCHASES_TO_SCALE      - minimum purchases before scale proposal (default: 2)
 *   ADS_OPTIMIZATION_MODE       - MONITOR_ONLY | SUGGEST | TELEGRAM_APPROVAL | EXECUTE | AUTO_EXECUTE
 */

var TARGET_CPA = function () { return parseFloat(process.env.TARGET_CPA || '15'); };
var _cachedLimits = null;
var MAX_ADSET_BUDGET = function () { return (_cachedLimits && _cachedLimits.max_adset_budget) || parseFloat(process.env.MAX_ADSET_BUDGET || '50'); };
var MAX_DAILY_SPEND = function () { return (_cachedLimits && _cachedLimits.max_daily_spend) || parseFloat(process.env.MAX_DAILY_SPEND || '100'); };
var MIN_PURCHASES_TO_SCALE = function () { return parseInt(process.env.MIN_PURCHASES_TO_SCALE || '2', 10); };
var MODE = function () { return process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY'; };

/**
 * Pre-load budget limits from Redis into module cache.
 * Call this before evaluate() in the ad-morning chain.
 */
async function initLimits() {
  try {
    var limits = require('./limits');
    _cachedLimits = await limits.getLimits();
  } catch (e) {
    console.warn('[RulesEngine] initLimits failed, using env var defaults:', e.message);
    _cachedLimits = null;
  }
}

var ACTION_TYPES = {
  PAUSE_AD: 'pause_ad',
  SCALE_ADSET: 'scale_adset',
  SCALE_CAMPAIGN: 'scale_campaign',
  ADJUST_ADSET_BUDGET: 'adjust_adset_budget',
  FLAG_FATIGUE: 'flag_fatigue',
  FLAG_SPEND_STARVED: 'flag_spend_starved',
  FLAG_REVIEW: 'flag_review'
};

var SAFETY_LEVELS = {
  AUTO_SAFE: 'auto_safe',
  APPROVAL_REQUIRED: 'approval_required',
  MONITOR_ONLY: 'monitor_only'
};

/**
 * Evaluate all rules against a performance snapshot.
 * @param {object} snapshot - from meta-insights-fetcher.fetchOptimizationSnapshot
 * @param {object} [fatigueData] - from ad-fatigue-tracker
 * @param {object} [budgetHistory] - recent budget changes
 * @returns {{proposals: Array, rulePlan: Array, evaluated: number, skipped: number, errors: string[], mode: string}}
 */
function evaluate(snapshot, fatigueData, budgetHistory) {
  snapshot = snapshot || {};

  var proposals = [];
  var evaluated = 0;
  var skipped = 0;
  var errors = [];
  var mode = MODE();

  var adRows = snapshot.adRows || [];
  var adsetRows = snapshot.adsetRows || [];
  var adsetConfigs = snapshot.adsetConfigs || [];
  var todayAdsetRows = snapshot.todayAdsetRows || [];

  var writeRulesAllowed = !hasCriticalSnapshotErrors(snapshot);
  var dataHoldAdded = false;
  var writeActionByEntity = {};
  var scaleByAdset = {};

  if (!writeRulesAllowed) {
    errors.push('Write-action rules held because Meta snapshot has critical API/config errors.');
  }

  var adsetConfigMap = indexBy(adsetConfigs, 'id');
  var todayAdsetMap = indexBy(todayAdsetRows, 'adset_id');
  var fatigue = fatigueData || {};
  var budgetHist = budgetHistory || {};

  function pushProposal(proposal, requiresWrite) {
    if (requiresWrite && !writeRulesAllowed) {
      if (!dataHoldAdded) {
        proposals.push({
          action: ACTION_TYPES.FLAG_REVIEW,
          safety: SAFETY_LEVELS.MONITOR_ONLY,
          entityId: 'account',
          entityName: snapshot.accountInfo && snapshot.accountInfo.name ? snapshot.accountInfo.name : 'Meta ad account',
          rule: 'DQ1_DATA_QUALITY_HOLD',
          reason: 'Meta API snapshot has errors; pause/scale rules are held until data quality is clean.',
          metrics: { errors: snapshot.errors || [] },
          expectedEffect: 'Prevent unsafe changes based on incomplete Meta data.'
        });
        dataHoldAdded = true;
      }
      return;
    }

    if (requiresWrite) {
      var dedupeKey = proposal.action + ':' + proposal.entityId;
      if (writeActionByEntity[dedupeKey]) return;
      writeActionByEntity[dedupeKey] = true;
    }

    proposals.push(proposal);
  }

  // --- AD-LEVEL RULES ---

  adRows.forEach(function (ad) {
    evaluated++;
    if (!ad || !ad.ad_id) { skipped++; return; }

    var noPurchase = (ad.purchases || 0) === 0;
    var noFunnelSignal = noPurchase && (ad.atc || 0) === 0 && (ad.ic || 0) === 0;
    var spend = ad.spend || 0;
    var ctr = ad.ctr || 0;
    var clicks = ad.clicks || 0;
    var impressions = ad.impressions || 0;
    var targetCpa = TARGET_CPA();

    // P2 first: strongest pure waste signal for a lean EUR 50/day ABO test.
    if (spend >= Math.max(20, targetCpa * 1.25) && noFunnelSignal) {
      pushProposal({
        action: ACTION_TYPES.PAUSE_AD,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P2_NO_FUNNEL_SIGNAL',
        reason: 'Spent EUR ' + spend.toFixed(2) + ' with 0 purchases, 0 initiate checkouts and 0 add-to-carts.',
        metrics: { spend: spend, purchases: ad.purchases || 0, initiateCheckouts: ad.ic || 0, addToCarts: ad.atc || 0, targetCpa: targetCpa },
        expectedEffect: 'Queue ad pause for approval and move spend away from a no-signal creative.'
      }, true);
    }

    if (spend >= targetCpa * 2.5 && noPurchase) {
      pushProposal({
        action: noFunnelSignal ? ACTION_TYPES.PAUSE_AD : ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: noFunnelSignal ? 'P3_EXCEED_CPA_NO_PURCHASE' : 'F2_FUNNEL_LEAK_NO_PURCHASE',
        reason: 'Spent EUR ' + spend.toFixed(2) + ' (>= 2.5x target CPA) with 0 purchases.',
        metrics: { spend: spend, targetCpa: targetCpa, purchases: 0, addToCarts: ad.atc || 0, initiateCheckouts: ad.ic || 0 },
        expectedEffect: noFunnelSignal ? 'Queue pause for approval after hard no-purchase threshold.' : 'Review offer, product page, checkout and shipping friction before pausing.'
      }, noFunnelSignal);
    }

    if (impressions >= 1000 && ctr < 0.7 && noFunnelSignal && spend >= targetCpa * 0.75) {
      pushProposal({
        action: ACTION_TYPES.PAUSE_AD,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P1_LOW_CTR_NO_FUNNEL',
        reason: 'CTR ' + ctr.toFixed(2) + '% with ' + impressions + ' impressions and no funnel signal.',
        metrics: { impressions: impressions, ctr: ctr, spend: spend, purchases: ad.purchases || 0, addToCarts: ad.atc || 0 },
        expectedEffect: 'Queue ad pause for approval because the creative is not earning attention or funnel action.'
      }, true);
    }

    if ((ad.purchases || 0) === 1 && spend > targetCpa * 2) {
      pushProposal({
        action: ACTION_TYPES.PAUSE_AD,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P5_HIGH_CPA_SINGLE_PURCHASE',
        reason: 'CPA EUR ' + spend.toFixed(2) + ' is above 2x target with only 1 purchase.',
        metrics: { spend: spend, purchases: ad.purchases || 0, cpa: spend, targetCpa: targetCpa },
        expectedEffect: 'Queue pause for approval if the purchase quality is not repeatable.'
      }, true);
    }

    if (ad.frequency > 3.5 && impressions >= 1000) {
      pushProposal({
        action: ACTION_TYPES.FLAG_FATIGUE,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P4_HIGH_FREQUENCY',
        reason: 'Frequency ' + ad.frequency.toFixed(1) + ' with ' + impressions + ' impressions.',
        metrics: { frequency: ad.frequency, impressions: impressions, ctr: ctr, purchases: ad.purchases || 0 },
        expectedEffect: 'Review for creative refresh, duplicate-with-new-copy or approval-gated pause.'
      }, false);
    }

    if (clicks >= 30 && ctr >= 1.0 && spend >= targetCpa && noFunnelSignal) {
      pushProposal({
        action: ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'F3_LANDING_PAGE_LEAK',
        reason: clicks + ' clicks and CTR ' + ctr.toFixed(2) + '% but no add-to-cart, checkout or purchase.',
        metrics: { clicks: clicks, ctr: ctr, spend: spend, lpv: ad.lpv || 0, addToCarts: ad.atc || 0, initiateCheckouts: ad.ic || 0 },
        expectedEffect: 'Investigate landing page, product match, price, shipping threshold and offer clarity.'
      }, false);
    }

    if ((ad.ic || 0) >= 2 && noPurchase && spend >= targetCpa) {
      pushProposal({
        action: ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'F4_CHECKOUT_LEAK',
        reason: (ad.ic || 0) + ' initiate checkouts but 0 purchases.',
        metrics: { spend: spend, initiateCheckouts: ad.ic || 0, purchases: ad.purchases || 0, addToCarts: ad.atc || 0 },
        expectedEffect: 'Review checkout friction, payment methods, shipping costs and trust elements before budget changes.'
      }, false);
    }

    if ((ad.purchases || 0) >= 2 && ad.cost_per_purchase > 0 && ad.cost_per_purchase <= targetCpa && ctr >= 1.0) {
      pushProposal({
        action: ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'W1_WINNER_REFRESH',
        reason: (ad.purchases || 0) + ' purchases at CPA EUR ' + ad.cost_per_purchase.toFixed(2) + ' and CTR ' + ctr.toFixed(2) + '%.',
        metrics: { purchases: ad.purchases || 0, costPerPurchase: ad.cost_per_purchase, ctr: ctr, roas: ad.roas || 0 },
        expectedEffect: 'Plan duplicate or fresh static/copy variant to extend the winning angle.'
      }, false);
    }
  });

  // --- ADSET-LEVEL RULES ---

  adsetRows.forEach(function (adset) {
    evaluated++;
    if (!adset || !adset.adset_id) { skipped++; return; }

    var config = adsetConfigMap[adset.adset_id];
    if (!config) { skipped++; return; }

    var dailyBudgetEur = config.daily_budget ? parseInt(config.daily_budget, 10) / 100 : 0;
    if (dailyBudgetEur <= 0) { skipped++; return; }

    var targetCpa = TARGET_CPA();
    var currentCpa = adset.cost_per_purchase || 0;
    var purchases = adset.purchases || 0;
    var spend = adset.spend || 0;
    var canScale = canScaleAdset(adset.adset_id, budgetHist);
    var minPurchases = MIN_PURCHASES_TO_SCALE();

    if (purchases >= minPurchases && adset.roas >= 2.0 && currentCpa > 0 && currentCpa <= targetCpa * 1.1 && spend >= targetCpa && canScale) {
      pushScaleProposal({
        adset: adset,
        adsetConfigs: adsetConfigs,
        dailyBudgetEur: dailyBudgetEur,
        increasePct: 0.15,
        rule: 'S1_STRONG_ROAS_QUALITY',
        reason: 'ROAS ' + adset.roas.toFixed(2) + 'x with ' + purchases + ' purchases and CPA EUR ' + currentCpa.toFixed(2) + '.',
        metrics: { roas: adset.roas, spend: spend, purchases: purchases, costPerPurchase: currentCpa, currentBudget: dailyBudgetEur },
        scaleByAdset: scaleByAdset,
        pushProposal: pushProposal
      });
    }

    if (!scaleByAdset[adset.adset_id] && purchases >= minPurchases && currentCpa > 0 && currentCpa <= targetCpa * 0.75 && spend >= targetCpa && canScale) {
      pushScaleProposal({
        adset: adset,
        adsetConfigs: adsetConfigs,
        dailyBudgetEur: dailyBudgetEur,
        increasePct: 0.15,
        rule: 'S2_LOW_CPA_QUALITY',
        reason: 'CPA EUR ' + currentCpa.toFixed(2) + ' is <= 75% of target CPA with ' + purchases + ' purchases.',
        metrics: { costPerPurchase: currentCpa, targetCpa: targetCpa, purchases: purchases, currentBudget: dailyBudgetEur },
        scaleByAdset: scaleByAdset,
        pushProposal: pushProposal
      });
    }

    if (!scaleByAdset[adset.adset_id] && purchases >= 3 && currentCpa > 0 && currentCpa <= targetCpa && spend >= targetCpa * 1.5 && canScale) {
      pushScaleProposal({
        adset: adset,
        adsetConfigs: adsetConfigs,
        dailyBudgetEur: dailyBudgetEur,
        increasePct: 0.10,
        rule: 'S3_CONSISTENT_PERFORMER',
        reason: purchases + ' purchases with CPA EUR ' + currentCpa.toFixed(2) + ' inside target.',
        metrics: { purchases: purchases, costPerPurchase: currentCpa, roas: adset.roas || 0, currentBudget: dailyBudgetEur },
        scaleByAdset: scaleByAdset,
        pushProposal: pushProposal
      });
    }

    if (spend >= Math.max(25, targetCpa * 1.5) && purchases === 0) {
      pushProposal({
        action: ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: adset.adset_id,
        entityName: adset.adset_name,
        rule: 'S4_UNDERPERFORMING_ADSET',
        reason: 'Spent EUR ' + spend.toFixed(2) + ' with 0 purchases at adset level.',
        metrics: { spend: spend, purchases: 0, ctr: adset.ctr || 0, roas: adset.roas || 0 },
        expectedEffect: 'Review budget reallocation, audience/market fit and creative mix before any pause.'
      }, false);
    }

    var today = todayAdsetMap[adset.adset_id];
    if (today && today.spend >= dailyBudgetEur * 0.65 && (today.purchases || 0) === 0) {
      pushProposal({
        action: ACTION_TYPES.FLAG_REVIEW,
        safety: SAFETY_LEVELS.MONITOR_ONLY,
        entityId: adset.adset_id,
        entityName: adset.adset_name,
        rule: 'S5_TODAY_PACING_NO_PURCHASE',
        reason: 'Today spend is already ' + ((today.spend / dailyBudgetEur) * 100).toFixed(0) + '% of daily budget with 0 purchases.',
        metrics: { todaySpend: today.spend, dailyBudget: dailyBudgetEur, purchases: today.purchases || 0, ctr: today.ctr || 0 },
        expectedEffect: 'Watch intraday pacing; do not pause until enough conversion data exists.'
      }, false);
    }
  });

  // --- SPEND-STARVED DETECTION ---

  var adsByAdset = {};
  adRows.forEach(function (ad) {
    if (!ad || !ad.adset_id) return;
    if (!adsByAdset[ad.adset_id]) adsByAdset[ad.adset_id] = [];
    adsByAdset[ad.adset_id].push(ad);
  });

  Object.keys(adsByAdset).forEach(function (adsetId) {
    var siblings = adsByAdset[adsetId];
    if (siblings.length < 2) return;
    var totalSpend = siblings.reduce(function (s, ad) { return s + (ad.spend || 0); }, 0);
    if (totalSpend < 5) return;

    siblings.forEach(function (ad) {
      evaluated++;
      var pct = ((ad.spend || 0) / totalSpend) * 100;
      if (pct < 5 && (ad.impressions || 0) < 100) {
        pushProposal({
          action: ACTION_TYPES.FLAG_SPEND_STARVED,
          safety: SAFETY_LEVELS.MONITOR_ONLY,
          entityId: ad.ad_id,
          entityName: ad.ad_name,
          rule: 'SS1_SPEND_STARVED',
          reason: 'Only ' + pct.toFixed(0) + '% of adset spend and ' + (ad.impressions || 0) + ' impressions.',
          metrics: { spend: ad.spend || 0, spendPct: pct, impressions: ad.impressions || 0, adsetTotalSpend: totalSpend },
          expectedEffect: 'Do not judge creative yet; consider adset structure, duplication or budget distribution.'
        }, false);
      }
    });
  });

  // --- FATIGUE DETECTION FROM TRACKER ---

  if (fatigue && typeof fatigue === 'object') {
    Object.keys(fatigue).forEach(function (adId) {
      var fd = fatigue[adId];
      if (fd && fd.fatigued) {
        evaluated++;
        pushProposal({
          action: ACTION_TYPES.FLAG_FATIGUE,
          safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
          entityId: adId,
          entityName: fd.adName || adId,
          rule: 'F1_CTR_DECLINE',
          reason: 'CTR dropped ' + (fd.ctrDeclinePct || 0).toFixed(0) + '% from peak.',
          metrics: { peakCtr: fd.peakCtr, currentCtr: fd.currentCtr, ctrDeclinePct: fd.ctrDeclinePct },
          expectedEffect: 'Plan creative refresh or approval-gated pause.'
        }, false);
      }
    });
  }

  var rulePlan = planRuleImprovements(snapshot, proposals, {
    writeRulesAllowed: writeRulesAllowed,
    mode: mode,
    minPurchasesToScale: MIN_PURCHASES_TO_SCALE()
  });

  return {
    proposals: proposals,
    rulePlan: rulePlan,
    evaluated: evaluated,
    skipped: skipped,
    errors: errors,
    mode: mode
  };
}

// --- Rule planning ---

function planRuleImprovements(snapshot, proposals, context) {
  var plan = [];
  var byRule = countBy(proposals, 'rule');
  var totalPause = proposals.filter(function (p) { return p.action === ACTION_TYPES.PAUSE_AD; }).length;
  var totalScale = proposals.filter(function (p) { return p.action === ACTION_TYPES.SCALE_ADSET; }).length;

  plan.push({
    id: 'RP0_RESEARCH_BEFORE_CHANGES',
    priority: 'standard',
    recommendation: 'Before adding native Meta rules or changing thresholds, review the latest Meta Marketing API docs and compare against the last 3, 7 and 14 days of account data.',
    reason: 'Meta API behavior and Ads Manager automation features change; CALQIX rules should stay data-led and approval-gated.'
  });

  if (!context.writeRulesAllowed) {
    plan.push({
      id: 'RP1_DATA_QUALITY_FIRST',
      priority: 'high',
      recommendation: 'Fix Meta API snapshot errors before allowing any pause or budget proposal.',
      reason: 'Incomplete insights/config data can create false loser or false winner signals.'
    });
  }

  if (byRule.F3_LANDING_PAGE_LEAK || byRule.F4_CHECKOUT_LEAK) {
    plan.push({
      id: 'RP2_FUNNEL_DIAGNOSTICS',
      priority: 'high',
      recommendation: 'Add the flagged ads to a funnel review: creative-message match, product page, offer, shipping threshold, checkout and payment methods.',
      reason: 'Clicks or checkouts without purchase usually need CRO and offer work before more ad budget.'
    });
  }

  if (byRule.W1_WINNER_REFRESH || totalScale > 0) {
    plan.push({
      id: 'RP3_WINNER_EXPANSION',
      priority: 'high',
      recommendation: 'Prepare fresh copy/static variants for winner Match IDs and duplicate only after operator approval.',
      reason: 'Winners should be extended with new creative before fatigue, not only scaled.'
    });
  }

  if (byRule.SS1_SPEND_STARVED) {
    plan.push({
      id: 'RP4_SPEND_STARVED_REVIEW',
      priority: 'medium',
      recommendation: 'Review adset structure if spend-starved ads keep appearing: fewer ads per adset, duplicate winner, or simplify market split.',
      reason: 'Spend-starved creatives lack enough data for a fair kill decision.'
    });
  }

  if (totalPause > 0) {
    plan.push({
      id: 'RP5_APPROVAL_QUEUE',
      priority: 'high',
      recommendation: 'Keep pause proposals in Telegram approval and verify the task data before executing.',
      reason: 'CALQIX guardrails require trigger data before destructive Meta changes.'
    });
  }

  if (proposals.length === 0) {
    plan.push({
      id: 'RP6_NO_ACTION',
      priority: 'low',
      recommendation: 'Keep learning active; do not add stricter rules until more purchase or funnel data is available.',
      reason: 'No rule fired, so current data does not justify changes.'
    });
  }

  return plan;
}

// --- Helpers ---

function pushScaleProposal(args) {
  var adset = args.adset;
  var dailyBudgetEur = args.dailyBudgetEur;
  var increasePct = args.increasePct;
  var newBudget = Math.min(dailyBudgetEur * (1 + increasePct), MAX_ADSET_BUDGET());
  var increase = newBudget - dailyBudgetEur;
  var totalDailySpend = estimateTotalDailySpend(args.adsetConfigs);

  if (args.scaleByAdset[adset.adset_id]) return;

  if (newBudget <= dailyBudgetEur) {
    args.pushProposal({
      action: ACTION_TYPES.FLAG_REVIEW,
      safety: SAFETY_LEVELS.MONITOR_ONLY,
      entityId: adset.adset_id,
      entityName: adset.adset_name,
      rule: args.rule + '_BLOCKED_BY_ADSET_CAP',
      reason: 'Adset qualifies for scale but is already at MAX_ADSET_BUDGET EUR ' + MAX_ADSET_BUDGET() + '.',
      metrics: Object.assign({}, args.metrics, { maxAdsetBudget: MAX_ADSET_BUDGET() }),
      expectedEffect: 'Keep capped or consider approved campaign-level restructure.'
    }, false);
    return;
  }

  if (totalDailySpend + increase > MAX_DAILY_SPEND()) {
    args.pushProposal({
      action: ACTION_TYPES.FLAG_REVIEW,
      safety: SAFETY_LEVELS.MONITOR_ONLY,
      entityId: adset.adset_id,
      entityName: adset.adset_name,
      rule: args.rule + '_BLOCKED_BY_SPEND_CAP',
      reason: 'Adset qualifies for scale but account daily spend would exceed MAX_DAILY_SPEND EUR ' + MAX_DAILY_SPEND() + '.',
      metrics: Object.assign({}, args.metrics, { totalDailySpend: totalDailySpend, increase: increase, maxDailySpend: MAX_DAILY_SPEND() }),
      expectedEffect: 'Reallocate budget or approve a higher cap before scaling.'
    }, false);
    return;
  }

  args.scaleByAdset[adset.adset_id] = true;
  args.pushProposal({
    action: ACTION_TYPES.SCALE_ADSET,
    safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
    entityId: adset.adset_id,
    entityName: adset.adset_name,
    rule: args.rule,
    reason: args.reason,
    metrics: Object.assign({}, args.metrics, { currentBudget: dailyBudgetEur, newBudget: newBudget, increasePct: increasePct }),
    expectedEffect: 'Queue budget increase from EUR ' + dailyBudgetEur.toFixed(2) + ' to EUR ' + newBudget.toFixed(2) + ' for operator approval.',
    payload: { newBudgetCents: Math.round(newBudget * 100) }
  }, true);
}

function indexBy(rows, key) {
  var out = {};
  (rows || []).forEach(function (row) {
    if (row && row[key]) out[row[key]] = row;
  });
  return out;
}

function countBy(rows, key) {
  var out = {};
  (rows || []).forEach(function (row) {
    var value = row && row[key] ? row[key] : 'unknown';
    out[value] = (out[value] || 0) + 1;
  });
  return out;
}

function hasCriticalSnapshotErrors(snapshot) {
  var errs = snapshot.errors || [];
  if (!errs.length) return false;
  return errs.some(function (err) {
    return /ad_performance|adset_performance|adsets_config|campaigns_config|account_info/i.test(String(err));
  });
}

function canScaleAdset(adsetId, budgetHistory) {
  var lastChange = budgetHistory[adsetId];
  if (!lastChange) return true;
  var hoursSince = (Date.now() - new Date(lastChange.timestamp).getTime()) / 3600000;
  return hoursSince >= 48;
}

function estimateTotalDailySpend(adsetConfigs) {
  var total = 0;
  (adsetConfigs || []).forEach(function (as) {
    if (as.daily_budget) total += parseInt(as.daily_budget, 10) / 100;
  });
  return total;
}

module.exports = {
  evaluate: evaluate,
  initLimits: initLimits,
  ACTION_TYPES: ACTION_TYPES,
  SAFETY_LEVELS: SAFETY_LEVELS,
  TARGET_CPA: TARGET_CPA,
  MAX_ADSET_BUDGET: MAX_ADSET_BUDGET,
  MAX_DAILY_SPEND: MAX_DAILY_SPEND,
  MIN_PURCHASES_TO_SCALE: MIN_PURCHASES_TO_SCALE,
  MODE: MODE
};
