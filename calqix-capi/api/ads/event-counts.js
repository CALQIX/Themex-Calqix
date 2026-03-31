const { apiGet, authDiagnostics, AD_ACCOUNT_ID, parseActionValue } = require('../../lib/meta-ads');

var OPTIMIZATION_EVENT_TYPES = {
  OFFSITE_CONVERSIONS: ['offsite_conversion.fb_pixel_purchase', 'purchase'],
  ADD_TO_CART: ['offsite_conversion.fb_pixel_add_to_cart'],
  INITIATE_CHECKOUT: ['offsite_conversion.fb_pixel_initiate_checkout'],
  LANDING_PAGE_VIEW: ['landing_page_view'],
  LINK_CLICK: ['link_click']
};

var WEEKLY_THRESHOLD = 50;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized — provide ?key= or x-diagnostics-key header' });
  }

  // Fetch ad sets with their optimization goals
  var adsetsResult = await apiGet(AD_ACCOUNT_ID + '/adsets', {
    fields: 'name,status,effective_status,optimization_goal,daily_budget',
    filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'] }],
    limit: 50
  });

  if (!adsetsResult.ok) {
    return res.status(200).json({ status: 'ERROR', error: adsetsResult.error, retryAfter: adsetsResult.retryAfter });
  }

  var adsets = Array.isArray(adsetsResult.data) ? adsetsResult.data : [];
  var results = [];

  for (var i = 0; i < adsets.length; i++) {
    var adset = adsets[i];
    var goal = adset.optimization_goal || 'OFFSITE_CONVERSIONS';
    var eventTypes = OPTIMIZATION_EVENT_TYPES[goal] || OPTIMIZATION_EVENT_TYPES.OFFSITE_CONVERSIONS;

    // Fetch daily insights for last 14 days
    var insightsResult = await apiGet(adset.id + '/insights', {
      fields: 'actions,spend',
      date_preset: 'last_14d',
      time_increment: 1,
      limit: 30
    });

    var dailyData = insightsResult.ok && Array.isArray(insightsResult.data) ? insightsResult.data : [];

    // Split into week 1 (last 7 days) and week 2 (7-14 days ago)
    var week1Events = 0;
    var week2Events = 0;
    var week1Spend = 0;
    var week2Spend = 0;

    // dailyData is ordered oldest first
    for (var d = 0; d < dailyData.length; d++) {
      var dayActions = dailyData[d].actions || [];
      var daySpend = parseFloat(dailyData[d].spend) || 0;
      var eventCount = parseActionValue(dayActions, eventTypes);

      if (d < 7) {
        week2Events += eventCount;
        week2Spend += daySpend;
      } else {
        week1Events += eventCount;
        week1Spend += daySpend;
      }
    }

    // If we have less than 14 days of data, adjust
    if (dailyData.length <= 7) {
      week1Events = week2Events;
      week1Spend = week2Spend;
      week2Events = 0;
      week2Spend = 0;
    }

    var belowThreshold = week1Events < WEEKLY_THRESHOLD;
    var trend = week2Events > 0
      ? Number(((week1Events - week2Events) / week2Events * 100).toFixed(1))
      : null;

    var adsetResult = {
      name: adset.name,
      id: adset.id,
      status: adset.effective_status,
      optimization_goal: goal,
      optimization_event_types: eventTypes,
      daily_budget: adset.daily_budget ? (parseInt(adset.daily_budget, 10) / 100).toFixed(2) + ' EUR' : null,
      this_week: {
        events: week1Events,
        spend: Number(week1Spend.toFixed(2))
      },
      last_week: {
        events: week2Events,
        spend: Number(week2Spend.toFixed(2))
      },
      trend_pct: trend,
      below_threshold: belowThreshold,
      threshold: WEEKLY_THRESHOLD,
      recommendation: null
    };

    if (belowThreshold) {
      var costPerEvent = week1Events > 0 ? Number((week1Spend / week1Events).toFixed(2)) : null;
      var budgetNeeded = costPerEvent ? Number((costPerEvent * WEEKLY_THRESHOLD / 7).toFixed(2)) : null;

      adsetResult.recommendation = {
        severity: week1Events < 10 ? 'HIGH' : 'MEDIUM',
        message: 'Ad set ' + adset.name + ' genereert ' + week1Events + '/week ' + goal + ' events. Dat is onder de ' + WEEKLY_THRESHOLD + '/week drempel.',
        options: [
          budgetNeeded
            ? 'Verhoog budget naar circa ' + budgetNeeded + ' EUR/dag om 50 events/week te bereiken'
            : null,
          'Schakel optimalisatie-event over naar een hoger-funnel event (bijv. AddToCart)',
          'Combineer meerdere ad sets in een CBO campagne'
        ].filter(Boolean),
        cost_per_event: costPerEvent,
        estimated_budget_for_50: budgetNeeded
      };
    }

    results.push(adsetResult);
  }

  // Sort: below threshold first, then by events ascending
  results.sort(function (a, b) {
    if (a.below_threshold !== b.below_threshold) return a.below_threshold ? -1 : 1;
    return a.this_week.events - b.this_week.events;
  });

  var belowCount = results.filter(function (r) { return r.below_threshold; }).length;

  return res.status(200).json({
    status: 'OK',
    adset_count: results.length,
    below_threshold_count: belowCount,
    threshold: WEEKLY_THRESHOLD,
    note: 'Meta heeft 50 optimalisatie-events per week nodig per ad set om de learning phase te verlaten.',
    data: results
  });
}

module.exports = handler;
