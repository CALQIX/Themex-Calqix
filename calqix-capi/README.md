# CALQIX Meta Conversions API

Server-side Meta Conversions API integration for the CALQIX Shopify store.

## Endpoints

### Shopify webhook handlers (HMAC verified)

| Endpoint | Event | Shopify topic |
|---|---|---|
| `POST /api/webhook/orders-paid` | Purchase | `orders/paid` |
| `POST /api/webhook/checkouts-create` | InitiateCheckout | `checkouts/create` |
| `POST /api/webhook/carts-create` | AddToCart | `carts/create` |
| `POST /api/webhook/customers-create` | Lead | `customers/create` |

### Custom endpoints

| Endpoint | Description |
|---|---|
| `POST /api/view-content` | ViewContent event — called from theme JS |
| `GET /api/diagnostics?key=YOUR_KEY` | Sends test event, returns env status |

## Project structure

```text
calqix-capi/
├── api/
│   ├── diagnostics.js
│   ├── view-content.js
│   └── webhook/
│       ├── orders-paid.js
│       ├── checkouts-create.js
│       ├── carts-create.js
│       └── customers-create.js
├── lib/
│   ├── meta-capi.js
│   ├── hash.js
│   ├── verify-webhook.js
│   └── webhook-utils.js
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
META_API_VERSION=v21.0
DIAGNOSTICS_KEY=
```

- `META_TEST_EVENT_CODE` — optional, only for testing in Meta Events Manager
- `META_API_VERSION` — optional, defaults to `v21.0`
- `DIAGNOSTICS_KEY` — required for the diagnostics endpoint

## Theme integration

The browser-side bridge (`assets/calqix-meta-bridge.js`) handles:

1. Syncs `_fbc` and `_fbp` cookies to Shopify cart attributes
2. Constructs `fbc` from `fbclid` URL parameter when cookie is missing
3. Auto-fires ViewContent server event on product pages
4. Provides `window.calqixMeta.track()` for browser↔server dedup

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
