# SEAL Subscriptions CAPI Handling

## Status

SEAL Subscriptions does not need a separate Recharge-style webhook endpoint in this setup.
Subscription renewals are handled through the existing Shopify `orders/paid` webhook:

`https://calqix-capi.vercel.app/api/webhook/orders-paid`

## Detection

Observed SEAL renewal signals from Shopify Admin API:

- App: `Seal Subscriptions`
- App ID: `3501525`
- Order source: `subscription_contract_checkout_one`
- Order tag: `seal_subsequent_order`

The `orders-paid` webhook treats an order as a subscription renewal when any of these are present:

- `app_id` is `3501525`
- tags include `seal_subsequent_order`
- `source_name` starts with `subscription_`
- tags include `subscription` or `recurring`

## Meta CAPI Payload

SEAL renewal purchases keep the same Purchase source-of-truth as other Shopify orders:

- `event_id`: `purchase_{checkout_token}` when available
- fallback: `purchase_{order.id}`
- `order_id`: Shopify order ID
- `order_type`: `subscription_renewal`
- `subscription_provider`: `seal`
- `subscription_source`: Shopify source name, for example `subscription_contract_checkout_one`

The webhook still enriches user data from stored checkout/customer identity when available.

## Manual Shopify Check

Confirm the Shopify app has an active `orders/paid` webhook pointing to:

`https://calqix-capi.vercel.app/api/webhook/orders-paid`

No `RECHARGE_WEBHOOK_SECRET` is required for SEAL. Shopify webhook verification continues to use `SHOPIFY_WEBHOOK_SECRET`.
