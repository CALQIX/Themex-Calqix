# CALQIX Meta Conversions API

Server-side Meta Conversions API integration for the CALQIX Shopify store.

## Status

This scaffold currently includes:

- project setup for Vercel serverless functions
- hashing and normalization helpers for Meta user data
- Shopify webhook HMAC verification helper
- Meta Conversions API sender
- placeholder webhook routes for the next step

Webhook event handling is intentionally not implemented yet, so the code can be reviewed before step 5.

## Project structure

```text
calqix-capi/
├── api/
│   └── webhook/
│       ├── orders-paid.js
│       ├── checkouts-create.js
│       ├── carts-create.js
│       └── customers-create.js
├── lib/
│   ├── meta-capi.js
│   ├── hash.js
│   └── verify-webhook.js
├── .env
├── .gitignore
├── vercel.json
├── package.json
└── README.md
```

## Environment variables

Create a local `.env` file with:

```env
META_PIXEL_ID=
META_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=
META_TEST_EVENT_CODE=
```

`META_TEST_EVENT_CODE` is optional and should only be used while testing.

## Development

```bash
npm install
npm run check
npm run dev
```

## Security notes

- keep secrets only in `.env` or Vercel environment variables
- never hardcode tokens in source files
- validate every Shopify webhook with HMAC
- do not log PII
- return HTTP 200 to Shopify even if Meta fails
