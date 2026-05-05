var eventStats = require('../../lib/event-stats');

function getBearer(req) {
  var auth = req && req.headers && (req.headers.authorization || req.headers.Authorization);
  var match = String(auth || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isAuthorized(req) {
  var expected = (process.env.ADMIN_TOKEN || process.env.DASHBOARD_TOKEN || '').trim();
  if (!expected) return false;
  var provided = getBearer(req) ||
    (req && req.query && req.query.token) ||
    (req && req.headers && req.headers['x-dashboard-token']);
  return provided === expected;
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var days = parseInt((req.query && req.query.days) || '7', 10);
    if (!Number.isFinite(days) || days < 1 || days > 30) days = 7;

    var stats = await eventStats.getEventStats(days);
    var operational = await eventStats.getOperationalCounts();

    return res.status(200).json({
      ok: true,
      days: days,
      generated_at: new Date().toISOString(),
      auth: process.env.ADMIN_TOKEN ? 'ADMIN_TOKEN' : 'DASHBOARD_TOKEN',
      stats: stats,
      recovery_queue_size: operational.recovery_queue_size,
      identity_store_count: operational.identity_store_count
    });
  } catch (err) {
    console.error('[EventStats] Error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
