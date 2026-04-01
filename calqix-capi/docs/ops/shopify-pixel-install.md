# Shopify Custom Pixel — Install Guide

## What This Pixel Does

Tracks checkout events (InitiateCheckout, Purchase) via Meta CAPI with high Event Match Quality by including `_fbc` and `_fbp` cookies from the browser.

## Installation Steps

1. Open **Shopify Admin** → **Settings** → **Customer events**
2. Click **"Add custom pixel"**
3. Name it: `CALQIX Meta CAPI`
4. Set **Permission** to "Not required" (or match your consent setup)
5. Set **Data sale** to your preference
6. Delete any placeholder code in the editor
7. Paste the **entire contents** of `calqix-capi/shopify-custom-pixel.js`
8. Click **Save**
9. Click **Connect**

## Validation After Install

### Step 1: Check pixel status
- The pixel should show as **"Connected"** in Customer events

### Step 2: Test with a real checkout
1. Add a product to cart on calqix.com
2. Proceed to checkout
3. Enter contact info (email + phone)
4. Complete a test purchase (or use Shopify Bogus Gateway)

### Step 3: Check server logs
In Vercel function logs, look for:
```
[CheckoutEvent] InitiateCheckout { eventId: "ic_...", hasFbc: true, hasFbp: true, ... }
[CheckoutEvent] contact_info stored { hasEmail: true, hasPhone: true, ... }
[CheckoutEvent] Purchase { eventId: "purchase_...", hasFbc: true, hasFbp: true, hasEmail: true, hasPhone: true, ... }
```

### Step 4: Check Meta Events Manager
- Go to Meta Events Manager → Pixel 934134615770602 → Test Events
- Set `META_TEST_EVENT_CODE` in Vercel env vars if you want to use test mode
- Look for InitiateCheckout and Purchase events with match quality > 6/10

## Updating the Pixel

1. Edit `calqix-capi/shopify-custom-pixel.js` in the repo
2. Copy the updated code
3. Shopify Admin → Settings → Customer events → CALQIX Meta CAPI → Edit code
4. Replace all code → Save

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Pixel shows "Disconnected" | Click "Connect" again |
| No events in Vercel logs | Check browser DevTools Network for POST to `checkout-event` |
| Events fire but no fbc/fbp | Check if `_fbc` / `_fbp` cookies exist on calqix.com |
| Compile error in Shopify editor | Ensure no syntax errors — the pixel uses only `var`, no `const`/`let`, no regex literals |
