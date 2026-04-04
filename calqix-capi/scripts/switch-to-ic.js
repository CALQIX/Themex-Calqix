#!/usr/bin/env node
/**
 * Switch adset optimization from ADD_TO_CART to INITIATED_CHECKOUT.
 * Meta doesn't allow changing promoted_object on active adsets,
 * so we: create new adset → copy ads → pause old adset.
 */
require('dotenv').config();
var m = require('../lib/meta-api-client');
var telegram = require('../lib/telegram');

var OLD_ADSET_ID = '120246975555810715';
var CAMPAIGN_ID = '120246975555310715';
var PIXEL_ID = '934134615770602';

var ADS = [
  { name: 'DE_Angle_3_Routine', creativeId: '796052673569126' },
  { name: 'NL_Angle_1_Microbioom', creativeId: '940326145496174' },
  { name: 'NL_Angle_3_Routine', creativeId: '1006853958962216' },
  { name: 'DE_Angle_1_Mikrobiom', creativeId: '1446342570212916' },
  { name: 'NL_Angle_2_Slechte_Adem', creativeId: '2024248394799694' }
];

async function main() {
  var log = [];
  console.log('=== Switch ATC → INITIATED_CHECKOUT ===\n');

  // 1. Create new adset with INITIATED_CHECKOUT
  console.log('[1] Creating new adset with INITIATED_CHECKOUT...');
  var createResult = await m.graphRequest('POST', 'act_2108393566376667/adsets', null, {
    name: 'IC | NL+BE+DE+AT | 25+ | OPEN',
    campaign_id: CAMPAIGN_ID,
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: {
      age_max: 65,
      age_min: 25,
      geo_locations: {
        countries: ['NL', 'BE', 'AT', 'DE'],
        location_types: ['home', 'recent']
      }
    },
    promoted_object: {
      pixel_id: PIXEL_ID,
      custom_event_type: 'INITIATED_CHECKOUT'
    },
    attribution_spec: [
      { event_type: 'CLICK_THROUGH', window_days: 7 }
    ],
    status: 'ACTIVE'
  });

  console.log('Create result:', JSON.stringify(createResult, null, 2));

  if (!createResult.ok) {
    console.error('Failed to create new adset:', createResult.error);
    log.push('❌ Create new IC adset: ' + createResult.error);
    await sendReport(log);
    return;
  }

  var newAdsetId = createResult.data.id;
  console.log('✅ New adset created:', newAdsetId);
  log.push('✅ New adset created: IC | NL+BE+DE+AT | 25+ | OPEN (ID: ' + newAdsetId + ')');

  // 2. Copy ads to new adset
  console.log('\n[2] Copying', ADS.length, 'ads to new adset...');
  var adsCopied = 0;
  for (var i = 0; i < ADS.length; i++) {
    var ad = ADS[i];
    console.log('  Copying:', ad.name, '(creative:', ad.creativeId + ')');

    var adResult = await m.graphRequest('POST', 'act_2108393566376667/ads', null, {
      name: ad.name,
      adset_id: newAdsetId,
      creative: { creative_id: ad.creativeId },
      status: 'ACTIVE'
    });

    if (adResult.ok) {
      console.log('    ✅ Created ad:', adResult.data.id);
      adsCopied++;
    } else {
      console.error('    ❌ Failed:', adResult.error);
      log.push('❌ Copy ad ' + ad.name + ': ' + adResult.error);
    }
  }
  log.push('✅ Copied ' + adsCopied + '/' + ADS.length + ' ads to new IC adset');

  // 3. Pause old adset
  console.log('\n[3] Pausing old ATC adset...');
  var pauseResult = await m.graphRequest('POST', OLD_ADSET_ID, null, {
    status: 'PAUSED'
  });

  if (pauseResult.ok) {
    console.log('✅ Old ATC adset paused');
    log.push('✅ Old ATC adset paused (ID: ' + OLD_ADSET_ID + ')');
  } else {
    console.error('❌ Failed to pause:', pauseResult.error);
    log.push('❌ Pause old ATC adset: ' + pauseResult.error);
  }

  // 4. Verify
  console.log('\n[4] Verifying...');
  var verify = await m.graphRequest('GET', newAdsetId, {
    fields: 'name,status,effective_status,optimization_goal,promoted_object'
  });
  if (verify.ok) {
    console.log('New adset:', JSON.stringify(verify.data, null, 2));
    log.push('📋 New adset event: ' + (verify.data.promoted_object || {}).custom_event_type);
    log.push('📋 New adset status: ' + verify.data.effective_status);
  }

  var verifyOld = await m.graphRequest('GET', OLD_ADSET_ID, {
    fields: 'name,status,effective_status'
  });
  if (verifyOld.ok) {
    console.log('Old adset:', JSON.stringify(verifyOld.data, null, 2));
    log.push('📋 Old adset status: ' + verifyOld.data.effective_status);
  }

  await sendReport(log);
  console.log('\n=== Done ===');
}

async function sendReport(log) {
  var msg = '🔄 <b>CALQIX Adset Switch: ATC → IC</b>\n\n' + log.join('\n');
  msg += '\n\n💰 Campaign budget: €40/dag (updated earlier)';
  console.log('\n--- Telegram ---\n' + msg + '\n---');
  var tg = await telegram.sendTelegram(msg);
  console.log('Telegram:', tg.sent ? 'sent (id: ' + tg.message_id + ')' : 'failed: ' + tg.reason);
}

main().catch(function (e) { console.error('Error:', e); process.exit(1); });
