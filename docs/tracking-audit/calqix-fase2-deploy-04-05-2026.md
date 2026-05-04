# Calqix Fase 2 Deploy 04-05-2026

## Status

Fase 2 code is lokaal ontwikkeld en syntax-gevalideerd. Production deploy is niet uitgevoerd, omdat Custom Pixel UI-status en Meta Test Events validatie nog niet groen zijn.

## Gedeveloped

- Fix A browser beacon advanced matching
- Fix B state mapping end-to-end
- Fix C bridge VC/ATC identity uitbreiden

## Niet gedeployed

- Fix A, B en C zijn niet naar productie gedeployed in deze run
- Fix D Redis identity warming blijft uit scope vandaag

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
| Custom Pixel Admin API check | Niet bevestigd | `web_pixels.json` retourneert 0 pixels |
| Webhook GraphQL Admin API check | Pass | 4/4 verwachtte webhook subscriptions aanwezig |
| `npm run check` na edits | Pass | Syntax groen |
| Production deploy | Niet uitgevoerd | Geblokkeerd door verificatie en test-event ontbreekt |

## Custom Pixel en webhooks

Verificatie via `lib/shopify-admin.js` self-heal Admin client:

- Custom Pixel `CALQIX Meta CAPI`: niet bevestigd via `web_pixels.json`
- Webhooks aanwezig: 4/4 via GraphQL `webhookSubscriptions`
- Ontbrekende webhooks: geen

Er zijn geen webhooks aangemaakt of gewijzigd.

## Test Events validatie

Niet uitgevoerd.

Redenen:

- Geen Meta Test Event Code ontvangen.
- Production deploy is niet uitgevoerd.
- Custom Pixel en webhooks zijn niet groen via Admin API.

## Verwacht effect na veilige deploy

- ViewContent EMQ: 6,1 naar 7,5+
- AddToCart EMQ: 6,1 naar 7,5+
- InitiateCheckout EMQ: 6,1 naar 8,0+
- AddPaymentInfo EMQ: 6,1 naar 8,5+
- Purchase EMQ: 8,3 naar 9,0+

## Blokkers voor livegang

1. Custom Pixel status moet worden bevestigd in Shopify Customer Events of via een correcte Admin API route.
2. PF.2 SubtleCrypto moet worden getest in Shopify Custom Pixel sandbox.
3. Meta Test Event Code is nodig voor validatie.
4. Production deploy moet expliciet worden vrijgegeven.

## Telegram updates

Verzonden:

- Shopify token blocker melding na raw 401.
- Custom Pixel en webhook verificatie melding met 0/4 webhooks. Deze melding is achterhaald na self-heal herstel.

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

## Eindstand

Code voor Fix A, Fix B en Fix C is lokaal klaar en syntax-gevalideerd. Shopify Admin en CLI verbinding zijn hersteld. Livegang is bewust gestopt omdat Custom Pixel UI-status, PF.2 SubtleCrypto en Meta Test Events validatie nog open zijn.
