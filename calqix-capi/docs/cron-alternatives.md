# CALQIX Ads Monitor - Cron Alternatieven

Het `/api/ads/monitor` endpoint wordt idealiter dagelijks om 07:00 CET getriggerd.
Vercel Cron is geconfigureerd in `vercel.json`, maar vereist het **Pro plan**.

Als je op het Hobby plan zit, gebruik dan een van deze alternatieven:

---

## Optie 1: cron-job.org (GRATIS, aanbevolen)

1. Ga naar [cron-job.org](https://cron-job.org) en maak een gratis account
2. Voeg een nieuwe cron job toe:
   - **URL**: `https://calqix-capi.vercel.app/api/ads/monitor?secret={CRON_SECRET}`
   - **Schedule**: elke dag om 07:00 CET
   - **Method**: GET
3. Klaar — betrouwbaar en geen code nodig

---

## Optie 2: GitHub Actions (GRATIS)

Maak `.github/workflows/daily-monitor.yml` in je repo:

```yaml
name: Daily Ads Monitor
on:
  schedule:
    - cron: '0 5 * * *'   # 05:00 UTC = 07:00 CET
jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - run: curl -s "https://calqix-capi.vercel.app/api/ads/monitor?secret=${{ secrets.CRON_SECRET }}"
```

Voeg `CRON_SECRET` toe als GitHub Actions secret:
Repo > Settings > Secrets and variables > Actions > New repository secret

---

## Optie 3: Handmatig (SIMPELST)

1. Maak een bookmark: `https://calqix-capi.vercel.app/api/ads/monitor?secret={CRON_SECRET}`
2. Open elke ochtend als onderdeel van je routine
3. Telegram notificatie wordt alsnog verstuurd

---

## Opmerking

Het maakt niet uit wie het endpoint triggert (Vercel Cron, cron-job.org, GitHub Actions, of jijzelf).
Het endpoint voert dezelfde checks uit en stuurt alleen een Telegram bericht als er actie nodig is.
