/**
 * Lead (newsletter / lightweight signup) — receives browser-side Lead events
 * from the theme bridge when a visitor submits a newsletter or lead-magnet form.
 *
 * Event ID strategy (deterministic dedup with webhook customers-create):
 *   - Browser-origin Lead (this endpoint):   lead_ns_{sha256(email).slice(0,16)}
 *   - Full-account Lead (customers-create):  lead_{customer_id}
 *
 * These use DIFFERENT prefixes on purpose — a newsletter capture that does NOT
 * create a Shopify customer account must not accidentally dedupe against a
 * later full-account registration that DOES create a customer. Meta sees
 * newsletter Lead + registration Lead as separate touch points (which is
 * correct: they represent different funnel stages).
 *
 * The browser-side fbq('track', 'Lead', ..., { eventID }) on the theme uses
 * the SAME lead_ns_{emailHash} id, giving perfect 1:1 browser↔server dedup
 * for each newsletter capture.
 */
const crypto = require('crypto');
const { formatUserData } = require('../lib/hash');
const { sendEvent } = require('../lib/meta-capi');
const { isDuplicate, markProcessed } = require('../lib/dedup-guard');
const eventState = require('../lib/event-state');
const bridgeVersionTracker = require('../lib/bridge-version-tracker');

const ALLOWED_ORIGINS = ['https://calqix.com', 'https://www.calqix.com'];
const SOURCE_URL_BASE = 'https://www.calqix.com/';

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function emailHashShort(email) {
  var norm = normalizeEmail(email);
  if (!norm) return '';
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

async function handler(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  res.setHeader(
    'Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : 'https://www.calqix.com'
  );
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    if (body.bridge_version) {
      bridgeVersionTracker.recordVersion(body.bridge_version).catch(function () { /* non-critical */ });
    }

    const email = normalizeEmail(body.email);

    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    const emailHash = emailHashShort(email);
    const eventId = body.event_id || ('lead_ns_' + emailHash);
    const formContext = body.form_context || 'newsletter';
    const sourceUrl = body.source_url || SOURCE_URL_BASE;

    // Dedup on emailHash so accidental double-submits within TTL collapse.
    if (await isDuplicate('Lead', emailHash)) {
      console.log('[Lead] duplicate suppressed', { emailHash, eventId });
      return res.status(200).json({
        received: true,
        processed: false,
        reason: 'duplicate',
        eventId
      });
    }

    const customerData = { email };
    if (body.fbc) customerData.fbc = body.fbc;
    if (body.fbp) customerData.fbp = body.fbp;
    if (body.phone) customerData.phone = body.phone;
    if (body.external_id) customerData.external_id = body.external_id;
    if (body.country_code) customerData.country_code = body.country_code;
    if (body.first_name) customerData.first_name = body.first_name;
    if (body.last_name) customerData.last_name = body.last_name;

    const clientIp =
      (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
      (req.socket && req.socket.remoteAddress) ||
      undefined;
    const clientUserAgent = (req.headers && req.headers['user-agent']) || undefined;

    const userData = formatUserData(customerData, clientIp, clientUserAgent);

    const customData = {
      content_name: formContext === 'newsletter' ? 'Newsletter Signup' : 'Lead Capture',
      content_category: formContext
    };

    console.log('[Lead] browser-origin Lead', {
      eventId,
      formContext,
      hasFbc: Boolean(userData.fbc),
      hasFbp: Boolean(userData.fbp),
      hasEmail: Boolean(userData.em),
      hasPhone: Boolean(userData.ph),
      hasExternalId: Boolean(userData.external_id),
      hasIp: Boolean(userData.client_ip_address),
      hasUa: Boolean(userData.client_user_agent)
    });

    await eventState.recordReceived(eventId, 'Lead', 'browser_bridge', emailHash);
    const result = await sendEvent('Lead', eventId, sourceUrl, userData, customData);
    await eventState.recordSent(eventId, result);
    await markProcessed('Lead', emailHash);

    return res.status(200).json({
      received: true,
      processed: Boolean(result && result.ok),
      event: 'Lead',
      eventId,
      match_keys: {
        fbc: Boolean(userData.fbc),
        fbp: Boolean(userData.fbp),
        em: Boolean(userData.em),
        ph: Boolean(userData.ph),
        ip: Boolean(userData.client_ip_address),
        ua: Boolean(userData.client_user_agent)
      }
    });
  } catch (error) {
    console.error('[Lead] internal error', { message: error.message });
    return res.status(200).json({ received: true, processed: false });
  }
}

module.exports = handler;
