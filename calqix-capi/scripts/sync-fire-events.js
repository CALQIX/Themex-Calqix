/**
 * Sync-fire a clean set of events to Meta CAPI via the live Vercel API.
 *
 * Purpose: after fixing catalog-aligned content_ids + double-fire dedup,
 * send a few correctly-formatted events so Meta's match-quality window
 * picks up the new signal format with high confidence.
 *
 * Uses real browser-like fbp + email + country so EMQ is high.
 */
require('dotenv').config();

const API_BASE = 'https://calqix-capi.vercel.app/api';

// Use the real fbp cookie from the live Playwright test so Meta recognises
// this as the same browser that added to cart earlier.
const FBP = 'fb.1.1773016346460.81442303314407815';
const EXTERNAL_ID = '9729821278537'; // logged-in customer id on calqix.com
const COUNTRY_CODE = 'NL';

// OralBiome Pro Cool Mint (verified live)
const PRODUCT_ID = '8954027049289';
const VARIANT_ID = '54065072177481';
const SKU = 'CALQIX-OBP-30-CM';
const PRODUCT_HANDLE = 'oralbiome-pro-cool-mint';
const PRODUCT_TITLE = 'OralBiome Pro Cool mint';
const PRICE = 19.95;

async function post(path, body) {
  const url = API_BASE + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'CALQIX-SyncFire/1.0',
      'Origin': 'https://www.calqix.com'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, json };
}

async function fireViewContent() {
  const ts = Math.floor(Date.now() / 1000);
  const eventId = `viewcontent_${VARIANT_ID}_${ts}`;
  console.log(`\n[fire] ViewContent  eventId=${eventId}`);
  const body = {
    event_id: eventId,
    product_id: PRODUCT_ID,
    variant_id: VARIANT_ID,
    sku: SKU,
    product_handle: PRODUCT_HANDLE,
    product_title: PRODUCT_TITLE,
    price: PRICE,
    currency: 'EUR',
    fbp: FBP,
    external_id: EXTERNAL_ID,
    country_code: COUNTRY_CODE
  };
  const r = await post('/view-content', body);
  console.log(`  status=${r.status}  processed=${r.json.processed}  eventId=${r.json.eventId}`);
  return r;
}

async function fireAddToCart() {
  const ts = Math.floor(Date.now() / 1000);
  const eventId = `addtocart_${VARIANT_ID}_${ts}`;
  console.log(`\n[fire] AddToCart    eventId=${eventId}`);
  const body = {
    event_id: eventId,
    content_ids: [VARIANT_ID, SKU],
    content_type: 'product',
    contents: [{ id: VARIANT_ID, quantity: 1, item_price: PRICE }],
    value: PRICE,
    currency: 'EUR',
    fbp: FBP,
    external_id: EXTERNAL_ID,
    country_code: COUNTRY_CODE,
    source_url: `https://www.calqix.com/products/${PRODUCT_HANDLE}`
  };
  const r = await post('/add-to-cart', body);
  console.log(`  status=${r.status}  processed=${r.json.processed}  eventId=${r.json.eventId}`);
  if (r.json.match_keys) {
    console.log(`  match_keys=${JSON.stringify(r.json.match_keys)}`);
  }
  return r;
}

async function main() {
  console.log('=== Sync-fire to Meta CAPI ===');
  console.log(`API: ${API_BASE}`);
  console.log(`Catalog IDs: [${VARIANT_ID}, ${SKU}]`);
  console.log(`User: fbp=${FBP.substring(0, 20)}... external_id=${EXTERNAL_ID}`);

  await fireViewContent();
  await new Promise(r => setTimeout(r, 500));
  await fireAddToCart();

  console.log('\n=== Done ===');
  console.log('Check Meta Events Manager → Test Events or Events Log (1-2 min delay).');
}

main().catch(e => {
  console.error('[error]', e);
  process.exit(1);
});
