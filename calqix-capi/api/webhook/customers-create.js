const { formatUserData } = require('../../lib/hash');
const { sendEvent } = require('../../lib/meta-capi');
const {
  extractExternalId,
  mergeCustomerData,
  parseAndVerifyWebhook,
  respondOk
} = require('../../lib/webhook-utils');

const SOURCE_URL = 'https://calqix.com/account/register';

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

    const eventId = `lead_${customer.id}`;
    const userData = buildCustomerUserData(customer, verification.clientIp, verification.userAgent);
    const customData = {
      content_name: 'Customer Registration'
    };

    await sendEvent('Lead', eventId, SOURCE_URL, userData, customData);

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
