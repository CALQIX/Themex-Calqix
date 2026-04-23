/**
 * Catalog Sync Monitor — Meta Commerce catalog vs live Shopify variants.
 *
 * Schedule: daily 06:00 Amsterdam (calqix-catalog-sync)
 * Endpoint: /api/cron/catalog-sync-monitor
 *
 * Why this matters:
 *   AddToCart / Purchase events ship content_ids = [variant_id, sku].
 *   If the Meta Commerce catalog's retailer_id list does NOT contain the
 *   variant_id OR sku that the event references, Meta cannot match the
 *   event to a catalog product → Advantage+ Catalog Sales attribution
 *   silently fails for that variant. No da_check surfaces this; you only
 *   notice via flat DPA ROAS.
 *
 * This cron cross-references both sides and alerts on mismatches:
 *   - P1 Telegram alert if >10% of live variants are missing in the catalog
 *   - P2 (bundled) otherwise, so the daily report shows the list.
 *
 * Env:
 *   META_CATALOG_ID        — Meta Commerce catalog ID (required)
 *   META_ACCESS_TOKEN      — (already used by pixel-diag)
 *   SHOPIFY_STORE_DOMAIN   — (already used by shopify-admin)
 */
var store = require('../../lib/store');
var dates = require('../../lib/dates');
var rlFetch = require('../../lib/rate-limited-fetch');
var shopify = require('../../lib/shopify-admin');
var { sendTelegram } = require('../../lib/telegram');
var alertDedup = require('../../lib/alert-dedup');

var LOCK_KEY = 'cron:lock:catalog-sync';
var LOCK_TTL = 30 * 60;
var META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
var MAX_CATALOG_PAGES = 10;       // safety cap: 10 * 500 = 5k retailer_ids
var MAX_SHOPIFY_PRODUCTS = 250;   // CALQIX has <50 SKUs today, 250 is plenty
var ALERT_P1_MISMATCH_PCT = 10;   // >10% variants missing → P1 alert

module.exports = async function (req, res) {
  try {
    var secret = process.env.CRON_SECRET;
    var authHeader = req.headers['authorization'];
    var querySecret = req.query && req.query.secret;
    if (secret && authHeader !== 'Bearer ' + secret && querySecret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    var locked = await store.setnx ? await store.setnx(LOCK_KEY, '1', LOCK_TTL) : null;
    // Fallback: older store.js versions may not expose setnx — use set+check
    if (!locked) {
      var existing = await store.get(LOCK_KEY);
      if (existing) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'Lock actief' });
      }
      await store.set(LOCK_KEY, '1', LOCK_TTL);
    }

    try {
      var catalogId = process.env.META_CATALOG_ID;
      var accessToken = process.env.META_ACCESS_TOKEN;
      if (!catalogId || !accessToken) {
        return res.status(200).json({
          ok: false,
          skipped: true,
          reason: 'META_CATALOG_ID of META_ACCESS_TOKEN ontbreekt'
        });
      }

      // --- 1. Fetch all retailer_ids from Meta catalog (paginated) ---
      var retailerIds = new Set();
      var catalogNames = {};
      var nextUrl = 'https://graph.facebook.com/' + META_API_VERSION +
        '/' + catalogId + '/products' +
        '?fields=retailer_id,name' +
        '&limit=500' +
        '&access_token=' + encodeURIComponent(accessToken);

      var pages = 0;
      while (nextUrl && pages < MAX_CATALOG_PAGES) {
        var r = await rlFetch(nextUrl, {
          method: 'GET',
          label: 'CatalogSync-Meta',
          timeout: 15000,
          maxRetries: 1
        });
        if (!r.ok || !r.data) {
          return res.status(200).json({
            ok: false,
            error: 'Meta catalog fetch failed',
            status: r.status,
            raw: r.data
          });
        }
        var items = (r.data && r.data.data) || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].retailer_id) {
            retailerIds.add(String(items[i].retailer_id));
            if (items[i].name) catalogNames[items[i].retailer_id] = items[i].name;
          }
        }
        nextUrl = r.data && r.data.paging && r.data.paging.next ? r.data.paging.next : null;
        pages++;
      }

      // --- 2. Fetch all live Shopify variants (id + sku + handle) ---
      var shopifyVariants = [];
      var cursor = null;
      var pageCount = 0;
      while (pageCount < 5) { // up to 5 * 50 = 250 products
        var query = 'query($cursor: String) {\n' +
          '  products(first: 50, after: $cursor, query: "status:active") {\n' +
          '    pageInfo { hasNextPage endCursor }\n' +
          '    edges {\n' +
          '      node {\n' +
          '        id\n' +
          '        handle\n' +
          '        title\n' +
          '        variants(first: 20) {\n' +
          '          edges { node { id sku title } }\n' +
          '        }\n' +
          '      }\n' +
          '    }\n' +
          '  }\n' +
          '}';
        var shopResp = await shopify.graphql(query, { cursor: cursor });
        var products = (shopResp && shopResp.products && shopResp.products.edges) || [];
        for (var pi = 0; pi < products.length; pi++) {
          var prod = products[pi].node;
          var variants = (prod.variants && prod.variants.edges) || [];
          for (var vi = 0; vi < variants.length; vi++) {
            var v = variants[vi].node;
            var variantId = String(v.id).split('/').pop();
            shopifyVariants.push({
              variant_id: variantId,
              sku: v.sku || '',
              product_handle: prod.handle,
              product_title: prod.title,
              variant_title: v.title
            });
            if (shopifyVariants.length >= MAX_SHOPIFY_PRODUCTS) break;
          }
          if (shopifyVariants.length >= MAX_SHOPIFY_PRODUCTS) break;
        }
        var pageInfo = shopResp && shopResp.products && shopResp.products.pageInfo;
        if (!pageInfo || !pageInfo.hasNextPage) break;
        cursor = pageInfo.endCursor;
        pageCount++;
      }

      // --- 3. Cross-reference ---
      // A variant is considered "matched" if either its variant_id OR sku
      // appears as a retailer_id in the Meta catalog. This matches the
      // browser bridge + server behavior of sending both IDs.
      var missing = [];
      var matched = 0;
      for (var j = 0; j < shopifyVariants.length; j++) {
        var sv = shopifyVariants[j];
        var inCatalog = retailerIds.has(sv.variant_id) ||
          (sv.sku && retailerIds.has(sv.sku));
        if (inCatalog) {
          matched++;
        } else {
          missing.push(sv);
        }
      }

      var totalVariants = shopifyVariants.length;
      var mismatchPct = totalVariants > 0
        ? Math.round((missing.length / totalVariants) * 1000) / 10
        : 0;
      var matchRate = totalVariants > 0
        ? Math.round((matched / totalVariants) * 1000) / 10
        : 100;

      // --- 4. Persist daily snapshot ---
      var dayKey = 'catalog:sync:' + new Date().toISOString().slice(0, 10);
      var snapshot = {
        timestamp: dates.formatDateTimeAmsterdam(),
        catalog_id: catalogId,
        catalog_count: retailerIds.size,
        shopify_variant_count: totalVariants,
        matched: matched,
        missing_count: missing.length,
        mismatch_pct: mismatchPct,
        match_rate: matchRate,
        missing_sample: missing.slice(0, 20).map(function (m) {
          return {
            variant_id: m.variant_id,
            sku: m.sku,
            product_handle: m.product_handle,
            variant_title: m.variant_title
          };
        })
      };
      await store.set(dayKey, JSON.stringify(snapshot), 90 * 86400);

      // --- 5. Alert if mismatch too high ---
      var alertsSent = [];
      if (missing.length > 0) {
        var priority = mismatchPct >= ALERT_P1_MISMATCH_PCT ? 'P1' : 'P2';
        var alertResult = await alertDedup.shouldAlert(
          'catalog-sync-monitor',
          'meta',
          '*',
          'catalog_mismatch_' + Math.round(mismatchPct) + 'pct',
          priority
        );

        if (alertResult.send) {
          var sample = missing.slice(0, 5).map(function (m) {
            return '  • ' + (m.product_handle || '?') +
              ' (variant ' + m.variant_id + (m.sku ? ' / SKU ' + m.sku : '') + ')';
          }).join('\n');

          var msg = alertDedup.formatAlertPrefix(priority, alertResult.suppressed) +
            ' Catalog Mismatch\n\n' +
            missing.length + '/' + totalVariants + ' variants niet in Meta catalog (' + mismatchPct + '%)\n' +
            'Match rate: ' + matchRate + '%\n' +
            'Catalog entries: ' + retailerIds.size + '\n\n' +
            'Voorbeeld ontbrekend:\n' + sample + '\n\n' +
            'Fix: upload deze variant_ids of SKUs naar Meta Commerce catalog\n' +
            'Tijdstip: ' + dates.formatDateTimeAmsterdam();
          await sendTelegram(msg);
          alertsSent.push('catalog_mismatch');
        }
      }

      await store.del(LOCK_KEY);

      return res.status(200).json({
        ok: true,
        catalog_count: retailerIds.size,
        shopify_variant_count: totalVariants,
        matched: matched,
        missing: missing.length,
        mismatch_pct: mismatchPct,
        match_rate: matchRate,
        alerts_sent: alertsSent
      });

    } catch (err) {
      try { await store.del(LOCK_KEY); } catch (e) { /* ignore */ }
      throw err;
    }

  } catch (err) {
    console.error('[CatalogSync] Fout:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
