var { apiGet, authDiagnostics, AD_ACCOUNT_ID } = require('../../lib/meta-ads');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!authDiagnostics(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var campaignId = req.query.campaign_id;

  // If campaign_id specified, get ads from that campaign's ad sets
  if (campaignId) {
    var adsetsResult = await apiGet(campaignId + '/adsets', { fields: 'name,id', limit: 50 });
    var adsets = adsetsResult.ok && Array.isArray(adsetsResult.data) ? adsetsResult.data : [];
    var allAds = [];

    for (var i = 0; i < adsets.length; i++) {
      var adsResult = await apiGet(adsets[i].id + '/ads', {
        fields: 'name,id,status,effective_status,creative{id,name,thumbnail_url,object_story_spec}',
        limit: 50
      });
      if (adsResult.ok && Array.isArray(adsResult.data)) {
        adsResult.data.forEach(function (ad) {
          allAds.push({
            ad_name: ad.name,
            ad_id: ad.id,
            status: ad.effective_status,
            adset: adsets[i].name,
            creative_id: ad.creative ? ad.creative.id : null
          });
        });
      }
    }
    return res.status(200).json({ campaign_id: campaignId, ads: allAds });
  }

  // Otherwise list all ads with insights (top performers by CTR)
  var insightsResult = await apiGet(AD_ACCOUNT_ID + '/insights', {
    fields: 'ad_name,ad_id,impressions,clicks,ctr,spend,actions,cost_per_action_type',
    date_preset: 'last_14d',
    level: 'ad',
    filtering: [{ field: 'impressions', operator: 'GREATER_THAN', value: '100' }],
    sort: ['ctr_descending'],
    limit: 30
  });

  var rows = insightsResult.ok && Array.isArray(insightsResult.data) ? insightsResult.data : [];

  // Get creative IDs for these ads
  var results = [];
  for (var j = 0; j < rows.length; j++) {
    var adResult = await apiGet(rows[j].ad_id, { fields: 'name,creative{id,name}' });
    results.push({
      ad_name: rows[j].ad_name,
      ad_id: rows[j].ad_id,
      impressions: parseInt(rows[j].impressions) || 0,
      ctr: parseFloat(rows[j].ctr) || 0,
      spend: parseFloat(rows[j].spend) || 0,
      creative_id: adResult.ok && adResult.data && adResult.data.creative ? adResult.data.creative.id : null
    });
  }

  return res.status(200).json({ count: results.length, ads: results });
}

module.exports = handler;
