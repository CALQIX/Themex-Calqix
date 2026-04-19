/*
 * Klaviyo REST API client — revision 2024-10-15
 *
 * Scope: profile upsert, list subscription, event tracking, list/flow reads.
 * Full flow-message CRUD is NOT exposed because Klaviyo's flow structure API
 * is version-fragile. Flow *content* (subject + HTML + personalization) is
 * editable via `updateTemplate()`; flow *graph* changes happen in Klaviyo UI.
 *
 * Auth: Authorization: Klaviyo-API-Key <KLAVIYO_PRIVATE_API_KEY>
 * Rate limits: Klaviyo returns 429 with Retry-After; we back off up to 3 times.
 *
 * Env:
 *  - KLAVIYO_PRIVATE_API_KEY  (required — private `pk_*` key)
 *  - KLAVIYO_PUBLIC_API_KEY   (optional — 6-char public key for onsite forms)
 *  - KLAVIYO_REVISION         (optional — defaults to 2024-10-15)
 *  - KLAVIYO_ENABLED          (optional — set to "false" to short-circuit)
 */

const fetch = require('node-fetch');

const BASE = 'https://a.klaviyo.com/api';
const DEFAULT_REVISION = '2024-10-15';
const MAX_RETRIES = 3;

function isEnabled() {
  return process.env.KLAVIYO_ENABLED !== 'false';
}

function apiKey() {
  return process.env.KLAVIYO_PRIVATE_API_KEY || '';
}

function revision() {
  return process.env.KLAVIYO_REVISION || DEFAULT_REVISION;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return key.slice(0, 2) + '***';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey()}`,
    revision: revision(),
    accept: 'application/vnd.api+json',
    'content-type': 'application/vnd.api+json',
    ...extra
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, body, { retries = MAX_RETRIES } = {}) {
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: 'KLAVIYO_ENABLED=false' };
  }
  if (!apiKey()) {
    return { ok: false, status: 0, error: 'missing KLAVIYO_PRIVATE_API_KEY' };
  }

  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const init = {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  };

  let attempt = 0;
  while (true) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt > retries) {
        return { ok: false, status: 0, error: `network: ${err.message}` };
      }
      await sleep(500 * attempt);
      continue;
    }

    const text = await res.text();
    const json = text ? safeJson(text) : null;

    if (res.status === 429 && attempt <= retries) {
      const retryAfter = Number(res.headers.get('retry-after')) || attempt;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.ok) {
      return { ok: true, status: res.status, data: json };
    }

    if (res.status >= 500 && attempt <= retries) {
      await sleep(500 * attempt);
      continue;
    }

    return {
      ok: false,
      status: res.status,
      error: json && json.errors ? json.errors : text,
      data: json
    };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

/* ───────────────────────── Profiles ───────────────────────── */

/**
 * Upsert a profile by email (preferred) or phone_number or external_id.
 * Returns the Klaviyo profile id on success. Idempotent.
 *
 * @param {object} profile
 *   { email, phone_number, external_id, first_name, last_name,
 *     organization, title, image, location: {...},
 *     properties: { locale, country, ... } }
 */
async function upsertProfile(profile = {}) {
  const attrs = {};
  if (profile.email) attrs.email = profile.email.trim().toLowerCase();
  if (profile.phone_number) attrs.phone_number = profile.phone_number;
  if (profile.external_id) attrs.external_id = String(profile.external_id);
  if (profile.first_name) attrs.first_name = profile.first_name;
  if (profile.last_name) attrs.last_name = profile.last_name;
  if (profile.organization) attrs.organization = profile.organization;
  if (profile.title) attrs.title = profile.title;
  if (profile.image) attrs.image = profile.image;
  if (profile.location) attrs.location = profile.location;
  if (profile.properties) attrs.properties = profile.properties;

  if (!attrs.email && !attrs.phone_number && !attrs.external_id) {
    return { ok: false, status: 0, error: 'upsertProfile requires email, phone_number, or external_id' };
  }

  const body = {
    data: {
      type: 'profile',
      attributes: attrs
    }
  };

  // Klaviyo "Create or Update Profile" endpoint (idempotent on email/phone/external_id)
  return request('POST', '/profile-import/', body);
}

/* ───────────────────────── Lists & Subscriptions ───────────────────────── */

async function listLists({ pageSize = 50 } = {}) {
  return request('GET', `/lists/?page[size]=${pageSize}&fields[list]=name,created,updated`);
}

async function createList(name) {
  return request('POST', '/lists/', {
    data: { type: 'list', attributes: { name } }
  });
}

/**
 * Subscribe profile(s) to a list with explicit consent (double-opt-in recommended).
 * Klaviyo returns 202 Accepted — processing is async.
 *
 * @param {string} listId
 * @param {Array<{email?:string, phone_number?:string, consent?:boolean}>} profiles
 * @param {{ consentMethod?: string, listSource?: string }} options
 */
async function subscribeToList(listId, profiles, options = {}) {
  if (!listId) return { ok: false, status: 0, error: 'subscribeToList requires listId' };
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { ok: false, status: 0, error: 'subscribeToList requires non-empty profiles array' };
  }

  const consentMethod = options.consentMethod || 'Form';
  const consentedAt = new Date().toISOString();

  const profileData = profiles.map((p) => {
    const subscriptions = { email: { marketing: { consent: 'SUBSCRIBED' } } };
    if (p.phone_number) {
      subscriptions.sms = { marketing: { consent: 'SUBSCRIBED' } };
    }
    return {
      type: 'profile',
      attributes: {
        email: p.email ? p.email.trim().toLowerCase() : undefined,
        phone_number: p.phone_number || undefined,
        subscriptions
      }
    };
  });

  const body = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: { data: profileData },
        custom_source: options.listSource || 'calqix-capi',
        historical_import: false
      },
      relationships: {
        list: { data: { type: 'list', id: listId } }
      }
    }
  };

  return request('POST', '/profile-subscription-bulk-create-jobs/', body);
}

/* ───────────────────────── Events ───────────────────────── */

/**
 * Track a server-side event. Klaviyo event-based flow triggers fire on this.
 *
 * @param {string} metricName  e.g. 'Placed Order', 'Started Checkout', 'Viewed Product'
 * @param {object} profile     { email?, phone_number?, external_id?, ...attrs }
 * @param {object} properties  arbitrary custom data (line items, value, currency, etc.)
 * @param {{ value?: number, value_currency?: string, unique_id?: string, time?: string }} opts
 */
async function trackEvent(metricName, profile, properties = {}, opts = {}) {
  if (!metricName) return { ok: false, status: 0, error: 'trackEvent requires metricName' };

  const profileAttributes = {};
  if (profile.email) profileAttributes.email = profile.email.trim().toLowerCase();
  if (profile.phone_number) profileAttributes.phone_number = profile.phone_number;
  if (profile.external_id) profileAttributes.external_id = String(profile.external_id);
  if (profile.first_name) profileAttributes.first_name = profile.first_name;
  if (profile.last_name) profileAttributes.last_name = profile.last_name;
  if (profile.properties) profileAttributes.properties = profile.properties;

  if (!profileAttributes.email && !profileAttributes.phone_number && !profileAttributes.external_id) {
    return { ok: false, status: 0, error: 'trackEvent profile requires email, phone_number, or external_id' };
  }

  const attrs = {
    properties,
    metric: {
      data: {
        type: 'metric',
        attributes: { name: metricName }
      }
    },
    profile: {
      data: {
        type: 'profile',
        attributes: profileAttributes
      }
    }
  };

  if (opts.value !== undefined && opts.value !== null) attrs.value = Number(opts.value);
  if (opts.value_currency) attrs.value_currency = opts.value_currency;
  if (opts.unique_id) attrs.unique_id = opts.unique_id;
  if (opts.time) attrs.time = opts.time;

  const body = {
    data: {
      type: 'event',
      attributes: attrs
    }
  };

  return request('POST', '/events/', body);
}

/* ───────────────────────── Flows & Templates (read + content-only write) ───────────────────────── */

async function listFlows({ pageSize = 50 } = {}) {
  return request(
    'GET',
    `/flows/?page[size]=${pageSize}&fields[flow]=name,status,created,updated,trigger_type`
  );
}

async function getFlow(flowId) {
  return request('GET', `/flows/${flowId}/?include=flow-actions`);
}

async function listTemplates({ pageSize = 100 } = {}) {
  return request(
    'GET',
    `/templates/?page[size]=${pageSize}&fields[template]=name,editor_type,created,updated`
  );
}

async function getTemplate(templateId) {
  return request('GET', `/templates/${templateId}/`);
}

async function updateTemplate(templateId, { name, html, text } = {}) {
  if (!templateId) return { ok: false, status: 0, error: 'updateTemplate requires templateId' };
  const attrs = {};
  if (name) attrs.name = name;
  if (html !== undefined) attrs.html = html;
  if (text !== undefined) attrs.text = text;

  const body = {
    data: {
      type: 'template',
      id: templateId,
      attributes: attrs
    }
  };

  return request('PATCH', `/templates/${templateId}/`, body);
}

async function createTemplate({ name, html, editor_type = 'CODE' }) {
  if (!name || !html) return { ok: false, status: 0, error: 'createTemplate requires name + html' };
  const body = {
    data: {
      type: 'template',
      attributes: { name, html, editor_type }
    }
  };
  return request('POST', '/templates/', body);
}

/* ───────────────────────── Health / diagnostics ───────────────────────── */

async function ping() {
  if (!isEnabled()) return { ok: true, skipped: true };
  if (!apiKey()) return { ok: false, error: 'missing KLAVIYO_PRIVATE_API_KEY' };
  const res = await request('GET', '/accounts/');
  return {
    ok: res.ok,
    status: res.status,
    key: maskKey(apiKey()),
    revision: revision(),
    data: res.ok && res.data && res.data.data ? res.data.data[0] : null,
    error: res.ok ? null : res.error
  };
}

module.exports = {
  isEnabled,
  ping,
  upsertProfile,
  listLists,
  createList,
  subscribeToList,
  trackEvent,
  listFlows,
  getFlow,
  listTemplates,
  getTemplate,
  updateTemplate,
  createTemplate
};
