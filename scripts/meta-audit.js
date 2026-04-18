#!/usr/bin/env node
/**
 * CALQIX — Meta CAPI deduplication audit.
 *
 * Pulls Meta Pixel stats + EMQ + Shopify orders count for the last 7 days
 * and writes META_AUDIT_REPORT.md at the repo root.
 *
 * Env vars required:
 *   META_SYSTEM_USER_TOKEN   Meta Business system user access token
 *   META_PIXEL_ID            934134615770602
 *   SHOPIFY_STORE_DOMAIN     calqix.myshopify.com
 *   SHOPIFY_ADMIN_API_TOKEN  Admin API access token (read_orders scope)
 *
 * Optional:
 *   META_API_VERSION         defaults to v20.0
 *   SHOPIFY_API_VERSION      defaults to 2025-01
 *   AUDIT_DAYS               defaults to 7
 *
 * Usage:
 *   node scripts/meta-audit.js
 *
 * Baseline captured 18 April 2026: total dedup coverage 58.79%, external_id 0% on browser,
 * fbp 0% on server. Target after Task 9 admin steps: >=95% total coverage within 48h.
 */

const fs = require('fs');
const path = require('path');

const META_TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const META_PIXEL_ID = process.env.META_PIXEL_ID || '934134615770602';
const META_API_VERSION = process.env.META_API_VERSION || 'v20.0';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN || 'calqix.myshopify.com';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

const AUDIT_DAYS = parseInt(process.env.AUDIT_DAYS || '7', 10);

const REPORT_PATH = path.resolve(__dirname, '..', 'META_AUDIT_REPORT.md');

function requireEnv() {
  const missing = [];
  if (!META_TOKEN) missing.push('META_SYSTEM_USER_TOKEN');
  if (!SHOPIFY_TOKEN) missing.push('SHOPIFY_ADMIN_API_TOKEN');
  if (missing.length > 0) {
    console.error('Missing env vars: ' + missing.join(', '));
    process.exit(1);
  }
}

function toIsoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function metaGet(pathWithQuery) {
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pathWithQuery}${sep}access_token=${encodeURIComponent(META_TOKEN)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Meta ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function getPixelHealth() {
  const fields = 'name,code,data_use_setting,last_fired_time,automatic_matching_fields,creation_time';
  return metaGet(`${META_PIXEL_ID}?fields=${fields}`);
}

async function getPixelStats() {
  // start_time / end_time as Unix seconds.
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - AUDIT_DAYS * 86400;
  // aggregation=event groups by event_name
  const query = `${META_PIXEL_ID}/stats?start_time=${startSec}&end_time=${endSec}&aggregation=event`;
  try {
    return await metaGet(query);
  } catch (e) {
    return { data: [], error: e.message };
  }
}

async function getConversionsApiStats() {
  try {
    return await metaGet(`${META_PIXEL_ID}?fields=conversions_api_stats`);
  } catch (e) {
    return { error: e.message };
  }
}

async function getShopifyOrdersCount() {
  const since = toIsoDaysAgo(AUDIT_DAYS);
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders/count.json?status=any&created_at_min=${encodeURIComponent(since)}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }
  });
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.count || 0;
}

function extractEventCount(stats, eventName) {
  if (!stats || !Array.isArray(stats.data)) return 0;
  let total = 0;
  for (const row of stats.data) {
    if (!row || !Array.isArray(row.data)) continue;
    for (const entry of row.data) {
      if (entry && entry.value && typeof entry.value.count === 'number') {
        if (!eventName || entry.value.event === eventName) total += entry.value.count;
      }
    }
  }
  return total;
}

function pct(numerator, denominator) {
  if (!denominator) return 'n/a';
  return ((numerator / denominator) * 100).toFixed(2) + '%';
}

function fmtTs(unixOrIso) {
  if (!unixOrIso) return 'n/a';
  if (typeof unixOrIso === 'number') return new Date(unixOrIso * 1000).toISOString();
  return unixOrIso;
}

async function main() {
  requireEnv();

  console.log(`[meta-audit] window: last ${AUDIT_DAYS} days`);

  const [pixel, stats, capiStats, shopifyOrders] = await Promise.all([
    getPixelHealth().catch((e) => ({ error: e.message })),
    getPixelStats().catch((e) => ({ data: [], error: e.message })),
    getConversionsApiStats().catch((e) => ({ error: e.message })),
    getShopifyOrdersCount().catch((e) => { throw e; })
  ]);

  const metaPurchase = extractEventCount(stats, 'Purchase');
  const metaInitiateCheckout = extractEventCount(stats, 'InitiateCheckout');
  const metaAddToCart = extractEventCount(stats, 'AddToCart');
  const metaViewContent = extractEventCount(stats, 'ViewContent');
  const metaPageView = extractEventCount(stats, 'PageView');

  const deltaPurchase = metaPurchase - shopifyOrders;
  const deltaPct = pct(Math.abs(deltaPurchase), shopifyOrders);

  const now = new Date().toISOString();

  const lines = [];
  lines.push(`# META_AUDIT_REPORT`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Window: last ${AUDIT_DAYS} days`);
  lines.push(`Meta Pixel ID: ${META_PIXEL_ID}`);
  lines.push(`Shopify store: ${SHOPIFY_STORE}`);
  lines.push('');
  lines.push(`## Pixel health`);
  lines.push('');
  if (pixel.error) {
    lines.push(`ERROR: ${pixel.error}`);
  } else {
    lines.push(`- name: ${pixel.name || 'n/a'}`);
    lines.push(`- data_use_setting: ${pixel.data_use_setting || 'n/a'}`);
    lines.push(`- last_fired_time: ${fmtTs(pixel.last_fired_time)}`);
    lines.push(`- automatic_matching_fields: ${(pixel.automatic_matching_fields || []).join(', ') || 'none'}`);
    lines.push(`- creation_time: ${fmtTs(pixel.creation_time)}`);
  }
  lines.push('');
  lines.push(`## Event counts (last ${AUDIT_DAYS} days)`);
  lines.push('');
  if (stats.error) {
    lines.push(`ERROR: ${stats.error}`);
  } else {
    lines.push('| Event | Count |');
    lines.push('| --- | ---: |');
    lines.push(`| PageView | ${metaPageView} |`);
    lines.push(`| ViewContent | ${metaViewContent} |`);
    lines.push(`| AddToCart | ${metaAddToCart} |`);
    lines.push(`| InitiateCheckout | ${metaInitiateCheckout} |`);
    lines.push(`| Purchase | ${metaPurchase} |`);
  }
  lines.push('');
  lines.push(`## Shopify orders vs Meta Purchase`);
  lines.push('');
  lines.push(`- Shopify orders (${AUDIT_DAYS}d): ${shopifyOrders}`);
  lines.push(`- Meta Purchase events (${AUDIT_DAYS}d): ${metaPurchase}`);
  lines.push(`- Delta: ${deltaPurchase} (${deltaPct})`);
  lines.push(`- Healthy threshold: delta <= 5%`);
  lines.push('');
  lines.push(`## Conversions API stats`);
  lines.push('');
  if (capiStats.error) {
    lines.push(`ERROR: ${capiStats.error}`);
  } else {
    lines.push('```json');
    lines.push(JSON.stringify(capiStats.conversions_api_stats || capiStats, null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push(`## Manual checks required in Meta Events Manager`);
  lines.push('');
  lines.push(`Open https://business.facebook.com/events_manager2/list/pixel/${META_PIXEL_ID}/overview and verify:`);
  lines.push('');
  lines.push(`- Overview: each event shows exactly one Browser source and one Server source.`);
  lines.push(`- Deduplication tab: Event ID coverage >= 95%, External ID >= 90% for logged-in, FBP >= 95% on server.`);
  lines.push(`- Event Match Quality: >= 9 for Purchase, InitiateCheckout, AddToCart.`);
  lines.push(`- Diagnostics: no new warnings related to duplicate events or mismatched event_ids.`);
  lines.push('');
  lines.push(`## Baseline for comparison (18 April 2026)`);
  lines.push('');
  lines.push('| Dedup key | Browser | Server | Coverage |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push('| Event ID | 16 (100%) | 18 (100%) | 58.79% |');
  lines.push('| External ID | 0 (0%) | 18 (100%) | 0% |');
  lines.push('| FBP | 16 (99.5%) | 0 (0%) | 0% |');
  lines.push('| Total coverage | | | 58.79% |');
  lines.push('');
  lines.push(`## Success criteria (target within 48 hours after admin steps in NOTES_ADMIN_TODO.md)`);
  lines.push('');
  lines.push(`- [ ] Event ID coverage >= 95%`);
  lines.push(`- [ ] External ID coverage >= 90% for logged-in sessions`);
  lines.push(`- [ ] FBP coverage >= 95% on server`);
  lines.push(`- [ ] Total dedup coverage >= 95% (Meta minimum: 75%)`);
  lines.push(`- [ ] Shopify orders vs Meta Purchase delta <= 5%`);
  lines.push(`- [ ] EMQ >= 9 for Purchase, InitiateCheckout, AddToCart`);
  lines.push(`- [ ] Overview shows exactly ONE browser source and ONE server source per event (no mystery third source)`);
  lines.push('');

  const out = lines.join('\n') + '\n';
  fs.writeFileSync(REPORT_PATH, out, 'utf8');
  console.log(`[meta-audit] report written to ${REPORT_PATH}`);
  console.log(`[meta-audit] summary: Shopify ${shopifyOrders} orders vs Meta ${metaPurchase} Purchase events, delta ${deltaPurchase}`);
}

main().catch((err) => {
  console.error('[meta-audit] fatal:', err.message);
  process.exit(1);
});
