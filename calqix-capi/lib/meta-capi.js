const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const DEFAULT_SOURCE_URL = 'https://calqix.com';

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

function buildEvent(eventName, eventId, sourceUrl, userData = {}, customData = {}) {
  return removeUndefined({
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
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

async function sendEvent(eventName, eventId, sourceUrl, userData = {}, customData = {}) {
  if (!isCapiEnabled()) {
    console.log(`[META CAPI] ${eventName} logged (CAPI_ENABLED=false)`, {
      eventId,
      event_time: Math.floor(Date.now() / 1000)
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
    data: [buildEvent(eventName, eventId, sourceUrl, userData, customData)],
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
        message: result.error ? result.error.message : 'Unknown Meta API error',
        eventId
      });
      return { ok: false, status: response.status, result };
    }

    console.log(`[META CAPI] ${eventName} sent`, {
      eventId,
      status: response.status,
      traceId: result.fbtrace_id || null,
      eventsReceived: result.events_received || null
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
  sendEvent,
  META_API_VERSION
};
