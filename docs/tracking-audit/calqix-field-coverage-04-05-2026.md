# CALQIX Field Coverage Diagnose 04-05-2026

## Scope

Dit rapport is Fase 1 van de Calqix tracking fix. De analyse is read-only uitgevoerd. Er zijn geen code-, Vercel-, Shopify-, Meta- of configuratiewijzigingen gedaan.

Doel van dit rapport:

- Vaststellen welke identity velden van Custom Pixel naar server gaan.
- Vaststellen hoe deze velden via `lib/hash.js` worden genormaliseerd en gehasht.
- Vaststellen welke `user_data` keys uiteindelijk naar Meta CAPI gaan.
- Vaststellen welke velden ontbreken in browser beacons, ViewContent en AddToCart.
- Vaststellen welke naming mismatches of hashing issues bestaan.

## Gelezen bestanden

- `calqix-capi/api/checkout-event.js`
- `calqix-capi/lib/hash.js`
- `calqix-capi/lib/meta-capi.js`
- `assets/calqix-meta-bridge.js`
- `calqix-capi/api/view-content.js`
- `calqix-capi/api/add-to-cart.js`
- `calqix-capi/shopify-custom-pixel.js`

## Field Coverage Diagnose

## Custom Pixel naar Server

Endpoint: `calqix-capi/api/checkout-event.js`

De Custom Pixel stuurt checkout-events naar:

`https://calqix-capi.vercel.app/api/checkout-event`

Ondersteunde event types:

| Custom Pixel event_type | Meta event | Event ID patroon | Server handler |
| --- | --- | --- | --- |
| `checkout_started` | `InitiateCheckout` | `ic_{checkout_token}` | `handleCheckoutStarted` |
| `contact_info_submitted` | Geen Meta send | n.v.t. | `handleContactInfo` |
| `payment_info_submitted` | `AddPaymentInfo` | `add_payment_info_{checkout_token}` | `handlePaymentInfo` |
| `checkout_completed` | `Purchase` | `purchase_{checkout_token}` | `handleCheckoutCompleted` |

### Custom Pixel veld naar Meta CAPI key

| Custom Pixel | Server param | Meta key | Hashed | Status |
| --- | --- | --- | --- | --- |
| `email` | `email` | `em` | Ja | Goed |
| `phone` | `phone` | `ph` | Ja | Goed |
| `first_name` | `first_name` | `fn` | Ja | Goed |
| `last_name` | `last_name` | `ln` | Ja | Goed |
| `city` | `city` | `ct` | Ja | Goed |
| `zip` | `zip` | `zp` | Ja | Goed |
| `country_code` | `country_code` | `country` | Ja | Goed als ISO2 |
| `external_id` | `external_id` | `external_id` | Ja | Goed |
| `fbc` | `fbc` | `fbc` | Nee | Goed, Meta verwacht raw |
| `fbp` | `fbp` | `fbp` | Nee | Goed, Meta verwacht raw |
| `state` | Niet gemapt | `st` | n.v.t. | Mist |
| `province_code` | Niet gemapt in checkout endpoint | `st` | n.v.t. | Mist |
| `provinceCode` | Niet gemapt in checkout endpoint | `st` | n.v.t. | Mist |

### Inkomende payload per checkout event

#### `checkout_started`

Custom Pixel stuurt naar server:

| Field | Bron |
| --- | --- |
| `event_type` | Literal `checkout_started` |
| `checkout_token` | `checkout.token` |
| `fbc` | Cookie `_fbc` |
| `fbp` | Cookie `_fbp` |
| `email` | `checkout.email` |
| `phone` | `checkout.phone` |
| `external_id` | `customerId(checkout)` |
| `first_name` | Shipping address first name |
| `last_name` | Shipping address last name |
| `city` | Shipping address city |
| `zip` | Shipping address zip |
| `country_code` | Shipping address country code |
| `line_items` | Built from checkout line items |
| `value` | Checkout total |
| `currency` | Checkout currency |
| `source_url` | Current event URL or fallback |

Belangrijke gap: bij `checkout_started` is shipping address vaak nog leeg. Daardoor zijn `first_name`, `last_name`, `city`, `zip` en `country_code` vaak leeg.

#### `contact_info_submitted`

Custom Pixel stuurt naar server:

| Field | Bron |
| --- | --- |
| `event_type` | Literal `contact_info_submitted` |
| `checkout_token` | `checkout.token` |
| `email` | `checkout.email` |
| `phone` | `checkout.phone` |
| `external_id` | `customerId(checkout)` |
| `fbc` | Cookie `_fbc` |
| `fbp` | Cookie `_fbp` |

Server slaat enrichment op voor:

| Field | Opgeslagen |
| --- | --- |
| `email` | Ja |
| `phone` | Ja |
| `fbc` | Ja |
| `fbp` | Ja |
| `external_id` | Ja |
| `first_name` | Nee |
| `last_name` | Nee |
| `city` | Nee |
| `zip` | Nee |
| `country_code` | Nee |
| `state` | Nee |

#### `payment_info_submitted`

Custom Pixel stuurt naar server:

| Field | Bron |
| --- | --- |
| `event_type` | Literal `payment_info_submitted` |
| `checkout_token` | `checkout.token` |
| `external_id` | `customerId(checkout)` |
| `fbc` | Current cookie of cached enrichment |
| `fbp` | Current cookie of cached enrichment |
| `email` | `checkout.email` of cached enrichment |
| `phone` | `checkout.phone` of cached enrichment |
| `first_name` | Shipping address first name |
| `last_name` | Shipping address last name |
| `city` | Shipping address city |
| `zip` | Shipping address zip |
| `country_code` | Shipping address country code |
| `line_items` | Built from checkout line items |
| `value` | Checkout total |
| `currency` | Checkout currency |
| `source_url` | Current event URL or fallback |

#### `checkout_completed`

Custom Pixel stuurt naar server:

| Field | Bron |
| --- | --- |
| `event_type` | Literal `checkout_completed` |
| `checkout_token` | `checkout.token` |
| `order_id` | Numeric Shopify order id |
| `external_id` | `customerId(checkout)` |
| `fbc` | Current cookie of cached enrichment |
| `fbp` | Current cookie of cached enrichment |
| `email` | `checkout.email` of cached enrichment |
| `phone` | `checkout.phone` of cached enrichment |
| `first_name` | Shipping address first name |
| `last_name` | Shipping address last name |
| `city` | Shipping address city |
| `zip` | Shipping address zip |
| `country_code` | Shipping address country code |
| `line_items` | Built from checkout line items |
| `value` | Checkout total |
| `currency` | Checkout currency |
| `source_url` | Current event URL or fallback |

## Hashing pad

Bestand: `calqix-capi/lib/hash.js`

### Normalisatie en hashing per veld

| Meta key | Input | Normalisatie | Hashing | Diagnose |
| --- | --- | --- | --- | --- |
| `em` | `customer.email` | trim, lowercase | SHA-256 | Correct |
| `ph` | `customer.phone` | digits only, country dialcode toegevoegd bij lokale nummers | SHA-256 | Correct voor E.164-style, prompttekst over leading zeros wijkt af |
| `fn` | `first_name` of `firstName` | trim, lowercase, accents weg, non-alphanumeric weg | SHA-256 | Correct |
| `ln` | `last_name` of `lastName` | trim, lowercase, accents weg, non-alphanumeric weg | SHA-256 | Correct |
| `ct` | `city` | trim, lowercase, accents weg, spaces toegestaan | SHA-256 | Correct |
| `st` | `province_code` of `provinceCode` | trim, lowercase, accents weg, non-alphanumeric weg | SHA-256 | Hash functie correct, checkout mapping mist input |
| `zp` | `zip`, `postal_code` of `postalCode` | trim, lowercase, spaces weg | SHA-256 | Correct, `1234 AB` wordt `1234ab` |
| `country` | `country_code` of `countryCode` | trim, lowercase, eerste 2 karakters | SHA-256 | Correct als input ISO2 is |
| `external_id` | `external_id` of fallback email | trim, lowercase via hash helper | SHA-256 | Correct |
| `fbc` | `fbc` | Geen | Geen | Correct |
| `fbp` | `fbp` | Geen | Geen | Correct |
| `client_ip_address` | request IP | Geen | Geen | Correct |
| `client_user_agent` | request UA | Geen | Geen | Correct |

### Belangrijkste hashing bevindingen

- Email normalisatie is Meta-compatible.
- Zip normalisatie is goed voor Nederlandse postcodes.
- Phone normalisatie converteert lokale nummers met landcode. Dat is waarschijnlijk beter voor Meta dan leading zeros behouden.
- State kan correct gehasht worden, maar bereikt `formatUserData` niet vanuit `/api/checkout-event`.
- Country werkt alleen betrouwbaar als `country_code` een ISO2 code is, zoals `NL`, `BE` of `DE`.

## Meta CAPI payload

Bestand: `calqix-capi/lib/meta-capi.js`

De finale payload naar Meta is:

```json
{
  "data": [
    {
      "event_name": "Purchase",
      "event_time": 1710000000,
      "event_id": "purchase_{checkout_token}",
      "event_source_url": "https://calqix.com/checkout",
      "action_source": "website",
      "user_data": {},
      "custom_data": {}
    }
  ],
  "access_token": "env:META_ACCESS_TOKEN"
}
```

Endpoint:

`https://graph.facebook.com/{META_API_VERSION}/{META_PIXEL_ID}/events`

Live context uit Vercel CLI audit:

- `META_API_VERSION=v22.0`
- `META_PIXEL_ID=934134615770602`

## Bridge naar Server voor ViewContent en AddToCart

Bestand: `assets/calqix-meta-bridge.js`

### Identity capture in de bridge

`buildUserPayload()` verzamelt:

| Bridge field | Bron | Naar server meegestuurd? |
| --- | --- | --- |
| `fbc` | `_fbc` cookie of `fbclid` URL capture | Ja |
| `fbp` | `_fbp` cookie of fallback generated `_fbp` | Ja |
| `email` | Shopify globals, `localStorage._cq_known_email`, cookie `_cq_known_email` | Ja |
| `phone` | Shopify globals | Ja |
| `external_id` | Shopify customer ID of `_cq_anon_id` | Ja |
| `country_code` | Shopify country/page country | Ja |
| `gclid` | `_cq_gclid` cookie | Niet naar Meta endpoints gebruikt |
| `gbraid` | `_cq_gbraid` cookie | Niet naar Meta endpoints gebruikt |
| `wbraid` | `_cq_wbraid` cookie | Niet naar Meta endpoints gebruikt |
| `ttclid` | `_cq_ttclid` cookie | Niet naar Meta endpoints gebruikt |
| `ttp` | `_ttp` cookie | Niet naar Meta endpoints gebruikt |

### Wanneer wordt `_cq_known_email` gezet?

`_cq_known_email` wordt gezet via `rememberEmail(email)` in twee situaties:

1. Bij `sendLead()`, wanneer een nieuwsbrief of lead form wordt verstuurd.
2. Bij `autoIdentityCapture()`, wanneer `window.Shopify.checkout.email` beschikbaar is.

Opslag:

- `localStorage._cq_known_email`
- cookie `_cq_known_email`
- TTL cookie: 365 dagen

### Wordt `dataLayer.calqix_user_data` uitgelezen?

Nee. De bridge pusht zelf naar `dataLayer` via `pushUserDataToDataLayer()`, maar leest bestaande `dataLayer.calqix_user_data` niet uit.

Wel voorkomt de bridge overschrijven als er al een `calqix_user_data` event bestaat:

- Als `window.dataLayer` al een entry met `event === 'calqix_user_data'` heeft, pusht de bridge geen anonieme fallback.

Diagnose:

- Logged-in customer data uit Liquid kan de browser pixel init helpen.
- De bridge gebruikt die data niet expliciet voor VC/ATC server payloads, behalve via Shopify globals zoals `window.meta`, `ShopifyAnalytics` en `window.__st`.
- Velden zoals `fn`, `ln`, `ct`, `st`, `zp` uit `dataLayer.calqix_user_data` worden niet door bridge naar `/api/view-content` of `/api/add-to-cart` gestuurd.

## Bridge naar Server tabel voor VC en ATC

### ViewContent

Bridge POST naar `/api/view-content` bevat:

| Bridge payload | Server endpoint param | Meta CAPI key | Status |
| --- | --- | --- | --- |
| `fbc` | `body.fbc` | `fbc` | Goed |
| `fbp` | `body.fbp` | `fbp` | Goed |
| `email` | `body.email` | `em` | Goed als bekend |
| `phone` | `body.phone` | `ph` | Goed als bekend |
| `external_id` | `body.external_id` | `external_id` | Goed |
| `country_code` | `body.country_code` | `country` | Goed als bekend |
| `first_name` | Niet verstuurd | `fn` | Mist |
| `last_name` | Niet verstuurd | `ln` | Mist |
| `city` | Niet verstuurd | `ct` | Mist |
| `state` of `province_code` | Niet verstuurd | `st` | Mist |
| `zip` | Niet verstuurd | `zp` | Mist |

Server endpoint `api/view-content.js` accepteert alleen:

- `fbc`
- `fbp`
- `email`
- `phone`
- `external_id`
- `country_code`

Dus zelfs als de bridge extra name/address velden zou sturen, de huidige endpoint mapping zou ze nog niet verwerken.

### AddToCart

Bridge POST naar `/api/add-to-cart` bevat:

| Bridge payload | Server endpoint param | Meta CAPI key | Status |
| --- | --- | --- | --- |
| `fbc` | `body.fbc` | `fbc` | Goed |
| `fbp` | `body.fbp` | `fbp` | Goed |
| `email` | `body.email` | `em` | Goed als bekend |
| `phone` | `body.phone` | `ph` | Goed als bekend |
| `external_id` | `body.external_id` | `external_id` | Goed |
| `country_code` | `body.country_code` | `country` | Goed als bekend |
| `first_name` | Niet verstuurd | `fn` | Mist |
| `last_name` | Niet verstuurd | `ln` | Mist |
| `city` | Niet verstuurd | `ct` | Mist |
| `state` of `province_code` | Niet verstuurd | `st` | Mist |
| `zip` | Niet verstuurd | `zp` | Mist |

Server endpoint `api/add-to-cart.js` accepteert alleen:

- `fbc`
- `fbp`
- `email`
- `phone`
- `external_id`
- `country_code`

## Browser Beacon advanced matching

Bestand: `calqix-capi/shopify-custom-pixel.js`

Functie:

`fireBrowserPixelEvent(eventName, eventId, customData, fbp, fbc, sourceUrl)`

### Query string parameters die wel worden meegestuurd

| Query parameter | Bron | Status |
| --- | --- | --- |
| `id` | `META_PIXEL_ID` | Goed |
| `ev` | Event name | Goed |
| `dl` | Source URL | Goed |
| `rl` | Source URL | Goed |
| `if` | Literal `false` | Goed |
| `ts` | Timestamp | Goed |
| `v` | Literal pixel version | Goed |
| `r` | Literal `stable` | Goed |
| `pl` | Literal `calqix-custom-pixel` | Goed |
| `es` | Literal `automatic` | Goed |
| `eid` | Shared event ID | Goed |
| `cd[value]` | custom data value | Goed |
| `cd[currency]` | custom data currency | Goed |
| `cd[content_ids]` | custom data content IDs JSON | Goed |
| `cd[content_type]` | custom data content type | Goed |
| `cd[num_items]` | custom data num items | Goed |
| `cd[order_id]` | purchase order ID | Goed |
| `fbp` | `_fbp` | Goed |
| `fbc` | `_fbc` | Goed |

### Query string parameters die niet worden meegestuurd

| Advanced matching parameter | Status |
| --- | --- |
| `ud[em]` | Mist |
| `ud[ph]` | Mist |
| `ud[fn]` | Mist |
| `ud[ln]` | Mist |
| `ud[ct]` | Mist |
| `ud[st]` | Mist |
| `ud[zp]` | Mist |
| `ud[country]` | Mist |
| `ud[external_id]` | Mist |

Diagnose:

- Browser beacon heeft goede dedup via `eid` en goede browser identifiers via `fbp` en `fbc`.
- Browser beacon mist alle hashed advanced matching identity velden.
- Dit verklaart logisch waarom `InitiateCheckout`, `AddPaymentInfo` en browser-side `Purchase` in Meta Events Manager lage of incomplete browser match coverage kunnen tonen, ondanks goed gevulde server CAPI payloads.

## Field-naming mismatches

| Mismatch | Locatie | Impact | Status |
| --- | --- | --- | --- |
| `country_code` versus Meta `country` | `checkout-event.js`, `hash.js` | Geen issue, mapping werkt | OK |
| `zip` versus Meta `zp` | `checkout-event.js`, `hash.js` | Geen issue, mapping werkt | OK |
| `first_name` versus Meta `fn` | `checkout-event.js`, `hash.js` | Geen issue, mapping werkt | OK |
| `last_name` versus Meta `ln` | `checkout-event.js`, `hash.js` | Geen issue, mapping werkt | OK |
| `state`, `province_code`, `provinceCode` naar `st` | `checkout-event.js` | State bereikt hashing niet | Bug/gap |
| `dataLayer.calqix_user_data` naar bridge payload | `calqix-meta-bridge.js` | Name/address velden uit Liquid worden niet gebruikt voor VC/ATC | Gap |
| `contact[tags]=newsletter` detectie | `calqix-meta-bridge.js` | Native Shopify newsletter kan gemist worden als class ontbreekt | Mogelijke bug |

## Hashing-bugs

### Geen harde hashing bug gevonden voor bestaande velden

De bestaande hashing voor email, phone, names, city, zip, country en external_id is functioneel correct.

### Wel gevonden aandachtspunten

| Punt | Diagnose |
| --- | --- |
| Phone leading zeros | Code verwijdert lokale leading zeros en voegt dialcode toe. Dit wijkt af van prompttekst, maar is waarschijnlijk Meta-correcter. |
| Country full name | `normalizeCountry` neemt eerste twee letters. `Netherlands` zou `ne` worden. Input moet ISO2 blijven. |
| State input | Hashing bestaat, maar checkout endpoint mappt state niet. |
| Browser beacon | Geen hashing aanwezig in `fireBrowserPixelEvent`, dus geen `ud[...]` velden. |

## Catalog ID structuur

Code gebruikt variant-level catalog IDs:

- Custom Pixel `buildLineItems()` verzamelt `variant_id` en `sku`.
- `checkout-event.js` gebruikt `variant_id` en `sku` eerst, fallback `product_id`.
- `view-content.js` gebruikt `variant_id` en `sku` eerst, fallback `product_id`.
- `add-to-cart.js` gebruikt bridge `content_ids`, die variant ID en SKU eerst gebruikt.

Code-commentaar zegt dat de CALQIX Meta Commerce catalog `variant_id` of SKU als `retailer_id` gebruikt.

Open verificatie:

- Dit rapport heeft geen directe toegang tot Meta Commerce Manager feed gehad.
- Vraag aan gebruiker: bevestig in Commerce Manager of `retailer_id` inderdaad variant ID of SKU is, niet product ID.

## Samenvatting gaps per event

| Event | Server CAPI identity | Browser identity | Grootste gap |
| --- | --- | --- | --- |
| `ViewContent` | fbc, fbp, email, phone, external_id, country mogelijk | fbq event zonder advanced user_data | Bridge mist name/address en leest dataLayer niet |
| `AddToCart` | fbc, fbp, email, phone, external_id, country mogelijk | fbq event zonder advanced user_data | Bridge mist name/address en leest dataLayer niet |
| `InitiateCheckout` | Server kan email, phone, name, city, zip, country hebben | Browser beacon mist alle `ud[...]` velden | Browser beacon advanced matching ontbreekt |
| `AddPaymentInfo` | Server kan rijk zijn, afhankelijk van address availability | Browser beacon mist alle `ud[...]` velden | Browser beacon advanced matching ontbreekt |
| `Purchase` | Server rijk, zeker met checkout/order fields | Browser beacon mist alle `ud[...]` velden | Browser beacon advanced matching ontbreekt |
| `Lead` | Email, fbc, fbp, external_id, country mogelijk | fbq Lead zonder advanced user_data | Form-detectie kan native newsletter missen |

## Aanbevolen Fase 2 volgorde

Geen code is in Fase 1 gewijzigd. Als review akkoord is, is de technische prioriteit:

1. Browser beacon advanced matching toevoegen in `shopify-custom-pixel.js`.
2. State/country fallback toevoegen aan Custom Pixel checkout handlers en server mapping.
3. Bridge uitbreiden zodat VC/ATC `first_name`, `last_name`, `city`, `state`, `zip`, `country` uit beschikbare first-party data of dataLayer kan doorgeven.
4. Server endpoints `/api/view-content` en `/api/add-to-cart` dezelfde extra velden laten accepteren.
5. Eventueel Redis identity warming per `fbp` toevoegen na review, met zorg voor PII en TTL.

## Stop punt

Fase 1 is afgerond als read-only diagnose. Wacht op review en groen licht voordat Fase 2 codewijzigingen worden uitgevoerd.
