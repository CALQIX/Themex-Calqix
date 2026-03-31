const { apiGet, apiPost, authAction, authDiagnostics, MAX_DAILY_BUDGET, MIN_DAILY_BUDGET, MAX_BUDGET_MULTIPLIER } = require('../../lib/meta-ads');

var ALLOWED_OPTIMIZATION_GOALS = ['OFFSITE_CONVERSIONS'];
var ALLOWED_CUSTOM_EVENT_TYPES = ['PURCHASE', 'ADD_TO_CART', 'INITIATE_CHECKOUT', 'LANDING_PAGE_VIEW', 'LINK_CLICK'];

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-diagnostics-key, x-ads-action-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Dual auth: DIAGNOSTICS_KEY + ADS_ACTION_KEY
  var auth = authAction(req);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized: ' + auth.reason });
  }

  var body = req.body || {};
  var action = body.action;
  var targetId = body.target_id;
  var params = body.params || {};
  var dryRun = body.dry_run !== false; // DEFAULT TRUE

  if (!action) {
    return res.status(400).json({ error: 'Missing "action" field' });
  }
  if (!targetId) {
    return res.status(400).json({ error: 'Missing "target_id" field' });
  }

  var validActions = ['pause_ad', 'enable_ad', 'adjust_budget', 'change_optimization'];
  if (validActions.indexOf(action) === -1) {
    return res.status(400).json({ error: 'Invalid action. Must be one of: ' + validActions.join(', ') });
  }

  try {
    var result;
    switch (action) {
      case 'pause_ad':
        result = await handlePause(targetId, dryRun);
        break;
      case 'enable_ad':
        result = await handleEnable(targetId, dryRun);
        break;
      case 'adjust_budget':
        result = await handleAdjustBudget(targetId, params, dryRun);
        break;
      case 'change_optimization':
        result = await handleChangeOptimization(targetId, params, dryRun);
        break;
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      action: action,
      target_id: targetId
    });
  }
}

async function getCurrentState(targetId, fields) {
  var result = await apiGet(targetId, { fields: fields });
  if (!result.ok) {
    throw new Error('Kan huidige status niet ophalen: ' + result.error);
  }
  return result.data;
}

async function handlePause(targetId, dryRun) {
  var current = await getCurrentState(targetId, 'name,status,effective_status');

  var response = {
    success: true,
    dry_run: dryRun,
    action: 'pause_ad',
    target_id: targetId,
    target_name: current.name,
    before: { status: current.status, effective_status: current.effective_status },
    after: { status: 'PAUSED' },
    timestamp: new Date().toISOString(),
    rollback_command: { action: 'enable_ad', target_id: targetId }
  };

  if (dryRun) {
    response.would_execute = 'POST /' + targetId + ' met { status: "PAUSED" }';
    return response;
  }

  var result = await apiPost(targetId, { status: 'PAUSED' });
  if (!result.ok) {
    response.success = false;
    response.error = result.error;
  }

  console.log('[ADS ACTION]', JSON.stringify({
    action: 'pause_ad',
    target: targetId,
    name: current.name,
    old_status: current.status,
    new_status: 'PAUSED',
    success: response.success,
    timestamp: response.timestamp
  }));

  return response;
}

async function handleEnable(targetId, dryRun) {
  var current = await getCurrentState(targetId, 'name,status,effective_status');

  var response = {
    success: true,
    dry_run: dryRun,
    action: 'enable_ad',
    target_id: targetId,
    target_name: current.name,
    before: { status: current.status, effective_status: current.effective_status },
    after: { status: 'ACTIVE' },
    timestamp: new Date().toISOString(),
    rollback_command: { action: 'pause_ad', target_id: targetId }
  };

  if (dryRun) {
    response.would_execute = 'POST /' + targetId + ' met { status: "ACTIVE" }';
    return response;
  }

  var result = await apiPost(targetId, { status: 'ACTIVE' });
  if (!result.ok) {
    response.success = false;
    response.error = result.error;
  }

  console.log('[ADS ACTION]', JSON.stringify({
    action: 'enable_ad',
    target: targetId,
    name: current.name,
    old_status: current.status,
    new_status: 'ACTIVE',
    success: response.success,
    timestamp: response.timestamp
  }));

  return response;
}

async function handleAdjustBudget(targetId, params, dryRun) {
  var newBudgetEur = parseFloat(params.daily_budget_eur);
  if (isNaN(newBudgetEur) || newBudgetEur <= 0) {
    throw new Error('params.daily_budget_eur is vereist en moet een positief getal zijn (in euro)');
  }

  var newBudgetCents = Math.round(newBudgetEur * 100);

  // Fetch current budget
  var current = await getCurrentState(targetId, 'name,status,daily_budget');
  var currentBudgetCents = parseInt(current.daily_budget, 10) || 0;
  var currentBudgetEur = currentBudgetCents / 100;

  // SAFETY: min budget
  if (newBudgetCents < MIN_DAILY_BUDGET) {
    throw new Error('Budget kan niet lager zijn dan ' + (MIN_DAILY_BUDGET / 100) + ' EUR/dag');
  }

  // SAFETY: max budget
  if (newBudgetCents > MAX_DAILY_BUDGET) {
    throw new Error('Budget kan niet hoger zijn dan ' + (MAX_DAILY_BUDGET / 100) + ' EUR/dag (ADS_MAX_DAILY_BUDGET limiet)');
  }

  // SAFETY: max 2x increase
  if (currentBudgetCents > 0 && newBudgetCents > currentBudgetCents * MAX_BUDGET_MULTIPLIER) {
    throw new Error(
      'Budget kan maximaal ' + MAX_BUDGET_MULTIPLIER + 'x verhoogd worden per keer. ' +
      'Huidig: ' + currentBudgetEur + ' EUR, Max: ' + (currentBudgetEur * MAX_BUDGET_MULTIPLIER) + ' EUR, ' +
      'Gevraagd: ' + newBudgetEur + ' EUR'
    );
  }

  var response = {
    success: true,
    dry_run: dryRun,
    action: 'adjust_budget',
    target_id: targetId,
    target_name: current.name,
    before: { daily_budget: currentBudgetEur + ' EUR', daily_budget_cents: currentBudgetCents },
    after: { daily_budget: newBudgetEur + ' EUR', daily_budget_cents: newBudgetCents },
    change_pct: currentBudgetCents > 0
      ? Number(((newBudgetCents - currentBudgetCents) / currentBudgetCents * 100).toFixed(1))
      : null,
    timestamp: new Date().toISOString(),
    rollback_command: {
      action: 'adjust_budget',
      target_id: targetId,
      params: { daily_budget_eur: currentBudgetEur }
    }
  };

  if (dryRun) {
    response.would_execute = 'POST /' + targetId + ' met { daily_budget: ' + newBudgetCents + ' }';
    return response;
  }

  var result = await apiPost(targetId, { daily_budget: newBudgetCents });
  if (!result.ok) {
    response.success = false;
    response.error = result.error;
  }

  console.log('[ADS ACTION]', JSON.stringify({
    action: 'adjust_budget',
    target: targetId,
    name: current.name,
    old_budget: currentBudgetCents,
    new_budget: newBudgetCents,
    success: response.success,
    timestamp: response.timestamp
  }));

  return response;
}

async function handleChangeOptimization(targetId, params, dryRun) {
  var customEventType = (params.custom_event_type || '').toUpperCase();

  if (ALLOWED_CUSTOM_EVENT_TYPES.indexOf(customEventType) === -1) {
    throw new Error('custom_event_type moet een van: ' + ALLOWED_CUSTOM_EVENT_TYPES.join(', '));
  }

  var current = await getCurrentState(targetId, 'name,status,optimization_goal,promoted_object');

  var newPromotedObject = Object.assign({}, current.promoted_object || {}, {
    custom_event_type: customEventType
  });

  var response = {
    success: true,
    dry_run: dryRun,
    action: 'change_optimization',
    target_id: targetId,
    target_name: current.name,
    before: {
      optimization_goal: current.optimization_goal,
      promoted_object: current.promoted_object
    },
    after: {
      optimization_goal: 'OFFSITE_CONVERSIONS',
      promoted_object: newPromotedObject
    },
    timestamp: new Date().toISOString(),
    rollback_command: {
      action: 'change_optimization',
      target_id: targetId,
      params: {
        custom_event_type: current.promoted_object && current.promoted_object.custom_event_type
          ? current.promoted_object.custom_event_type
          : 'PURCHASE'
      }
    }
  };

  if (dryRun) {
    response.would_execute = 'POST /' + targetId + ' met { optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: ' + JSON.stringify(newPromotedObject) + ' }';
    return response;
  }

  var result = await apiPost(targetId, {
    optimization_goal: 'OFFSITE_CONVERSIONS',
    promoted_object: newPromotedObject
  });
  if (!result.ok) {
    response.success = false;
    response.error = result.error;
  }

  console.log('[ADS ACTION]', JSON.stringify({
    action: 'change_optimization',
    target: targetId,
    name: current.name,
    old_goal: current.optimization_goal,
    new_event_type: customEventType,
    success: response.success,
    timestamp: response.timestamp
  }));

  return response;
}

module.exports = handler;
