/**
 * CALQIX Recovery Job — 1-Minute QStash Schedule
 *
 * Retries genuinely failed or missed Meta CAPI events.
 * Does NOT blindly resend — only processes items in the recovery queue.
 *
 * Flow:
 *   1. Verify QStash signature or CRON_SECRET
 *   2. Acquire recovery lock (TTL 120s)
 *   3. Pop items from recovery:queue (max BATCH_SIZE per run)
 *   4. For each: check event state, retry if retryable
 *   5. Release lock
 *   6. Return structured result
 *
 * Schedule: QStash CRON_TZ=Europe/Amsterdam * * * * * (every minute)
 */
var store = require('../../lib/store');
var { authenticate, getRawBody } = require('../../lib/qstash-verify');
var eventState = require('../../lib/event-state');
var { sendEvent } = require('../../lib/meta-capi');

var BATCH_SIZE = 10;
var ENDPOINT_PATH = '/api/recovery/run';

async function handler(req, res) {
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

  var startTime = Date.now();
  var now = new Date();

  // Acquire recovery lock
  var lockAcquired = await store.acquireRecoveryLock();
  if (!lockAcquired) {
    return res.status(200).json({
      timestamp: now.toISOString(),
      skipped: true,
      reason: 'lock_held',
      auth_source: auth.source
    });
  }

  var retried = 0;
  var confirmed = 0;
  var terminal = 0;
  var skipped = 0;
  var errors = [];

  try {
    var queueLength = await eventState.getRecoveryQueueLength();

    if (queueLength === 0) {
      return res.status(200).json({
        timestamp: now.toISOString(),
        queue_length: 0,
        retried: 0,
        confirmed: 0,
        terminal: 0,
        skipped: 0,
        elapsed_ms: Date.now() - startTime,
        auth_source: auth.source
      });
    }

    console.log('[Recovery] Processing queue', {
      queueLength: queueLength,
      batchSize: BATCH_SIZE,
      authSource: auth.source
    });

    // Process up to BATCH_SIZE items
    for (var i = 0; i < BATCH_SIZE; i++) {
      var eventId = await eventState.popFromRecoveryQueue();
      if (!eventId) break;

      try {
        var result = await processRetry(eventId);
        if (result === 'retried') retried++;
        else if (result === 'confirmed') confirmed++;
        else if (result === 'terminal') terminal++;
        else skipped++;
      } catch (err) {
        errors.push({ eventId: eventId.substring(0, 20) + '...', error: err.message });
        skipped++;
      }
    }

    var elapsed = Date.now() - startTime;
    console.log('[Recovery] Completed', {
      retried: retried,
      confirmed: confirmed,
      terminal: terminal,
      skipped: skipped,
      errors: errors.length,
      elapsed_ms: elapsed
    });

    return res.status(200).json({
      timestamp: now.toISOString(),
      queue_length: queueLength,
      retried: retried,
      confirmed: confirmed,
      terminal: terminal,
      skipped: skipped,
      errors: errors.length > 0 ? errors : undefined,
      elapsed_ms: elapsed,
      auth_source: auth.source
    });

  } catch (err) {
    console.error('[Recovery] CRITICAL FAILURE', { message: err.message, stack: err.stack });
    return res.status(200).json({
      timestamp: now.toISOString(),
      error: err.message,
      retried: retried,
      confirmed: confirmed,
      terminal: terminal,
      skipped: skipped,
      elapsed_ms: Date.now() - startTime,
      auth_source: auth.source
    });
  } finally {
    await store.releaseRecoveryLock();
  }
}

/**
 * Process a single retry from the recovery queue.
 * @param {string} eventId
 * @returns {Promise<string>} — 'retried' | 'confirmed' | 'terminal' | 'skipped'
 */
async function processRetry(eventId) {
  var state = await eventState.getEventState(eventId);

  if (!state) {
    console.log('[Recovery] Event state not found, skipping', { eventId: eventId.substring(0, 20) });
    return 'skipped';
  }

  // Already confirmed or recovered — nothing to do
  if (state.state === eventState.STATES.CONFIRMED || state.state === eventState.STATES.RECOVERED) {
    return 'confirmed';
  }

  // Terminal — no more retries
  if (state.state === eventState.STATES.FAILED_TERMINAL) {
    return 'terminal';
  }

  // Check if max retries exceeded
  if (state.attempts >= eventState.MAX_RETRY_ATTEMPTS) {
    console.log('[Recovery] Max retries exceeded', {
      eventId: eventId.substring(0, 20),
      attempts: state.attempts
    });
    // Mark as terminal
    await eventState.recordSent(eventId, { ok: false, status: 0 });
    return 'terminal';
  }

  if (state.next_retry_at) {
    var retryAt = new Date(state.next_retry_at).getTime();
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      await eventState.pushToRecoveryQueue(eventId, retryAt - Date.now());
      return 'skipped';
    }
  }

  // Retry the Meta CAPI send
  console.log('[Recovery] Retrying event', {
    eventId: eventId.substring(0, 20),
    eventName: state.event_name,
    attempt: (state.attempts || 0) + 1,
    previousDelayMs: state.retry_delay_ms || null,
    source: state.source
  });

  // Reconstruct event from stored payload (hashed user_data, no PII).
  // Falls back to minimal event if payload was not stored.
  var storedPayload = await eventState.getEventPayload(state.event_id);
  var recoveryUserData = storedPayload ? storedPayload.user_data : {};
  var recoveryCustomData = storedPayload ? storedPayload.custom_data : {};
  var recoverySourceUrl = storedPayload ? storedPayload.source_url : 'https://calqix.com/checkout';

  console.log('[Recovery] Replay payload', {
    eventId: eventId.substring(0, 20),
    hasStoredPayload: Boolean(storedPayload),
    hasEmail: Boolean(recoveryUserData.em),
    hasFbc: Boolean(recoveryUserData.fbc),
    hasFbp: Boolean(recoveryUserData.fbp),
    hasExternalId: Boolean(recoveryUserData.external_id),
    hasCountry: Boolean(recoveryUserData.country)
  });

  var metaResult = await sendEvent(
    state.event_name,
    state.event_id,
    recoverySourceUrl,
    recoveryUserData,
    recoveryCustomData
  );

  var updatedState = await eventState.recordSent(eventId, metaResult);

  if (updatedState && updatedState.state === eventState.STATES.CONFIRMED) {
    await eventState.recordRecovered(eventId);
    return 'retried';
  }

  // Still failing — recordSent already pushed back to queue if retryable
  return 'skipped';
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
