#!/usr/bin/env node
/**
 * One-off ad optimization script.
 *
 * Actions (operator-approved):
 *   1. Fetch current campaigns, adsets, ads, and performance
 *   2. Set adset daily budget to €40
 *   3. Change adset optimization from ADD_TO_CART to INITIATE_CHECKOUT
 *   4. Review all optimization opportunities
 *   5. Send Telegram summary
 *
 * Usage: node scripts/optimize-now.js
 */
require('dotenv').config();

var metaApi = require('../lib/meta-api-client');
var { sendTelegram } = require('../lib/telegram');

var TARGET_BUDGET_CENTS = 4000; // €40.00

async function main() {
  console.log('\n=== CALQIX Ad Optimization — Manual Run ===\n');

  var results = { actions: [], errors: [], warnings: [] };

  // -------------------------------------------------------
  // 1. Fetch current state
  // -------------------------------------------------------
  console.log('[1/5] Fetching current campaigns...');
  var campaigns = await metaApi.fetchCampaigns();
  if (!campaigns.ok) {
    console.error('Failed to fetch campaigns:', campaigns.error);
    results.errors.push('Campaigns fetch: ' + campaigns.error);
  } else {
    console.log('  Found', campaigns.data.length, 'campaigns');
    campaigns.data.forEach(function (c) {
      console.log('  •', c.name, '| Status:', c.effective_status, '| Objective:', c.objective, '| ID:', c.id);
    });
  }

  console.log('\n[2/5] Fetching current adsets...');
  var adsets = await metaApi.fetchAdsets();
  if (!adsets.ok) {
    console.error('Failed to fetch adsets:', adsets.error);
    results.errors.push('Adsets fetch: ' + adsets.error);
  } else {
    console.log('  Found', adsets.data.length, 'adsets');
    adsets.data.forEach(function (as) {
      var budgetEur = as.daily_budget ? (parseInt(as.daily_budget, 10) / 100).toFixed(2) : 'N/A';
      console.log('  •', as.name, '| Status:', as.effective_status, '| Opt:', as.optimization_goal,
        '| Budget: €' + budgetEur, '| ID:', as.id);
    });
  }

  console.log('\n[3/5] Fetching current ads...');
  var ads = await metaApi.fetchAds();
  if (!ads.ok) {
    console.error('Failed to fetch ads:', ads.error);
    results.errors.push('Ads fetch: ' + ads.error);
  } else {
    console.log('  Found', ads.data.length, 'ads');
    ads.data.forEach(function (ad) {
      console.log('  •', ad.name, '| Status:', ad.effective_status, '| ID:', ad.id);
    });
  }

  // Fetch 7-day performance
  console.log('\n[4/5] Fetching 7-day performance...');
  var now = new Date();
  var sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  var since = sevenDaysAgo.toISOString().split('T')[0];
  var until = now.toISOString().split('T')[0];

  var adPerf = await metaApi.fetchInsights('ad', since, until);
  var adsetPerf = await metaApi.fetchInsights('adset', since, until);

  if (adPerf.ok) {
    console.log('  Ad-level rows:', adPerf.rows.length);
    adPerf.rows.sort(function (a, b) { return b.spend - a.spend; });
    adPerf.rows.slice(0, 10).forEach(function (r) {
      console.log('  •', r.ad_name.substring(0, 35).padEnd(36),
        'Spend: €' + r.spend.toFixed(2).padStart(6),
        'CTR:', r.ctr.toFixed(2) + '%',
        'ROAS:', r.roas.toFixed(2) + 'x',
        'ATC:', r.atc, 'IC:', r.ic, 'Purch:', r.purchases);
    });
  }

  if (adsetPerf.ok) {
    console.log('\n  Adset-level rows:', adsetPerf.rows.length);
    adsetPerf.rows.forEach(function (r) {
      console.log('  •', r.adset_name.substring(0, 35).padEnd(36),
        'Spend: €' + r.spend.toFixed(2).padStart(6),
        'CTR:', r.ctr.toFixed(2) + '%',
        'ROAS:', r.roas.toFixed(2) + 'x',
        'ATC:', r.atc, 'IC:', r.ic, 'Purch:', r.purchases);
    });
  }

  // -------------------------------------------------------
  // 5. Execute changes
  // -------------------------------------------------------
  console.log('\n[5/5] Executing approved changes...\n');

  if (!campaigns.ok || !adsets.ok) {
    console.error('Cannot proceed — fetch failures. Aborting changes.');
    await sendTelegramReport(results, campaigns, adsets, ads, adPerf, adsetPerf);
    return;
  }

  // Find active adsets to change
  var activeAdsets = (adsets.data || []).filter(function (as) {
    return as.effective_status === 'ACTIVE' || as.effective_status === 'LEARNING' || as.effective_status === 'LEARNING_LIMITED';
  });

  if (activeAdsets.length === 0) {
    console.log('  No active adsets found.');
    results.warnings.push('No active adsets found');
  }

  for (var i = 0; i < activeAdsets.length; i++) {
    var as = activeAdsets[i];
    var currentBudget = as.daily_budget ? parseInt(as.daily_budget, 10) : 0;
    var currentBudgetEur = currentBudget / 100;

    // --- Budget change to €40 ---
    if (currentBudget !== TARGET_BUDGET_CENTS) {
      console.log('  [BUDGET] Changing', as.name, 'from €' + currentBudgetEur.toFixed(2), 'to €40.00...');
      var budgetResult = await metaApi.graphRequest('POST', as.id, null, {
        daily_budget: TARGET_BUDGET_CENTS
      });
      if (budgetResult.ok) {
        console.log('    ✅ Budget updated to €40.00');
        results.actions.push('Budget ' + as.name + ': €' + currentBudgetEur.toFixed(2) + ' → €40.00');
      } else {
        console.error('    ❌ Budget update failed:', budgetResult.error);
        results.errors.push('Budget ' + as.name + ': ' + budgetResult.error);
      }
    } else {
      console.log('  [BUDGET]', as.name, 'already at €40.00');
      results.warnings.push(as.name + ' already at €40.00');
    }

    // --- Optimization goal change: ATC → InitiateCheckout ---
    // First fetch the full adset details including promoted_object
    var adsetDetail = await metaApi.graphRequest('GET', as.id, {
      fields: 'name,optimization_goal,promoted_object,billing_event'
    });

    if (adsetDetail.ok) {
      var currentOpt = adsetDetail.data.optimization_goal || 'unknown';
      var currentPromoted = adsetDetail.data.promoted_object || {};
      var currentEvent = currentPromoted.custom_event_type || 'unknown';

      console.log('  [OPT] Current:', currentOpt, '/ event:', currentEvent);

      if (currentEvent === 'ADD_TO_CART' || currentEvent === 'OTHER') {
        console.log('  [OPT] Changing', as.name, 'from', currentEvent, 'to INITIATED_CHECKOUT...');

        var newPromoted = Object.assign({}, currentPromoted);
        newPromoted.custom_event_type = 'INITIATED_CHECKOUT';

        var optResult = await metaApi.graphRequest('POST', as.id, null, {
          promoted_object: newPromoted
        });

        if (optResult.ok) {
          console.log('    ✅ Optimization changed to INITIATED_CHECKOUT');
          results.actions.push('Optimization ' + as.name + ': ' + currentEvent + ' → INITIATED_CHECKOUT');
        } else {
          console.error('    ❌ Optimization change failed:', optResult.error);
          results.errors.push('Optimization ' + as.name + ': ' + optResult.error);

          // If promoted_object update fails, try optimization_goal directly
          console.log('  [OPT] Trying alternative: update optimization_goal...');
          var altResult = await metaApi.graphRequest('POST', as.id, null, {
            optimization_goal: 'OFFSITE_CONVERSIONS',
            promoted_object: newPromoted
          });
          if (altResult.ok) {
            console.log('    ✅ Optimization changed via alternative method');
            results.actions.push('Optimization (alt) ' + as.name + ': → INITIATED_CHECKOUT');
            // Remove the error since alt worked
            results.errors.pop();
          } else {
            console.error('    ❌ Alternative also failed:', altResult.error);
            results.errors.push('Optimization alt ' + as.name + ': ' + altResult.error);
          }
        }
      } else if (currentEvent === 'INITIATED_CHECKOUT') {
        console.log('  [OPT]', as.name, 'already optimizing for INITIATED_CHECKOUT');
        results.warnings.push(as.name + ' already on INITIATED_CHECKOUT');
      } else {
        console.log('  [OPT]', as.name, 'optimizing for', currentEvent, '— leaving as is');
        results.warnings.push(as.name + ' on ' + currentEvent + ' — not changed');
      }
    } else {
      results.errors.push('Adset detail fetch ' + as.name + ': ' + adsetDetail.error);
    }

    console.log('');
  }

  // -------------------------------------------------------
  // Optimization review
  // -------------------------------------------------------
  console.log('--- Optimization Review ---');
  if (adPerf.ok) {
    // Flag low performers
    adPerf.rows.forEach(function (r) {
      if (r.spend > 10 && r.ctr < 0.8 && r.impressions > 500) {
        results.warnings.push('Low CTR: ' + r.ad_name + ' (CTR ' + r.ctr.toFixed(2) + '%, spend €' + r.spend.toFixed(2) + ')');
        console.log('  ⚠️  Low CTR:', r.ad_name, '— CTR', r.ctr.toFixed(2) + '%', 'spend €' + r.spend.toFixed(2));
      }
      if (r.spend > 20 && r.purchases === 0 && r.atc === 0) {
        results.warnings.push('No conversions: ' + r.ad_name + ' (spend €' + r.spend.toFixed(2) + ')');
        console.log('  ⚠️  No conversions:', r.ad_name, '— spend €' + r.spend.toFixed(2));
      }
      if (r.frequency > 3.0) {
        results.warnings.push('High frequency: ' + r.ad_name + ' (' + r.frequency.toFixed(1) + ')');
        console.log('  ⚠️  High frequency:', r.ad_name, '—', r.frequency.toFixed(1));
      }
    });

    // Top performers
    var topByRoas = adPerf.rows.filter(function (r) { return r.spend > 5; })
      .sort(function (a, b) { return b.roas - a.roas; }).slice(0, 3);
    if (topByRoas.length > 0) {
      console.log('\n  🏆 Top performers by ROAS:');
      topByRoas.forEach(function (r) {
        console.log('    •', r.ad_name, '— ROAS', r.roas.toFixed(2) + 'x', 'spend €' + r.spend.toFixed(2));
      });
    }
  }

  // -------------------------------------------------------
  // Send Telegram report
  // -------------------------------------------------------
  await sendTelegramReport(results, campaigns, adsets, ads, adPerf, adsetPerf);

  console.log('\n=== Done ===');
}

async function sendTelegramReport(results, campaigns, adsets, ads, adPerf, adsetPerf) {
  var lines = ['🔧 <b>CALQIX Manual Ad Optimization — Complete</b>\n'];

  // Actions taken
  if (results.actions.length > 0) {
    lines.push('✅ <b>Actions executed:</b>');
    results.actions.forEach(function (a) { lines.push('• ' + a); });
    lines.push('');
  }

  // Errors
  if (results.errors.length > 0) {
    lines.push('❌ <b>Errors:</b>');
    results.errors.forEach(function (e) { lines.push('• ' + e); });
    lines.push('');
  }

  // Warnings / review items
  if (results.warnings.length > 0) {
    lines.push('⚠️ <b>Review items:</b>');
    results.warnings.forEach(function (w) { lines.push('• ' + w); });
    lines.push('');
  }

  // Performance summary
  if (adPerf && adPerf.ok && adPerf.rows.length > 0) {
    var totalSpend = adPerf.rows.reduce(function (s, r) { return s + r.spend; }, 0);
    var totalRevenue = adPerf.rows.reduce(function (s, r) { return s + r.revenue; }, 0);
    var totalPurchases = adPerf.rows.reduce(function (s, r) { return s + r.purchases; }, 0);
    var totalAtc = adPerf.rows.reduce(function (s, r) { return s + r.atc; }, 0);
    var totalIc = adPerf.rows.reduce(function (s, r) { return s + r.ic; }, 0);
    var roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    lines.push('📊 <b>7-day performance:</b>');
    lines.push('• Spend: €' + totalSpend.toFixed(2));
    lines.push('• Revenue: €' + totalRevenue.toFixed(2));
    lines.push('• ROAS: ' + roas.toFixed(2) + 'x');
    lines.push('• Purchases: ' + totalPurchases);
    lines.push('• ATC: ' + totalAtc + ' | IC: ' + totalIc);
    lines.push('• Active ads: ' + adPerf.rows.length);
    lines.push('');

    // Top 3 ads
    var topAds = adPerf.rows.filter(function (r) { return r.spend > 3; })
      .sort(function (a, b) { return b.roas - a.roas; }).slice(0, 3);
    if (topAds.length > 0) {
      lines.push('🏆 <b>Top 3 ads (ROAS):</b>');
      topAds.forEach(function (r) {
        lines.push('• ' + r.ad_name.substring(0, 30) + ' | €' + r.spend.toFixed(2) + ' | ROAS ' + r.roas.toFixed(2) + 'x | CTR ' + r.ctr.toFixed(1) + '%');
      });
      lines.push('');
    }
  }

  // Schedule info
  lines.push('📅 <b>Schedules active:</b>');
  lines.push('• Content: insights→plan→generate→review→publish (05:45-18:30)');
  lines.push('• Monitor: 07:00, 12:00, 19:00 Amsterdam');
  lines.push('• Recovery: every minute');
  lines.push('');
  lines.push('⚙️ Mode: CONTENT=' + (process.env.CONTENT_AUTOMATION_MODE || 'DRAFT_ONLY') +
    ' | ADS=' + (process.env.ADS_OPTIMIZATION_MODE || 'MONITOR_ONLY'));

  var msg = lines.join('\n');
  console.log('\n--- Telegram Message ---');
  console.log(msg);
  console.log('--- End ---\n');

  var result = await sendTelegram(msg);
  if (result.sent) {
    console.log('✅ Telegram sent successfully (msg_id:', result.message_id + ')');
  } else {
    console.error('❌ Telegram failed:', result.reason);
  }
}

main().catch(function (err) {
  console.error('Script failed:', err);
  process.exit(1);
});
