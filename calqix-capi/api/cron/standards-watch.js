var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var store = require('../../lib/store');
var watcher = require('../../lib/tracking-standards-watch');

var ENDPOINT_PATH = '/api/cron/standards-watch';
var LOCK_KEY = 'cron:lock:standards-watch';
var LOCK_TTL = 20 * 60;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = '';
  if (req.method === 'POST') {
    try { rawBody = await getRawBody(req); } catch (e) { rawBody = ''; }
  }

  var auth = await authenticate(req, rawBody, ENDPOINT_PATH);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var dryRun = req.query && (req.query.dryRun === '1' || req.query.dry_run === '1');
  try {
    if (!dryRun) {
      var locked = await store.setnx(LOCK_KEY, '1', LOCK_TTL);
      if (!locked) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'Lock active' });
      }
    }

    var result = await watcher.run({ dryRun: dryRun });
    if (!dryRun) await store.del(LOCK_KEY);

    return res.status(200).json({
      ok: result.ok,
      auth_source: auth.source,
      dryRun: dryRun,
      docs_checked: result.docs_checked,
      review_required: result.review_required,
      diffs: result.tracking_standard_diff
    });
  } catch (err) {
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    console.error('[StandardsWatch] failed', { message: err.message });
    return res.status(200).json({ ok: false, error: err.message });
  }
};
