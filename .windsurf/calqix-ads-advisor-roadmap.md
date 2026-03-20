# CALQIX Ads Advisor — Roadmap

> Automatisch Meta advertentie-performance analyseren, advies genereren, en dat advies terugvertalen naar uitvoerbare acties in Meta Ads Manager.

---

## Bestaande koppelingen (beschikbaar)

| Koppeling | Locatie | Functie |
|---|---|---|
| calqix-capi (Vercel) | `calqix-capi/` | Server-side Purchase, AddToCart, Checkout, Lead events → Meta CAPI |
| META_ACCESS_TOKEN | Vercel env var | Authenticatie met Meta |
| META_PIXEL_ID | Vercel env var | Pixel identificatie |
| fbc/fbp cookie bridge | `assets/calqix-meta-bridge.js` | Browser↔server event matching (EMQ) |
| Shopify webhooks | Orders, carts, checkouts, customers | Realtime e-commerce data |

---

## Fase 1 — Read-Only Performance Advies (1-2 dagen)

### Doel
Dagelijks Meta Ads performance data ophalen, correleren met Shopify order data, en een adviesrapport genereren.

### Technisch
- **Meta Marketing API** (`/act_{ad_account_id}/insights`) — ophalen van:
  - Campaign/Ad Set/Ad level metrics: spend, impressions, reach, clicks, CTR, CPM, CPA, ROAS, frequency
  - Breakdowns: leeftijd, geslacht, plaatsing, device, dag
- **Shopify Admin API** — ophalen van:
  - Orders (revenue, producten, korting, verzendkosten)
  - Customer data (repeat purchase rate, LTV)
  - Product margins (indien beschikbaar via metafields)
- **Correlatie-engine** — matcht Meta ad_id/campaign_id met Shopify orders via UTM parameters of CAPI event data
- **Adviesrapport** — JSON + leesbaar rapport met:
  - Top/bottom performers per campaign, ad set, ad
  - ROAS vs werkelijke marge analyse
  - Frequency alerts (creative vermoeidheid)
  - Audience performance ranking
  - Budget allocatie suggesties

### Vereisten
- `ads_read` permission op Meta App (App Review nodig)
- Ad Account ID (`act_XXXXXXXXX`)
- Cron job (Vercel Cron of externe scheduler) voor dagelijkse run

### Output
Adviesrapport als JSON endpoint + optioneel e-mail notificatie.

---

## Fase 2 — Automatische Regels op Basis van Advies (3-5 dagen)

### Doel
Het advies uit Fase 1 automatisch vertalen naar concrete acties die via de Meta Ads Management API worden uitgevoerd.

### Regelset (configureerbaar)

| Regel | Trigger | Actie |
|---|---|---|
| Lage ROAS | ROAS < 1.5 voor ≥ 3 dagen | Pauzeer ad set |
| Hoge CPA | CPA > drempel EN LTV < 2x CPA | Pauzeer ad set |
| Creative fatigue | CTR < 0.8% EN frequency > 3.0 | Pauzeer ad |
| Winner scaling | ROAS > 3.0 voor ≥ 3 dagen | Budget +20% (max cap) |
| Audience shift | Audience A 2x+ beter dan B | Budget herverdelen |
| Spend zonder conversie | Spend > €50 en 0 conversies | Pauzeer ad set |
| Hoge LTV compensatie | CPA > drempel MAAR LTV > 3x CPA | Behoud, budget +10% |

### Technisch
- **Meta Ads Management API** — schrijfacties:
  - `POST /act_{id}/adsets` — budget update
  - `POST /{adset_id}` — status PAUSED/ACTIVE
  - `POST /{ad_id}` — status PAUSED/ACTIVE
- **Execution loop**:
  1. Fase 1 rapport genereren
  2. Regels evalueren tegen rapport data
  3. Voorgestelde acties loggen (audit trail)
  4. Acties uitvoeren via API
  5. Resultaat bevestigen en loggen
- **Safety guards**:
  - Max budget increase per dag: 30%
  - Minimaal 3 dagen data voordat een regel triggert
  - Handmatige override lijst (campaigns die nooit automatisch gepauzeerd worden)
  - Dry-run modus (alleen advies, geen uitvoering)

### Vereisten
- `ads_management` permission op Meta App (App Review nodig, 1-5 werkdagen)
- System User token met juiste scope

---

## Fase 3 — Closed-Loop: Advies → Uitvoering → Evaluatie → Bijsturing (1-2 weken)

### Doel
Een volledig gesloten feedback loop waarin:
1. Performance data wordt opgehaald
2. Advies wordt gegenereerd
3. Acties worden uitgevoerd
4. De resultaten van die acties worden geëvalueerd
5. De regelset/strategie wordt bijgestuurd op basis van die evaluatie

### Architectuur

```
┌─────────────────────────────────────────────────────────────┐
│                    DAGELIJKSE CYCLUS                         │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ 1. DATA  │──▶│ 2. ADVIES│──▶│ 3. ACTIE │──▶│4. EVAL  │ │
│  │ ophalen  │   │ genereren│   │ uitvoeren│   │ meten   │ │
│  └──────────┘   └──────────┘   └──────────┘   └────┬────┘ │
│       ▲                                             │      │
│       └─────────────────────────────────────────────┘      │
│                    feedback loop                            │
└─────────────────────────────────────────────────────────────┘
```

### Evaluatie-engine
Na elke uitgevoerde actie wordt het effect gemeten:

| Actie uitgevoerd | Evaluatie na 48-72 uur | Bijsturing |
|---|---|---|
| Ad set gepauzeerd | Was ROAS inderdaad laag? Totale campaign ROAS verbeterd? | Regel bevestigen of drempel aanpassen |
| Budget verhoogd | ROAS behouden na scaling? CPA gestegen? | Terugdraaien als CPA > 20% gestegen |
| Ad gepauzeerd (fatigue) | Andere ads in set beter gaan presteren? | Nieuwe creative nodig signaleren |
| Budget herverdeeld | Winnende audience nog steeds beter? | Verdere consolidatie of spreiding |

### Leercomponent
- Historische actie-resultaat paren opslaan
- Drempels automatisch bijstellen op basis van wat werkt voor dit specifieke account
- Weekrapport met: "Deze week X acties uitgevoerd, Y resultaat, Z geleerd"

### Technisch
- **Actie-log database** (Vercel KV of externe DB):
  - `{ action_id, type, target_id, trigger_rule, timestamp, metrics_before }`
- **Evaluatie cron** (48-72 uur na actie):
  - Ophalen metrics_after voor zelfde target
  - Vergelijken met metrics_before
  - Score toekennen aan regeleffectiviteit
- **Drempel-tuning**:
  - Per regel een confidence score bijhouden
  - Regels met lage confidence → alleen advies (geen auto-execute)
  - Regels met hoge confidence → auto-execute

### Optioneel: AI-laag
- LLM-gestuurde analyse van edge cases die niet in vaste regels passen
- Creative performance scoring op basis van ad copy/visual patronen
- Predictive budget allocation op basis van historische seizoenspatronen

---

## Vereiste Meta Permissions

| Permission | Fase | Review nodig |
|---|---|---|
| `ads_read` | 1, 2, 3 | Ja (App Review) |
| `ads_management` | 2, 3 | Ja (App Review) |
| `business_management` | 3 (optioneel) | Ja |

## Eerste stap
1. Meta Business App aanmaken/updaten met `ads_read` scope
2. Ad Account ID vastleggen
3. App Review indienen bij Meta
4. Zodra goedgekeurd: Fase 1 bouwen

---

*Geparkeerd — eerst OralBiome product pagina afmaken.*
