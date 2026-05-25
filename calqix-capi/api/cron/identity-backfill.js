/**
 * Identity Backfill Cron — re-enriches events with EMQ < 7.0.
 *
 * Schedule: every 15 min (calqix-identity-backfill)
 * Endpoint: /api/cron/identity-backfill
 *
 * Scans orders from last 24h with low EMQ, checks for newer identity
 * signals in Redis, and re-sends enriched events to all platforms.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');

var LOCK_KEY = 'cron:lock:identity-backfill';
var LOCK_TTL = 10 * 60;

module.exports = async function (req, res) {
  try {
    // Auth check
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Lock
    var locked = await store.set(LOCK_KEY, '1', LOCK_TTL, true);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }

    var enriched = 0;
    var scanned = 0;

    // Scan recent events for low EMQ
    var redis = store._getRedis();
    if (redis) {
      // Scan meta:event:* keys from last 24h
      var now = Date.now();
      var cutoff = now - 24 * 3600 * 1000;

      // Use cursor-based scan for efficiency
      var cursor = '0';
      var batchSize = 50;
      var processed = [];

      do {
        var scanResult = await redis.scan(cursor, { match: 'meta:event:*', count: batchSize });
        cursor = scanResult[0];
        var keys = scanResult[1] || [];

        for (var i = 0; i < keys.length && scanned < 200; i++) {
          scanned++;
          var raw = await redis.get(keys[i]);
          if (!raw) continue;

          var event;
          try { event = JSON.parse(raw); } catch (e) { continue; }

          // Only process confirmed events
          if (event.state !== 'confirmed' && event.state !== 'recovered') continue;

          // Check if event is from last 24h
          var eventTime = new Date(event.created_at || 0).getTime();
          if (eventTime < cutoff) continue;

          // Try to find enrichment data
          var eventId = event.event_id;
          if (!eventId) continue;

          // Look up identity from multiple sources. Webhook events usually
          // carry checkout_token as shopify_id, while browser-side checkout
          // events write their first-party fields to enrich:{checkout_token}.
          var identity = null;
          var identityParts = [];

          if (event.shopify_id) {
            var orderIdentity = await store.get('identity:order:' + event.shopify_id);
            if (orderIdentity) {
              try { identityParts.push(JSON.parse(orderIdentity)); } catch (e) { /* skip */ }
            }

            var cartIdentity = await store.get('identity:cart:' + event.shopify_id);
            if (cartIdentity) {
              try { identityParts.push(JSON.parse(cartIdentity)); } catch (e) { /* skip */ }
            }

            var checkoutEnrichment = await store.getEnrichment(String(event.shopify_id));
            if (checkoutEnrichment) {
              identityParts.push(checkoutEnrichment);
            }
          }

          if (identityParts.length > 0) {
            identity = mergeIdentityParts(identityParts);
          }

          // Try stored payload to check current EMQ fields
          var payloadRaw = await store.get('meta:payload:' + eventId);
          if (!payloadRaw || !identity) continue;

          var payload;
          try { payload = JSON.parse(payloadRaw); } catch (e) { continue; }

          // Count current EMQ fields
          var userData = payload.user_data || {};
          var currentFields = countEMQFields(userData);

          // Check if identity has new fields
          var newFields = 0;
          if (identity.phone && !userData.ph) newFields++;
          if (identity.fn && !userData.fn) newFields++;
          if (identity.ln && !userData.ln) newFields++;
          if (identity.ct && !userData.ct) newFields++;
          if (identity.st && !userData.st) newFields++;
          if (identity.zp && !userData.zp) newFields++;
          if (identity.db && !userData.db) newFields++;

          if (newFields > 0) {
            // Store backfill record for platforms to re-send
            await store.set('backfill:pending:' + eventId, JSON.stringify({
              event_id: eventId,
              event_name: event.event_name,
              identity: identity,
              original_fields: currentFields,
              new_fields: newFields,
              created_at: new Date().toISOString()
            }), 24 * 3600);

            enriched++;
            processed.push(eventId);
          }
        }
      } while (cursor !== '0' && scanned < 200);

      // Snapshot run
      var snapshot = {
        timestamp: dates.formatDateTimeAmsterdam(),
        scanned: scanned,
        enriched: enriched,
        processed: processed.slice(0, 20)
      };
      var snapshotKey = 'backfill:run:' + dates.formatDateTimeAmsterdam().replace(/[\s:]/g, '-');
      await store.set(snapshotKey, JSON.stringify(snapshot), 7 * 86400);
    }

    await store.del(LOCK_KEY);

    return res.status(200).json({
      ok: true,
      scanned: scanned,
      enriched: enriched
    });

  } catch (err) {
    console.error('[IdentityBackfill] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};

function countEMQFields(userData) {
  var count = 0;
  if (userData.em) count++;
  if (userData.ph) count++;
  if (userData.fn) count++;
  if (userData.ln) count++;
  if (userData.ct) count++;
  if (userData.st) count++;
  if (userData.zp) count++;
  if (userData.country) count++;
  if (userData.db) count++;
  if (userData.fbc) count++;
  if (userData.fbp) count++;
  if (userData.external_id) count++;
  return count;
}

function mergeIdentityParts(parts) {
  var identity = {};
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i] || {};
    setIfPresent(identity, 'email', part.email);
    setIfPresent(identity, 'phone', part.phone);
    setIfPresent(identity, 'fn', part.fn || part.first_name || part.firstName);
    setIfPresent(identity, 'ln', part.ln || part.last_name || part.lastName);
    setIfPresent(identity, 'ct', part.ct || part.city);
    setIfPresent(identity, 'st', part.st || part.state || part.province_code || part.provinceCode);
    setIfPresent(identity, 'zp', part.zp || part.zip || part.postal_code || part.postalCode);
    setIfPresent(identity, 'country', part.country || part.country_code || part.countryCode);
    setIfPresent(identity, 'db', part.db || part.date_of_birth || part.dateOfBirth || part.birthdate || part.birthday);
    setIfPresent(identity, 'fbc', part.fbc);
    setIfPresent(identity, 'fbp', part.fbp);
    setIfPresent(identity, 'external_id', part.external_id || part.externalId);
  }
  return identity;
}

function setIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}
