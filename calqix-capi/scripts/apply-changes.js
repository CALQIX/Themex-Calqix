#!/usr/bin/env node
require('dotenv').config();
var m = require('../lib/meta-api-client');
var telegram = require('../lib/telegram');

async function main() {
  var results = [];

  // 1. Campaign budget €30 → €40
  console.log('=== 1. Campaign budget €30 → €40 ===');
  var r1 = await m.graphRequest('POST', '120246975555310715', null, {
    daily_budget: 4000
  });
  console.log(JSON.stringify(r1, null, 2));
  results.push(r1.ok ? '✅ Campaign budget: €30 → €40' : '❌ Campaign budget failed: ' + r1.error);

  // 2. Adset optimization ATC → INITIATED_CHECKOUT
  console.log('\n=== 2. Adset optimization ATC → INITIATED_CHECKOUT ===');
  var r2 = await m.graphRequest('POST', '120246975555810715', null, {
    promoted_object: {
      pixel_id: '934134615770602',
      custom_event_type: 'INITIATED_CHECKOUT'
    }
  });
  console.log(JSON.stringify(r2, null, 2));
  results.push(r2.ok ? '✅ Adset optimization: ADD_TO_CART → INITIATED_CHECKOUT' : '❌ Adset optimization failed: ' + r2.error);

  // 3. Verify changes
  console.log('\n=== 3. Verifying changes ===');
  var campaign = await m.graphRequest('GET', '120246975555310715', {
    fields: 'name,daily_budget,status'
  });
  console.log('Campaign:', JSON.stringify(campaign.data, null, 2));

  var adset = await m.graphRequest('GET', '120246975555810715', {
    fields: 'name,optimization_goal,promoted_object,status'
  });
  console.log('Adset:', JSON.stringify(adset.data, null, 2));

  if (campaign.ok) {
    results.push('📋 Campaign budget now: €' + (parseInt(campaign.data.daily_budget) / 100).toFixed(2));
  }
  if (adset.ok && adset.data.promoted_object) {
    results.push('📋 Adset event type now: ' + adset.data.promoted_object.custom_event_type);
  }

  // 4. Send Telegram
  var msg = '🔧 <b>CALQIX Ad Changes Applied</b>\n\n' + results.join('\n');
  msg += '\n\n📊 <b>7-day snapshot:</b>\n';
  msg += '• Spend: €321.94 | Revenue: €111.61 | ROAS: 0.35x\n';
  msg += '• Purchases: 4 | ATC: 40 | IC: 29\n';
  msg += '\n🏆 <b>Top ads:</b>\n';
  msg += '• DE_Angle_3_Routine | ROAS 2.60x | CTR 4.4%\n';
  msg += '• DE_Angle_1_Mikrobiom | ROAS 1.11x | CTR 3.1%\n';
  msg += '• NL_Angle_4_Autoriteit | ROAS 0.99x | CTR 5.1%\n';
  msg += '\n⚠️ <b>Flagged (no conversions, €20+ spend):</b>\n';
  msg += '• Angle_1_Bad_breath_2 — €28.96\n';
  msg += '• FR_Angle_2_Haleine — €23.41\n';
  msg += '• DE_Angle_4_Wissenschaft — €23.24';

  var tg = await telegram.sendTelegram(msg);
  console.log('\nTelegram:', tg.sent ? 'sent (id: ' + tg.message_id + ')' : 'failed: ' + tg.reason);
}

main().catch(function (e) { console.error('Error:', e); process.exit(1); });
