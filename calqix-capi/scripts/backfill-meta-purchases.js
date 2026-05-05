#!/usr/bin/env node
/**
 * Backfill real/reconstructable Shopify funnel events to Meta CAPI.
 *
 * Safety rules:
 * - Defaults to dry-run. Use --live to send.
 * - Caps website CAPI lookback at 7 days; older events are skipped.
 * - Uses real Shopify timestamps and deterministic event IDs.
 * - Never fabricates purchases or leads.
 * - ViewContent/AddToCart/PageView are marked as reconstructed because Shopify
 *   does not retain browser event logs historically.
 */
require('dotenv').config();

var crypto = require('crypto');
var fetch = require('node-fetch');
var shopify = require('../lib/shopify-admin');
var store = require('../lib/store');
var eventState = require('../lib/event-state');
var eventStats = require('../lib/event-stats');
var { formatUserData } = require('../lib/hash');
var {
  buildContents,
  countItems,
  extractContentIds,
  extractExternalId,
  extractMetaBrowserIds,
  mergeCustomerData,
  resolveContentType,
  toMoney
} = require('../lib/webhook-utils');

var META_API_VERSION = process.env.META_API_VERSION || 'v22.0';
var SHOP_URL = 'https://www.calqix.com';
var CHECKOUT_SOURCE_URL = SHOP_URL + '/checkout';
var REGISTER_SOURCE_URL = SHOP_URL + '/account/register';
var MAX_WEBSITE_CAPI_AGE_SECONDS = 7 * 24 * 60 * 60;

var EVENT_ALIASES = {
  purchase: 'Purchase',
  purchases: 'Purchase',
  ic: 'InitiateCheckout',
  initiatecheckout: 'InitiateCheckout',
  checkout: 'InitiateCheckout',
  atc: 'AddToCart',
  addtocart: 'AddToCart',
  vc: 'ViewContent',
  viewcontent: 'ViewContent',
  lead: 'Lead',
  leads: 'Lead',
  pageview: 'PageView',
  pv: 'PageView'
};

var DEFAULT_EVENTS = ['Purchase', 'InitiateCheckout', 'AddToCart', 'ViewContent', 'Lead', 'PageView'];

function parseArgs(argv) {
  var args = {
    live: false,
    lookback: 7,
    limit: 250,
    resendConfirmed: false,
    events: DEFAULT_EVENTS.slice()
  };

  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--live') { args.live = true; continue; }
    if (argv[i] === '--dry') { args.live = false; continue; }
    if (argv[i] === '--resend-confirmed') { args.resendConfirmed = true; continue; }
    if (argv[i] === '--lookback' && argv[i + 1]) { args.lookback = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--limit' && argv[i + 1]) { args.limit = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--events' && argv[i + 1]) {
      var raw = String(argv[++i]).split(',').map(function (v) { return v.trim().toLowerCase(); }).filter(Boolean);
      if (raw.indexOf('all') !== -1) {
        args.events = DEFAULT_EVENTS.slice();
      } else {
        args.events = raw.map(function (name) { return EVENT_ALIASES[name]; }).filter(Boolean);
      }
      continue;
    }
  }

  if (!Number.isFinite(args.lookback) || args.lookback < 1) args.lookback = 1;
  if (args.lookback > 7) args.lookback = 7;
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 250;
  if (args.limit > 250) args.limit = 250;
  args.events = Array.from(new Set(args.events));
  return args;
}

function getLineItemPrice(item) {
  return (
    toMoney(item && item.price) ??
    toMoney(item && item.line_price) ??
    toMoney(item && item.price_set && item.price_set.shop_money && item.price_set.shop_money.amount) ??
    toMoney(item && item.original_price) ??
    toMoney(item && item.original_price_set && item.original_price_set.shop_money && item.original_price_set.shop_money.amount)
  );
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function secondsFromIso(value) {
  var ms = new Date(value || Date.now()).getTime();
  return Math.floor(ms / 1000);
}

function sourceUrlFromPath(path) {
  if (!path) return SHOP_URL + '/';
  var str = String(path);
  if (/^https?:\/\//i.test(str)) return str;
  if (str.charAt(0) !== '/') str = '/' + str;
  return SHOP_URL + str;
}

function productHandleFromLandingSite(path) {
  if (!path) return '';
  var pathname = String(path).split('?')[0];
  var match = pathname.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : '';
}

function eventIdForOrder(order) {
  var checkoutToken = order.checkout_token || order.token;
  return checkoutToken ? 'purchase_' + checkoutToken : 'purchase_' + order.id;
}

function checkoutKey(payload) {
  return payload && (payload.checkout_token || payload.token || payload.cart_token || payload.checkout_id || payload.id);
}

function eventKey(payload) {
  return checkoutKey(payload) || (payload && payload.id) || stableHash(JSON.stringify(payload || {}));
}

function buildOrderUserData(order) {
  var mergedCustomer = mergeCustomerData(
    order && order.customer,
    order && order.customer && order.customer.default_address,
    order && order.billing_address,
    order && order.shipping_address,
    {
      email: order && (order.email || order.contact_email),
      phone:
        order &&
        (order.phone ||
          (order.billing_address && order.billing_address.phone) ||
          (order.shipping_address && order.shipping_address.phone) ||
          (order.customer && order.customer.phone)),
      first_name:
        order &&
        ((order.customer && order.customer.first_name) ||
          (order.billing_address && order.billing_address.first_name) ||
          (order.shipping_address && order.shipping_address.first_name)),
      last_name:
        order &&
        ((order.customer && order.customer.last_name) ||
          (order.billing_address && order.billing_address.last_name) ||
          (order.shipping_address && order.shipping_address.last_name)),
      city:
        order &&
        ((order.billing_address && order.billing_address.city) ||
          (order.shipping_address && order.shipping_address.city)),
      province_code:
        order &&
        ((order.billing_address && order.billing_address.province_code) ||
          (order.shipping_address && order.shipping_address.province_code)),
      zip:
        order &&
        ((order.billing_address && order.billing_address.zip) ||
          (order.shipping_address && order.shipping_address.zip)),
      country_code:
        order &&
        ((order.billing_address && order.billing_address.country_code) ||
          (order.shipping_address && order.shipping_address.country_code) ||
          (order.customer &&
            order.customer.default_address &&
            order.customer.default_address.country_code))
    },
    extractMetaBrowserIds(order),
    { external_id: extractExternalId(order) }
  );

  var clientIp =
    (order && order.client_details && order.client_details.browser_ip) ||
    order.browser_ip;
  var clientUserAgent =
    (order && order.client_details && order.client_details.user_agent) ||
    order.user_agent;

  return formatUserData(mergedCustomer, clientIp, clientUserAgent);
}

function buildCheckoutUserData(checkout) {
  var mergedCustomer = mergeCustomerData(
    checkout && checkout.customer,
    checkout && checkout.customer && checkout.customer.default_address,
    checkout && checkout.billing_address,
    checkout && checkout.shipping_address,
    {
      email: checkout && checkout.email,
      phone:
        checkout &&
        (checkout.phone ||
          (checkout.billing_address && checkout.billing_address.phone) ||
          (checkout.shipping_address && checkout.shipping_address.phone) ||
          (checkout.customer && checkout.customer.phone)),
      first_name:
        checkout &&
        ((checkout.customer && checkout.customer.first_name) ||
          (checkout.billing_address && checkout.billing_address.first_name) ||
          (checkout.shipping_address && checkout.shipping_address.first_name)),
      last_name:
        checkout &&
        ((checkout.customer && checkout.customer.last_name) ||
          (checkout.billing_address && checkout.billing_address.last_name) ||
          (checkout.shipping_address && checkout.shipping_address.last_name)),
      city:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.city) ||
          (checkout.shipping_address && checkout.shipping_address.city)),
      province_code:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.province_code) ||
          (checkout.shipping_address && checkout.shipping_address.province_code)),
      zip:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.zip) ||
          (checkout.shipping_address && checkout.shipping_address.zip)),
      country_code:
        checkout &&
        ((checkout.billing_address && checkout.billing_address.country_code) ||
          (checkout.shipping_address && checkout.shipping_address.country_code) ||
          (checkout.customer &&
            checkout.customer.default_address &&
            checkout.customer.default_address.country_code))
    },
    extractMetaBrowserIds(checkout),
    { external_id: extractExternalId(checkout) }
  );

  return formatUserData(mergedCustomer);
}

function buildCustomerUserData(customer) {
  var mergedCustomer = mergeCustomerData(
    customer,
    customer && customer.default_address,
    {
      email: customer && customer.email,
      phone: customer && (customer.phone || (customer.default_address && customer.default_address.phone)),
      first_name: customer && (customer.first_name || (customer.default_address && customer.default_address.first_name)),
      last_name: customer && (customer.last_name || (customer.default_address && customer.default_address.last_name)),
      city: customer && customer.default_address && customer.default_address.city,
      province_code: customer && customer.default_address && customer.default_address.province_code,
      zip: customer && customer.default_address && customer.default_address.zip,
      country_code: customer && customer.default_address && customer.default_address.country_code,
      external_id: customer && customer.id
    }
  );
  return formatUserData(mergedCustomer);
}

function buildCommerceCustomData(payload, extra) {
  var lineItems = Array.isArray(payload && payload.line_items) ? payload.line_items : [];
  return Object.assign({
    value: toMoney(payload && (payload.total_price || payload.current_total_price || payload.subtotal_price)),
    currency: (payload && (payload.currency || payload.presentment_currency)) || 'EUR',
    content_ids: extractContentIds(lineItems),
    content_type: resolveContentType(lineItems),
    contents: buildContents(lineItems, getLineItemPrice),
    num_items: countItems(lineItems)
  }, extra || {});
}

function buildSingleProductData(item, payload, handle) {
  var ids = extractContentIds([item]);
  return {
    content_ids: ids,
    content_type: resolveContentType([item]),
    content_name: (item && (item.title || item.presentment_title || item.name)) || undefined,
    content_category: handle ? 'landing_product' : 'purchased_product',
    value: getLineItemPrice(item),
    currency: (payload && (payload.currency || payload.presentment_currency)) || 'EUR'
  };
}

function hasMatchData(userData) {
  return Boolean(
    userData &&
    (userData.em || userData.ph || userData.external_id || userData.fbp || userData.fbc ||
      userData.client_ip_address || userData.client_user_agent)
  );
}

async function fetchOrders(lookback, limit) {
  var since = new Date(Date.now() - lookback * 86400 * 1000).toISOString();
  var endpoint = 'orders.json?status=any&financial_status=paid&limit=' + limit +
    '&created_at_min=' + encodeURIComponent(since);
  var data = await shopify.rest(endpoint);
  var orders = (data && data.orders) || [];
  return orders.filter(function (order) {
    if (!order || !order.id) return false;
    if (order.test) return false;
    if (order.cancelled_at) return false;
    return String(order.financial_status || '').toLowerCase() === 'paid';
  });
}

async function fetchCheckouts(lookback, limit) {
  var since = new Date(Date.now() - lookback * 86400 * 1000).toISOString();
  var endpoint = 'checkouts.json?limit=' + limit + '&created_at_min=' + encodeURIComponent(since);
  var data = await shopify.rest(endpoint).catch(function () { return { checkouts: [] }; });
  return (data && data.checkouts) || [];
}

async function fetchCustomers(lookback, limit) {
  var since = new Date(Date.now() - lookback * 86400 * 1000).toISOString();
  var endpoint = 'customers.json?limit=' + limit + '&created_at_min=' + encodeURIComponent(since);
  var data = await shopify.rest(endpoint).catch(function () { return { customers: [] }; });
  return (data && data.customers) || [];
}

function buildEventsFromOrder(order, selected) {
  var out = [];
  var key = eventKey(order);
  var userData = buildOrderUserData(order);
  var createdAt = order.created_at || order.processed_at || new Date().toISOString();
  var lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  var landingHandle = productHandleFromLandingSite(order.landing_site);
  var landingUrl = sourceUrlFromPath(order.landing_site || '/');

  if (selected.has('Purchase')) {
    out.push({
      event_name: 'Purchase',
      event_id: eventIdForOrder(order),
      event_time: secondsFromIso(createdAt),
      source_url: CHECKOUT_SOURCE_URL,
      user_data: userData,
      custom_data: buildCommerceCustomData(order, {
        order_id: String(order.id),
        order_type: 'historical_purchase_backfill'
      }),
      source: 'shopify_order',
      canonical: true
    });
  }

  if (selected.has('InitiateCheckout')) {
    out.push({
      event_name: 'InitiateCheckout',
      event_id: 'ic_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: CHECKOUT_SOURCE_URL,
      user_data: userData,
      custom_data: buildCommerceCustomData(order, { source: 'historical_order_backfill' }),
      source: 'shopify_order',
      reconstructed: true
    });
  }

  if (selected.has('AddToCart')) {
    out.push({
      event_name: 'AddToCart',
      event_id: 'atc_backfill_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: SHOP_URL + '/cart',
      user_data: userData,
      custom_data: buildCommerceCustomData(order, { source: 'historical_order_backfill' }),
      source: 'shopify_order',
      reconstructed: true
    });
  }

  if (selected.has('ViewContent')) {
    var vcItem = landingHandle
      ? lineItems.find(function (item) {
        return String(item.title || item.presentment_title || '').toLowerCase().replace(/\s+/g, '-').indexOf(landingHandle) !== -1;
      }) || lineItems[0]
      : lineItems[0];
    if (vcItem) {
      out.push({
        event_name: 'ViewContent',
        event_id: 'vc_backfill_' + key + '_' + stableHash(landingHandle || vcItem.variant_id || vcItem.product_id || vcItem.sku),
        event_time: secondsFromIso(createdAt),
        source_url: landingHandle ? landingUrl : SHOP_URL + '/products/',
        user_data: userData,
        custom_data: buildSingleProductData(vcItem, order, landingHandle),
        source: 'shopify_order',
        reconstructed: true
      });
    }
  }

  if (selected.has('PageView') && order.landing_site) {
    out.push({
      event_name: 'PageView',
      event_id: 'pv_backfill_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: landingUrl,
      user_data: userData,
      custom_data: { source: 'historical_order_landing_site' },
      source: 'shopify_order',
      reconstructed: true
    });
  }

  return out;
}

function buildEventsFromCheckout(checkout, selected) {
  var out = [];
  var key = eventKey(checkout);
  var userData = buildCheckoutUserData(checkout);
  var createdAt = checkout.created_at || checkout.updated_at || new Date().toISOString();
  var lineItems = Array.isArray(checkout.line_items) ? checkout.line_items : [];
  var landingHandle = productHandleFromLandingSite(checkout.landing_site);
  var landingUrl = sourceUrlFromPath(checkout.landing_site || '/');

  if (selected.has('InitiateCheckout')) {
    out.push({
      event_name: 'InitiateCheckout',
      event_id: 'ic_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: checkout.abandoned_checkout_url || CHECKOUT_SOURCE_URL,
      user_data: userData,
      custom_data: buildCommerceCustomData(checkout, { source: 'historical_checkout_backfill' }),
      source: 'shopify_checkout',
      canonical: true
    });
  }

  if (selected.has('AddToCart')) {
    out.push({
      event_name: 'AddToCart',
      event_id: 'atc_backfill_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: SHOP_URL + '/cart',
      user_data: userData,
      custom_data: buildCommerceCustomData(checkout, { source: 'historical_checkout_backfill' }),
      source: 'shopify_checkout',
      reconstructed: true
    });
  }

  if (selected.has('ViewContent') && lineItems[0]) {
    out.push({
      event_name: 'ViewContent',
      event_id: 'vc_backfill_' + key + '_' + stableHash(landingHandle || lineItems[0].variant_id || lineItems[0].product_id || lineItems[0].sku),
      event_time: secondsFromIso(createdAt),
      source_url: landingHandle ? landingUrl : SHOP_URL + '/products/',
      user_data: userData,
      custom_data: buildSingleProductData(lineItems[0], checkout, landingHandle),
      source: 'shopify_checkout',
      reconstructed: true
    });
  }

  if (selected.has('PageView') && checkout.landing_site) {
    out.push({
      event_name: 'PageView',
      event_id: 'pv_backfill_' + key,
      event_time: secondsFromIso(createdAt),
      source_url: landingUrl,
      user_data: userData,
      custom_data: { source: 'historical_checkout_landing_site' },
      source: 'shopify_checkout',
      reconstructed: true
    });
  }

  return out;
}

function buildEventsFromCustomer(customer, selected) {
  if (!selected.has('Lead')) return [];
  var userData = buildCustomerUserData(customer);
  return [{
    event_name: 'Lead',
    event_id: 'lead_' + customer.id,
    event_time: secondsFromIso(customer.created_at || customer.updated_at || new Date().toISOString()),
    source_url: REGISTER_SOURCE_URL,
    user_data: userData,
    custom_data: { content_name: 'Customer Registration' },
    source: 'shopify_customer',
    canonical: true
  }];
}

async function sendMetaEvent(event) {
  var pixelId = (process.env.META_PIXEL_ID || '').trim();
  var accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!pixelId || !accessToken) {
    return { ok: false, status: 0, error: 'META_PIXEL_ID or META_ACCESS_TOKEN missing' };
  }

  var payload = {
    data: [{
      event_name: event.event_name,
      event_time: event.event_time,
      event_id: event.event_id,
      event_source_url: event.source_url || SHOP_URL,
      action_source: 'website',
      user_data: event.user_data || {},
      custom_data: event.custom_data || {}
    }],
    access_token: accessToken
  };

  var response = await fetch('https://graph.facebook.com/' + META_API_VERSION + '/' + pixelId + '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var result = await response.json().catch(function () { return {}; });
  if (!response.ok || result.error) {
    return {
      ok: false,
      status: response.status,
      result: result,
      error: result.error ? result.error.message : 'Unknown Meta API error'
    };
  }
  return { ok: true, status: response.status, result: result };
}

function increment(stats, name, key) {
  stats.by_event[name] = stats.by_event[name] || {
    prepared: 0,
    sent: 0,
    skipped_confirmed: 0,
    skipped_too_old: 0,
    skipped_missing_match_data: 0,
    failed: 0,
    reconstructed: 0
  };
  stats.by_event[name][key]++;
}

function makeSample(event, extra) {
  return Object.assign({
    event_name: event.event_name,
    event_id: event.event_id,
    source: event.source,
    reconstructed: Boolean(event.reconstructed),
    event_time: new Date(event.event_time * 1000).toISOString(),
    value: event.custom_data && event.custom_data.value,
    currency: event.custom_data && event.custom_data.currency,
    content_ids: event.custom_data && event.custom_data.content_ids ? event.custom_data.content_ids.length : undefined,
    has_email: Boolean(event.user_data && event.user_data.em),
    has_phone: Boolean(event.user_data && event.user_data.ph),
    has_external_id: Boolean(event.user_data && event.user_data.external_id),
    has_fbp: Boolean(event.user_data && event.user_data.fbp),
    has_fbc: Boolean(event.user_data && event.user_data.fbc)
  }, extra || {});
}

async function main() {
  var args = parseArgs(process.argv);
  var selected = new Set(args.events);
  var nowSeconds = Math.floor(Date.now() / 1000);
  var stats = {
    mode: args.live ? 'live' : 'dry',
    lookback_days: args.lookback,
    requested_events: args.events,
    source_counts: {},
    by_event: {},
    totals: {
      prepared: 0,
      sent: 0,
      skipped_confirmed: 0,
      skipped_too_old: 0,
      skipped_missing_match_data: 0,
      failed: 0
    },
    notes: [
      'Website CAPI backfill is capped at 7 days.',
      'ViewContent/AddToCart/PageView are reconstructed from Shopify landing/order/checkout records, not raw browser logs.'
    ],
    samples: []
  };

  var orders = selected.has('Purchase') || selected.has('InitiateCheckout') || selected.has('AddToCart') || selected.has('ViewContent') || selected.has('PageView')
    ? await fetchOrders(args.lookback, args.limit)
    : [];
  var checkouts = selected.has('InitiateCheckout') || selected.has('AddToCart') || selected.has('ViewContent') || selected.has('PageView')
    ? await fetchCheckouts(args.lookback, args.limit)
    : [];
  var customers = selected.has('Lead') ? await fetchCustomers(args.lookback, args.limit) : [];

  stats.source_counts = {
    paid_orders: orders.length,
    checkouts: checkouts.length,
    customers: customers.length
  };

  var events = [];
  orders.forEach(function (order) { events = events.concat(buildEventsFromOrder(order, selected)); });
  checkouts.forEach(function (checkout) { events = events.concat(buildEventsFromCheckout(checkout, selected)); });
  customers.forEach(function (customer) { events = events.concat(buildEventsFromCustomer(customer, selected)); });

  var seen = new Set();
  events = events.filter(function (event) {
    var key = event.event_name + ':' + event.event_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    increment(stats, event.event_name, 'prepared');
    stats.totals.prepared++;
    if (event.reconstructed) increment(stats, event.event_name, 'reconstructed');

    if ((nowSeconds - event.event_time) > MAX_WEBSITE_CAPI_AGE_SECONDS) {
      increment(stats, event.event_name, 'skipped_too_old');
      stats.totals.skipped_too_old++;
      continue;
    }

    if (!hasMatchData(event.user_data)) {
      increment(stats, event.event_name, 'skipped_missing_match_data');
      stats.totals.skipped_missing_match_data++;
      continue;
    }

    if (!args.resendConfirmed && await eventState.isConfirmed(event.event_id)) {
      increment(stats, event.event_name, 'skipped_confirmed');
      stats.totals.skipped_confirmed++;
      continue;
    }

    if (!args.live) {
      if (stats.samples.length < 15) stats.samples.push(makeSample(event, { dry: true }));
      continue;
    }

    await eventState.recordReceived(event.event_id, event.event_name, 'historical_backfill', event.event_id);
    await eventState.storeEventPayload(event.event_id, event.user_data, event.custom_data, event.source_url);
    await eventStats.incrementEventStat(event.event_name, 'server');

    var result = await sendMetaEvent(event);
    await eventState.recordSent(event.event_id, result);

    if (result && result.ok) {
      increment(stats, event.event_name, 'sent');
      stats.totals.sent++;
      if (stats.samples.length < 15) {
        stats.samples.push(makeSample(event, {
          meta_status: result.status,
          events_received: result.result && result.result.events_received
        }));
      }
    } else {
      increment(stats, event.event_name, 'failed');
      stats.totals.failed++;
      if (stats.samples.length < 15) {
        stats.samples.push(makeSample(event, {
          meta_status: result && result.status,
          error: result && result.error
        }));
      }
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  if (stats.totals.failed > 0) process.exitCode = 1;

  if (store && store._getRedis && store._getRedis()) {
    try { await store._getRedis().quit(); } catch (e) { /* ignore */ }
  }
}

main().catch(function (err) {
  console.error('[BackfillMetaEvents] Fatal:', err.message);
  process.exit(1);
});
