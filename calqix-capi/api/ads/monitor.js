var { sendTelegram } = require('../../lib/telegram');
var { apiGet, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');

var PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase'];
var ATC_TYPES = ['offsite_conversion.fb_pixel_add_to_cart'];
var IC_TYPES = ['offsite_conversion.fb_pixel_initiate_checkout'];
var VC_TYPES = ['offsite_conversion.fb_pixel_view_content'];

function authCron(req) {
  var secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Check query parameter
  var querySecret = req.query && req.query.secret;
  if (querySecret === secret) return true;

  // Check Authorization header (Vercel Cron sends this)
  var authHeader = req.headers && req.headers['authorization'];
  if (authHeader === 'Bearer ' + secret) return true;

  return false;
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authCron(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?secret= or Authorization: Bearer header' });
  }

  var now = new Date();
  var triggers = [];

  // --- Fetch data ---

  // 1. Ad-level insights (last 3 days)
  var adInsightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'ad_name,ad_id,adset_name,adset_id,impressions,clicks,ctr,cpc,spend,frequency,actions,cost_per_action_type',
    date_preset: 'last_3d',
    level: 'ad',
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '0' }],
    limit: 200
  });
  var adInsights = adInsightsResult.ok && Array.isArray(adInsightsResult.data) ? adInsightsResult.data : [];

  // 2. Ad set metadata (active only)
  var adsetsResult = await apiGet(AD_ACCOUNT_ID + '/adsets', {
    fields: 'name,status,effective_status,optimization_goal,daily_budget',
    filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'] }],
    limit: 50
  });
  var adsets = adsetsResult.ok && Array.isArray(adsetsResult.data) ? adsetsResult.data : [];

  // 3. Ad set insights (last 3 days)
  var adsetInsightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend,actions,action_values',
    date_preset: 'last_3d',
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  });
  var adsetInsights = adsetInsightsResult.ok && Array.isArray(adsetInsightsResult.data) ? adsetInsightsResult.data : [];

  // 4. Ad set insights (last 7 days for event counts)
  var adsetInsights7dResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend,actions,action_values',
    date_preset: 'last_7d',
    level: 'adset',
    filtering: [{ field: 'spend', operator: 'GREATER_THAN', value: '0' }],
    limit: 100
  });
  var adsetInsights7d = adsetInsights7dResult.ok && Array.isArray(adsetInsights7dResult.data) ? adsetInsights7dResult.data : [];

  // 5. Today's spend per ad set (for spike detection)
  var todayInsightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'adset_name,adset_id,spend',
    date_preset: 'today',
    level: 'adset',
    limit: 100
  });
  var todayInsights = todayInsightsResult.ok && Array.isArray(todayInsightsResult.data) ? todayInsightsResult.data : [];

  // --- Evaluate triggers ---

  // TRIGGER 1: AD KILLER
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;
    if (impressions >= 1000 && ctr < 0.8) {
      triggers.push({
        severity: 'URGENT',
        rule: 'AD_KILLER',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft " + impressions + " impressies maar CTR van " + ctr.toFixed(2) + "%. Pauzeer deze ad."
      });
    }
  });

  // TRIGGER 2: CREATIVE FATIGUE
  adInsights.forEach(function (ad) {
    var frequency = parseFloat(ad.frequency) || 0;
    if (frequency > 3.0) {
      triggers.push({
        severity: 'URGENT',
        rule: 'CREATIVE_FATIGUE',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Ad '" + ad.ad_name + "' heeft frequency " + frequency.toFixed(1) + ". Maak nieuwe creative aan in Predis.ai."
      });
    }
  });

  // TRIGGER 3: BUDGET NIET BESTEED
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var expectedSpend3d = dailyBudgetEur * 3;
    var insightRow = adsetInsights.find(function (i) { return i.adset_id === adset.id; });
    var actualSpend3d = insightRow ? parseFloat(insightRow.spend) || 0 : 0;
    var pct = expectedSpend3d > 0 ? (actualSpend3d / expectedSpend3d * 100) : 0;

    if (pct < 50 && actualSpend3d > 0) {
      triggers.push({
        severity: 'WARNING',
        rule: 'BUDGET_UNDERUTILIZED',
        target: adset.name,
        target_id: adset.id,
        message: "Ad set '" + adset.name + "' besteedt slechts " + pct.toFixed(0) + "% van budget. Check audience grootte of bid."
      });
    }
  });

  // TRIGGER 4: LEARNING LIMITED
  adsets.forEach(function (adset) {
    if (adset.effective_status === 'LEARNING_LIMITED') {
      triggers.push({
        severity: 'WARNING',
        rule: 'LEARNING_LIMITED',
        target: adset.name,
        target_id: adset.id,
        message: "Ad set '" + adset.name + "' zit vast in Learning Limited. Overweeg hoger-funnel optimalisatie event."
      });
    }
  });

  // TRIGGER 5: WINNER GEVONDEN
  adInsights.forEach(function (ad) {
    var impressions = parseInt(ad.impressions) || 0;
    var ctr = parseFloat(ad.ctr) || 0;
    var costPerAtc = null;
    if (ad.cost_per_action_type) {
      for (var c = 0; c < ad.cost_per_action_type.length; c++) {
        if (ATC_TYPES.indexOf(ad.cost_per_action_type[c].action_type) !== -1) {
          costPerAtc = parseFloat(ad.cost_per_action_type[c].value) || null;
          break;
        }
      }
    }
    if (impressions >= 500 && ctr > 3 && costPerAtc !== null && costPerAtc < 10) {
      triggers.push({
        severity: 'INFO',
        rule: 'WINNER',
        target: ad.ad_name,
        target_id: ad.ad_id,
        message: "Winner: '" + ad.ad_name + "' presteert goed (CTR " + ctr.toFixed(1) + "%, ATC " + costPerAtc.toFixed(2) + " euro). Overweeg budget verhoging."
      });
    }
  });

  // TRIGGER 6: SPENDING SPIKE
  adsets.forEach(function (adset) {
    if (!adset.daily_budget) return;
    var dailyBudgetEur = parseInt(adset.daily_budget, 10) / 100;
    var todayRow = todayInsights.find(function (i) { return i.adset_id === adset.id; });
    var todaySpend = todayRow ? parseFloat(todayRow.spend) || 0 : 0;

    if (todaySpend > dailyBudgetEur * 1.5 && todaySpend > 0) {
      triggers.push({
        severity: 'URGENT',
        rule: 'SPENDING_SPIKE',
        target: adset.name,
        target_id: adset.id,
        message: "Spend alert: " + todaySpend.toFixed(2) + " euro uitgegeven vandaag bij budget van " + dailyBudgetEur.toFixed(2) + " euro."
      });
    }
  });

  // --- Website / Funnel Optimization Triggers ---

  // Aggregate funnel data from 7-day insights
  var totalVC = 0, totalATC = 0, totalIC = 0, totalPurchases = 0, totalSpend7d = 0;
  adsetInsights7d.forEach(function (row) {
    var actions = row.actions || [];
    totalVC += parseActionValue(actions, VC_TYPES);
    totalATC += parseActionValue(actions, ATC_TYPES);
    totalIC += parseActionValue(actions, IC_TYPES);
    totalPurchases += parseActionValue(actions, PURCHASE_TYPES);
    totalSpend7d += parseFloat(row.spend) || 0;
  });

  // TRIGGER 7: CHECKOUT DROP-OFF (IC → Purchase < 25%)
  if (totalIC >= 5 && totalPurchases > 0) {
    var icToPurchaseRate = (totalPurchases / totalIC * 100);
    if (icToPurchaseRate < 25) {
      triggers.push({
        severity: 'WARNING',
        rule: 'CHECKOUT_DROPOFF',
        target: 'Website funnel',
        target_id: null,
        message: 'Checkout drop-off: slechts ' + icToPurchaseRate.toFixed(0) + '% van InitiateCheckout converteert naar Purchase (' + totalPurchases + '/' + totalIC + '). Check: verzendkosten, betaalmethoden, checkout flow.'
      });
    }
  }

  // TRIGGER 8: LOW ATC-TO-IC RATIO (ATC → IC < 30%)
  if (totalATC >= 5) {
    var atcToIcRate = totalIC > 0 ? (totalIC / totalATC * 100) : 0;
    if (atcToIcRate < 30) {
      triggers.push({
        severity: 'WARNING',
        rule: 'CART_ABANDONMENT',
        target: 'Website funnel',
        target_id: null,
        message: 'Cart abandonment hoog: slechts ' + atcToIcRate.toFixed(0) + '% van AddToCart start checkout (' + totalIC + '/' + totalATC + '). Check: winkelwagen UX, trust signals, urgentie-elementen.'
      });
    }
  }

  // TRIGGER 9: LOW VC-TO-ATC RATIO (VC → ATC < 5%)
  if (totalVC >= 20) {
    var vcToAtcRate = totalATC > 0 ? (totalATC / totalVC * 100) : 0;
    if (vcToAtcRate < 5) {
      triggers.push({
        severity: 'WARNING',
        rule: 'LOW_PRODUCT_CONVERSION',
        target: 'Website funnel',
        target_id: null,
        message: 'Productpagina converteert slecht: slechts ' + vcToAtcRate.toFixed(1) + '% van ViewContent naar ATC (' + totalATC + '/' + totalVC + '). Check: productpagina copy, prijs, reviews, CTA button.'
      });
    }
  }

  // TRIGGER 10: HIGH CPC (> €2.00 gemiddeld)
  var totalClicks = 0;
  adInsights.forEach(function (ad) { totalClicks += parseInt(ad.clicks) || 0; });
  if (totalClicks > 0 && totalSpend7d > 0) {
    var avgCpc = totalSpend7d / totalClicks;
    if (avgCpc > 2.0) {
      triggers.push({
        severity: 'INFO',
        rule: 'HIGH_CPC',
        target: 'Ads overall',
        target_id: null,
        message: 'Gemiddelde CPC is ' + avgCpc.toFixed(2) + ' euro. Overweeg: nieuwe creatives, bredere targeting, of lagere-funnel landingspagina.'
      });
    }
  }

  // --- Notification decision ---

  var urgentTriggers = triggers.filter(function (t) { return t.severity === 'URGENT'; });
  var warningTriggers = triggers.filter(function (t) { return t.severity === 'WARNING'; });
  var infoTriggers = triggers.filter(function (t) { return t.severity === 'INFO'; });

  var isMonday = now.getDay() === 1;
  var shouldNotify = false;
  var telegramResult = null;

  if (urgentTriggers.length > 0) {
    shouldNotify = true;
  } else if (warningTriggers.length > 0) {
    shouldNotify = true;
  } else if (infoTriggers.length > 0 && isMonday) {
    shouldNotify = true;
  }

  if (shouldNotify) {
    var msg = formatMessage(now, urgentTriggers, warningTriggers, infoTriggers, adsetInsights7d, adsets);
    telegramResult = await sendTelegram(msg);
  } else {
    console.log('[Monitor] Geen acties nodig, geen notificatie verstuurd.');
  }

  return res.status(200).json({
    timestamp: now.toISOString(),
    triggers_fired: triggers.length,
    urgent: urgentTriggers.length,
    warning: warningTriggers.length,
    info: infoTriggers.length,
    notification_sent: shouldNotify,
    telegram_response: telegramResult,
    triggers: triggers
  });
}

function formatMessage(now, urgent, warning, info, weeklyInsights, adsets) {
  var dateStr = now.toISOString().split('T')[0];
  var lines = ['<b>CALQIX Ads Monitor - ' + dateStr + '</b>\n'];

  // Split warnings into ad warnings and website warnings
  var adWarnings = [];
  var websiteWarnings = [];
  warning.forEach(function (t) {
    if (['CHECKOUT_DROPOFF', 'CART_ABANDONMENT', 'LOW_PRODUCT_CONVERSION'].indexOf(t.rule) !== -1) {
      websiteWarnings.push(t);
    } else {
      adWarnings.push(t);
    }
  });

  if (urgent.length > 0) {
    lines.push('🔴 <b>ACTIE NODIG:</b>');
    urgent.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (adWarnings.length > 0) {
    lines.push('⚠️ <b>ADS - LET OP:</b>');
    adWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  if (websiteWarnings.length > 0) {
    lines.push('🌐 <b>WEBSITE OPTIMALISATIE:</b>');
    websiteWarnings.forEach(function (t) { lines.push('- ' + t.message); });
    lines.push('');
  }

  // Weekly report on Monday or if only info triggers
  if (urgent.length === 0 && warning.length === 0 && info.length > 0) {
    var totalSpend = 0;
    var totalAtc = 0;
    var totalPurchases = 0;
    var bestAd = null;
    var bestCtr = 0;

    weeklyInsights.forEach(function (row) {
      totalSpend += parseFloat(row.spend) || 0;
      totalAtc += parseActionValue(row.actions || [], ATC_TYPES);
      totalPurchases += parseActionValue(row.actions || [], PURCHASE_TYPES);
    });

    info.forEach(function (t) {
      // Extract CTR from message for "best ad"
      var match = t.message.match(/CTR (\d+\.?\d*)%/);
      if (match) {
        var ctr = parseFloat(match[1]);
        if (ctr > bestCtr) {
          bestCtr = ctr;
          bestAd = t.target;
        }
      }
    });

    lines.push('✅ <b>WEEK RAPPORT:</b>');
    lines.push('- Spend: ' + totalSpend.toFixed(2) + ' euro');
    lines.push('- ATC events: ' + totalAtc + ' (doel: 50/week)');
    lines.push('- Purchases: ' + totalPurchases);
    if (bestAd) lines.push('- Beste ad: ' + bestAd + ' (CTR ' + bestCtr.toFixed(1) + '%)');
    lines.push('- Geen urgente acties nodig');
    lines.push('');

    if (info.length > 0) {
      lines.push('🏆 <b>WINNERS:</b>');
      info.forEach(function (t) { lines.push('- ' + t.message); });
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = handler;
