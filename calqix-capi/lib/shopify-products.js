/**
 * Shopify Products — fetches product data from Shopify Admin API with Redis caching.
 *
 * Env vars:
 *   SHOPIFY_STORE_DOMAIN          — e.g. calqix.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN    — Shopify Admin API token
 *
 * Redis key: shopify:products (TTL 6 hours)
 */
var fetch = require('node-fetch');
var store = require('./store');
var { sendTelegram } = require('./telegram');
var shopify = require('./shopify-admin');

var CACHE_KEY = 'shopify:products';
var CACHE_TTL = 6 * 3600; // 6 hours

var PRODUCT_MAP = {
  'toothpaste_tablets': 'calqix-flowcore',
  'water_flosser': 'calqix-flowcore',
  'FlowCore': 'calqix-flowcore',
  'oralbiome_pro': 'oralbiome-pro',
  'OralBiome': 'oralbiome-pro',
  'Bundle': null
};

function getStoreDomain() {
  return (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
}

/**
 * Fetch all products from Shopify Admin API (or Redis cache).
 */
async function getProducts() {
  // Check cache first
  var cached = await store.get(CACHE_KEY);
  if (cached) {
    try {
      var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (e) { /* cache corrupt, refetch */ }
  }

  try {
    var data = await shopify.rest('products.json?fields=id,title,handle,images,variants&limit=50');
    var products = (data.products || []).map(function (p) {
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        images: (p.images || []).map(function (img) { return img.src; }),
        price: p.variants && p.variants[0] ? p.variants[0].price : null
      };
    });

    await store.set(CACHE_KEY, JSON.stringify(products), CACHE_TTL);
    console.log('[ShopifyProducts] Cached', products.length, 'products');
    return products;
  } catch (err) {
    console.error('[ShopifyProducts] Fetch error:', err.message);
    return [];
  }
}

/**
 * Get image URLs for a product by its internal product name or handle.
 */
async function getProductImages(productName) {
  var handle = PRODUCT_MAP[productName] || productName;
  if (!handle) return [];

  var products = await getProducts();
  var product = products.find(function (p) { return p.handle === handle; });
  if (!product) return [];
  return product.images || [];
}

/**
 * Get full product data by handle.
 */
async function getProductByHandle(handle) {
  if (!handle) return null;
  var products = await getProducts();
  return products.find(function (p) { return p.handle === handle; }) || null;
}

/**
 * Resolve internal product name to Shopify handle.
 */
function resolveHandle(productName) {
  return PRODUCT_MAP[productName] || productName;
}

/**
 * Build a localized landing page URL with UTM parameters.
 * Format: https://www.calqix.com/{locale}/products/{handle}?utm_source=meta&utm_medium=paid&utm_campaign={campaign}&utm_content={adName}
 * @param {string} productName - internal product name or handle
 * @param {string} locale - 'nl' | 'de' | 'fr' | 'en'
 * @param {object} [utm] - { campaign, content, term }
 * @returns {string} full URL
 */
function buildLandingPageUrl(productName, locale, utm) {
  var handle = PRODUCT_MAP[productName] || productName;
  if (!handle) handle = 'calqix-flowcore'; // fallback

  var loc = locale || 'nl';
  // English is the default locale on Shopify, no prefix needed
  var prefix = loc === 'en' ? '' : '/' + loc;
  var base = 'https://www.calqix.com' + prefix + '/products/' + handle;

  var params = ['utm_source=meta', 'utm_medium=paid'];
  if (utm && utm.campaign) params.push('utm_campaign=' + encodeURIComponent(utm.campaign));
  if (utm && utm.content) params.push('utm_content=' + encodeURIComponent(utm.content));
  if (utm && utm.term) params.push('utm_term=' + encodeURIComponent(utm.term));

  return base + '?' + params.join('&');
}

/**
 * Verify that a localized product URL returns 200.
 * Caches result in Redis for 6 hours.
 * @param {string} handle - product handle
 * @param {string} locale - 'nl' | 'de' | 'fr' | 'en'
 * @returns {Promise<boolean>}
 */
async function verifyLocalizedUrl(handle, locale) {
  var cacheKey = 'shopify:url_check:' + locale + ':' + handle;
  var cached = await store.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'ok' || cached === true;
  }

  var prefix = (!locale || locale === 'en') ? '' : '/' + locale;
  var url = 'https://www.calqix.com' + prefix + '/products/' + handle;

  try {
    var res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    var ok = res.status >= 200 && res.status < 400;
    await store.set(cacheKey, ok ? 'ok' : 'missing', CACHE_TTL);

    if (!ok) {
      console.warn('[ShopifyProducts] Localized URL missing:', url, 'status:', res.status);
      // Alert via Telegram
      await sendTelegram(
        '\u26a0\ufe0f <b>Ontbrekende productpagina</b>\n\n' +
        'Product: ' + handle + '\n' +
        'Locale: ' + locale + '\n' +
        'URL: ' + url + '\n\n' +
        'Fallback naar standaard URL gebruikt.'
      ).catch(function () { /* non-critical */ });
    }
    return ok;
  } catch (err) {
    console.warn('[ShopifyProducts] URL check failed:', url, err.message);
    return true; // assume ok on network error to not block
  }
}

/**
 * Build landing page URL with verification.
 * Falls back to default locale if localized page is missing.
 * @param {string} productName
 * @param {string} locale
 * @param {object} [utm]
 * @returns {Promise<string>}
 */
async function buildVerifiedLandingPageUrl(productName, locale, utm) {
  var handle = PRODUCT_MAP[productName] || productName;
  if (!handle) handle = 'calqix-flowcore';

  var ok = await verifyLocalizedUrl(handle, locale);
  var effectiveLocale = ok ? locale : 'en';
  return buildLandingPageUrl(productName, effectiveLocale, utm);
}

module.exports = {
  getProducts: getProducts,
  getProductImages: getProductImages,
  getProductByHandle: getProductByHandle,
  resolveHandle: resolveHandle,
  buildLandingPageUrl: buildLandingPageUrl,
  verifyLocalizedUrl: verifyLocalizedUrl,
  buildVerifiedLandingPageUrl: buildVerifiedLandingPageUrl,
  PRODUCT_MAP: PRODUCT_MAP
};
