/**
 * Meta Custom Audiences client — thin wrapper around the Graph API
 * `/{audience_id}/users` endpoint for uploading hashed user rows.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences
 *
 * Usage:
 *   var audiences = require('./meta-audiences');
 *   var rows = [
 *     { email: 'foo@bar.com', phone: '+31612345678', first_name: 'Foo', ... }
 *   ];
 *   var result = await audiences.addUsers(audienceId, rows);
 *   // → { ok, status, numReceived, invalidEntries, sessionId, traceId, error }
 *
 * Design notes:
 *   - We pre-hash all PII fields via lib/hash.js so the payload never contains
 *     raw identifiers. Meta accepts both hashed and unhashed; pre-hashing
 *     eliminates any ambiguity in transit.
 *   - EXTERN_ID is sent unhashed per Meta's spec (opaque to them, improves match).
 *   - Schema order in the payload MUST match the column order in each data row.
 *   - Single-batch upload: session.batch_seq=1, last_batch_flag=true. Volume cap
 *     MAX_USERS_PER_BATCH protects us from Meta's 10k row limit — CALQIX ships
 *     <1k Purchases per 180d, so this is defensive.
 */
var rlFetch = require('./rate-limited-fetch');
var hash = require('./hash');

var META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
var MAX_USERS_PER_BATCH = 10000;

// Schema column order used for every upload. Keep in sync with buildRow().
// Meta-recognized keys: https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences/#hash
var SCHEMA = ['EMAIL', 'PHONE', 'FN', 'LN', 'CT', 'ST', 'ZIP', 'COUNTRY', 'EXTERN_ID'];

/**
 * Build a single schema-ordered row of hashed values from a raw user object.
 * Returns null if the row contains zero match keys (would be rejected by Meta).
 */
function buildRow(user) {
  if (!user) return null;

  var email = hash.normalizeEmail(user.email);
  var phone = hash.normalizePhone(user.phone, user.country_code || user.countryCode);
  var fn = hash.normalizeText(user.first_name || user.firstName);
  var ln = hash.normalizeText(user.last_name || user.lastName);
  var ct = hash.normalizeText(user.city, { keepSpaces: false });
  var st = hash.normalizeText(user.province_code || user.provinceCode);
  var zp = hash.normalizeZip(user.zip || user.postal_code || user.postalCode);
  var country = hash.normalizeCountry(user.country_code || user.countryCode);
  var externalId = user.external_id || user.externalId;

  // Bail out if we have no match keys at all.
  if (!email && !phone && !externalId) return null;

  return [
    email ? hash.hash(email) : '',
    phone ? hash.hash(phone) : '',
    fn ? hash.hash(fn) : '',
    ln ? hash.hash(ln) : '',
    ct ? hash.hash(ct) : '',
    st ? hash.hash(st) : '',
    zp ? hash.hash(zp) : '',
    country ? hash.hash(country) : '',
    // EXTERN_ID stays unhashed — Meta uses it as an opaque correlation key.
    externalId ? String(externalId) : ''
  ];
}

/**
 * Upload users to a Meta Custom Audience (append semantics).
 *
 * @param {string} audienceId
 * @param {Array<object>} users — raw user objects (email, phone, first_name, ...)
 * @param {object} [options]
 * @param {string} [options.sessionId] — stable session id for QStash retries
 * @param {string} [options.accessToken] — override for META_ACCESS_TOKEN
 * @returns {Promise<{ok, status, numReceived, invalidEntries, sessionId, traceId, error, skipped, rowsSent}>}
 */
async function addUsers(audienceId, users, options) {
  return _sendUsers('POST', audienceId, users, options);
}

/**
 * Remove users from a Meta Custom Audience.
 */
async function removeUsers(audienceId, users, options) {
  return _sendUsers('DELETE', audienceId, users, options);
}

async function _sendUsers(method, audienceId, users, options) {
  var opts = options || {};
  var accessToken = (opts.accessToken || process.env.META_ACCESS_TOKEN || '').trim();
  audienceId = (audienceId || '').trim();

  if (!audienceId) {
    return { ok: false, error: 'audienceId ontbreekt', skipped: true, rowsSent: 0 };
  }
  if (!accessToken) {
    return { ok: false, error: 'META_ACCESS_TOKEN ontbreekt', skipped: true, rowsSent: 0 };
  }
  if (!Array.isArray(users) || users.length === 0) {
    return { ok: true, skipped: true, reason: 'geen rijen', rowsSent: 0 };
  }
  if (users.length > MAX_USERS_PER_BATCH) {
    return {
      ok: false,
      error: 'Batch te groot: ' + users.length + ' > ' + MAX_USERS_PER_BATCH,
      rowsSent: 0
    };
  }

  var rows = [];
  var dropped = 0;
  for (var i = 0; i < users.length; i++) {
    var row = buildRow(users[i]);
    if (row) rows.push(row); else dropped++;
  }
  if (rows.length === 0) {
    return { ok: true, skipped: true, reason: 'alle rijen ongeldig', rowsSent: 0, dropped: dropped };
  }

  var sessionId = opts.sessionId || ('cq_la_' + Date.now());
  var payload = {
    session: {
      session_id: sessionId,
      batch_seq: 1,
      last_batch_flag: true,
      estimated_num_total: rows.length
    },
    payload: {
      schema: SCHEMA,
      data: rows
    }
  };

  var url = 'https://graph.facebook.com/' + META_API_VERSION +
    '/' + audienceId + '/users' +
    '?access_token=' + encodeURIComponent(accessToken);

  var result = await rlFetch(url, {
    method: method,
    label: 'MetaAudience-' + method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 30000,
    maxRetries: 2
  });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      raw: result.data,
      sessionId: sessionId,
      rowsSent: 0,
      dropped: dropped
    };
  }

  var data = result.data || {};
  return {
    ok: true,
    status: result.status,
    numReceived: data.num_received !== undefined ? data.num_received : rows.length,
    numInvalidEntries: data.num_invalid_entries || 0,
    invalidEntrySamples: data.invalid_entry_samples || [],
    sessionId: sessionId,
    audienceId: data.audience_id || audienceId,
    rowsSent: rows.length,
    dropped: dropped
  };
}

/**
 * Read a Custom Audience's approximate count + delivery status.
 * Useful for bootstrap / health checks.
 */
async function describeAudience(audienceId, options) {
  var opts = options || {};
  var accessToken = (opts.accessToken || process.env.META_ACCESS_TOKEN || '').trim();
  audienceId = (audienceId || '').trim();
  if (!audienceId || !accessToken) {
    return { ok: false, error: 'audienceId of access token ontbreekt' };
  }

  var url = 'https://graph.facebook.com/' + META_API_VERSION +
    '/' + audienceId +
    '?fields=id,name,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,subtype,time_updated' +
    '&access_token=' + encodeURIComponent(accessToken);

  var result = await rlFetch(url, {
    method: 'GET',
    label: 'MetaAudience-Describe',
    timeout: 15000,
    maxRetries: 1
  });

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, raw: result.data };
  }
  return { ok: true, data: result.data };
}

module.exports = {
  SCHEMA: SCHEMA,
  MAX_USERS_PER_BATCH: MAX_USERS_PER_BATCH,
  buildRow: buildRow,
  addUsers: addUsers,
  removeUsers: removeUsers,
  describeAudience: describeAudience
};
