#!/usr/bin/env node
/**
 * Backfill recent real Shopify Purchase events to Meta CAPI.
 *
 * Safety rules:
 * - Only reads real paid Shopify orders.
 * - Defaults to dry-run. Use --live to send.
 * - Caps lookback at 7 days because website CAPI rejects older event_time.
 * - Uses the canonical purchase_{checkout_token} event_id format.
 * - Skips events already confirmed in Redis unless --resend-confirmed is set.
 */
require('dotenv').config();

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
var SOURCE_URL = 'https://www.calqix.com/checkout';
var MAX_WEBSITE_CAPI_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseArgs(argv) {
  var args = {
    live: false,
    lookback: 7,
    limit: 250,
    resendConfirmed: false
  };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--live') { args.live = true; continue; }
    if (argv[i] === '--dry') { args.live = false; continue; }
    if (argv[i] === '--resend-confirmed') { args.resendConfirmed = true; continue; }
    if (argv[i] === '--lookback' && argv[i + 1]) { args.lookback = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--limit' && argv[i + 1]) { args.limit = parseInt(argv[++i], 10); continue; }
  }
  if (!Number.isFinite(args.lookback) || args.lookback < 1) args.lookback = 1;
  if (args.lookback > 7) args.lookback = 7;
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 250;
  if (args.limit > 250) args.limit = 250;
  return args;
}

function getLineItemPrice(item) {
  return (
    toMoney(item && item.price) ??
    toMoney(item && item.price_set && item.price_set.shop_money && item.price_set.shop_money.amount) ??
    toMoney(item && item.original_price) ??
    toMoney(item && item.original_price_set && item.original_price_set.shop_money && item.original_price_set.shop_money.amount)
  );
}

function eventIdForOrder(order) {
  var checkoutToken = order.checkout_token || order.token;
  return checkoutToken ? 'purchase_' + checkoutToken : 'purchase_' + order.id;
}

function dedupKeyForOrder(order) {
  return order.checkout_token || order.token || String(order.id);
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

function buildCustomData(order) {
  var lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  return {
    value: toMoney(order.total_price),
    currency: order.currency || 'EUR',
    content_ids: extractContentIds(lineItems),
    content_type: resolveContentType(lineItems),
    contents: buildContents(lineItems, getLineItemPrice),
    num_items: countItems(lineItems),
    order_id: String(order.id),
    order_type: 'historical_purchase_backfill'
  };
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

async function sendMetaPurchase(order, userData, customData) {
  var pixelId = (process.env.META_PIXEL_ID || '').trim();
  var accessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  if (!pixelId || !accessToken) {
    return { ok: false, status: 0, error: 'META_PIXEL_ID or META_ACCESS_TOKEN missing' };
  }

  var eventTime = Math.floor(new Date(order.created_at).getTime() / 1000);
  var payload = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      event_id: eventIdForOrder(order),
      event_source_url: SOURCE_URL,
      action_source: 'website',
      user_data: userData,
      custom_data: customData
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

async function main() {
  var args = parseArgs(process.argv);
  var orders = await fetchOrders(args.lookback, args.limit);
  var nowSeconds = Math.floor(Date.now() / 1000);
  var stats = {
    mode: args.live ? 'live' : 'dry',
    lookback_days: args.lookback,
    orders_found: orders.length,
    sent: 0,
    skipped_confirmed: 0,
    skipped_too_old: 0,
    skipped_missing_match_data: 0,
    failed: 0,
    samples: []
  };

  for (var i = 0; i < orders.length; i++) {
    var order = orders[i];
    var eventId = eventIdForOrder(order);
    var eventTime = Math.floor(new Date(order.created_at).getTime() / 1000);
    var age = nowSeconds - eventTime;

    if (age > MAX_WEBSITE_CAPI_AGE_SECONDS) {
      stats.skipped_too_old++;
      continue;
    }

    if (!args.resendConfirmed && await eventState.isConfirmed(eventId)) {
      stats.skipped_confirmed++;
      continue;
    }

    var userData = buildOrderUserData(order);
    if (!userData.em && !userData.ph && !userData.external_id && !userData.fbp && !userData.fbc) {
      stats.skipped_missing_match_data++;
      continue;
    }

    var customData = buildCustomData(order);
    var sample = {
      order_id: String(order.id),
      event_id: eventId,
      created_at: order.created_at,
      value: customData.value,
      currency: customData.currency,
      has_email: Boolean(userData.em),
      has_phone: Boolean(userData.ph),
      has_external_id: Boolean(userData.external_id),
      has_fbp: Boolean(userData.fbp),
      has_fbc: Boolean(userData.fbc)
    };

    if (!args.live) {
      if (stats.samples.length < 10) stats.samples.push(Object.assign({ dry: true }, sample));
      continue;
    }

    await eventState.recordReceived(eventId, 'Purchase', 'historical_backfill', dedupKeyForOrder(order));
    await eventState.storeEventPayload(eventId, userData, customData, SOURCE_URL);
    await eventStats.incrementEventStat('Purchase', 'server');

    var result = await sendMetaPurchase(order, userData, customData);
    await eventState.recordSent(eventId, result);

    if (result && result.ok) {
      stats.sent++;
      if (stats.samples.length < 10) {
        stats.samples.push(Object.assign({
          meta_status: result.status,
          events_received: result.result && result.result.events_received
        }, sample));
      }
    } else {
      stats.failed++;
      if (stats.samples.length < 10) {
        stats.samples.push(Object.assign({
          meta_status: result && result.status,
          error: result && result.error
        }, sample));
      }
    }
  }

  console.log(JSON.stringify(stats, null, 2));

  if (stats.failed > 0) process.exitCode = 1;

  if (store && store._getRedis && store._getRedis()) {
    try { await store._getRedis().quit(); } catch (e) { /* ignore */ }
  }
}

main().catch(function (err) {
  console.error('[BackfillMetaPurchases] Fatal:', err.message);
  process.exit(1);
});
