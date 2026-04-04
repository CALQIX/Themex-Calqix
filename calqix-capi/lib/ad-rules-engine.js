/**
 * Ad Rules Engine — evaluates optimization rules against performance data.
 *
 * Outputs machine-readable action proposals.
 * Separates safe auto-actions from approval-required actions.
 *
 * Env vars:
 *   TARGET_CPA             — target cost per acquisition (default: 15)
 *   MAX_ADSET_BUDGET       — max adset daily budget EUR (default: 50)
 *   MAX_DAILY_SPEND        — max total daily account spend EUR (default: 100)
 *   ADS_OPTIMIZATION_MODE  — MONITOR_ONLY | SUGGEST | AUTO_EXECUTE
 */

var TARGET_CPA = function () { return parseFloat(process.env.TARGET_CPA || '15'); };
var _cachedLimits = null;
var MAX_ADSET_BUDGET = function () { return (_cachedLimits && _cachedLimits.max_adset_budget) || parseFloat(process.env.MAX_ADSET_BUDGET || '50'); };
var MAX_DAILY_SPEND = function () { return (_cachedLimits && _cachedLimits.max_daily_spend) || parseFloat(process.env.MAX_DAILY_SPEND || '100'); };
var MODE = function () { return process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY'; };
var AUTO_SCALE = function () { return process.env.AUTO_SCALE_ENABLED === 'true'; };

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
 * @param {object} snapshot — from meta-insights-fetcher.fetchOptimizationSnapshot
 * @param {object} [fatigueData] — from ad-fatigue-tracker
 * @param {object} [budgetHistory] — recent budget changes
 * @returns {{proposals: Array, evaluated: number, skipped: number, errors: string[]}}
 */
function evaluate(snapshot, fatigueData, budgetHistory) {
  var proposals = [];
  var evaluated = 0;
  var skipped = 0;
  var errors = [];
  var mode = MODE();

  var adRows = snapshot.adRows || [];
  var adsetRows = snapshot.adsetRows || [];
  var adsetConfigs = snapshot.adsetConfigs || [];
  var todayAdRows = snapshot.todayAdRows || [];

  // Build lookup maps
  var adsetConfigMap = {};
  adsetConfigs.forEach(function (as) { adsetConfigMap[as.id] = as; });

  var fatigue = fatigueData || {};
  var budgetHist = budgetHistory || {};

  // --- PAUSE RULES (ad level) ---

  adRows.forEach(function (ad) {
    evaluated++;

    // Rule P1: Low CTR killer
    if (ad.impressions > 500 && ad.ctr < 0.8) {
      proposals.push({
        action: ACTION_TYPES.PAUSE_AD,
        safety: canAutoExecute(mode) ? SAFETY_LEVELS.AUTO_SAFE : SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P1_LOW_CTR',
        reason: 'CTR ' + ad.ctr.toFixed(2) + '% with ' + ad.impressions + ' impressions',
        metrics: { impressions: ad.impressions, ctr: ad.ctr, spend: ad.spend },
        expectedEffect: 'Stop wasting spend on underperforming creative'
      });
    }

    // Rule P2: High spend, no conversions
    if (ad.spend > 20 && ad.purchases === 0 && ad.atc === 0) {
      proposals.push({
        action: ACTION_TYPES.PAUSE_AD,
        safety: canAutoExecute(mode) ? SAFETY_LEVELS.AUTO_SAFE : SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P2_NO_CONVERSIONS',
        reason: 'Spent €' + ad.spend.toFixed(2) + ' with 0 purchases and 0 ATC',
        metrics: { spend: ad.spend, purchases: ad.purchases, atc: ad.atc },
        expectedEffect: 'Stop wasteful spend'
      });
    }

    // Rule P3: Spend exceeds 3x target CPA without purchase
    if (ad.spend > TARGET_CPA() * 3 && ad.purchases === 0) {
      proposals.push({
        action: ACTION_TYPES.PAUSE_AD,
        safety: canAutoExecute(mode) ? SAFETY_LEVELS.AUTO_SAFE : SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P3_EXCEED_CPA_THRESHOLD',
        reason: 'Spent €' + ad.spend.toFixed(2) + ' (>' + (TARGET_CPA() * 3) + ' = 3x target CPA) with 0 purchases',
        metrics: { spend: ad.spend, targetCpa: TARGET_CPA(), purchases: 0 },
        expectedEffect: 'Prevent further CPA-exceeding spend'
      });
    }

    // Rule P4: High frequency (flag, don't auto-pause)
    if (ad.frequency > 3.5) {
      proposals.push({
        action: ACTION_TYPES.FLAG_FATIGUE,
        safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
        entityId: ad.ad_id,
        entityName: ad.ad_name,
        rule: 'P4_HIGH_FREQUENCY',
        reason: 'Frequency ' + ad.frequency.toFixed(1) + ' (>3.5)',
        metrics: { frequency: ad.frequency, impressions: ad.impressions, ctr: ad.ctr },
        expectedEffect: 'Review for creative refresh or pause'
      });
    }
  });

  // --- SCALE RULES (adset level) ---

  adsetRows.forEach(function (adset) {
    evaluated++;
    var config = adsetConfigMap[adset.adset_id];
    if (!config) { skipped++; return; }

    var dailyBudgetEur = config.daily_budget ? parseInt(config.daily_budget, 10) / 100 : 0;
    if (dailyBudgetEur <= 0) { skipped++; return; }

    // Rule S1: Strong ROAS — scale up 20%
    if (adset.roas > 2.0 && adset.spend > 15) {
      var newBudget = Math.min(dailyBudgetEur * 1.2, MAX_ADSET_BUDGET());
      var canScale = canScaleAdset(adset.adset_id, budgetHist);

      if (newBudget > dailyBudgetEur && canScale) {
        // Check account-level spend protection
        var totalDailySpend = estimateTotalDailySpend(adsetConfigs);
        var increase = newBudget - dailyBudgetEur;

        if (totalDailySpend + increase <= MAX_DAILY_SPEND()) {
          proposals.push({
            action: ACTION_TYPES.SCALE_ADSET,
            safety: AUTO_SCALE() ? SAFETY_LEVELS.AUTO_SAFE : SAFETY_LEVELS.APPROVAL_REQUIRED,
            entityId: adset.adset_id,
            entityName: adset.adset_name,
            rule: 'S1_STRONG_ROAS',
            reason: 'ROAS ' + adset.roas.toFixed(2) + 'x over ' + (snapshot.lookbackDays || 3) + 'd with €' + adset.spend.toFixed(2) + ' spend',
            metrics: { roas: adset.roas, spend: adset.spend, purchases: adset.purchases, currentBudget: dailyBudgetEur },
            expectedEffect: 'Increase daily budget from €' + dailyBudgetEur.toFixed(2) + ' to €' + newBudget.toFixed(2),
            payload: { newBudgetCents: Math.round(newBudget * 100) }
          });
        } else {
          proposals.push({
            action: ACTION_TYPES.FLAG_REVIEW,
            safety: SAFETY_LEVELS.MONITOR_ONLY,
            entityId: adset.adset_id,
            entityName: adset.adset_name,
            rule: 'S1_BLOCKED_BY_SPEND_CAP',
            reason: 'ROAS ' + adset.roas.toFixed(2) + 'x qualifies for scale but total spend would exceed €' + MAX_DAILY_SPEND(),
            metrics: { roas: adset.roas, totalDailySpend: totalDailySpend, maxDailySpend: MAX_DAILY_SPEND() },
            expectedEffect: 'Converted to suggestion — manual review needed'
          });
        }
      }
    }

    // Rule S2: Low cost per purchase — scale up 20%
    if (adset.cost_per_purchase > 0 && adset.cost_per_purchase < TARGET_CPA() * 0.7 && adset.spend > 15) {
      var newBudget2 = Math.min(dailyBudgetEur * 1.2, MAX_ADSET_BUDGET());
      var canScale2 = canScaleAdset(adset.adset_id, budgetHist);

      if (newBudget2 > dailyBudgetEur && canScale2) {
        proposals.push({
          action: ACTION_TYPES.SCALE_ADSET,
          safety: AUTO_SCALE() ? SAFETY_LEVELS.AUTO_SAFE : SAFETY_LEVELS.APPROVAL_REQUIRED,
          entityId: adset.adset_id,
          entityName: adset.adset_name,
          rule: 'S2_LOW_CPA',
          reason: 'Cost/purchase €' + adset.cost_per_purchase.toFixed(2) + ' < €' + (TARGET_CPA() * 0.7).toFixed(2) + ' (70% of target)',
          metrics: { costPerPurchase: adset.cost_per_purchase, targetCpa: TARGET_CPA(), currentBudget: dailyBudgetEur },
          expectedEffect: 'Increase daily budget from €' + dailyBudgetEur.toFixed(2) + ' to €' + newBudget2.toFixed(2),
          payload: { newBudgetCents: Math.round(newBudget2 * 100) }
        });
      }
    }
  });

  // --- SPEND-STARVED DETECTION (ad level) ---

  var adsByAdset = {};
  adRows.forEach(function (ad) {
    if (!adsByAdset[ad.adset_id]) adsByAdset[ad.adset_id] = [];
    adsByAdset[ad.adset_id].push(ad);
  });

  Object.keys(adsByAdset).forEach(function (adsetId) {
    var siblings = adsByAdset[adsetId];
    if (siblings.length < 2) return;
    var totalSpend = siblings.reduce(function (s, a) { return s + a.spend; }, 0);
    if (totalSpend < 5) return;

    siblings.forEach(function (ad) {
      evaluated++;
      var pct = (ad.spend / totalSpend) * 100;
      if (pct < 5 && ad.impressions < 100) {
        proposals.push({
          action: ACTION_TYPES.FLAG_SPEND_STARVED,
          safety: SAFETY_LEVELS.MONITOR_ONLY,
          entityId: ad.ad_id,
          entityName: ad.ad_name,
          rule: 'SS1_SPEND_STARVED',
          reason: 'Only ' + pct.toFixed(0) + '% of adset spend (' + ad.impressions + ' impressions)',
          metrics: { spend: ad.spend, spendPct: pct, impressions: ad.impressions, adsetTotalSpend: totalSpend },
          expectedEffect: 'Review recommendation — insufficient data for creative evaluation'
        });
      }
    });
  });

  // --- FATIGUE DETECTION from tracker ---

  if (fatigue && typeof fatigue === 'object') {
    Object.keys(fatigue).forEach(function (adId) {
      var fd = fatigue[adId];
      if (fd && fd.fatigued) {
        evaluated++;
        proposals.push({
          action: ACTION_TYPES.FLAG_FATIGUE,
          safety: SAFETY_LEVELS.APPROVAL_REQUIRED,
          entityId: adId,
          entityName: fd.adName || adId,
          rule: 'F1_CTR_DECLINE',
          reason: 'CTR dropped ' + (fd.ctrDeclinePct || 0).toFixed(0) + '% from peak',
          metrics: { peakCtr: fd.peakCtr, currentCtr: fd.currentCtr, ctrDeclinePct: fd.ctrDeclinePct },
          expectedEffect: 'Needs creative refresh or pause'
        });
      }
    });
  }

  return { proposals: proposals, evaluated: evaluated, skipped: skipped, errors: errors, mode: mode };
}

// --- Helpers ---

function canAutoExecute(mode) {
  return mode === 'AUTO_EXECUTE';
}

function canScaleAdset(adsetId, budgetHistory) {
  // Max 1 increase per 48h per adset
  var lastChange = budgetHistory[adsetId];
  if (!lastChange) return true;
  var hoursSince = (Date.now() - new Date(lastChange.timestamp).getTime()) / 3600000;
  return hoursSince >= 48;
}

function estimateTotalDailySpend(adsetConfigs) {
  var total = 0;
  adsetConfigs.forEach(function (as) {
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
  MODE: MODE
};
