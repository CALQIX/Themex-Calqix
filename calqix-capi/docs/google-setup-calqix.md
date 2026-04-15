# CALQIX Google Layer — Setup Guide

## Overzicht
De Google layer bestaat uit drie onderdelen die naast de bestaande Meta CAPI pipeline draaien:

1. **GA4 Measurement Protocol** — server-side events naar Google Analytics 4
2. **Google Ads OCI** — offline conversion import via REST API v17
3. **Google OAuth** — token management voor Google Ads API access

## Deel 1 — Google Cloud Project

**Project**: Calqix Tracking Hub (`project-38c1f326-1f73-40ef-a7e`)

### APIs controleren
1. Ga naar [console.cloud.google.com](https://console.cloud.google.com)
2. Selecteer project "Calqix Tracking Hub"
3. **APIs & Services → Enabled APIs & services**
4. Controleer dat deze APIs enabled zijn:
   - Google Ads API
   - Google Analytics Admin API (optioneel)

## Deel 2 — OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. App naam: **CALQIX Tracking Hub** (of "Calqix Tracking Hub")
3. User support email: jouw email
4. Publishing status:
   - **Testing** = alleen test users, refresh tokens verlopen na 7 dagen
   - **In production** = alle gebruikers, tokens verlopen niet
5. Scopes nodig: `https://www.googleapis.com/auth/adwords`
6. Als je in Testing modus bent, voeg je Google account toe als test user

### Van Testing naar Production
1. Klik "PUBLISH APP" op de consent screen pagina
2. Als je minder dan 100 gebruikers hebt en geen gevoelige scopes, is review niet nodig

## Deel 3 — Web OAuth Client

**Locatie**: APIs & Services → Credentials → OAuth 2.0 Client IDs

| Veld | Waarde |
|------|--------|
| **Type** | Web application |
| **Client ID** | `96448711830-opgl38553gamju5vpnv3jp83ee2etojp.apps.googleusercontent.com` |
| **Authorized redirect URIs** | `https://calqix-capi.vercel.app/api/google/oauth/callback` |

### Redirect URIs — regels
- Alleen **één** stabiele productie-URL
- **NOOIT** een Vercel preview URL (`calqix-capi-xxx-calqixs.vercel.app`)
- Schema, host en pad moeten **exact** matchen
- Geen trailing slash tenzij in de URI geregistreerd
- Geen wildcards

### Oude/foute redirect URIs verwijderen
In Google Cloud Console → Credentials → klik op de client → verwijder alle URIs behalve:
```
https://calqix-capi.vercel.app/api/google/oauth/callback
```

## Deel 4 — Desktop OAuth Client

| Veld | Waarde |
|------|--------|
| **Type** | Desktop app |
| **Client ID** | `96448711830-k1lg2uba3tvj91nlmlmk28jq04r3dl50.apps.googleusercontent.com` |

Gebruik alleen voor lokale development/CLI tooling. Niet in productie.

## Deel 5 — Google Ads API

### Manager Account (MCC)
- **Manager ID**: `514-003-5966`
- Open via [ads.google.com](https://ads.google.com) → selecteer manager account
- **Tools & Settings → API Center** → hier staat de developer token

### Developer Token
- **Token**: `9jKlg4QvLkGbNuFcuVK29g`
- Status: check of Basic/Standard (Basic is rate-limited maar werkt)
- Als status "Test" is: alleen test accounts mogelijk

### Customer Account
- **Customer ID**: `534-849-4850`
- Dit is het ads account waar conversies naartoe gaan

### Conversion Action
- **Conversion Action ID**: `AW-18050194876`
- **Type**: moet "Import → Upload clicks" zijn voor OCI
- **Locatie**: Tools & Settings → Conversions → klik op de actie → controleer type
- Als dit een gtag conversie is in plaats van upload clicks: maak een nieuwe aan

### Nieuwe conversion action aanmaken (indien nodig)
1. Tools & Settings → Conversions
2. **+ New conversion action** → **Import**
3. Kies: **Upload clicks**
4. Naam: "CALQIX Purchase Import"
5. Category: Purchase/Sale
6. Value: Use the value from each conversion
7. Count: Every conversion
8. Click-through conversion window: 90 days
9. Sla de numeric conversion action ID op

## Deel 6 — GA4

### Property
- **Property ID**: `530537320`
- **Measurement ID**: `G-99R7FCM5H1`
- **Stream ID**: `14280543365`

### Measurement Protocol API Secret
1. [analytics.google.com](https://analytics.google.com) → Admin
2. Data Streams → klik op web stream
3. **Measurement Protocol API secrets** → Create
4. Naam: "CALQIX CAPI"
5. Kopieer de secret → al ingesteld als `GA4_API_SECRET`

### Debug / Validatie
1. In GA4: **Realtime** rapport openen
2. Stuur test event via debug endpoint:
   ```
   curl -X POST "https://www.google-analytics.com/debug/mp/collect?measurement_id=G-99R7FCM5H1&api_secret=AZsSa7MmTd6sfG8Sk50THw" \
     -H "Content-Type: application/json" \
     -d '{"client_id":"test.123","events":[{"name":"test_event","params":{}}]}'
   ```
3. Debug endpoint retourneert validatie errors in response body

## Deel 7 — Vercel Environment Variables

### Alle Google env vars (production)
| Variabele | Waarde | Omgeving |
|-----------|--------|----------|
| `GOOGLE_CLOUD_PROJECT_ID` | `project-38c1f326-1f73-40ef-a7e` | Production |
| `GA4_MEASUREMENT_ID` | `G-99R7FCM5H1` | Production |
| `GA4_API_SECRET` | `AZsSa7MmTd6sfG8Sk50THw` | Production |
| `GA4_STREAM_ID` | `14280543365` | Production |
| `GA4_PROPERTY_ID` | `530537320` | Production |
| `GA4_ENABLED` | `true` | Production |
| `GOOGLE_ADS_CUSTOMER_ID` | `5348494850` | Production |
| `GOOGLE_ADS_MANAGER_ID` | `5140035966` | Production |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | `***` | Production |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | `AW-18050194876` | Production |
| `GOOGLE_ADS_ENABLED` | `false` → `true` na OAuth | Production |
| `GOOGLE_OAUTH_CLIENT_ID` | `96448711830-...` | Production |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `***` | Production |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://calqix-capi.vercel.app/api/google/oauth/callback` | Production |
| `GOOGLE_ENABLED` | `true` | Production |

### Env vars die NOOIT branch-specific mogen afwijken
- `GOOGLE_OAUTH_REDIRECT_URI` — moet altijd de productie callback zijn
- `GOOGLE_ADS_CUSTOMER_ID` — één account
- `GOOGLE_ADS_MANAGER_ID` — één MCC

### Na env var wijziging
1. `vercel --prod` om te redeployen
2. Of push naar main (auto-deploy)

## Deel 8 — Troubleshooting

### 400 redirect_uri_mismatch
- **Oorzaak**: redirect_uri in de request matcht niet met Google Cloud Console
- **Fix**: check exact de URI in GOOGLE_OAUTH_REDIRECT_URI vs Google Cloud → Credentials → client → Authorized redirect URIs
- Let op: trailing slash verschil, http vs https, hoofdletters

### invalid_grant
- **Oorzaak**: refresh token verlopen (testing mode) of ingetrokken
- **Fix**: voer consent flow opnieuw uit via `/api/google/oauth/start?secret=CRON_SECRET&force=true`

### access token scope insufficient
- **Oorzaak**: token heeft niet de adwords scope
- **Fix**: re-consent met force=true

### developer token invalid / prohibited
- **Oorzaak**: token is nog in "Test" status of verkeerde MCC
- **Fix**: check API Center in Google Ads manager account

### preview URL gebruikt als callback
- **Oorzaak**: GOOGLE_OAUTH_REDIRECT_URI bevat een Vercel preview URL
- **Fix**: gebruik alleen `https://calqix-capi.vercel.app/api/google/oauth/callback`

---

## OAuth Flow — Stap voor stap

### Eerste keer (refresh token verkrijgen)
1. Deploy naar productie: `vercel --prod`
2. Open in browser:
   ```
   https://calqix-capi.vercel.app/api/google/oauth/start?secret=JOUW_CRON_SECRET
   ```
3. Log in met het Google account dat Google Ads toegang heeft
4. Accepteer de consent screen
5. Je wordt teruggestuurd naar de callback
6. Check de response — `has_refresh_token: true` moet verschijnen
7. Check health: `https://calqix-capi.vercel.app/api/google/oauth/health?secret=JOUW_CRON_SECRET`
8. Zet `GOOGLE_ADS_ENABLED=true` in Vercel
9. Redeploy

### Token status controleren
```
https://calqix-capi.vercel.app/api/google/oauth/health?secret=JOUW_CRON_SECRET
```
