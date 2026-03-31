# CALQIX Tracking Migration Checklist

## Van: FB Sales Channel + Vercel CAPI → Naar: GTM-only (browser + server)

### Doel
Migreren naar een single tracking stack via GTM web + server containers,
met behoud van historische data en Custom Audiences op Pixel ID `1400881244790983`.

---

## Pre-migratie checks

- [ ] Verifieer dat GTM web container (GTM-T86BFXXW) het juiste Pixel ID gebruikt: `1400881244790983`
- [ ] Verifieer dat GTM server container (GTM-K4LPNF8L) het juiste Pixel ID + Access Token gebruikt
- [ ] Verifieer dat TAGGRS data layer event_id genereert die gedeeld wordt tussen web en server tags
- [ ] Controleer dat Aggregated Event Measurement (AEM) is geconfigureerd met juiste event prioriteiten:
  - Purchase (hoogste)
  - InitiateCheckout
  - AddToCart
  - ViewContent
  - Lead
  - PageView (laagste)
- [ ] Maak een backup van alle Custom Audiences (exporteer als CSV vanuit Meta Ads Manager)
- [ ] Noteer huidige EMQ scores per event type als baseline
- [ ] Verifieer dat facebook-domain-verification meta tag aanwezig is in theme.liquid

---

## Migratie stappen (in volgorde)

### Stap 1: Activeer GTM Meta pixel tag
- [ ] Un-pause de Meta/Facebook pixel tag in GTM web container (GTM-T86BFXXW)
- [ ] Verifieer in GTM Preview mode dat pixel events correct vuren

### Stap 2: Activeer GTM Meta CAPI tag
- [ ] Un-pause de Meta CAPI tag in GTM server container (GTM-K4LPNF8L)
- [ ] Verifieer dat server events binnenkomen in TAGGRS debug view

### Stap 3: Publiceer containers
- [ ] Publiceer GTM web container
- [ ] Publiceer GTM server container

### Stap 4: Test
- [ ] Test met Meta Pixel Helper browser extension
- [ ] Test in Meta Events Manager → Test Events tab
- [ ] Verifieer dat events correct binnenkomen met source "Browser and Server"
- [ ] Controleer dat event_id matcht tussen browser en server events (deduplicatie)

### Stap 5: Wacht en verifieer (24 uur)
- [ ] Wacht minimaal 24 uur
- [ ] Check Events Manager → Overview: zijn alle event types zichtbaar?
- [ ] Check dat er geen dubbele events zijn (vergelijk event counts met baseline)

### Stap 6: Schakel custom Vercel CAPI uit
- [ ] Zet `CAPI_ENABLED=false` in Vercel Dashboard → Environment Variables
- [ ] Verifieer in Vercel logs dat events worden gelogd maar NIET verstuurd
- [ ] Wacht 24 uur en check Events Manager

### Stap 7: Verwijder Shopify FB & Instagram sales channel
- [ ] Ga naar Shopify Admin → Settings → Apps and sales channels → Facebook
- [ ] Verwijder de sales channel
- [ ] Dit stopt zowel de Shopify native browser pixel als de Shopify native CAPI
- [ ] Verifieer in Events Manager dat events nog steeds binnenkomen (nu alleen via GTM)

### Stap 8: Cleanup theme bestanden
- [ ] Verwijder de calqix-meta-bridge.js script tag uit layout/theme.liquid
- [ ] Optioneel: verwijder assets/calqix-meta-bridge.js

### Stap 9: Finale verificatie
- [ ] Wacht 48 uur voor EMQ score refresh
- [ ] Check EMQ scores: doel is 8.0+ voor Purchase
- [ ] Verifieer dat Custom Audiences nog functioneren
- [ ] Verifieer dat Lookalike Audiences nog data ontvangen

---

## Rollback plan

Als events wegvallen na stap 6-7:

1. Zet `CAPI_ENABLED=true` in Vercel Dashboard (heractiveer custom CAPI)
2. Herinstalleer de Shopify FB & Instagram sales channel
3. Koppel aan het juiste Pixel ID (`1400881244790983`) in Meta Business Settings
4. Pause de GTM Meta tags opnieuw
5. Analyseer wat er fout ging in Events Manager → Diagnostics

### Wat behouden blijft bij rollback
- Custom Audiences blijven intact zolang hetzelfde Pixel ID wordt gebruikt
- Historische event data gaat niet verloren
- De Vercel CAPI endpoints zijn nog operationeel (alleen gepauzeerd via env var)

---

## Tijdlijn

| Stap | Geschatte duur | Target datum |
|---|---|---|
| Pre-migratie checks | 1 dag | TBD |
| Stap 1-4 (activeren + test) | 1 dag | TBD |
| Stap 5 (wachten) | 24 uur | TBD |
| Stap 6 (Vercel CAPI uit) | 5 min + 24 uur wachten | TBD |
| Stap 7 (FB channel verwijderen) | 5 min + 48 uur wachten | TBD |
| Stap 8-9 (cleanup + verificatie) | 1 dag | TBD |
| **Totaal** | **~5-7 dagen** | TBD |
