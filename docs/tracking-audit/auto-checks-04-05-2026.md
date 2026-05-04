# CALQIX Fase 2 Auto-checks 04-05-2026

## Scope

Dit rapport legt de self-service pre-flight checks vast voor Fase 2 van de Calqix tracking fix.

Er zijn geen trackingcode-, Shopify-, Vercel-, Meta- of configuratiewijzigingen uitgevoerd.

## Gewijzigde bestanden

- `docs/tracking-audit/auto-checks-04-05-2026.md`

## Bronnen

- Lokale env key aanwezigheid via `calqix-capi/.env.local`
- Meta Marketing API via `META_ACCESS_TOKEN`
- Shopify Admin API via `SHOPIFY_ADMIN_ACCESS_TOKEN`
- Privacy Policy fetch via `https://calqix.com/policies/privacy-policy`
- Lokale codebase analyse uit Fase 1

Secrets zijn niet geprint of opgeslagen.

## AUTO-CHECK 04-05-2026 09:27 - PF.1 Catalog retailer_id

Bron: Meta Marketing API + Shopify Admin API fallback.

### PF.1 resultaat

| Check | Resultaat |
| --- | --- |
| Business catalog endpoint | Niet beschikbaar, API gaf 401 |
| Ad account product catalog endpoint | Niet beschikbaar, API gaf 400 |
| Catalog segment insights endpoint | Niet beschikbaar, API gaf 400 |
| Catalog naam | Niet opgehaald |
| Aantal catalog items | Niet opgehaald |
| Sample `retailer_id`s | Niet opgehaald |
| Shopify Admin product fallback | Niet bruikbaar door Shopify Admin 401 |

### Conclusie

PF.1 is **niet groen**.

De beschikbare API credentials geven wel toegang tot ad account insights, maar niet tot catalog endpoints of Shopify Admin endpoints die nodig zijn om `retailer_id` automatisch te verifiëren.

### Blokkerend punt

Volgens de Fase 2 prompt is dit blokkerend voordat Fix A en Fix C definitief worden gedeployed.

Benodigde handmatige of credential-fix verificatie:

- Controleer in Meta Commerce Manager of `retailer_id` een SKU, Shopify variant ID of Shopify product ID is.
- Of geef API credentials met toegang tot de catalog en Shopify Admin read scopes.

## AUTO-CHECK 04-05-2026 09:27 - PF.2 SubtleCrypto

Bron: lokale toegang en promptbeoordeling.

### PF.2 resultaat

PF.2 is **niet volledig automatisch verifieerbaar** zonder een development Custom Pixel of Shopify sandbox runtime.

Een gewone browsercontext kan `crypto.subtle` ondersteunen, maar dat bewijst niet dat de Shopify Custom Pixel sandbox dezelfde API toestaat.

### PF.2 conclusie

PF.2 is **niet groen**.

Voor Fix A development kan de code defensief worden gebouwd met:

- Eerst `crypto.subtle.digest` gebruiken als beschikbaar.
- Fallback pad voorbereiden als Shopify sandbox dit blokkeert.

Maar productie-deploy vereist nog Custom Pixel sandbox test.

## AUTO-CHECK 04-05-2026 09:27 - PF.3 Privacy Policy

Bron: fetch `https://calqix.com/policies/privacy-policy`.

### Automatische keyword-check

| Check | Resultaat |
| --- | --- |
| Meta of Facebook vermeld | Ja |
| Gehashte identifiers of identifiers vermeld | Ja |
| Retentie of maximumperiode vermeld | Ja |
| Cookie of opt-out mechanisme vermeld | Ja |

### Belangrijke nuance

De automatische excerpt bevatte ook ingesloten tracking-scripttekst uit de HTML. Daardoor kan de keyword-check false positives bevatten.

### PF.3 conclusie

PF.3 is **niet voldoende groen voor Fix D** op basis van alleen deze automatische check.

Fix D, Redis identity warming, moet niet gedeployed worden totdat de privacy policy expliciet dekt:

- hashing van email, phone en address voor advertentie-tracking;
- doorzending naar Meta Conversions API;
- Redis of server-side opslag van identifiers;
- duidelijke TTL of retentieperiode;
- opt-out of cookie-instellingen.

Fix A, B en C zijn hierdoor niet geblokkeerd, behalve door PF.1/PF.2.

## AUTO-CHECK 04-05-2026 09:27 - Custom Pixel installatie status

Bron: Shopify Admin API `web_pixels.json`.

### Custom Pixel resultaat

Shopify Admin API gaf 401.

### Custom Pixel conclusie

Custom Pixel installatiestatus kon niet automatisch worden bevestigd.

Dit blokkeert geen lokale development, maar moet worden bevestigd voordat live validatie in Meta Test Events wordt verwacht.

## AUTO-CHECK 04-05-2026 09:27 - Webhook subscriptions

Bron: Shopify Admin API `webhooks.json`.

### Webhook resultaat

Shopify Admin API gaf 401.

### Webhook conclusie

Webhook subscriptions konden niet automatisch worden bevestigd.

Dit is vooral relevant voor Fix D. Fix D blijft geblokkeerd.

## AUTO-CHECK 04-05-2026 09:27 - EMQ baseline

Bron: Meta Marketing API event match quality endpoints.

### EMQ resultaat

| Endpoint | Resultaat |
| --- | --- |
| Pixel `event_match_quality` | Niet beschikbaar, API gaf 400 |
| Pixel `event_diagnostics` | Niet beschikbaar, API gaf 400 |

### EMQ conclusie

EMQ baseline kon niet via deze Graph endpoints worden opgehaald.

Meta Events Manager blijft nodig voor EMQ screenshot of een ander werkend endpoint moet worden gevonden.

## AUTO-CHECK 04-05-2026 09:27 - Performance baseline last 30 days

Bron: Meta Marketing API ad account insights.

### Performance resultaat

| Metric | Waarde |
| --- | ---: |
| Spend | 826.66 |
| Impressions | 40916 |
| Clicks | 1674 |
| Purchase ROAS | 0.437048 |
| ViewContent | 1549 |
| AddToCart | 174 |
| InitiateCheckout | 71 |
| AddPaymentInfo | 17 |
| Purchase | 11 |

Periode uit API response:

- Start: 04-04-2026
- Stop: 03-05-2026

### Funnel ratios

| Ratio | Waarde |
| --- | ---: |
| AddToCart / ViewContent | 11.23% |
| InitiateCheckout / AddToCart | 40.80% |
| AddPaymentInfo / InitiateCheckout | 23.94% |
| Purchase / AddPaymentInfo | 64.71% |
| Purchase / ViewContent | 0.71% |

### Performance conclusie

Performance baseline is beschikbaar. De funnel toont dat tracking of conversievolume laag is op Purchase-niveau, maar deze baseline bewijst op zichzelf geen catalog mismatch.

## Samenvatting pre-flight status

| Check | Status | Blokkeert |
| --- | --- | --- |
| PF.1 Catalog retailer_id | Niet groen | Fix A/C deploy, mogelijk development review |
| PF.2 SubtleCrypto sandbox | Niet groen | Fix A production deploy |
| PF.3 Privacy Policy | Niet groen voor Fix D | Fix D |
| Custom Pixel status | Niet bevestigd | Live testplanning |
| Webhooks | Niet bevestigd | Fix D |
| EMQ baseline | Niet via API beschikbaar | Monitoring, niet lokale code |
| Performance baseline | Groen | Geen |

## Aanbevolen volgende stap

Omdat PF.1 en PF.2 volgens de prompt verplicht groen moeten zijn voordat Fase 2 start, is de veilige status:

- Geen productie-deploy.
- Geen Fix D.
- Fix A/B/C development kan pas na expliciete bevestiging dat development ondanks PF.1/PF.2 mag starten, of nadat de ontbrekende checks handmatig/API-matig groen zijn gemaakt.

## Benodigde menselijke actie of credential-fix

1. PF.1: bevestig `retailer_id` in Meta Commerce Manager of geef catalog API toegang.
2. PF.2: voer SubtleCrypto test uit in een development Custom Pixel sandbox.
3. PF.3: bevestig privacy policy dekking voor Redis identity warming als Fix D gewenst is.

## Stop punt

Conform Fase 2 regels stop ik hier voordat trackingcode wordt gewijzigd.

## Appendix Doorbraak pre-flight 04-05-2026 09:37

### Token diagnose

#### Meta access token

Bron: Meta Graph API `debug_token`.

| Check | Resultaat |
| --- | --- |
| Debug endpoint | 200 |
| Token type | `SYSTEM_USER` |
| App ID aanwezig | Ja |
| User ID aanwezig | Ja |
| Catalog-relevante scopes aanwezig | Ja |
| Ontbrekende catalog-relevante scopes | Geen |

Aanwezige relevante scopes:

- `read_insights`
- `catalog_management`
- `ads_management`
- `ads_read`
- `business_management`
- `pages_read_engagement`

Conclusie: het Meta token heeft voldoende scopes. De eerdere catalog-fout kwam niet door ontbrekende scopes, maar door een onjuist of leeg business discovery pad.

#### Shopify Admin token

Bron: Shopify Admin API.

| Endpoint | Status |
| --- | ---: |
| `/admin/api/2025-01/shop.json` | 401 |
| `/admin/api/2025-01/products.json?limit=1` | 401 |
| `/admin/api/2025-01/web_pixels.json` | 401 |
| `/admin/api/2025-01/webhooks.json` | 401 |

Conclusie: het Shopify Admin token in `.env.local` is kapot, verlopen of niet geldig voor deze shop. Dit is geen scope-only probleem, omdat zelfs `shop.json` 401 geeft.

### Catalog doorbraak

#### Route C: campaign promoted object

Bron: Meta Marketing API ad account campaigns.

| Check | Resultaat |
| --- | --- |
| Ad account | `act_2108393566376667` |
| Route C status | 200 |
| Gevonden catalog ID | `1549301396145400` |

#### Catalog details

Bron: Meta Graph API catalog object.

| Field | Waarde |
| --- | --- |
| Catalog ID | `1549301396145400` |
| Catalog naam | `Shopify Product Catalog (uipq4d-jj.myshopify.com) - 2026-03-08 System User` |
| Product count | 21 |

#### Product samples

Bron: Meta Graph API catalog products.

| `retailer_id` | Naam | Beschikbaarheid | Prijs |
| --- | --- | --- | ---: |
| `CALQIX-OBP-30-CM` | OralBiome Pro Menthe fraîche | in stock | € 19,95 |
| `CALQIX-OBP-30-CO` | OralBiome Pro Citrus Orange | in stock | € 19,95 |
| `CALQIX-OBP-30-FM` | OralBiome Pro Fresh Mint | in stock | € 24,95 |
| `CALQIX-OBP-30-P` | OralBiome Pro Peach | in stock | € 19,95 |
| `54065091346761` | OralBiome Pro Grape | in stock | € 19,95 |
| `54065088299337` | OralBiome Pro Peach | in stock | € 19,95 |
| `54065079845193` | OralBiome Pro Citrus Orange | in stock | € 19,95 |
| `54065072177481` | OralBiome Pro Cool mint | in stock | € 19,95 |
| `CALQIX-OBP-30` | OralBiome Pro Fresh Mint | in stock | € 19,95 |
| `54056139391305` | OralBiome Pro Fresh Mint | in stock | € 19,95 |

#### Route E: product breakdown

Bron: Meta Ads Insights met `breakdowns=product_id`.

Route E status: 200.

Voorbeelden van Meta `product_id` waarden:

- `53918702207305, FlowCore Midnight Black`
- `53918712561993, FlowCore Clinical White`
- `53918714495305, FlowCore Lime Green`
- `53918714593609, FlowCore Blush Pink`
- `53974656483657, FlowCore Travel Pouch`
- `54056139391305, OralBiome Pro Fresh Mint`
- `54065072177481, OralBiome Pro Cool mint`
- `54065079845193, OralBiome Pro Citrus Orange`
- `54065088299337, OralBiome Pro Peach`
- `CALQIX-OBP-30-FM, OralBiome Pro Fresh Mint`
- `flowcore-blk, FlowCore Midnight Black`

#### PF.1 conclusie na doorbraak

PF.1 is **groen**.

Catalog `retailer_id` gebruikt een gemengd patroon:

- SKU waarden zoals `CALQIX-OBP-30-FM`
- Shopify variant-ID-achtige numerieke waarden zoals `54065088299337`
- SKU slugs zoals `flowcore-blk`

De huidige code stuurt variant ID en SKU eerst en valt daarna terug op product ID. Dit pad is correct voor de gevonden catalogstructuur.

Actie:

- Fix A mag niet meer door catalog matching worden geblokkeerd.
- Fix C mag niet meer door catalog matching worden geblokkeerd.
- Geen catalog-ID architectuurwijziging nodig.

### EMQ endpoint doorbraak

Bron: Meta Graph API pixel endpoints.

| Endpoint | Status | Resultaat |
| --- | ---: | --- |
| `/{pixel_id}/stats?fields=event,quality` | 200 | Endpoint werkt, maar gaf 0 rijen |
| `/{pixel_id}/activities?fields=event,event_match_quality_score` | 400 | Niet bruikbaar |
| `/{pixel_id}?fields=name,description,event_quality,event_quality_summary` | 400 | Niet bruikbaar |
| `/{pixel_id}/server_event_diagnostics` | 400 | Niet bruikbaar |

Conclusie: EMQ baseline blijft niet betrouwbaar via API beschikbaar. Meta Events Manager screenshot of UI export blijft nodig voor EMQ score baseline. Dit blokkeert Fix B niet en blokkeert lokale Fix A/C development niet.

### Privacy Policy diepe parse

Bron: `https://calqix.com/policies/privacy-policy`, met script en style tags verwijderd voor tekstextractie.

| Check | Resultaat |
| --- | --- |
| Meta CAPI vermeld | Ja |
| Hashing uitleg aanwezig | Ja |
| Retentieperiode aanwezig | Ja |
| Opt-out of cookie mechanisme aanwezig | Ja |

Relevante gevonden tekst:

- Data categories omvatten identity data, contact data, delivery data, behavioural data en marketing interaction data.
- Marketing cookies worden op consent basis geplaatst.
- De policy noemt Meta Pixel en Conversions API.
- De policy noemt conversion tracking, retargeting, lookalike audiences en campaign performance measurement.
- De policy noemt cookie preferences en marketing opt-in/opt-out status.

PF.3 is **groen voor policy-inhoud**.

Belangrijke beperking:

- Fix D blijft technisch geblokkeerd zolang Shopify webhook status niet bevestigd is en zolang er geen veilige identity-warming implementatie is gereviewed.

### Beslismatrix na doorbraak

| Pre-flight | Status | Actie |
| --- | --- | --- |
| PF.1 catalog | Groen via Route C/E | Fix A en Fix C mogen door catalog niet worden geblokkeerd |
| PF.2 SubtleCrypto | Niet groen | Fix A production deploy wacht op sandbox-test of fallback library |
| PF.3 Privacy | Groen voor policy-inhoud | Fix D juridisch mogelijk, maar technisch nog niet vrij |
| Shopify token | Kapot, 401 op `shop.json` | Token vervangen of Shopify UI fallback gebruiken |
| Custom Pixel status | Niet bevestigd | Bevestigen via Shopify UI of Meta Test Events |
| Webhooks status | Niet bevestigd | Bevestigen via Vercel logs of Shopify UI |
| EMQ baseline | API niet bruikbaar | Screenshot of UI baseline nodig |
| Performance baseline | Groen | Gebruiken als business baseline |

### Fix beslissing na doorbraak

| Fix | Status | Reden |
| --- | --- | --- |
| Fix A browser beacon advanced matching | Startbaar voor development, production wacht op PF.2 | Catalog is groen, hashing runtime nog niet |
| Fix B state mapping | Startbaar | Onafhankelijk van catalog en SubtleCrypto |
| Fix C bridge VC/ATC identity | Startbaar | Catalog is groen, server hashing bestaat |
| Fix D Redis identity warming | Skip vandaag | Webhooks niet bevestigd en extra veiligheidsreview nodig |

### Samenvattende update

`[PRE-FLIGHT DOORBRAAK 04-05-2026 09:37]`

- PF.1: groen via Route C en Route E, catalog ID `1549301396145400`
- PF.2: niet groen, Shopify Custom Pixel sandbox-test ontbreekt
- PF.3: groen voor policy-inhoud
- Shopify token: kapot, 401 op alle endpoints
- Custom Pixel: niet bevestigd via API
- Webhooks: niet bevestigd via API
- EMQ endpoint: pixel stats werkt maar geeft 0 rijen, overige EMQ endpoints niet bruikbaar

Beslissing:

- Fix A: development kan starten met runtime fallback, production pas na PF.2
- Fix B: kan starten
- Fix C: kan starten
- Fix D: skip vandaag
