/**
 * Budget Limits — Redis-backed safety limits adjustable via Telegram.
 *
 * Redis key: config:limits (no TTL, persistent)
 * All values in EUR (whole numbers, not cents).
 * Minimum floor: EUR 10 (hardcoded, not adjustable).
 */
var store = require('./store');
var dates = require('./dates');

var REDIS_KEY = 'config:limits';
var LOG_KEY = 'log:limit-changes';
var MIN_FLOOR = 10;

var DEFAULTS = {
  max_adset_budget: 50,
  max_daily_spend: 100,
  max_campaign_budget: 200,
  currency: 'EUR'
};

/**
 * Get current limits from Redis (or initialize with defaults).
 */
async function getLimits() {
  var raw = await store.get(REDIS_KEY);
  if (raw) {
    try {
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Ensure all default keys exist
      var result = {};
      var keys = Object.keys(DEFAULTS);
      for (var i = 0; i < keys.length; i++) {
        result[keys[i]] = parsed[keys[i]] !== undefined ? parsed[keys[i]] : DEFAULTS[keys[i]];
      }
      result.updated_at = parsed.updated_at || null;
      result.updated_by = parsed.updated_by || 'system_default';
      return result;
    } catch (e) { /* corrupt, re-init */ }
  }

  // Initialize with defaults
  var init = Object.assign({}, DEFAULTS, {
    updated_at: dates.formatDateTimeAmsterdam(new Date()),
    updated_by: 'system_default'
  });
  await store.set(REDIS_KEY, JSON.stringify(init));
  return init;
}

/**
 * Update a specific limit. Enforces minimum floor of EUR 10.
 */
async function updateLimit(key, value) {
  var limits = await getLimits();
  var oldValue = limits[key];

  // Enforce minimum
  var newValue = Math.max(MIN_FLOOR, parseInt(value, 10) || MIN_FLOOR);

  limits[key] = newValue;
  limits.updated_at = dates.formatDateTimeAmsterdam(new Date());
  limits.updated_by = 'telegram';
  await store.set(REDIS_KEY, JSON.stringify(limits));

  // Log the change
  var logEntry = {
    key: key,
    old_value: oldValue,
    new_value: newValue,
    changed_at: dates.formatDateTimeAmsterdam(new Date()),
    changed_by: 'telegram'
  };
  try {
    var logRaw = await store.get(LOG_KEY);
    var log = [];
    if (logRaw) {
      try { log = typeof logRaw === 'string' ? JSON.parse(logRaw) : logRaw; } catch (e) { log = []; }
    }
    log.push(logEntry);
    // Keep last 100 entries
    if (log.length > 100) log = log.slice(-100);
    await store.set(LOG_KEY, JSON.stringify(log), 90 * 86400);
  } catch (e) {
    console.warn('[Limits] Log error:', e.message);
  }

  return limits;
}

/**
 * Get max adset budget in cents (for Meta API compatibility).
 * Meta API uses cents, our limits are in EUR.
 */
async function getMaxAdsetBudgetCents() {
  var limits = await getLimits();
  return limits.max_adset_budget * 100;
}

/**
 * Get max daily spend in EUR.
 */
async function getMaxDailySpend() {
  var limits = await getLimits();
  return limits.max_daily_spend;
}

/**
 * Get max campaign budget in cents.
 */
async function getMaxCampaignBudgetCents() {
  var limits = await getLimits();
  return limits.max_campaign_budget * 100;
}

module.exports = {
  getLimits: getLimits,
  updateLimit: updateLimit,
  getMaxAdsetBudgetCents: getMaxAdsetBudgetCents,
  getMaxDailySpend: getMaxDailySpend,
  getMaxCampaignBudgetCents: getMaxCampaignBudgetCents,
  DEFAULTS: DEFAULTS,
  MIN_FLOOR: MIN_FLOOR
};
