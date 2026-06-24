const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();

const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
const DEFAULT_SOURCE_URL = 'https://www.calqix.com';

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .map(removeUndefined)
      .filter((item) => item !== undefined && item !== null);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      const cleanedValue = removeUndefined(nestedValue);

      if (cleanedValue !== undefined && cleanedValue !== null) {
        acc[key] = cleanedValue;
      }

      return acc;
    }, {});
  }

  return value === undefined ? undefined : value;
}

function normalizeEventTime(value) {
  if (value === undefined || value === null || value === '') {
    return Math.floor(Date.now() / 1000);
  }

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
    return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000);
}

function buildEvent(eventName, eventId, sourceUrl, userData = {}, customData = {}, options = {}) {
  const eventTime = normalizeEventTime(options.eventTime || options.event_time);
  return removeUndefined({
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    event_source_url: sourceUrl || DEFAULT_SOURCE_URL,
    action_source: 'website',
    user_data: userData,
    custom_data: customData
  });
}

function isCapiEnabled() {
  return process.env.CAPI_ENABLED !== 'false';
}

async function sendEvent(eventName, eventId, sourceUrl, userData = {}, customData = {}, options = {}) {
  const eventTime = normalizeEventTime(options.eventTime || options.event_time);
  if (!isCapiEnabled()) {
    console.log(`[META CAPI] ${eventName} logged (CAPI_ENABLED=false)`, {
      eventId,
      event_time: eventTime
    });
    return { ok: true, skipped: true, reason: 'CAPI_ENABLED=false' };
  }

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.error(`[META CAPI] ${eventName} skipped: missing META_PIXEL_ID or META_ACCESS_TOKEN`);
    return null;
  }

  const payload = {
    data: [buildEvent(eventName, eventId, sourceUrl, userData, customData, { eventTime })],
    access_token: accessToken
  };

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.error) {
      console.error(`[META CAPI] ${eventName} failed`, {
        status: response.status,
        errorType: result.error ? result.error.type : null,
        errorCode: result.error ? result.error.code : null,
        errorSubcode: result.error ? result.error.error_subcode : null,
        traceId: result.fbtrace_id || null,
        eventId
      });
      return { ok: false, status: response.status, result };
    }

    const eventsReceived = Number(result.events_received);
    if (!Number.isFinite(eventsReceived) || eventsReceived <= 0) {
      console.error(`[META CAPI] ${eventName} not accepted`, {
        eventId,
        status: response.status,
        traceId: result.fbtrace_id || null,
        eventsReceived: Number.isFinite(eventsReceived) ? eventsReceived : null
      });
      return { ok: false, status: response.status, result, reason: 'events_received_not_positive' };
    }

    console.log(`[META CAPI] ${eventName} sent`, {
      eventId,
      status: response.status,
      traceId: result.fbtrace_id || null,
      eventsReceived: eventsReceived,
      event_time: eventTime
    });

    return { ok: true, status: response.status, result };
  } catch (error) {
    console.error(`[META CAPI] ${eventName} failed`, {
      eventId,
      message: error.message
    });
    return { ok: false, status: 0, result: null, error: error.message };
  }
}

module.exports = {
  buildEvent,
  isCapiEnabled,
  normalizeEventTime,
  sendEvent,
  META_API_VERSION
};
