/**
 * Lookalike Feeder — daily export Purchase users to Meta Custom Audience.
 *
 * Schedule: daily 04:30 Amsterdam (calqix-lookalike-feeder)
 * Endpoint: /api/cron/lookalike-feeder
 *
 * Why this matters:
 *   Meta Lookalike Audiences are only as good as their seed. Shipping a fresh
 *   rolling 180d Purchase seed daily gives Meta the richest 1st-party signal
 *   we own — hashed email + phone + name + address + Shopify customer_id per
 *   paying customer. Meta's LAL algo will then find prospects that resemble
 *   this seed and we target them in Advantage+ / manual campaigns.
 *
 * Flow:
 *   1. Read Shopify orders (paid, last LOOKBACK_DAYS) via Admin GraphQL.
 *   2. Dedup per customer.id (Shopify GID) with email / phone fallback.
 *   3. Hash all PII via lib/hash + schema-map via lib/meta-audiences.
 *   4. POST to Meta /{audience_id}/users with schema + data payload.
 *   5. Persist run snapshot + last_success marker in Redis.
 *   6. Telegram: P1 alert on Meta API failure, noop otherwise.
 *
 * Env:
 *   META_LOOKALIKE_SOURCE_AUDIENCE_ID   (required) — the Custom Audience ID
 *   META_ACCESS_TOKEN                    — already present
 *   LOOKALIKE_LOOKBACK_DAYS              (optional, default 180)
 *   LOOKALIKE_FEEDER_ENABLED             (optional, default true) — kill switch
 *   LOOKALIKE_MAX_USERS                  (optional, default 10000) — safety cap
 *
 * Redis keys:
 *   cron:lock:lookalike-feeder           (TTL 30min)
 *   lookalike:feeder:run:{timestamp}     (TTL 90d) — per-run snapshot
 *   lookalike:feeder:last_success        (TTL 7d)  — quick health probe
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var audiences = require('../../lib/meta-audiences');
var purchaseBuilder = require('../../lib/purchase-audience-builder');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

var LOCK_KEY = 'cron:lock:lookalike-feeder';
var LOCK_TTL = 30 * 60;         // 30 min
var RUN_SNAPSHOT_TTL = 90 * 86400;
var LAST_SUCCESS_TTL = 7 * 86400;

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Kill switch — default ON, operator can flip to 'false' in Vercel env.
    var enabled = (process.env.LOOKALIKE_FEEDER_ENABLED || 'true').trim().toLowerCase();
    if (enabled === 'false' || enabled === '0') {
      return res.status(200).json({ ok: true, skipped: true, reason: 'LOOKALIKE_FEEDER_ENABLED=false' });
    }

    var audienceId = (process.env.META_LOOKALIKE_SOURCE_AUDIENCE_ID || '').trim();
    if (!audienceId) {
      return res.status(200).json({
        ok: false,
        skipped: true,
        reason: 'META_LOOKALIKE_SOURCE_AUDIENCE_ID ontbreekt'
      });
    }

    // Redis lock — prevents overlap if QStash retries a slow run.
    var lockAcquired = await store.setnx(LOCK_KEY, '1', LOCK_TTL);
    if (!lockAcquired) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }

    // Allow operator overrides via query string for ad-hoc rebuilds.
    var lookbackDays = parseInt(
      (req.query && req.query.lookback) || process.env.LOOKALIKE_LOOKBACK_DAYS || '180',
      10
    );
    var maxUsers = parseInt(
      (req.query && req.query.max_users) || process.env.LOOKALIKE_MAX_USERS || '10000',
      10
    );
    var dryRun = req.query && (req.query.dry_run === '1' || req.query.dry_run === 'true');

    var stats = {
      started_at: dates.formatDateTimeAmsterdam(),
      lookback_days: lookbackDays,
      max_users: maxUsers,
      dry_run: Boolean(dryRun),
      audience_id: audienceId,
      orders_scanned: 0,
      unique_users: 0,
      rows_sent: 0,
      num_received: 0,
      num_invalid_entries: 0,
      dropped: 0,
      meta_trace_id: null,
      meta_status: null,
      meta_error: null
    };

    try {
      // --- 1. Build the seed from Shopify orders ---
      var built = await purchaseBuilder.fetchPurchaseUsers({
        lookbackDays: lookbackDays,
        maxCustomers: maxUsers
      });
      stats.orders_scanned = built.stats.orders_scanned;
      stats.pages_fetched = built.stats.pages_fetched;
      stats.unique_users = built.stats.unique_users;
      stats.hit_max = built.stats.hit_max;

      if (!built.users.length) {
        await store.del(LOCK_KEY);
        var emptySnap = Object.assign({ finished_at: dates.formatDateTimeAmsterdam() }, stats);
        await _saveRunSnapshot(emptySnap);
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: 'Geen paying customers in lookback window',
          stats: emptySnap
        });
      }

      // --- 2. Dry run short-circuit ---
      if (dryRun) {
        var dryRow = audiences.buildRow(built.users[0]);
        var dryRes = Object.assign({
          finished_at: dates.formatDateTimeAmsterdam(),
          sample_hashed_row_keys: audiences.SCHEMA,
          sample_hashed_row_nonempty_cols: dryRow ? dryRow.map(function (v) { return v ? 1 : 0; }) : []
        }, stats);
        await _saveRunSnapshot(dryRes);
        await store.del(LOCK_KEY);
        return res.status(200).json({ ok: true, dry_run: true, stats: dryRes });
      }

      // --- 3. Push to Meta ---
      var result = await audiences.addUsers(audienceId, built.users, {
        sessionId: 'cq_la_' + new Date().toISOString().replace(/[:.]/g, '-')
      });

      stats.rows_sent = result.rowsSent || 0;
      stats.dropped = (result.dropped || 0) + (built.users.length - stats.rows_sent);
      stats.meta_status = result.status || null;

      if (!result.ok) {
        stats.meta_error = result.error || 'onbekend';
        // Persist a failure snapshot for the dashboard before we bail.
        var failSnap = Object.assign({ finished_at: dates.formatDateTimeAmsterdam() }, stats);
        await _saveRunSnapshot(failSnap);
        await _alertFailure(stats);
        await store.del(LOCK_KEY);
        return res.status(200).json({ ok: false, stats: failSnap, error: stats.meta_error });
      }

      stats.num_received = result.numReceived;
      stats.num_invalid_entries = result.numInvalidEntries;
      stats.meta_session_id = result.sessionId;

      var snapshot = Object.assign({ finished_at: dates.formatDateTimeAmsterdam() }, stats);
      await _saveRunSnapshot(snapshot);
      await store.set('lookalike:feeder:last_success', JSON.stringify({
        ts: new Date().toISOString(),
        rows_sent: stats.rows_sent,
        num_received: stats.num_received,
        audience_id: audienceId
      }), LAST_SUCCESS_TTL);

      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: true, stats: snapshot });

    } catch (innerErr) {
      try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
      throw innerErr;
    }

  } catch (err) {
    console.error('[LookalikeFeeder] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    // Always 200 so QStash doesn't bombard the DLQ.
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function _saveRunSnapshot(snapshot) {
  var key = 'lookalike:feeder:run:' + new Date().toISOString().replace(/[:.]/g, '-');
  await store.set(key, JSON.stringify(snapshot), RUN_SNAPSHOT_TTL);
}

async function _alertFailure(stats) {
  var issueKey = 'meta_audience_fail_' + (stats.meta_status || 'unknown');
  var alertResult = await alertDedup.shouldAlert(
    'lookalike-feeder', 'meta', '*', issueKey, 'P1'
  );
  if (!alertResult.send) return;

  var msg = alertDedup.formatAlertPrefix('P1', alertResult.suppressed) +
    ' Lookalike Feeder\n\n' +
    'Meta Custom Audience upload faalde.\n' +
    'Audience: ' + stats.audience_id + '\n' +
    'Users gevonden: ' + stats.unique_users + '\n' +
    'HTTP: ' + (stats.meta_status || '-') + '\n' +
    'Fout: ' + (stats.meta_error || '-') + '\n\n' +
    'Check META_ACCESS_TOKEN (ads_management scope) en audience ID.\n' +
    'Tijdstip: ' + dates.formatDateTimeAmsterdam();
  await sendTelegram(msg);
}
