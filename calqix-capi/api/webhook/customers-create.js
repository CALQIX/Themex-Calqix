// MIGRATION NOTE: This endpoint is part of the custom Vercel CAPI.
// It will be replaced by GTM server container Meta CAPI tag after migration.
// Kill switch: set CAPI_ENABLED=false in env vars to disable without removing.
// Target migration date: TBD
const { isDuplicate, markProcessed } = require('../../lib/dedup-guard');
const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const eventState = require('../../lib/event-state');
const multiPlatform = require('../../lib/multi-platform-send');
const eventStats = require('../../lib/event-stats');
const {
  extractExternalId,
  extractMetaBrowserIds,
  mergeCustomerData,
  parseAndVerifyWebhook,
  respondOk
} = require('../../lib/webhook-utils');

const SOURCE_URL = 'https://www.calqix.com/account/register';

/**
 * Parse registration marker from customer.note and persist as metafields.
 *
 * The storefront registration form (templates/customers/register.liquid) captures optional
 * birthday + gender inputs into the customer's note field, prefixed with `CQ_PROFILE:` so
 * we can identify and strip the marker here. Format:
 *   CQ_PROFILE:birthday=2000-05-15;gender=male
 * Only recognised keys are persisted to metafields; everything else is ignored.
 *
 * This function is fire-and-forget: any failure is logged but does not block the Lead event.
 */
const CQ_PROFILE_PATTERN = /CQ_PROFILE:([^\n]*)/;
const ALLOWED_GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];

async function persistProfileMetafieldsFromNote(customer) {
  try {
    if (!customer || !customer.id || !customer.note) return;

    const match = customer.note.match(CQ_PROFILE_PATTERN);
    if (!match) return;

    const parts = String(match[1] || '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);

    const payload = {};
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      if (!key || !value) continue;

      if (key === 'birthday') {
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
        if (iso) payload.birthday = iso;
      } else if (key === 'gender') {
        const g = value.toLowerCase();
        if (ALLOWED_GENDERS.includes(g)) payload.gender = g;
      }
    }

    if (Object.keys(payload).length === 0) return;

    const store = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    if (!store || !token) {
      console.warn('[customers-create] profile metafield write skipped: missing shopify credentials');
      return;
    }

    const metafields = [];
    if (payload.birthday) {
      metafields.push({
        ownerId: `gid://shopify/Customer/${customer.id}`,
        namespace: 'calqix',
        key: 'birthday',
        type: 'date',
        value: payload.birthday
      });
    }
    if (payload.gender) {
      metafields.push({
        ownerId: `gid://shopify/Customer/${customer.id}`,
        namespace: 'calqix',
        key: 'gender',
        type: 'single_line_text_field',
        value: payload.gender
      });
    }

    // Also clear the marker from customer.note so it is not shown in admin going forward.
    const cleanedNote = customer.note.replace(CQ_PROFILE_PATTERN, '').trim();

    const metafieldsSet = `mutation Set($m: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $m) { userErrors { field message } }
    }`;
    const customerUpdate = `mutation Upd($id: ID!, $note: String!) {
      customerUpdate(input: { id: $id, note: $note }) { userErrors { field message } }
    }`;

    const gqlUri = `https://${store}/admin/api/2025-01/graphql.json`;
    const headers = {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    };

    const metafieldBody = JSON.stringify({
      query: metafieldsSet,
      variables: { m: metafields }
    });
    const mfRes = await fetch(gqlUri, { method: 'POST', headers, body: metafieldBody });
    const mfJson = await mfRes.json();
    if (mfJson.data && mfJson.data.metafieldsSet && mfJson.data.metafieldsSet.userErrors.length === 0) {
      console.log('[customers-create] profile metafields set', {
        customerId: customer.id,
        hasBirthday: !!payload.birthday,
        hasGender: !!payload.gender
      });
    } else {
      console.warn('[customers-create] metafieldsSet errors', mfJson.data && mfJson.data.metafieldsSet && mfJson.data.metafieldsSet.userErrors);
    }

    const noteBody = JSON.stringify({
      query: customerUpdate,
      variables: { id: `gid://shopify/Customer/${customer.id}`, note: cleanedNote }
    });
    await fetch(gqlUri, { method: 'POST', headers, body: noteBody });
  } catch (err) {
    console.warn('[customers-create] persistProfileMetafieldsFromNote failed', { message: err.message });
  }
}

function buildCustomerUserData(customer, fallbackIp, fallbackUserAgent) {
  const mergedCustomer = mergeCustomerData(
    customer,
    customer && customer.default_address,
    {
      email: customer && customer.email,
      phone:
        customer &&
        (customer.phone ||
          (customer.default_address && customer.default_address.phone)),
      first_name:
        customer &&
        (customer.first_name ||
          (customer.default_address && customer.default_address.first_name)),
      last_name:
        customer &&
        (customer.last_name ||
          (customer.default_address && customer.default_address.last_name)),
      city: customer && customer.default_address && customer.default_address.city,
      province_code:
        customer && customer.default_address && customer.default_address.province_code,
      zip: customer && customer.default_address && customer.default_address.zip,
      country_code:
        customer && customer.default_address && customer.default_address.country_code
    },
    extractMetaBrowserIds(customer),
    {
      external_id: extractExternalId(customer)
    }
  );

  return formatUserData(mergedCustomer, fallbackIp, fallbackUserAgent);
}

async function handler(req, res) {
  try {
    const verification = await parseAndVerifyWebhook(req);

    if (!verification.ok) {
      console.warn('[Webhook customers-create] ignored', {
        reason: verification.reason
      });
      return respondOk(res, { received: true, processed: false });
    }

    const customer = verification.payload || {};

    if (!customer.id) {
      console.warn('[Webhook customers-create] ignored', {
        reason: 'missing_customer_id'
      });
      return respondOk(res, { received: true, processed: false });
    }

    if (await isDuplicate('Lead', String(customer.id))) {
      console.log('[Webhook customers-create] skipping duplicate', { identifier: customer.id });
      return respondOk(res, { received: true, processed: false, reason: 'duplicate' });
    }

    const eventId = `lead_${customer.id}`;
    const userData = buildCustomerUserData(customer, verification.clientIp, verification.userAgent);
    const customData = {
      content_name: 'Customer Registration'
    };

    await eventState.recordReceived(eventId, 'Lead', 'webhook', String(customer.id));
    await eventStats.incrementEventStat('Lead', 'server');
    var metaResult = await sendEvent('Lead', eventId, SOURCE_URL, userData, customData);
    await eventState.recordSent(eventId, metaResult);
    await markProcessed('Lead', String(customer.id));

    // Persist optional profile fields (birthday + gender) captured via storefront note marker.
    // Intentionally not awaited — fire-and-forget so Lead response is not blocked on metafield writes.
    persistProfileMetafieldsFromNote(customer);

    // Multi-platform: Klaviyo (subscribe to list + event) + GA4 (non-blocking)
    try {
      await multiPlatform.sendLead({
        eventId: eventId,
        customData: customData,
        userData: {
          email: customer.email,
          phone: customer.phone || (customer.default_address && customer.default_address.phone),
          first_name: customer.first_name || (customer.default_address && customer.default_address.first_name),
          last_name: customer.last_name || (customer.default_address && customer.default_address.last_name),
          city: customer.default_address && customer.default_address.city,
          zip: customer.default_address && customer.default_address.zip,
          country_code: customer.default_address && customer.default_address.country_code,
          external_id: String(customer.id)
        },
        userId: String(customer.id)
      });
    } catch (e) { /* non-fatal */ }

    return respondOk(res, {
      received: true,
      processed: true,
      event: 'Lead',
      eventId
    });
  } catch (error) {
    console.error('[Webhook customers-create] internal error', {
      message: error.message
    });
    return respondOk(res, { received: true, processed: false });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
