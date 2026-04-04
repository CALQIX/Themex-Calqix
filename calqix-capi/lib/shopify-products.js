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
  return process.env.SHOPIFY_STORE_DOMAIN || '';
}

function getAdminToken() {
  return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
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

  var domain = getStoreDomain();
  var token = getAdminToken();
  if (!domain || !token) {
    console.warn('[ShopifyProducts] SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN not set');
    return [];
  }

  var url = 'https://' + domain + '/admin/api/2024-10/products.json?fields=id,title,handle,images,variants&limit=50';

  try {
    var res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': token }
    });

    if (!res.ok) {
      console.error('[ShopifyProducts] API error:', res.status, res.statusText);
      return [];
    }

    var data = await res.json();
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

module.exports = {
  getProducts: getProducts,
  getProductImages: getProductImages,
  getProductByHandle: getProductByHandle,
  resolveHandle: resolveHandle,
  PRODUCT_MAP: PRODUCT_MAP
};
