/**
 * Ad Fatigue Tracker — tracks CTR trend over 7 days per ad.
 *
 * Detects creative fatigue when CTR drops >30% from peak with >1000 impressions.
 *
 * Redis keys:
 *   ad_fatigue:{ad_id}  → JSON  TTL 14d  (CTR history + fatigue state)
 */
var store = require('./store');
var dates = require('./dates');

var TTL_FATIGUE = 14 * 86400;
var CTR_DECLINE_THRESHOLD = 30; // percent drop from peak
var MIN_IMPRESSIONS_FOR_FATIGUE = 1000;
var HISTORY_DAYS = 7;

async function getJSON(key) {
  var raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setJSON(key, val, ttl) {
  return store.set(key, JSON.stringify(val), ttl);
}

/**
 * Update CTR data point for an ad.
 * @param {string} adId
 * @param {string} adName
 * @param {number} ctr - current CTR
 * @param {number} impressions - current total impressions
 * @param {number} frequency - current frequency
 * @returns {Promise<object>} Updated fatigue state
 */
async function updateAdData(adId, adName, ctr, impressions, frequency) {
  var key = 'ad_fatigue:' + adId;
  var data = (await getJSON(key)) || {
    adId: adId,
    adName: adName,
    ctrHistory: [],
    peakCtr: 0,
    fatigued: false,
    ctrDeclinePct: 0,
    lastUpdated: null
  };

  data.adName = adName;

  // Add today's data point
  var today = dates.todayKey();
  var lastEntry = data.ctrHistory.length > 0 ? data.ctrHistory[data.ctrHistory.length - 1] : null;

  // Only add one entry per day
  if (!lastEntry || lastEntry.date !== today) {
    data.ctrHistory.push({
      date: today,
      ctr: ctr,
      impressions: impressions,
      frequency: frequency
    });
  } else {
    // Update today's entry
    lastEntry.ctr = ctr;
    lastEntry.impressions = impressions;
    lastEntry.frequency = frequency;
  }

  // Keep only last HISTORY_DAYS entries
  if (data.ctrHistory.length > HISTORY_DAYS) {
    data.ctrHistory = data.ctrHistory.slice(-HISTORY_DAYS);
  }

  // Calculate peak CTR from history
  data.peakCtr = 0;
  data.ctrHistory.forEach(function (entry) {
    if (entry.ctr > data.peakCtr) data.peakCtr = entry.ctr;
  });

  // Detect fatigue
  var currentCtr = ctr;
  data.currentCtr = currentCtr;
  if (data.peakCtr > 0 && impressions >= MIN_IMPRESSIONS_FOR_FATIGUE) {
    data.ctrDeclinePct = ((data.peakCtr - currentCtr) / data.peakCtr) * 100;
    data.fatigued = data.ctrDeclinePct >= CTR_DECLINE_THRESHOLD;
  } else {
    data.ctrDeclinePct = 0;
    data.fatigued = false;
  }

  data.lastUpdated = new Date().toISOString();
  await setJSON(key, data, TTL_FATIGUE);

  return data;
}

/**
 * Bulk update from ad performance rows.
 * @param {Array} adRows — normalized ad insight rows
 * @returns {Promise<object>} Map of adId → fatigue data
 */
async function bulkUpdate(adRows) {
  var results = {};
  for (var i = 0; i < adRows.length; i++) {
    var ad = adRows[i];
    if (!ad.ad_id) continue;
    var data = await updateAdData(
      ad.ad_id,
      ad.ad_name || '',
      ad.ctr || 0,
      ad.impressions || 0,
      ad.frequency || 0
    );
    results[ad.ad_id] = data;
  }
  return results;
}

/**
 * Get fatigue data for a specific ad.
 */
async function getAdFatigue(adId) {
  return getJSON('ad_fatigue:' + adId);
}

/**
 * Get all fatigued ads from a list of ad IDs.
 * @param {Array<string>} adIds
 * @returns {Promise<object>} Map of adId → fatigue data (only fatigued)
 */
async function getFatiguedAds(adIds) {
  var result = {};
  for (var i = 0; i < adIds.length; i++) {
    var data = await getAdFatigue(adIds[i]);
    if (data && data.fatigued) {
      result[adIds[i]] = data;
    }
  }
  return result;
}

module.exports = {
  updateAdData: updateAdData,
  bulkUpdate: bulkUpdate,
  getAdFatigue: getAdFatigue,
  getFatiguedAds: getFatiguedAds,
  CTR_DECLINE_THRESHOLD: CTR_DECLINE_THRESHOLD,
  MIN_IMPRESSIONS_FOR_FATIGUE: MIN_IMPRESSIONS_FOR_FATIGUE
};
