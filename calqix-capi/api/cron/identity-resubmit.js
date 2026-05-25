/**
 * Identity Resubmit Cron — re-sends events to Meta CAPI with enriched user_data.
 *
 * Schedule: every 15 min offset +7 (calqix-identity-resubmit)
 * Endpoint: /api/cron/identity-resubmit
 *
 * Works in concert with api/cron/identity-backfill.js, which scans recent events
 * and produces `backfill:pending:{event_id}` records whenever it finds newer
 * identity signals (phone / name / address) for an event that was originally
 * shipped to Meta with only fbp / IP / UA.
 *
 * This cron consumes those pending records:
 *   1. Load meta:payload:{event_id}                      (hashed user_data + custom_data + source_url)
 *   2. Merge the newly-captured identity (unhashed) into user_data via hash.formatUserData
 *      - Existing fields are preserved (fbp / fbc / client_ip / client_ua stay intact)
 *      - Missing fields get the new hashed values (em / ph / fn / ln / db / ct / st / zp / country)
 *   3. Call meta-capi.sendEvent with the SAME event_id
 *      - Meta dedups on event_id within its 48h window and merges match keys
 *        from the richer submission, raising EMQ retroactively without double-
 *        counting the event.
 *   4. Mark backfill:resubmit:{event_id} (7d TTL) so a future run skips it.
 *   5. Delete backfill:pending:{event_id} so the queue drains.
 *
 * Safety constraints:
 *   - Only processes events <24h old (inside Meta's safe update window)
 *   - Skips if backfill:resubmit:{event_id} already exists
 *   - Skips if the event state is not confirmed/recovered
 *   - Hard-caps at 100 resubmits per run to stay well under CAPI rate limits
 *   - 10-min Redis lock prevents overlapping cron invocations
 *
 * Metrics (per run, stored under backfill:resubmit:run:{timestamp}, 7d):
 *   scanned, resubmitted, skipped_no_payload, skipped_too_old, skipped_already_done,
 *   skipped_bad_state, meta_failures
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var eventState = require('../../lib/event-state');
var metaCapi = require('../../lib/meta-capi');
var hash = require('../../lib/hash');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');
var qualityLedger = require('../../lib/meta-quality-ledger');

var LOCK_KEY = 'cron:lock:identity-resubmit';
var LOCK_TTL = 10 * 60;
var RESUBMIT_MARKER_TTL = 7 * 86400;
var MAX_EVENT_AGE_MS = 24 * 3600 * 1000;   // Meta's safe update window
var MAX_RESUBMITS_PER_RUN = 100;
var SCAN_BATCH = 100;

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var redis = store._getRedis();
    if (!redis) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Redis niet beschikbaar' });
    }

    var existingLock = await store.get(LOCK_KEY);
    if (existingLock) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }
    await store.set(LOCK_KEY, '1', LOCK_TTL);

    var stats = {
      scanned: 0,
      resubmitted: 0,
      skipped_no_payload: 0,
      skipped_too_old: 0,
      skipped_already_done: 0,
      skipped_bad_state: 0,
      meta_failures: 0,
      samples: []
    };

    try {
      var cursor = '0';
      do {
        var scanResult = await redis.scan(cursor, { match: 'backfill:pending:*', count: SCAN_BATCH });
        cursor = String(scanResult[0]);
        var keys = scanResult[1] || [];

        for (var i = 0; i < keys.length; i++) {
          if (stats.resubmitted >= MAX_RESUBMITS_PER_RUN) {
            cursor = '0';
            break;
          }

          stats.scanned++;
          var pendingKey = keys[i];
          var eventId = pendingKey.replace('backfill:pending:', '');

          // Skip if already resubmitted in the past 7 days.
          var alreadyDone = await store.get('backfill:resubmit:' + eventId);
          if (alreadyDone) {
            stats.skipped_already_done++;
            await store.del(pendingKey); // drain queue
            continue;
          }

          // Load the pending enrichment record.
          var pendingRaw = await store.get(pendingKey);
          if (!pendingRaw) {
            stats.skipped_no_payload++;
            continue;
          }
          var pending;
          try { pending = JSON.parse(pendingRaw); }
          catch (e) { stats.skipped_no_payload++; await store.del(pendingKey); continue; }

          // Load the original event state — we need event_name, source, and age.
          var evState = await eventState.getEventState(eventId);
          if (!evState || (evState.state !== 'confirmed' && evState.state !== 'recovered')) {
            stats.skipped_bad_state++;
            continue;
          }

          var eventAgeMs = Date.now() - new Date(evState.created_at || 0).getTime();
          if (eventAgeMs > MAX_EVENT_AGE_MS) {
            stats.skipped_too_old++;
            await store.del(pendingKey); // Meta won't accept enrichment beyond 24h
            continue;
          }

          // Load the hashed payload we originally shipped.
          var originalPayload = await eventState.getEventPayload(eventId);
          if (!originalPayload) {
            stats.skipped_no_payload++;
            continue;
          }

          // Build merged user_data. Start from unhashed identity, then layer
          // the already-hashed originals back on top so we preserve fbp/fbc/IP/UA.
          var identity = pending.identity || {};
          var externalIdRaw =
            identity.external_id ||
            (evState.shopify_id ? String(evState.shopify_id) : undefined);

          var freshHashed = hash.formatUserData({
            email: identity.email,
            phone: identity.phone,
            first_name: identity.fn,
            last_name: identity.ln,
            city: identity.ct,
            date_of_birth: identity.db,
            zip: identity.zp,
            country_code: identity.country,
            province_code: identity.st,
            external_id: externalIdRaw,
            fbc: identity.fbc,
            fbp: identity.fbp
          });

          // Original wins for fbp / fbc / IP / UA / external_id — those were
          // captured at the real event time and are more accurate than whatever
          // we learn later. Fresh wins for em/ph/fn/ln/db/ct/st/zp/country.
          var originalUD = originalPayload.user_data || {};
          var mergedUD = Object.assign({}, freshHashed);
          var PRESERVE = ['fbp', 'fbc', 'client_ip_address', 'client_user_agent'];
          for (var p = 0; p < PRESERVE.length; p++) {
            if (originalUD[PRESERVE[p]]) {
              mergedUD[PRESERVE[p]] = originalUD[PRESERVE[p]];
            }
          }
          // Keep original external_id if we didn't derive a better one.
          if (originalUD.external_id && !mergedUD.external_id) {
            mergedUD.external_id = originalUD.external_id;
          }

          // Count new fields for telemetry.
          var newFields = 0;
          var keysToCheck = ['em', 'ph', 'fn', 'ln', 'db', 'ct', 'st', 'zp', 'country'];
          for (var k = 0; k < keysToCheck.length; k++) {
            if (mergedUD[keysToCheck[k]] && !originalUD[keysToCheck[k]]) newFields++;
          }
          if (newFields === 0) {
            // Nothing genuinely new — avoid an unnecessary Meta call.
            await store.del(pendingKey);
            await store.set('backfill:resubmit:' + eventId, JSON.stringify({
              ts: new Date().toISOString(), noop: true
            }), RESUBMIT_MARKER_TTL);
            continue;
          }

          // Fire the resubmit. Same event_id so Meta dedups and enriches.
          var sendResult = await metaCapi.sendEvent(
            evState.event_name,
            eventId,
            originalPayload.source_url || 'https://calqix.com',
            mergedUD,
            originalPayload.custom_data || {},
            { eventTime: originalPayload.event_time || evState.event_time }
          );

          if (!sendResult || !sendResult.ok) {
            stats.meta_failures++;
            continue; // leave pending for retry next run
          }
          await qualityLedger.recordServerEvent({
            event_name: evState.event_name,
            event_id: eventId,
            event_time: originalPayload.event_time || evState.event_time,
            source: 'identity_resubmit',
            user_data: mergedUD,
            custom_data: originalPayload.custom_data || {},
            source_url: originalPayload.source_url || 'https://calqix.com',
            meta_result: sendResult
          });

          stats.resubmitted++;
          if (stats.samples.length < 5) {
            stats.samples.push({
              event_id: eventId,
              event_name: evState.event_name,
              new_fields: newFields
            });
          }

          // Persist richer payload so future resubmits see the merged state.
          await eventState.storeEventPayload(
            eventId,
            mergedUD,
            originalPayload.custom_data || {},
            originalPayload.source_url || 'https://calqix.com',
            originalPayload.event_time || evState.event_time
          );

          await store.set('backfill:resubmit:' + eventId, JSON.stringify({
            ts: new Date().toISOString(),
            new_fields: newFields,
            event_name: evState.event_name,
            meta_trace_id: sendResult.result && sendResult.result.fbtrace_id || null
          }), RESUBMIT_MARKER_TTL);
          await store.del(pendingKey);
        }
      } while (cursor !== '0' && stats.resubmitted < MAX_RESUBMITS_PER_RUN);

      // Persist run snapshot for trend / radar dashboard (session 3).
      var runKey = 'backfill:resubmit:run:' + new Date().toISOString().replace(/[:.]/g, '-');
      await store.set(runKey, JSON.stringify(Object.assign({
        timestamp: dates.formatDateTimeAmsterdam()
      }, stats)), 7 * 86400);

      // Alert if Meta starts failing repeatedly — signals a token / catalog issue.
      if (stats.meta_failures >= 10) {
        var alertResult = await alertDedup.shouldAlert(
          'identity-resubmit', 'meta', '*', 'resubmit_failures', 'P1'
        );
        if (alertResult.send) {
          await sendTelegram(
            alertDedup.formatAlertPrefix('P1', alertResult.suppressed) +
            ' Identity Resubmit\n\n' +
            stats.meta_failures + '/' + stats.scanned + ' resubmits faalden bij Meta\n' +
            'Resubmitted OK: ' + stats.resubmitted + '\n' +
            'Check META_ACCESS_TOKEN geldigheid.\n' +
            'Tijdstip: ' + dates.formatDateTimeAmsterdam()
          );
        }
      }
    } finally {
      await store.del(LOCK_KEY);
    }

    return res.status(200).json({ ok: true, stats: stats });

  } catch (err) {
    console.error('[IdentityResubmit] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};
