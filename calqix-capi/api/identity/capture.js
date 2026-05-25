/**
 * POST /api/identity/capture — Multi-key identity storage for EMQ enrichment.
 *
 * Called from browser bridge when user provides PII on checkout fields.
 * Stores identity data in Redis for later enrichment of server events.
 *
 * Redis keys written:
 *   identity:cart:{cart_token}       TTL 7d
 *   identity:email:{sha256_email}    TTL 30d
 *   identity:anon:{cq_anon_id}      TTL 90d
 *   identity:order:{order_id}        TTL 30d
 *
 * No raw PII is logged. Only hashed presence flags.
 */
var store = require('../../lib/store');
var hash = require('../../lib/hash');
var nlProvince = require('../../lib/nl-postcode-province');
var bridgeVersionTracker = require('../../lib/bridge-version-tracker');

var TTL_CART = 7 * 86400;
var TTL_EMAIL = 30 * 86400;
var TTL_ANON = 90 * 86400;
var TTL_ORDER = 30 * 86400;

module.exports = async function (req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    var body = req.body || {};

    if (body.bridge_version) {
      bridgeVersionTracker.recordVersion(body.bridge_version).catch(function () { /* non-critical */ });
    }

    var email = body.email ? body.email.toString().trim().toLowerCase() : null;
    var phone = body.phone || null;
    var firstName = body.first_name || body.firstName || null;
    var lastName = body.last_name || body.lastName || null;
    var city = body.city || null;
    var zip = body.zip || body.postal_code || null;
    var country = body.country_code || body.country || null;
    var province = body.province || body.province_code || null;
    var dateOfBirth = hash.normalizeDateOfBirth(body.db || body.birthday || body.birthdate || body.date_of_birth);
    var cartToken = body.cart_token || null;
    var anonId = body.anon_id || body.cq_anon_id || null;
    var orderId = body.order_id || null;
    var fbc = body.fbc || null;
    var fbp = body.fbp || null;
    var externalId = body.external_id || null;
    var gclid = body.gclid || null;
    var gbraid = body.gbraid || null;
    var wbraid = body.wbraid || null;
    var gaClientId = body.ga_client_id || body.client_id || null;
    var ttclid = body.ttclid || null;
    var ttp = body.ttp || null;

    // Auto-derive province from NL postcode if missing
    if (!province && country && country.toUpperCase() === 'NL' && zip) {
      province = nlProvince.lookup(zip);
    }

    // Build identity object (unhashed for storage, hashed on read for CAPI)
    var identity = {};
    if (email) identity.email = email;
    if (phone) identity.phone = phone;
    if (firstName) identity.fn = firstName;
    if (lastName) identity.ln = lastName;
    if (city) identity.ct = city;
    if (zip) identity.zp = zip;
    if (country) identity.country = country;
    if (province) identity.st = province;
    if (dateOfBirth) identity.db = dateOfBirth;
    if (fbc) identity.fbc = fbc;
    if (fbp) identity.fbp = fbp;
    if (externalId) identity.external_id = externalId;
    if (gclid) identity.gclid = gclid;
    if (gbraid) identity.gbraid = gbraid;
    if (wbraid) identity.wbraid = wbraid;
    if (gaClientId) identity.ga_client_id = gaClientId;
    if (ttclid) identity.ttclid = ttclid;
    if (ttp) identity.ttp = ttp;

    var keysWritten = 0;
    var identityJSON = JSON.stringify(identity);

    // Store by cart token
    if (cartToken) {
      await store.set('identity:cart:' + cartToken, identityJSON, TTL_CART);
      keysWritten++;
    }

    // Store by hashed email
    if (email) {
      var emailHash = hash.hash(email);
      await store.set('identity:email:' + emailHash, identityJSON, TTL_EMAIL);
      keysWritten++;
    }

    // Store by anon ID (links anonymous sessions to identity)
    if (anonId) {
      await store.set('identity:anon:' + anonId, identityJSON, TTL_ANON);
      keysWritten++;

      // Also persist the link between anon_id and email for warm identity lookup
      if (email) {
        await store.set('identity:link:' + anonId, email, TTL_ANON);
      }
    }

    // Store by order ID
    if (orderId) {
      await store.set('identity:order:' + orderId, identityJSON, TTL_ORDER);
      keysWritten++;
    }

    // Track capture volume for bridge health monitoring
    var captureCountKey = 'identity:capture:count:' + new Date().toISOString().slice(0, 13);
    try {
      var redis = store._getRedis();
      if (redis) {
        await redis.incr(captureCountKey);
        await redis.expire(captureCountKey, 8 * 86400);
      }
    } catch (e) { /* non-critical */ }

    console.log('[Identity] Captured', {
      keysWritten: keysWritten,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
      hasName: Boolean(firstName || lastName),
      hasAddress: Boolean(city || zip),
      hasProvince: Boolean(province),
      hasDateOfBirth: Boolean(dateOfBirth),
      hasClickIds: Boolean(gclid || ttclid)
    });

    return res.status(200).json({
      ok: true,
      keysWritten: keysWritten
    });

  } catch (err) {
    console.error('[Identity] Error:', err.message);
    return res.status(200).json({ ok: false, error: 'Internal error' });
  }
};
