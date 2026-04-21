# CALQIX Klaviyo — Flow setup operator runbook

**Doel:** 5 flows live zetten in Klaviyo UI obv 26 reeds-gecreeerde templates (EN/NL/DE).

**Voorwaarden:**
- `KLAVIYO_PRIVATE_API_KEY`, `KLAVIYO_PUBLIC_API_KEY`, `KLAVIYO_NEWSLETTER_LIST_ID` staan in Vercel env ✅
- `KLAVIYO_SHOPIFY_APP_INSTALLED=true` (default) → onze CAPI dupliceert GEEN `Placed Order / Added to Cart / Checkout Started` meer ✅
- List `UeRAty` (Email List) met double-opt-in bestaat ✅
- 26 templates (Pakket C) reeds gecreeerd via `scripts/klaviyo-seed-calqix-templates.js --apply` ✅

**Bouwvolgorde** (hoogste ROI eerst):
1. Abandoned Cart (herschrijven van live flow `XnTXAH`)
2. Welcome Series (draft `U9KJ43` activeren)
3. Post-Purchase (nieuwe flow bouwen)
4. Browse Abandonment (draft `VJhNs3` activeren)
5. Winback (pas in maand 4+)

---

## Shared conventions

**Locale-splitting** — alle multi-lingual flows gebruiken dezelfde pattern:
1. Eerste blok na trigger: **Conditional Split** → `Profile property: $locale · equals · "nl"` → NL-branch
2. Tweede: `$locale equals "de"` → DE-branch
3. Default (else): EN-branch

**Profile property `$locale`** wordt gezet door:
- Klaviyo Shopify app (uit Shopify customer.locale)
- Onze CAPI (via `buildKlaviyoProfile` → `properties.$locale` — TODO: niet geïmplementeerd, zie checklist §7)

Als `$locale` ontbreekt → default EN (veiligste fallback).

**Smart Sending** — overal aan zetten (Klaviyo UI: flow → Settings → "Smart Sending" = 16h). Voorkomt dat je iemand 2× op dezelfde dag mailt.

**Send-Time Optimization** — Klaviyo's AI feature aan zetten voor Welcome + Post-Purchase (niet Abandoned Cart, daar wil je directe triggers).

---

## Flow 1 — Abandoned Cart (rewrite existing)

**Flow-ID:** `XnTXAH` (Abandoned Checkout Reminder (Email))
**Trigger:** Metric `Checkout Started` (Shopify-native — gebruik deze, NIET "Started Checkout" van onze API)
**Huidige staat:** LIVE met Klaviyo-standaard copy. **Eerst pauzeren** (flow → Manual mode) voor we wijzigen.

### Stappen in UI

1. Klaviyo → **Flows** → klik `Abandoned Checkout Reminder (Email)` → rechtsboven "Live" → zet op **Manual**
2. Verwijder alle bestaande email-blokken
3. Bouw deze structuur:

```
[Trigger: Checkout Started]
  ↓
[Trigger Filter: Placed Order zero times since flow started]
  ↓
[Time Delay: 2 hours]
  ↓
[Conditional Split: $locale equals "nl"]
  ├─ YES → Email: CALQIX — Abandoned Cart T+2h (NL) [WtUqVh]
  └─ NO  → [Conditional Split: $locale equals "de"]
            ├─ YES → Email: CALQIX — Abandoned Cart T+2h (DE) [VQTniE]
            └─ NO  → Email: CALQIX — Abandoned Cart T+2h (EN) [ST4DUj]
  ↓
[Time Delay: 22 hours]  ← (totaal T+24h)
  ↓
[Flow Filter re-check: still no Placed Order]
  ↓
[Conditional Split: $locale] → T+24h email (NL [SNrpyV] / DE [WphazT] / EN [VdSjG3])
  ↓
[Time Delay: 48 hours]  ← (totaal T+72h)
  ↓
[Flow Filter re-check: still no Placed Order]
  ↓
[Conditional Split: $locale] → T+72h email (NL [WVEWR8] / DE [WiDUev] / EN [SbqkWi])
  ↓
[Exit]
```

4. **Elke email-blok instellen:**
   - Subject + preheader zijn al gezet in template → laat ze staan
   - From name: `CALQIX`
   - From email: `info@calqix.com`
   - Reply-to: `info@calqix.com`
   - Tag: `flow:abandoned_cart`

5. **Flow settings:**
   - Smart Sending: ON (16h window)
   - Send-Time Optimization: OFF (AC moet direct)
   - Exit criteria: `Placed Order since flow start`
   - Conversion metric: `Placed Order` (Shopify)

6. **Preview → send test to yourself** (stuur naar je eigen email via "Send Preview")
7. **Manual → Live**

**Verwachte KPI's:** Open rate 35-45%, click rate 8-12%, cart recovery 15-20%.

---

## Flow 2 — Welcome Series (activate draft)

**Flow-ID:** `U9KJ43` (Welcome Series)
**Trigger:** List `UeRAty` (Email List) — Added to List
**Huidige staat:** DRAFT. Bouw graph, dan Live.

### Stappen in UI

1. Flows → klik `Welcome Series`
2. Trigger bevestigen: `Added to list: Email List`
3. Bouw:

```
[Trigger: Added to Email List]
  ↓
[Time Delay: 0 hours (immediate)]
  ↓
[Conditional Split: $locale] → Welcome #1 (NL [WbqpGe] / DE [RXxA4D] / EN [UnYwbK])
  ↓
[Time Delay: 2 days]
  ↓
[Flow Filter: Placed Order zero times since flow start]
  ↓
[Conditional Split: $locale] → Welcome #2 (NL [RSUjHf] / DE [UQK47A] / EN [UVnisY])
  ↓
[Time Delay: 2 days]  (totaal +4d)
  ↓
[Flow Filter re-check]
  ↓
[Conditional Split: $locale] → Welcome #3 (NL [Vp8QnP] / DE [U96K9z] / EN [XNzLvV])
  ↓
[Time Delay: 3 days]  (totaal +7d)
  ↓
[Flow Filter re-check]
  ↓
[Conditional Split: $locale] → Welcome #4 (NL [Tw5GwW] / DE [VivA3r] / EN [XHWwax])
  ↓
[Exit]
```

4. **Elke email instellen** (From/Reply-to hetzelfde als flow 1).
5. **Flow settings:**
   - Smart Sending: ON
   - Send-Time Optimization: ON (use AI-optimal send time)
   - Exit criteria: `Placed Order since flow start`
6. **WELCOME10 discount code** moet actief zijn in Shopify Admin → Discounts. Code **WELCOME10**, 10% off, single-use per customer, expires 7 days after creation. Als je geen eeuwig-geldige bulk-code wil, maak 1 per profile via Shopify's Discount Code API — niet binnen scope van dit runbook.
7. **Manual → Live**

**Verwachte KPI's:** Open rate 45-60% (welkom = hoogste), first-order-conversion 20-35%.

---

## Flow 3 — Post-Purchase Education + Review

**Status:** Nog niet bestaand. Klik **Create Flow → From Scratch**.

### Stappen

1. **Create Flow** → Naam: `CALQIX Post-Purchase Education`
2. Trigger: **Metric** → `Placed Order` (Shopify-native)
3. Trigger filter: `Placed Order count since start of flow is greater than 0` (technisch niet nodig, zekerheidshalve)
4. Bouw:

```
[Trigger: Placed Order (Shopify)]
  ↓
[Time Delay: 0 hours]
  ↓
[Conditional Split: $locale] → PP Day 0 (NL [Rp8MCT] / DE [SyxCwK] / EN [RtL3Yh])
  ↓
[Time Delay: 7 days]
  ↓
[Email: CALQIX — Post-Purchase Day 7 (EN) [UkXw3e]]
   ← EN-only; NL/DE ontvangen alleen Day 0 in hun taal.
     Verklaring in Flow notes: "Day 7+ is content-heavy, EN is brand default."
  ↓
[Time Delay: 21 days]  (totaal +28d)
  ↓
[Email: CALQIX — Post-Purchase Day 28 (EN) [Rivxhv]]
  ↓
[Exit]
```

5. Post-Purchase heeft GEEN exit op `Placed Order` (anders mist 2e order in cycle). Wel **Conversion metric = `Placed Order`** voor revenue reporting.
6. **Manual → Live**

**Verwachte KPI's:** Open rate 40-55% (hoog — customers zijn al warm), review-submission-rate Day 28 mail 3-8%.

---

## Flow 4 — Browse Abandonment (activate draft)

**Flow-ID:** `VJhNs3` (Browse Abandonment)
**Trigger:** Metric `Viewed Product` (API — onze CAPI) — **niet** Shopify-native, want wij zijn de enige bron
**Huidige staat:** DRAFT.

### Stappen

1. Flows → `Browse Abandonment`
2. Trigger bevestigen: `Viewed Product` (integration=API)
3. Trigger filter: **kritiek** — voeg `Viewed Product zero times in last 1 day EXCLUDING THIS ONE` → voorkomt spam bij snelle scrollers
4. Flow filter: `Added to Cart zero times since flow started` + `Placed Order zero times since flow started`
5. Bouw:

```
[Trigger: Viewed Product]
  ↓
[Trigger Filter: no other Viewed Product in last 24h]
  ↓
[Time Delay: 4 hours]
  ↓
[Flow Filter: no Added to Cart, no Placed Order]
  ↓
[Conditional Split: event.ProductID is set]
  ├─ YES → Dynamic product email (use "Browse Abandonment #1 EN" — create if not exists)
  └─ NO  → Exit
```

**Notitie:** Ik heb **geen browse-abandonment template geseed** omdat dynamic-product blocks in Klaviyo UI makkelijker te configureren zijn dan in template HTML. Build in UI met het ingebouwde "Recently Viewed Products" block, dat gebruikt de `ProductID` property uit onze `Viewed Product` metric.

6. **Manual → Live** — pas na email-capture via section in §7 zorgt voor voldoende geïdentificeerde browsers.

**Verwachte KPI's:** Open rate 30-40%, click-to-site 15-25%, conversion 2-5%.

---

## Flow 5 — Winback (deferred to month 4+)

**Status:** Niet bouwen nu. Insufficient data-signal onder 200 klanten.

**In maand 4** wanneer je >500 klanten hebt:
- Trigger: `Segment membership` → `Win-Back Opportunities (Shopify)` (segment `SLWJkD` bestaat al ✅)
- 3 steps: education (+0d) → 15% winback code (+7d) → last chance (+14d)
- Exit: `Placed Order since flow start`

---

## §6 — QA checklist voor elke flow voor je Live zet

- [ ] Flow is in **Manual** mode
- [ ] Elk email-blok heeft template + subject + preheader ingevuld
- [ ] Elke conditional split heeft default (else) branch
- [ ] From/Reply-to is `info@calqix.com` (verified sender in Klaviyo → Settings → Senders)
- [ ] DNS records (SPF, DKIM, DMARC) staan op calqix.com — check via Klaviyo → Settings → Domains
- [ ] Test-send naar jezelf (Preview → Send Preview → je eigen email)
- [ ] Render check op **mobile** (iOS Mail + Gmail app) via test-send
- [ ] Alle links klikken + landen op juiste locale-URL
- [ ] Discount code WELCOME10 werkt in Shopify (voor Welcome + AC T+72h)
- [ ] Flow Filter voor exit-op-Placed-Order is gezet
- [ ] Smart Sending + Send-Time Optimization zijn correct ingesteld per flow
- [ ] Flow → Manual → **Live**

---

## §7 — Pre-requisites die nog NIET klaar zijn

Deze items blokkeren of verzwakken flow-werking:

### 7.1 Locale capture in onze CAPI (30 min code)
Onze `buildKlaviyoProfile` in `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\multi-platform-send.js` zet momenteel geen `$locale` property. Zonder dat valt iedereen in EN-branch. Fix: lees `req.headers['accept-language']` of `body.locale` in de `view-content` en `add-to-cart` endpoints, en pass via `userData.locale` door.

### 7.2 Email capture section op homepage
`@c:\Users\Gebruiker\Desktop\CALQIX Repo\sections\calqix-email-signup.liquid` bestaat maar wordt in geen template aangeroepen. Plaats in:
- `@c:\Users\Gebruiker\Desktop\CALQIX Repo\templates\index.json` (homepage — boven-de-vouw of footer-area)
- Overweeg ook exit-intent popup via Klaviyo Signup Forms

Een Klaviyo onsite embed block staat al actief in `settings_data.json:158` — mogelijk dekt die al deels. Verify in Shopify theme editor.

### 7.3 WELCOME10 discount code in Shopify
Maak aan: Shopify Admin → Discounts → Create discount → **WELCOME10** → 10% off → Requirements: one-time use per customer → Active indefinitely (of maak per-user via Script + API, als je generieke code wil voorkomen).

### 7.4 DNS setup
Check Klaviyo → Settings → Domains → voeg `calqix.com` toe, configureer SPF + DKIM records. Zonder dit komen emails in spam (10-30% delivery loss).

### 7.5 Double-opt-in confirmation email branded
List `UeRAty` is double-opt-in → Klaviyo stuurt een standaard "confirm your email" mail. Die moet ook in CALQIX voice. Klaviyo → Lists → Email List → Settings → Subscribe Confirmation Email → bewerk HTML. **Ik heb hier geen API-ondersteuning voor**, moet handmatig in UI.

---

## §8 — Taal-strategie aantekening voor toekomstige content

Je `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\lib\brand-guardrails.js:88` declareert `languages: ['English']`. Dit conflicteert met de EN+NL+DE keuze die we nu maken voor Klaviyo. **Dit is OK** — de guardrails gelden voor **AI-gegenereerde ad-copy** (Meta ads, Predis). Voor hand-crafted email-templates gaan we multi-lingual maar beperkt (3 talen, niet 28).

**Regel voor toekomstige automation:**
- Meta-ads: Engels only (zoals guardrails zegt)
- Email/Klaviyo: EN + NL + DE (hand-crafted, niet AI-generated)
- Product pagina's / UI strings: alle 28 locales (Shopify-managed)

Update `brand-guardrails.js` NIET — het is scoped voor ads-automation. Aanbeveling: voeg comment toe aan `languages: ['English']` met `// scope: ad copy only; Klaviyo emails are hand-crafted in EN/NL/DE`.

---

## §9 — Template ID reference

Bewaren als lookup — dit staat ook in Klaviyo UI, maar handig bij bulk-edits via API.

| Template name | ID |
|---|---|
| CALQIX — Welcome #1 (EN) | `UnYwbK` |
| CALQIX — Welcome #1 (NL) | `WbqpGe` |
| CALQIX — Welcome #1 (DE) | `RXxA4D` |
| CALQIX — Welcome #2 (EN) | `UVnisY` |
| CALQIX — Welcome #2 (NL) | `RSUjHf` |
| CALQIX — Welcome #2 (DE) | `UQK47A` |
| CALQIX — Welcome #3 (EN) | `XNzLvV` |
| CALQIX — Welcome #3 (NL) | `Vp8QnP` |
| CALQIX — Welcome #3 (DE) | `U96K9z` |
| CALQIX — Welcome #4 (EN) | `XHWwax` |
| CALQIX — Welcome #4 (NL) | `Tw5GwW` |
| CALQIX — Welcome #4 (DE) | `VivA3r` |
| CALQIX — Abandoned Cart T+2h (EN) | `ST4DUj` |
| CALQIX — Abandoned Cart T+2h (NL) | `WtUqVh` |
| CALQIX — Abandoned Cart T+2h (DE) | `VQTniE` |
| CALQIX — Abandoned Cart T+24h (EN) | `VdSjG3` |
| CALQIX — Abandoned Cart T+24h (NL) | `SNrpyV` |
| CALQIX — Abandoned Cart T+24h (DE) | `WphazT` |
| CALQIX — Abandoned Cart T+72h (EN) | `SbqkWi` |
| CALQIX — Abandoned Cart T+72h (NL) | `WVEWR8` |
| CALQIX — Abandoned Cart T+72h (DE) | `WiDUev` |
| CALQIX — Post-Purchase Day 0 (EN) | `RtL3Yh` |
| CALQIX — Post-Purchase Day 0 (NL) | `Rp8MCT` |
| CALQIX — Post-Purchase Day 0 (DE) | `SyxCwK` |
| CALQIX — Post-Purchase Day 7 (EN) | `UkXw3e` |
| CALQIX — Post-Purchase Day 28 (EN) | `Rivxhv` |

---

## §10 — Re-seed / update-in-place

Als je template-copy wilt wijzigen (bv. na A/B test):

1. Edit `@c:\Users\Gebruiker\Desktop\CALQIX Repo\calqix-capi\scripts\klaviyo-seed-calqix-templates.js` → wijzig de relevante `body[]` of `subject`
2. Re-run met **`--force`**:
   ```powershell
   node scripts/klaviyo-seed-calqix-templates.js --apply --force
   ```
3. Klaviyo UI → Templates → verify de wijziging
4. Flows die deze template gebruiken hoeven **niet** opnieuw geactiveerd — templates worden by-reference gebruikt

**Waarschuwing:** `--force` overschrijft ook handmatige edits die iemand in de Klaviyo UI heeft gemaakt. Stem af met operator voor grote edits.

---

## §11 — KPI-dashboard suggestie

Na 4 weken live-data, meet in Klaviyo → Reports:

| Metric | Doel fase-1 (€30-45k/mnd) | Doel fase-3 (€200k/mnd) |
|---|---|---|
| List size | >500 | >15.000 |
| List growth rate | +15%/mnd | +20%/mnd |
| Welcome flow conversion | 20% | 30% |
| Abandoned Cart recovery | 12% | 20% |
| Post-Purchase → review submit | 5% | 12% |
| Email attributed revenue | €5-7k/mnd | €50-70k/mnd (25-35% van totaal) |
| Unsubscribe rate | <0.5%/mail | <0.3%/mail |
| Bounce rate | <1% | <0.5% |

Als Welcome flow conversion <15% blijft na 6 weken: subject-line A/B test op Welcome #1. Als AC recovery <10%: overweeg SMS-augmentation (Text Messaging List → al actief).
