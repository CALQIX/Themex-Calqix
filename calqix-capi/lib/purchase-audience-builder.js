/**
 * Purchase Audience Builder — reads Shopify orders and turns each unique
 * paying customer into a raw user object consumable by lib/meta-audiences.
 *
 * Only paid orders within the lookback window are included. The dedup key is
 * `customer.id` (Shopify GID) when present, with email fallback so guest
 * checkouts still surface.
 *
 * Output shape (one entry per unique customer):
 *   {
 *     email, phone,
 *     first_name, last_name,
 *     city, province_code, zip, country_code, birthday,
 *     external_id          // Shopify customer numeric id as string
 *   }
 */
var shopify = require('./shopify-admin');
var nlProvince = require('./nl-postcode-province');

var DEFAULT_LOOKBACK_DAYS = 180;
var DEFAULT_MAX_CUSTOMERS = 10000;        // matches Meta's single-batch cap
var PAGE_SIZE = 100;                      // Shopify GraphQL max first
var MAX_PAGES = 200;                      // safety cap: 200 * 100 = 20k orders

/**
 * @param {object} [options]
 * @param {number} [options.lookbackDays=180]
 * @param {number} [options.maxCustomers=10000]
 * @returns {Promise<{users: Array, stats: object}>}
 */
async function fetchPurchaseUsers(options) {
  var opts = options || {};
  var lookbackDays = opts.lookbackDays || DEFAULT_LOOKBACK_DAYS;
  var maxCustomers = opts.maxCustomers || DEFAULT_MAX_CUSTOMERS;

  var sinceDate = new Date(Date.now() - lookbackDays * 86400 * 1000);
  var sinceIso = sinceDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Shopify order search query: paid + created_at window.
  // financial_status:paid covers "paid", "partially_refunded". We intentionally
  // omit "refunded" so full-refund customers don't seed lookalikes.
  var orderQuery = 'financial_status:paid created_at:>=' + sinceIso;

  var gqlQuery = 'query($cursor: String, $q: String!) {\n' +
    '  orders(first: ' + PAGE_SIZE + ', after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {\n' +
    '    pageInfo { hasNextPage endCursor }\n' +
    '    edges {\n' +
    '      node {\n' +
    '        id\n' +
    '        email\n' +
    '        phone\n' +
    '        createdAt\n' +
    '        customer { id firstName lastName email phone birthday: metafield(namespace: "calqix", key: "birthday") { value } }\n' +
    '        billingAddress { firstName lastName city provinceCode zip countryCodeV2 phone }\n' +
    '        shippingAddress { firstName lastName city provinceCode zip countryCodeV2 phone }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '}';

  var cursor = null;
  var pagesFetched = 0;
  var ordersSeen = 0;
  var usersByKey = new Map();

  while (pagesFetched < MAX_PAGES && usersByKey.size < maxCustomers) {
    var resp = await shopify.graphql(gqlQuery, { cursor: cursor, q: orderQuery });
    pagesFetched++;

    var orders = (resp && resp.orders && resp.orders.edges) || [];
    for (var i = 0; i < orders.length; i++) {
      ordersSeen++;
      var order = orders[i].node;
      var user = normalizeOrderToUser(order);
      if (!user) continue;

      var key = user.external_id
        ? 'id:' + user.external_id
        : user.email
          ? 'em:' + user.email.toLowerCase().trim()
          : user.phone
            ? 'ph:' + user.phone.replace(/\D/g, '')
            : null;
      if (!key) continue;

      // First seen wins — orders are sorted CREATED_AT DESC, so the most
      // recent (likely richest) address is retained.
      if (!usersByKey.has(key)) {
        usersByKey.set(key, user);
      }

      if (usersByKey.size >= maxCustomers) break;
    }

    var pageInfo = resp && resp.orders && resp.orders.pageInfo;
    if (!pageInfo || !pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  var users = Array.from(usersByKey.values());

  return {
    users: users,
    stats: {
      lookback_days: lookbackDays,
      since: sinceIso,
      orders_scanned: ordersSeen,
      pages_fetched: pagesFetched,
      unique_users: users.length,
      hit_max: users.length >= maxCustomers
    }
  };
}

/**
 * Convert a Shopify order node into a unified user object.
 * Address precedence: shippingAddress > billingAddress > customer-level fields.
 */
function normalizeOrderToUser(order) {
  if (!order) return null;

  var customer = order.customer || {};
  var ship = order.shippingAddress || {};
  var bill = order.billingAddress || {};

  var email = customer.email || order.email || null;
  var phone = customer.phone || order.phone || ship.phone || bill.phone || null;

  var firstName = customer.firstName || ship.firstName || bill.firstName || null;
  var lastName = customer.lastName || ship.lastName || bill.lastName || null;

  var city = ship.city || bill.city || null;
  var zip = ship.zip || bill.zip || null;
  var countryCode = ship.countryCodeV2 || bill.countryCodeV2 || null;
  var provinceCode = ship.provinceCode || bill.provinceCode || null;
  if (!provinceCode && countryCode === 'NL' && zip) {
    provinceCode = nlProvince.lookup(zip);
  }
  var birthday = customer.birthday && customer.birthday.value ? customer.birthday.value : null;

  // Extract numeric id from GID (gid://shopify/Customer/1234567890 → 1234567890).
  var externalId = null;
  if (customer.id) {
    externalId = String(customer.id).split('/').pop();
  }

  // Drop rows with no match keys at all.
  if (!email && !phone && !externalId) return null;

  return {
    email: email,
    phone: phone,
    first_name: firstName,
    last_name: lastName,
    city: city,
    province_code: provinceCode,
    zip: zip,
    country_code: countryCode,
    birthday: birthday,
    external_id: externalId
  };
}

module.exports = {
  fetchPurchaseUsers: fetchPurchaseUsers,
  normalizeOrderToUser: normalizeOrderToUser,
  DEFAULT_LOOKBACK_DAYS: DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_CUSTOMERS: DEFAULT_MAX_CUSTOMERS
};
