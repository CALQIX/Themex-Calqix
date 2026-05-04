# Calqix Fase 2 Deploy 04-05-2026

## Status

Fase 2 code is lokaal ontwikkeld, syntax-gevalideerd en naar production gedeployed. Live validatie met Meta Test Events loopt via fallback test code.

## Gedeveloped

- Fix A browser beacon advanced matching
- Fix B state mapping end-to-end
- Fix C bridge VC/ATC identity uitbreiden

## Gedeployed

- Fix A, B en C zijn naar production gedeployed
- Diagnostic endpoint is live op `/api/diagnostic`
- Custom Pixel code moet nog handmatig in Shopify Customer Events worden bijgewerkt als GraphQL update niet beschikbaar is

## Cascade memory updates

- Calqix Shopify Admin API toegang
- Calqix tracking infrastructure setup
- Calqix tracking sessie startup checklist

## Wijzigingen

### Fix A browser beacon advanced matching

Bestand:

- `calqix-capi/shopify-custom-pixel.js`

Wijzigingen:

- `fireBrowserPixelEvent` is async gemaakt.
- Browser beacon voegt `ud[...]` velden toe voor bekende checkout identity velden.
- Gehashte velden: `em`, `ph`, `fn`, `ln`, `ct`, `st`, `zp`, `country`, `external_id`.
- Hashing gebruikt native `crypto.subtle.digest` met defensieve skip als SubtleCrypto niet beschikbaar is.
- Geen zelfgeschreven crypto fallback is achtergelaten.

Belangrijke beperking:

- PF.2 blijft vereist voor production confidence, omdat Shopify Custom Pixel sandbox SubtleCrypto nog niet live is bevestigd.

### Fix B state mapping end-to-end

Bestanden:

- `calqix-capi/shopify-custom-pixel.js`
- `calqix-capi/api/checkout-event.js`
- `calqix-capi/lib/hash.js`

Wijzigingen:

- Custom Pixel stuurt `state` mee bij `checkout_started`, `payment_info_submitted` en `checkout_completed`.
- Checkout endpoint accepteert `state` in `buildCustomerData`.
- `formatUserData` mapt `customer.state` naar Meta `st`.

### Fix C bridge VC/ATC identity uitbreiden

Bestanden:

- `assets/calqix-meta-bridge.js`
- `calqix-capi/api/view-content.js`
- `calqix-capi/api/add-to-cart.js`

Wijzigingen:

- Bridge versie verhoogd naar `2026-05-04-a`.
- Bridge leest `window.dataLayer` entry `calqix_user_data` terug.
- Bridge stuurt extra identity velden mee voor ViewContent en AddToCart: `first_name`, `last_name`, `city`, `state`, `zip`.
- ViewContent endpoint accepteert en verwerkt deze velden.
- AddToCart endpoint accepteert en verwerkt deze velden.
- Diagnostics `match_keys` tonen nu ook `fn`, `ln`, `ct`, `st`, `zp`.

## Verificatie status

| Check | Status | Resultaat |
| --- | --- | --- |
| `npm run check` voor edits | Pass | Syntax baseline groen |
| `vercel env pull .env.local` development | Uitgevoerd | Bleek ongeschikt voor productie env |
| `vercel env pull .env.local --environment=production` | Uitgevoerd | Production env hersteld |
| Raw Shopify REST `shop.json` met `SHOPIFY_ADMIN_ACCESS_TOKEN` | Pass | Hersteld na self-heal token sync |
| `npm run check:shopify` via self-heal client | Pass | Token healthy via OAuth self-heal |
| `npm run test:selfheal` | Pass | Redis token, Redis read en OAuth mint werken |
| Shopify CLI `theme list` | Pass | CLI verbonden met `calqix.myshopify.com` |
| Custom Pixel Admin API check | Niet relevant voor handmatige Custom Pixel | `web_pixels.json` retourneert alleen app-pixels |
| Webhook GraphQL Admin API check | Pass | 4/4 verwachtte webhook subscriptions aanwezig |
| `npm run check` na edits | Pass | Syntax groen |
| `META_TEST_EVENT_CODE` | Pass | Fallback `TEST_CALQIX_DEPLOY_04052026` gezet in Vercel Production |
| Production deploy | Pass | Prebuilt deploy live op `calqix-capi.vercel.app` |
| `/api/diagnostic` smoke | Pass | 200 OK, Telegram `sent: true`, message_id 905 |
| `/api/view-content` OPTIONS | Pass | 204 |
| `/api/webhook/orders-paid` POST | Pass | 200 |

## Custom Pixel en webhooks

Verificatie via `lib/shopify-admin.js` self-heal Admin client:

- Custom Pixel `CALQIX Meta CAPI`: UI-status moet via Shopify Customer Events worden bevestigd
- Webhooks aanwezig: 4/4 via GraphQL `webhookSubscriptions`
- Ontbrekende webhooks: geen

Er zijn geen webhooks aangemaakt of gewijzigd.

## Test Events validatie

Gestart met fallback test code.

Status:

- Vercel Production env `META_TEST_EVENT_CODE`: `TEST_CALQIX_DEPLOY_04052026`
- `lib/meta-capi.js` voegt `test_event_code` al toe aan Meta CAPI payloads als env aanwezig is
- Na validatie moet `META_TEST_EVENT_CODE` weer verwijderd worden uit Production

## Verwacht effect na veilige deploy

- ViewContent EMQ: 6,1 naar 7,5+
- AddToCart EMQ: 6,1 naar 7,5+
- InitiateCheckout EMQ: 6,1 naar 8,0+
- AddPaymentInfo EMQ: 6,1 naar 8,5+
- Purchase EMQ: 8,3 naar 9,0+

## Open voor live validatie

1. Nieuwe inhoud van `calqix-capi/shopify-custom-pixel.js` moet in Shopify Admin > Settings > Customer events > `CALQIX Meta CAPI` worden geplakt.
2. Meta Test Events validatie uitvoeren met test code `TEST_CALQIX_DEPLOY_04052026`.
3. Na validatie `META_TEST_EVENT_CODE` verwijderen uit Vercel Production en opnieuw deployen.

## Telegram updates

Verzonden:

- Shopify token blocker melding na raw 401.
- Custom Pixel en webhook verificatie melding met 0/4 webhooks. Deze melding is achterhaald na self-heal herstel.
- Diagnostic smoke melding via `/api/diagnostic`: Telegram `sent: true`, message_id 905.

## Shopify herstel 04-05-2026 10:08

Shopify verbinding is hersteld zonder secrets te tonen:

- `npm run test:selfheal`: pass
- Fresh token gemint via OAuth `client_credentials`
- Fresh token opgeslagen in Redis key `shopify:admin_token`
- Lokale `calqix-capi/.env.local` en `calqix-capi/.env` zijn gesynchroniseerd met de fresh token
- Raw REST `shop.json`: pass, shop `CALQIX`, domain `uipq4d-jj.myshopify.com`
- `node scripts/verify-shopify-token.js`: pass
- Shopify CLI `theme list --store calqix.myshopify.com`: pass
- `shopify.app.toml`: `embedded = false` toegevoegd zodat Shopify CLI app-config valideert
- Webhooks via GraphQL: 4/4 aanwezig
- REST `web_pixels.json`: 0 pixels, Custom Pixel UI-status blijft apart te bevestigen

## Production deploy 04-05-2026 10:26

Commit:

- `fb7c7a5` Deploy tracking fixes A B C

Deploy:

- Eerste Vercel deploys via gewone CLI produceerden lege output met build target `.` en veroorzaakten tijdelijk 404 op API routes.
- Herstel uitgevoerd met `vercel build --prod --debug`, gevolgd door `vercel deploy --prebuilt --prod --yes`.
- Correcte live deployment: `dpl_HUwaqWjHNERRd2mLbZRi1nfKh2H7`
- Live alias: `https://calqix-capi.vercel.app`

Post-deploy verificatie:

- `/api/diagnostic`: pass, Telegram `sent: true`
- `/api/view-content` OPTIONS: pass, HTTP 204
- `/api/webhook/orders-paid` POST `{}`: pass, HTTP 200
- Vercel inspect toont lambda routes inclusief API functions

## Eindstand

Code voor Fix A, Fix B en Fix C is gedeployed naar Vercel Production. Shopify Admin en CLI verbinding zijn hersteld. Server-side endpoints zijn live en bereikbaar. Resterend: Custom Pixel code handmatig updaten in Shopify Customer Events, Meta Test Events validatie uitvoeren en daarna `META_TEST_EVENT_CODE` opruimen.
