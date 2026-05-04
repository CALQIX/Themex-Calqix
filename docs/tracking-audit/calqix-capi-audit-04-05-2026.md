# CALQIX CAPI Tracking Audit — 04-05-2026

## Scope en uitgangspunten

- **Doel:** feitelijke audit van Meta Pixel + Meta Conversions API tracking om te bepalen of performance-problemen eerder uit de site/conversie of uit trackingkwaliteit komen.
- **Datum:** 04-05-2026.
- **Repo:** `CALQIX/Themex-Calqix`.
- **Auditmodus:** read-only code- en CLI-scan. Er zijn geen tracking-, theme-, Vercel- of Shopify-configuraties gewijzigd.
- **Secret policy:** er zijn geen secret values gelogd; alleen aanwezigheid, scopes en niet-geheime identifiers zoals Pixel ID en API-versie.

## Executive summary

De huidige CALQIX tracking-architectuur is technisch aanzienlijk sterker dan een standaard Shopify pixel setup. Er is een tweelaagse event delivery:

- **Browserlaag:** inline Meta Pixel init, `calqix-meta-bridge.js`, Shopify Custom Pixel directe `facebook.com/tr/` beacons.
- **Serverlaag:** `calqix-capi` op Vercel met Meta CAPI endpoints, Shopify webhooks, Upstash Redis dedup/state, QStash recovery.

Belangrijkste conclusie: de tracking is niet fundamenteel kapot. De code bevat consistente CAPI-sending, hashing, dedup, `_fbc/_fbp` capture, checkout enrichment en recovery. De grootste risico's zitten in externe/live afhankelijkheden die deels buiten code vallen: daadwerkelijke Shopify Customer Event pixel-installatie, webhook subscriptions, Meta Events Manager diagnostics, catalog match rate en of alle Vercel production env vars overeenkomen met de codeverwachting.

Belangrijkste positieve bevindingen:

- **Correcte Pixel ID:** `934134615770602` is consistent aanwezig in browser snippet, Custom Pixel en Vercel env.
- **Meta API versie live:** Vercel CLI `env run -e production` retourneerde `META_API_VERSION=v22.0`.
- **Dedup voor checkout/purchase:** Custom Pixel en server gebruiken gedeelde event IDs zoals `ic_{checkout_token}`, `add_payment_info_{checkout_token}` en `purchase_{checkout_token}`.
- **Hashing:** server hasht PII met SHA-256 na normalisatie.
- **Recovery:** alleen events in `retry_pending`/recovery queue worden opnieuw verstuurd; geen blind resend patroon.

Belangrijkste gaps/risico's:

- **Live Customer Events-status onbekend:** codebestand `calqix-capi/shopify-custom-pixel.js` bestaat, maar de audit bevestigt niet of deze exact geïnstalleerd en connected is in Shopify Admin.
- **Webhook subscriptions onbekend in deze run:** codehandlers bestaan, maar deze audit heeft geen Shopify Admin live query uitgevoerd.
- **Catalog-match risico:** code gebruikt variant/SKU-first catalog IDs. Dat is correct als Meta Commerce catalog retailer IDs variant/SKU zijn, maar fout als catalog product-group IDs verwacht.
- **Browser IC click event is niet 1:1 deduped met checkout-token IC:** theme bridge vuurt `ic_cart_{cartToken}` bij checkout click; Custom Pixel/webhook gebruiken `ic_{checkout_token}`. Dit is bewust gedocumenteerd, maar kan als extra InitiateCheckout touchpoint zichtbaar zijn.
- **Lead form detection bug/risico:** `calqix-meta-bridge.js` zoekt voor nieuwsbrief naar `input[name="contact[email]"][value="newsletter"]`, terwijl Shopify native newsletter meestal `contact[tags]=newsletter` gebruikt en het emailveld ook `contact[email]` heet. Daardoor kan een native nieuwsbriefsubmit mogelijk niet als Lead worden gedetecteerd, afhankelijk van markup.

## Vercel projectmetadata

### Lokaal project

Bron: `.vercel/project.json`.

- **Projectnaam:** `calqix-capi`.
- **Project ID:** `prj_Z70L2xAbEqaomho5K3Gt6fnXTrWv`.

Bron: `calqix-capi/vercel.json`.

- **Rewrite:** `/` wordt herschreven naar `/api/index`.

Bron: Vercel CLI read-only.

- **Team/project:** `calqixs-projects/calqix-capi`.
- **Latest Production URL:** `https://calqix-capi.vercel.app`.
- **Node version:** `24.x`.
- **Recente deployments:** meerdere production deployments met status `Ready`; meest recente getoonde deployment was `https://calqix-capi-mxtah9w4e-calqixs-projects.vercel.app`, leeftijd `1d`, status `Ready`, environment `Production`.

## Vercel environment variables

Bron: Vercel CLI `vercel env ls`, read-only.

Tracking-kritieke env vars die aanwezig zijn:

| Variabele | Vercel status | Scope |
| --- | ---: | --- |
| `META_PIXEL_ID` | Encrypted | Production |
| `META_ACCESS_TOKEN` | Encrypted | Production |
| `META_API_VERSION` | Encrypted | Development, Preview, Production |
| `SHOPIFY_WEBHOOK_SECRET` | Encrypted | Production |
| `UPSTASH_REDIS_REST_URL` | Encrypted | Development, Preview, Production |
| `UPSTASH_REDIS_REST_TOKEN` | Encrypted | Development, Preview, Production |
| `QSTASH_TOKEN` | Encrypted | Development, Preview, Production |
| `QSTASH_CURRENT_SIGNING_KEY` | Encrypted | Development, Preview, Production |
| `QSTASH_NEXT_SIGNING_KEY` | Encrypted | Development, Preview, Production |
| `CRON_SECRET` | Encrypted | Development, Preview, Production |
| `DIAGNOSTICS_KEY` | Encrypted | Development, Preview, Production |
| `TELEGRAM_BOT_TOKEN` | Encrypted | Development, Preview, Production |
| `TELEGRAM_CHAT_ID` | Encrypted | Development, Preview, Production |
| `SHOPIFY_STORE_DOMAIN` | Encrypted | Development, Preview, Production |
| `SHOPIFY_API_KEY` | Encrypted | Production |
| `SHOPIFY_API_SECRET` | Encrypted | Production |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Encrypted | Production + Development |

Niet-geheime Vercel runtime check:

- **`META_API_VERSION`:** `v22.0`.
- **`META_PIXEL_ID`:** `934134615770602`.

Conclusie: de live Vercel API-versie voldoet aan de auditnorm `v22.0+`. De code fallback is nog `v21.0`, maar production env overschrijft dit naar `v22.0`.

## Meta Pixel implementatie in Shopify theme

### `layout/theme.liquid`

Belangrijke feiten:

- GTM web container wordt in `<head>` geladen met container ID `GTM-T86BFXXW`.
- `microsoft-clarity` snippet wordt geladen.
- Voor ingelogde klanten pusht het theme `calqix_user_data` naar `dataLayer` met:
  - `external_id`
  - `em`
  - `ph`
  - `fn`
  - `ln`
  - `ct`
  - `st`
  - `zp`
  - `country`
  - optioneel `db` en `ge` via customer metafields
- `snippets/calqix-meta-pixel-init.liquid` wordt in de `<head>` gerenderd vóór de deferred bridge.
- `assets/calqix-meta-bridge.js` wordt aan het einde van `<body>` geladen met `defer`.

### `snippets/calqix-meta-pixel-init.liquid`

Belangrijke feiten:

- Initialiseert Meta Pixel ID `934134615770602`.
- Vuurt `PageView` met eventID `pv_{timestamp}_{random}`.
- Advanced Matching gebruikt klantdata uit Liquid en fallback `_cq_anon_id` voor anonieme bezoekers.
- Bevat een vangnet om dubbele Meta Pixel tags van derden te blokkeren op dezelfde pixel ID.
- Noscript fallback gebruikt `https://www.facebook.com/tr?id=934134615770602&ev=PageView`.

Beoordeling:

- **Sterk:** inline init vóór bridge voorkomt dat `fbq` ontbreekt wanneer `ViewContent`/`AddToCart` browser events worden afgevuurd.
- **Sterk:** logged-in Advanced Matching kan EMQ significant verhogen.
- **Risico:** GTM kan nog eigen Meta templates bevatten. De snippet probeert dubbeling te blokkeren, maar GTM live-config is niet in code zichtbaar.

## Browser bridge: `assets/calqix-meta-bridge.js`

### Capture en identity

De bridge:

- Persisteert `fbclid` naar `_fbc`.
- Leest/genereert `_fbp`.
- Slaat click IDs op: `gclid`, `gbraid`, `wbraid`, `ttclid`, `ttp`.
- Genereert `_cq_anon_id`.
- Onthoudt bekende e-mail via `_cq_known_email` voor latere anonieme events.
- Synchroniseert `_meta_fbc` en `_meta_fbp` naar Shopify cart attributes via `/cart/update.js`.
- Pusht anonieme `external_id` en eventueel email/phone/country naar `dataLayer` als er nog geen `calqix_user_data` bestaat.

### Browser events

| Event | Browser source | Server endpoint | Event ID strategie | Dedup kwaliteit |
| --- | --- | --- | --- | --- |
| `PageView` | `calqix-meta-pixel-init.liquid` | geen server CAPI endpoint | `pv_*` | Browser-only |
| `ViewContent` | bridge op product pages | `/api/view-content` | `viewcontent_{productId}_{timestamp/random}` via `generateEventId` | Browser/server gedeeld binnen bridge call |
| `AddToCart` | bridge intercepts `/cart/add`, XHR, events | `/api/add-to-cart` | `addtocart_{contentId}_{...}` via `generateEventId` | Browser/server gedeeld binnen bridge call |
| `InitiateCheckout` click | bridge checkout click listener | geen server call vanuit bridge | `ic_cart_{cartToken}` | Niet 1:1 met checkout-token IC |
| `Lead` | bridge nieuwsbrief submit | `/api/lead` | `lead_ns_{sha256(email).slice(0,16)}` | Browser/server gedeeld |

### Belangrijk risico: Lead-detectie

De bridge detecteert nieuwsbrief formulieren via:

- `form.classList.contains('newsletter-form')`, of
- `input[name="contact[email]"][value="newsletter"]`.

Bij Shopify native newsletter is de gebruikelijke marker `contact[tags]=newsletter`, terwijl `contact[email]` het daadwerkelijke emailveld is. Als het themeformulier geen class `newsletter-form` heeft, kan Lead firing gemist worden.

Impact:

- Minder browser/server `Lead` events.
- Minder `_cq_known_email` warming voor anonieme `ViewContent`/`AddToCart` EMQ.

## Shopify Custom Pixel: `calqix-capi/shopify-custom-pixel.js`

Het Custom Pixel bestand is bedoeld voor Shopify Admin > Settings > Customer events.

Tracks:

- `checkout_started` → `InitiateCheckout` browser + server.
- `checkout_contact_info_submitted` → enrichment storage.
- `payment_info_submitted` → `AddPaymentInfo` browser + server.
- `checkout_completed` → `Purchase` browser + server.

Belangrijke feiten:

- Browser event wordt als directe GET naar `https://www.facebook.com/tr/` gestuurd.
- Pixel ID is `934134615770602`.
- Server event gaat naar `https://calqix-capi.vercel.app/api/checkout-event`.
- Dedup IDs:
  - `ic_{checkout_token}`
  - `add_payment_info_{checkout_token}`
  - `purchase_{checkout_token}`
- `_fbp` en `_fbc` worden met de browser beacon meegestuurd.
- Checkout line items gebruiken variant ID en SKU voor catalog matching.

Beoordeling:

- **Sterk:** checkout events hebben 1:1 browser/server event ID dedup.
- **Sterk:** `keepalive` en `credentials: include` verhogen kans dat checkout-completed beacon aankomt.
- **Onbekend:** of deze exacte Custom Pixel code live in Shopify Customer Events is geïnstalleerd, connected en niet gepauzeerd.

## Server-side endpoints en event mapping

| Endpoint | Event(s) | Bron | Dedup/event_id | Meta send? | Opmerkingen |
| --- | --- | --- | --- | ---: | --- |
| `/api/view-content` | `ViewContent` | bridge | client `event_id` of `vc_*` fallback | Ja | Product page CAPI; variant/SKU-first IDs |
| `/api/add-to-cart` | `AddToCart` | bridge | client `event_id` of `atc_*` fallback | Ja | Canonieke ATC serverbron |
| `/api/lead` | `Lead` | bridge | `lead_ns_{emailHash}` | Ja | Nieuwsbrief/lightweight signup |
| `/api/checkout-event` | `InitiateCheckout`, `AddPaymentInfo`, `Purchase`, enrichment | Shopify Custom Pixel | `ic_*`, `add_payment_info_*`, `purchase_*` | Ja, behalve contact enrichment | Belangrijkste checkout pipeline |
| `/api/webhook/checkouts-create` | `InitiateCheckout` | Shopify webhook | `ic_{checkout_token}` | Ja | Fallback/parallel op checkout create |
| `/api/webhook/orders-paid` | `Purchase` | Shopify webhook | `purchase_{checkout_token}` of `purchase_{order.id}` | Ja | Belangrijkste paid-order fallback |
| `/api/webhook/customers-create` | `Lead` | Shopify webhook | `lead_{customer.id}` | Ja | Accountregistratie Lead |
| `/api/webhook/carts-create` | diagnostisch | Shopify webhook | `cart_{cartKey}` | Nee | Bewust geen Meta send om ATC dubbeling te vermijden |
| `/api/identity/capture` | identity enrichment | bridge/checkout | Redis identity keys | Nee | Verrijkt latere events |
| `/api/recovery/run` | retry failed CAPI | QStash | bestaande event_id | Ja, alleen retry queue | Geen blind resend |

## Hashing en user_data

Bron: `calqix-capi/lib/hash.js`.

Server-side hashing:

- `em`: normalized lowercase email → SHA-256.
- `ph`: normalized phone/E.164-ish zonder `+` → SHA-256.
- `fn`, `ln`, `ct`, `st`, `zp`, `country`: genormaliseerd → SHA-256.
- `external_id`: gehasht; fallback kan e-mail zijn.
- `fbc` en `fbp`: blijven raw zoals Meta verwacht.
- `client_ip_address` en `client_user_agent`: raw zoals Meta verwacht.

Beoordeling:

- **Goed:** PII wordt server-side gehasht vóór Meta CAPI.
- **Goed:** logs gebruiken hoofdzakelijk boolean presence flags zoals `hasEmail`, `hasFbc`, `hasFbp`.
- **Aandachtspunt:** sommige identity storage in Redis bewaart ruwe identity voor latere hashing. Dit is functioneel nuttig, maar vereist strikte Redis access control en retention discipline.

## Deduplicatie

### Dedup binnen eigen backend

Bron: `calqix-capi/lib/dedup-guard.js` en `lib/store.js`.

- Dedup keys worden via Upstash Redis bijgehouden.
- Dedup TTL is 48 uur.
- `isDuplicate(eventName, identifier)` voorkomt dubbele sends binnen TTL.

### Meta browser/server dedup

Sterke event ID paren:

- `InitiateCheckout`: Custom Pixel browser `ic_{checkout_token}` ↔ `/api/checkout-event` server `ic_{checkout_token}` ↔ webhook `checkouts-create` `ic_{checkout_token}`.
- `AddPaymentInfo`: Custom Pixel browser `add_payment_info_{checkout_token}` ↔ `/api/checkout-event` server.
- `Purchase`: Custom Pixel browser `purchase_{checkout_token}` ↔ `/api/checkout-event` server ↔ webhook `orders-paid` als checkout token beschikbaar is.
- `Lead` nieuwsbrief: bridge browser `lead_ns_{hash}` ↔ `/api/lead` server.
- `ViewContent`/`AddToCart`: bridge genereert één event ID en gebruikt die voor browser `fbq` en server POST.

Dedup risico's:

- `orders-paid` fallback gebruikt `purchase_{order.id}` als `checkout_token` ontbreekt. Dat dedupt niet met `purchase_{checkout_token}` uit Custom Pixel.
- Bridge checkout-click IC gebruikt `ic_cart_{cartToken}`, niet `ic_{checkout_token}`. Dit is bewust eerder-funnel gedrag, maar kan Meta extra IC-signalen geven.

## Recovery en state machine

Bronnen: `calqix-capi/lib/event-state.js`, `api/recovery/run.js`.

Event lifecycle:

- `received`
- `prepared`
- `sent`
- `confirmed`
- `retry_pending`
- `failed_terminal`
- `recovered`

Redis keys:

- `meta:event:{event_id}` TTL 7d.
- `meta:pending:{event_id}` TTL 7d.
- `meta:failed:{event_id}` TTL 7d.
- `meta:payload:{event_id}` TTL 7d.
- `recovery:queue`.

Recovery behavior:

- QStash schedule: every minute.
- Endpoint: `/api/recovery/run`.
- Batch size: 10.
- Locking via Redis recovery lock.
- Retried only if event state is retryable.
- Confirmed/recovered events are skipped.
- Terminal events are skipped.
- Stored payload contains already-hashed `user_data`, `custom_data`, and `source_url`.

Beoordeling:

- **Goed:** recovery voldoet aan guardrail: geen fake/redundant events; alleen recovery queue.
- **Goed:** payload replay gebruikt hashed user data.

## QStash schedules

Bron: `calqix-capi/scripts/bootstrap.js`.

Belangrijkste tracking/recovery schedules:

| Schedule ID | Endpoint | Cron |
| --- | --- | --- |
| `calqix-recovery` | `/api/recovery/run` | `CRON_TZ=Europe/Amsterdam * * * * *` |
| `calqix-bridge-health` | `/api/cron/bridge-health` | every 10 min |
| `calqix-dedup-audit` | `/api/cron/dedup-audit` | every 30 min |
| `calqix-anomaly-watch` | `/api/cron/anomaly-watch` | every 5 min, 09-23 |
| `calqix-emq-deep` | `/api/cron/emq-deep` | hourly |
| `calqix-pixel-diag` | `/api/cron/pixel-diag` | hourly at :15 |
| `calqix-webhook-audit` | `/api/cron/webhook-audit` | :05 and :35 hourly |
| `calqix-reconciliation` | `/api/cron/reconciliation` | daily 04:00 |
| `calqix-identity-backfill` | `/api/cron/identity-backfill` | every 15 min |
| `calqix-identity-resubmit` | `/api/cron/identity-resubmit` | every 15 min offset |
| `calqix-catalog-sync` | `/api/cron/catalog-sync-monitor` | daily 06:00 |

Onbekend in deze audit:

- Of alle QStash schedules live exact bestaan. De audit heeft `vercel env ls` gebruikt, maar geen `npm run schedule:list` uitgevoerd.

## Shopify app embeds / app blocks in theme code

Bron: `config/settings_data.json`, templates en sections.

Gevonden app blocks:

- **Instafeed:** enabled in global settings/footer.
- **Klaviyo Email Marketing SMS:** onsite embed enabled.
- **Judge.me Reviews:** core/review widget enabled.
- **Seal Subscriptions:** global subscription script disabled; product widget in `product.oralbiome.json` disabled.
- **Google & YouTube:** store widget enabled.
- **Recharge Subscriptions:** app block aanwezig op `templates/product.lumicore.json`.

Tracking-impact:

- Klaviyo kan extra onsite scripts/events injecteren.
- Google & YouTube app kan Google tracking injecteren.
- Judge.me/Instafeed meestal laag Meta-impact.
- Subscription apps kunnen order source/tags wijzigen; `orders-paid.js` detecteert subscription renewals.

## Event Match Quality inschatting

Deze score is een code-gebaseerde inschatting, niet een live Events Manager waarde.

| Event | Verwachte EMQ | Reden |
| --- | ---: | --- |
| `PageView` | 4-7 | Browser Advanced Matching voor logged-in; anoniem vooral `_fbp`, `_fbc`, anon external_id |
| `ViewContent` | 5-8 | Browser + CAPI, `_fbp/_fbc`, known email fallback mogelijk |
| `AddToCart` | 5-8 | Browser + CAPI; email/phone alleen als bekend; `_fbp/_fbc` sterk |
| `InitiateCheckout` | 7-9 | Checkout email/phone + `_fbp/_fbc`; Custom Pixel en server dedup |
| `AddPaymentInfo` | 7-9 | Checkout enrichment aanwezig |
| `Purchase` | 7-9 | Checkout/order PII, fbp/fbc, webhook fallback, enrichment |
| `Lead` nieuwsbrief | 6-8 indien detected | Email direct beschikbaar; risico dat native form niet gedetecteerd wordt |
| `Lead` customer create | 7-9 | Customer email/phone/address beschikbaar |

## Top 5 aanbevolen fixes / verificaties

1. **Verifieer live Shopify Customer Events Custom Pixel**
   - Check of `CALQIX Meta CAPI` connected is.
   - Vergelijk live Shopify pixel code exact met `calqix-capi/shopify-custom-pixel.js`.
   - Test `checkout_started` en `checkout_completed` in Meta Test Events.

2. **Verifieer live Shopify webhook subscriptions**
   - Required topics voor bestaande handlers:
     - `ORDERS_PAID`
     - `CHECKOUTS_CREATE`
     - `CUSTOMERS_CREATE`
     - `CARTS_CREATE`
   - Controleer delivery URL naar `https://calqix-capi.vercel.app/api/webhook/...`.

3. **Valideer Meta Commerce catalog ID-format**
   - Huidige code gebruikt variant ID en SKU als primary catalog IDs.
   - Bevestig in Commerce Manager of `retailer_id` inderdaad variant/SKU is.
   - Als catalog product-group IDs verwacht, dan is dit de grootste catalog-match gap.

4. **Fix/controleer Lead form detection**
   - Controleer of alle nieuwsbrief forms class `newsletter-form` hebben.
   - Als niet: bridge mist mogelijk native Shopify newsletter submits.
   - Dit beïnvloedt Lead tracking en email warming voor latere EMQ.

5. **Live Events Manager audit uitvoeren**
   - Controleer per event:
     - browser/server overlap
     - dedup percentage
     - event match quality
     - diagnostics warnings
     - recent activity
     - event source match rate

## Open vragen voor gebruiker / live systemen

1. Is de Shopify Custom Pixel `CALQIX Meta CAPI` momenteel connected in Customer Events?
2. Zijn de vier Shopify webhook subscriptions live aanwezig?
3. Wat toont Meta Events Manager voor afgelopen 24-72 uur per event?
   - `PageView`
   - `ViewContent`
   - `AddToCart`
   - `InitiateCheckout`
   - `AddPaymentInfo`
   - `Purchase`
   - `Lead`
4. Wat is de actuele Event Match Quality per event in Events Manager?
5. Geeft Meta Diagnostics nog warnings zoals low event source match rate, missing fbp/fbc, dedup issues of invalid content IDs?
6. Welke ID gebruikt de Meta Commerce catalog als `retailer_id`: product ID, variant ID of SKU?

## Conflicten en onbekenden

- **Pixel ID conflict uit externe context:** sommige oude notities noemen een andere pixel, maar repo, Vercel en huidige CALQIX-context bevestigen `934134615770602` als juiste pixel.
- **Code fallback vs live API versie:** code fallback is `v21.0`, maar Vercel production runtime check gaf `v22.0`. Geen direct probleem zolang env aanwezig blijft.
- **Custom Pixel live status onbekend:** bestand bestaat lokaal, installatie in Shopify Admin is niet via CLI bevestigd.
- **Webhook live status onbekend:** handlers bestaan, maar live Shopify subscriptions zijn niet in deze audit opgevraagd.
- **GTM live container onbekend:** repo toont GTM container ID, maar niet welke tags live in GTM staan.
- **Meta Events Manager onbekend:** geen toegang gebruikt tot Meta UI/API diagnostics in deze run.

## Eindoordeel

Op basis van code en Vercel CLI is CALQIX tracking waarschijnlijk niet de primaire oorzaak van slechte performance, mits de Custom Pixel en Shopify webhooks live actief zijn. De implementatie bevat de juiste basis voor hoge matchkwaliteit: browser + server delivery, gedeelde event IDs, `_fbp/_fbc`, hashed PII, checkout enrichment, Redis dedup en recovery.

De meest waarschijnlijke tracking-gerelateerde performance lekken zijn:

1. live installatie/configuratie buiten repo ontbreekt of wijkt af;
2. catalog content ID mismatch;
3. nieuwsbrief/lead capture warming werkt niet op alle formulieren;
4. browser/server overlap of dedup in Meta Events Manager is lager dan de code beoogt;
5. checkout/order fallback gebruikt soms andere event IDs wanneer `checkout_token` ontbreekt.

Zonder live Events Manager data kan niet definitief worden vastgesteld of de site slecht converteert of tracking data verliest. De codebasis zelf wijst echter eerder op een redelijk volwassen trackingstack dan op een volledig gebroken CAPI-implementatie.
