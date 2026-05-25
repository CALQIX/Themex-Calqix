/**
 * Daily Reconciliation — matches Shopify orders against all platforms.
 *
 * Schedule: daily at 04:00 Amsterdam (calqix-reconciliation)
 * Endpoint: /api/cron/reconciliation
 *
 * Identifies data loss, value mismatches, platform-specific gaps.
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var { sendTelegram } = require('../../lib/telegram');
var shopify = require('../../lib/shopify-admin');
var insights = require('../../lib/meta-insights-source');

var LOCK_KEY = 'cron:lock:reconciliation';
var LOCK_TTL = 15 * 60;
// Alert threshold for Shopify↔Meta drift (% of Shopify order count).
var DRIFT_WARN_PCT = 10;
var DRIFT_ALERT_PCT = 25;

/**
 * Fetch yesterday's paid, non-test orders from Shopify Admin API.
 * Returns count and total value (after refunds/cancellations are excluded
 * by `financial_status:paid AND NOT status:cancelled`).
 * @param {string} dayIso - Amsterdam business day, YYYY-MM-DD
 * @param {string} nextDayIso - next Amsterdam business day, YYYY-MM-DD
 * @returns {Promise<{ok: boolean, orderCount: number, totalValue: number, currency: string, error: string|null}>}
 */
async function fetchShopifyOrdersForDay(dayIso, nextDayIso) {
  try {
    var search = 'financial_status:paid AND created_at:>=' + dayIso +
      ' AND created_at:<' + nextDayIso +
      ' AND test:false AND -status:cancelled';
    var query = 'query OrdersForReconciliation($query: String!, $cursor: String) {\n' +
      '  orders(first: 250, after: $cursor, query: $query) {\n' +
      '    edges { node { id totalPriceSet { shopMoney { amount currencyCode } } } }\n' +
      '    pageInfo { hasNextPage endCursor }\n' +
      '  }\n' +
      '}';

    var edges = [];
    var cursor = null;
    var page = 0;
    var hasNext = false;
    do {
      page++;
      var data = await shopify.graphql(query, { query: search, cursor: cursor });
      edges = edges.concat((data && data.orders && data.orders.edges) || []);
      hasNext = Boolean(data && data.orders && data.orders.pageInfo && data.orders.pageInfo.hasNextPage);
      cursor = data && data.orders && data.orders.pageInfo && data.orders.pageInfo.endCursor;
    } while (hasNext && cursor && page < 8);
    var total = 0;
    var currency = 'EUR';
    edges.forEach(function (e) {
      var money = e && e.node && e.node.totalPriceSet && e.node.totalPriceSet.shopMoney;
      if (money) {
        total += parseFloat(money.amount) || 0;
        if (money.currencyCode) currency = money.currencyCode;
      }
    });

    // Reconciliation is capped to eight Shopify pages for safety.
    return {
      ok: true,
      orderCount: edges.length,
      totalValue: Math.round(total * 100) / 100,
      currency: currency,
      truncated: Boolean(hasNext),
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      orderCount: 0,
      totalValue: 0,
      currency: 'EUR',
      truncated: false,
      error: err.message
    };
  }
}

/**
 * Fetch yesterday's Meta-attributed purchase count + revenue via Insights API.
 * Uses the pinned attribution windows from meta-insights-source for UI parity.
 * @param {string} dayIso - Amsterdam business day, YYYY-MM-DD
 * @returns {Promise<{ok: boolean, purchases: number, revenue: number, error: string|null}>}
 */
async function fetchMetaPurchasesForDay(dayIso) {
  var result = await insights.fetchAccountInsights(dayIso, dayIso, 'reconciliation_yesterday');
  if (!result.ok) {
    return { ok: false, purchases: 0, revenue: 0, error: (result.errors || []).join('; ') || 'unknown' };
  }
  return {
    ok: true,
    purchases: Math.round(result.funnel.purchases || 0),
    revenue: Math.round((result.funnel.revenue || 0) * 100) / 100,
    error: null
  };
}

/**
 * Compute signed drift percentage of value vs baseline.
 * @param {number} value
 * @param {number} baseline
 * @returns {number} drift pct, or 0 when baseline is 0
 */
function driftPct(value, baseline) {
  if (!baseline) return 0;
  return Math.round((value - baseline) / baseline * 1000) / 10;
}

function eventBelongsToAmsterdamDay(event, dayIso) {
  var stamp = event && (event.created_at || event.updated_at || event.last_attempt);
  if (!stamp) return false;
  var parsed = new Date(stamp);
  if (isNaN(parsed.getTime())) return false;
  return dates.toISODateAmsterdam(parsed) === dayIso;
}

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var locked = await store.setnx(LOCK_KEY, '1', LOCK_TTL);
    if (!locked) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
    }

    var redis = store._getRedis();
    if (!redis) {
      await store.del(LOCK_KEY);
      return res.status(200).json({ ok: true, skipped: true, reason: 'Redis niet beschikbaar' });
    }

    var todayIso = dates.toISODateAmsterdam();
    var dateIso = dates.addDaysISODateAmsterdam(todayIso, -1);
    var nextDateIso = dates.addDaysISODateAmsterdam(dateIso, 1);
    var dateKey = dates.isoToDisplay(dateIso);

    // Scan purchase events from the Amsterdam business day under audit.
    var platformCounts = {
      meta: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 },
      ga: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 },
      tt: { sent: 0, confirmed: 0, failed: 0, totalValue: 0 }
    };

    var orderIds = new Set();
    var mismatches = [];
    var cursor = '0';
    var scanned = 0;

    do {
      var scanResult = await redis.scan(cursor, { match: 'meta:event:purchase_*', count: 50 });
      cursor = scanResult[0];
      var keys = scanResult[1] || [];

      for (var i = 0; i < keys.length && scanned < 1000; i++) {
        scanned++;
        var raw = await redis.get(keys[i]);
        if (!raw) continue;

        var event = store.parseJsonValue(raw, null);
        if (!event) continue;

        if (event.event_name !== 'Purchase') continue;
        if (!eventBelongsToAmsterdamDay(event, dateIso)) continue;

        var eventId = event.event_id;
        if (event.shopify_id) orderIds.add(event.shopify_id);

        // Check Meta
        platformCounts.meta.sent++;
        if (event.state === 'confirmed' || event.state === 'recovered') {
          platformCounts.meta.confirmed++;
        } else if (event.state === 'failed_terminal') {
          platformCounts.meta.failed++;
        }

        // Check Google dedup key
        var gaDedup = await redis.get('processed:ga:' + eventId);
        if (gaDedup) {
          platformCounts.ga.sent++;
          platformCounts.ga.confirmed++;
        }

        // Check TikTok dedup key
        var ttDedup = await redis.get('processed:tt:' + eventId);
        if (ttDedup) {
          platformCounts.tt.sent++;
          platformCounts.tt.confirmed++;
        }

        // Detect platform gaps (event in Meta but not others)
        if (event.state === 'confirmed' && !gaDedup && process.env.GA4_ENABLED === 'true') {
          mismatches.push({ orderId: event.shopify_id, missing: 'Google', eventId: eventId });
        }
        if (event.state === 'confirmed' && !ttDedup && process.env.TIKTOK_ENABLED === 'true') {
          mismatches.push({ orderId: event.shopify_id, missing: 'TikTok', eventId: eventId });
        }
      }
    } while (cursor !== '0' && scanned < 1000);

    var internalPurchaseEvents = orderIds.size;

    // --- Shopify ↔ Meta drift check (yesterday) ---
    // Compares what Shopify says was truly sold (source of truth) vs what Meta
    // Insights reports as conversions. Detects:
    //   - Pixel/CAPI dedup failures (Meta > Shopify)
    //   - Missing CAPI events (Meta < Shopify)
    //   - Revenue attribution drift
    var shopifyRes = await fetchShopifyOrdersForDay(dateIso, nextDateIso);
    var metaRes = await fetchMetaPurchasesForDay(dateIso);

    var totalOrders = shopifyRes.ok ? shopifyRes.orderCount : internalPurchaseEvents;
    var matchRate = totalOrders > 0
      ? Math.round(platformCounts.meta.confirmed / totalOrders * 100)
      : 100;

    var shopifyMetaDrift = null;
    if (shopifyRes.ok && metaRes.ok) {
      shopifyMetaDrift = {
        shopifyOrders: shopifyRes.orderCount,
        shopifyRevenue: shopifyRes.totalValue,
        shopifyCurrency: shopifyRes.currency,
        shopifyTruncated: shopifyRes.truncated,
        metaPurchases: metaRes.purchases,
        metaRevenue: metaRes.revenue,
        orderDriftPct: driftPct(metaRes.purchases, shopifyRes.orderCount),
        revenueDriftPct: driftPct(metaRes.revenue, shopifyRes.totalValue)
      };
    }

    var result = {
      timestamp: dates.formatDateTimeAmsterdam(),
      date: dateKey,
      date_iso: dateIso,
      totalOrders: totalOrders,
      internalPurchaseEvents: internalPurchaseEvents,
      scanned: scanned,
      platforms: platformCounts,
      matchRate: matchRate,
      mismatches: mismatches.slice(0, 20),
      mismatchCount: mismatches.length,
      shopifyMetaDrift: shopifyMetaDrift,
      shopifyError: shopifyRes.ok ? null : shopifyRes.error,
      metaError: metaRes.ok ? null : metaRes.error
    };

    // Persist
    await store.set('reconciliation:' + dateKey, JSON.stringify(result), 30 * 86400);

    // Telegram summary
    var msg = '\uD83D\uDCCA Dagelijkse Reconciliation — ' + dateKey + '\n\n' +
      'Shopify orders: ' + totalOrders + ' | internal purchase events: ' + internalPurchaseEvents + '\n' +
      'Meta: ' + platformCounts.meta.confirmed + '/' + platformCounts.meta.sent + ' bevestigd';

    if (process.env.GA4_ENABLED === 'true') {
      msg += '\nGoogle: ' + platformCounts.ga.confirmed + ' matched';
    }
    if (process.env.TIKTOK_ENABLED === 'true') {
      msg += '\nTikTok: ' + platformCounts.tt.confirmed + ' matched';
    }

    msg += '\nMatch rate: ' + matchRate + '%';
    if (mismatches.length > 0) {
      msg += '\nMismatches: ' + mismatches.length + ' events missen op 1+ platform';
    }
    msg += '\n\nStatus: ' + (matchRate >= 99 ? '\uD83D\uDFE2' : matchRate >= 95 ? '\uD83D\uDFE1' : '\uD83D\uDD34');

    // --- Shopify ↔ Meta drift section ---
    if (shopifyMetaDrift) {
      var absOrderDrift = Math.abs(shopifyMetaDrift.orderDriftPct);
      var absRevenueDrift = Math.abs(shopifyMetaDrift.revenueDriftPct);
      var driftIcon = '\uD83D\uDFE2';
      if (absOrderDrift >= DRIFT_ALERT_PCT || absRevenueDrift >= DRIFT_ALERT_PCT) {
        driftIcon = '\uD83D\uDD34';
      } else if (absOrderDrift >= DRIFT_WARN_PCT || absRevenueDrift >= DRIFT_WARN_PCT) {
        driftIcon = '\uD83D\uDFE1';
      }

      msg += '\n\nShopify ↔ Meta ' + driftIcon + '\n' +
        'Shopify orders: ' + shopifyMetaDrift.shopifyOrders +
          ' | ' + shopifyMetaDrift.shopifyCurrency + ' ' + shopifyMetaDrift.shopifyRevenue.toFixed(2) + '\n' +
        'Meta purchases: ' + shopifyMetaDrift.metaPurchases +
          ' | EUR ' + shopifyMetaDrift.metaRevenue.toFixed(2) + '\n' +
        'Drift orders: ' + (shopifyMetaDrift.orderDriftPct >= 0 ? '+' : '') + shopifyMetaDrift.orderDriftPct + '%' +
        ' | revenue: ' + (shopifyMetaDrift.revenueDriftPct >= 0 ? '+' : '') + shopifyMetaDrift.revenueDriftPct + '%';

      if (shopifyMetaDrift.shopifyTruncated) {
        msg += '\n(Shopify result truncated — >250 orders/day, contact dev)';
      }
      if (absOrderDrift >= DRIFT_WARN_PCT) {
        msg += '\nHint: +drift = Meta counts too many (dedup fail). -drift = CAPI events missing.';
      }
    } else {
      if (!shopifyRes.ok) msg += '\n\nShopify API error: ' + shopifyRes.error;
      if (!metaRes.ok) msg += '\nMeta Insights error: ' + metaRes.error;
    }

    await sendTelegram(msg);

    await store.del(LOCK_KEY);

    return res.status(200).json({ ok: true, result: result });

  } catch (err) {
    console.error('[Reconciliation] Fout:', err.message);
    try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: false, error: err.message });
  }
};
