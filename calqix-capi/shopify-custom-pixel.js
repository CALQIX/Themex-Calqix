/**
 * CALQIX Shopify Custom Pixel — Meta CAPI Checkout Tracking
 *
 * INSTALLATION:
 * 1. Go to Shopify Admin → Settings → Customer events
 * 2. Click "Add custom pixel"
 * 3. Name it "CALQIX Meta CAPI"
 * 4. Paste this entire script
 * 5. Click "Save" then "Connect"
 *
 * This pixel subscribes to Shopify checkout events and sends them to the
 * CALQIX Vercel CAPI endpoint with fbc/fbp cookies for high match quality.
 *
 * Events tracked:
 *   checkout_started              → InitiateCheckout (Meta CAPI)
 *   checkout_contact_info_submitted → Enrichment storage (email/phone)
 *   checkout_completed            → Purchase (Meta CAPI)
 *
 * Deduplication:
 *   Uses checkout_token as the shared correlation key.
 *   event_id for IC = ic_{checkout_token}
 *   event_id for Purchase = purchase_{checkout_token}
 *   Webhook fallbacks use the same format → Meta deduplicates correctly.
 */

const CAPI_ENDPOINT = 'https://calqix-capi.vercel.app/api/checkout-event';

// In-pixel enrichment accumulator (survives across events in same checkout session)
const enrichmentCache = {};

async function getFbc() {
  try {
    return await browser.cookie.get('_fbc');
  } catch (e) { return null; }
}

async function getFbp() {
  try {
    return await browser.cookie.get('_fbp');
  } catch (e) { return null; }
}

function extractLineItems(checkout) {
  if (!checkout || !checkout.lineItems) return [];
  return checkout.lineItems.map(function (item) {
    var productId = null;
    if (item.variant && item.variant.product && item.variant.product.id) {
      productId = String(item.variant.product.id);
    } else if (item.id) {
      productId = String(item.id);
    }
    // Strip gid:// prefix if present
    if (productId) {
      var match = productId.match(/\/(\d+)$/);
      if (match) productId = match[1];
    }
    var price = null;
    if (item.variant && item.variant.price && item.variant.price.amount) {
      price = parseFloat(item.variant.price.amount);
    }
    return {
      product_id: productId,
      quantity: item.quantity || 1,
      price: price
    };
  });
}

function extractTotalValue(checkout) {
  if (checkout && checkout.totalPrice && checkout.totalPrice.amount) {
    return parseFloat(checkout.totalPrice.amount);
  }
  return undefined;
}

function extractCurrency(checkout) {
  if (checkout && checkout.totalPrice && checkout.totalPrice.currencyCode) {
    return checkout.totalPrice.currencyCode;
  }
  if (checkout && checkout.currencyCode) {
    return checkout.currencyCode;
  }
  return 'EUR';
}

function extractCheckoutToken(checkout) {
  if (checkout && checkout.token) return checkout.token;
  return null;
}

function extractOrderId(checkout) {
  if (checkout && checkout.order && checkout.order.id) {
    var id = String(checkout.order.id);
    var match = id.match(/\/(\d+)$/);
    return match ? match[1] : id;
  }
  return null;
}

async function sendToServer(payload) {
  try {
    var response = await fetch(CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

// --- Event handlers ---

analytics.subscribe('checkout_started', async function (event) {
  var checkout = event.data && event.data.checkout;
  if (!checkout) return;

  var token = extractCheckoutToken(checkout);
  if (!token) return;

  var fbc = await getFbc();
  var fbp = await getFbp();
  var lineItems = extractLineItems(checkout);

  // Store fbc/fbp in enrichment cache for later events
  if (fbc || fbp) {
    enrichmentCache[token] = enrichmentCache[token] || {};
    if (fbc) enrichmentCache[token].fbc = fbc;
    if (fbp) enrichmentCache[token].fbp = fbp;
  }

  await sendToServer({
    event_type: 'checkout_started',
    checkout_token: token,
    fbc: fbc,
    fbp: fbp,
    email: checkout.email || null,
    phone: checkout.phone || null,
    line_items: lineItems,
    value: extractTotalValue(checkout),
    currency: extractCurrency(checkout),
    source_url: event.context && event.context.document && event.context.document.location
      ? event.context.document.location.href
      : 'https://calqix.com/checkout'
  });
});

analytics.subscribe('checkout_contact_info_submitted', async function (event) {
  var checkout = event.data && event.data.checkout;
  if (!checkout) return;

  var token = extractCheckoutToken(checkout);
  if (!token) return;

  var fbc = await getFbc();
  var fbp = await getFbp();

  // Accumulate enrichment
  enrichmentCache[token] = enrichmentCache[token] || {};
  if (checkout.email) enrichmentCache[token].email = checkout.email;
  if (checkout.phone) enrichmentCache[token].phone = checkout.phone;
  if (fbc) enrichmentCache[token].fbc = fbc;
  if (fbp) enrichmentCache[token].fbp = fbp;

  await sendToServer({
    event_type: 'contact_info_submitted',
    checkout_token: token,
    email: checkout.email || null,
    phone: checkout.phone || null,
    fbc: fbc,
    fbp: fbp
  });
});

analytics.subscribe('checkout_completed', async function (event) {
  var checkout = event.data && event.data.checkout;
  if (!checkout) return;

  var token = extractCheckoutToken(checkout);
  if (!token) return;

  var fbc = await getFbc();
  var fbp = await getFbp();
  var cached = enrichmentCache[token] || {};
  var lineItems = extractLineItems(checkout);

  await sendToServer({
    event_type: 'checkout_completed',
    checkout_token: token,
    order_id: extractOrderId(checkout),
    fbc: fbc || cached.fbc || null,
    fbp: fbp || cached.fbp || null,
    email: checkout.email || cached.email || null,
    phone: checkout.phone || cached.phone || null,
    line_items: lineItems,
    value: extractTotalValue(checkout),
    currency: extractCurrency(checkout),
    source_url: event.context && event.context.document && event.context.document.location
      ? event.context.document.location.href
      : 'https://calqix.com/checkout'
  });

  // Clean up
  delete enrichmentCache[token];
});
