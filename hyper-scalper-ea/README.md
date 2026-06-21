# HyperScalper (MT5 Expert Advisor)

Een "altijd in de markt" winst-recycling scalper voor MetaTrader 5, zoals gevraagd:

- **Schaalt de lotsize mee met de accountgrootte** (hoe groter het saldo, hoe groter de lot).
- **Sluit bij winst en heropent direct** een nieuwe positie — continu doorrollen.
- **Harde risico-remmen** ingebouwd (spread-filter, stop loss, daily max loss, max drawdown).

> ⚠️ **Belangrijk / disclaimer.** Een strategie die continu posities heropent en de inzet
> met de accountgrootte opschaalt, is martingale-/grid-achtig van karakter. Dat kan lange tijd
> mooi ogen en vervolgens in één ongunstige beweging een account leegtrekken. Dit is **geen
> financieel advies**. Test **eerst** uitgebreid op een demo-account en houd de risico-remmen aan.
> Trading op echt geld is voor eigen risico.

---

## Installatie

1. Open MetaTrader 5 → **File → Open Data Folder**.
2. Plaats `HyperScalper.mq5` in `MQL5/Experts/`.
3. Open **MetaEditor** (F4), open het bestand en klik **Compile** (F7). Je krijgt `HyperScalper.ex5`.
4. Terug in MT5: in de **Navigator** verschijnt de EA onder *Expert Advisors*. Sleep 'm op een chart.
5. Zet rechtsboven **Algo Trading** aan (de knop moet groen zijn) en vink in de EA-dialoog
   *Allow Algo Trading* aan.

## Eerst testen (aanrader)

Gebruik de **Strategy Tester** (Ctrl+R):
- Kies het symbool en de timeframe.
- Model: *Every tick based on real ticks* voor de meest realistische test.
- Test minstens 6–12 maanden, daarna *forward test* op demo.

---

## Hoe het werkt

1. Geen open posities? → EA opent een positie (richting volgens `InpDirection`).
2. Lotsize wordt bepaald door de gekozen `InpLotMode` (zie hieronder) en geschaald met je saldo.
3. Zodra de zwevende winst van de basket het doel (`InpTargetMoney` of `InpTargetPercent`) raakt,
   sluit de EA alles en opent op de volgende tick weer een nieuwe positie.
4. Optioneel: bij `InpEnableGrid=true` voegt de EA posities toe als de prijs tegen je in beweegt
   (averaging). Standaard **uit**.
5. Risico-remmen blokkeren nieuwe entries (of stoppen de EA) zodra een limiet wordt geraakt.

---

## Instellingen

### Lotsize (schaalt mee met account)
| Input | Uitleg |
|---|---|
| `InpLotMode` | `LOT_BALANCE_RATIO` (standaard), `LOT_RISK_PERCENT`, of `LOT_FIXED`. |
| `InpFixedLot` | Vaste lot bij `LOT_FIXED`. |
| `InpBalancePerStep` | Per dit bedrag saldo komt er `InpLotPerStep` lot bij. Bv. €1000 → +0.01 lot. |
| `InpLotPerStep` | Lot die per saldo-stap wordt toegevoegd. |
| `InpRiskPercent` | Risico % per trade bij `LOT_RISK_PERCENT` (vereist een stop loss). |
| `InpMaxLot` | Harde bovengrens op de lotsize. |

**Voorbeeld (`LOT_BALANCE_RATIO`):** bij `InpBalancePerStep=1000`, `InpLotPerStep=0.01`:
- €1.000 saldo → 0.01 lot
- €5.000 saldo → 0.05 lot
- €25.000 saldo → 0.25 lot (afgekapt op `InpMaxLot` indien lager)

### Richting (altijd in de markt)
| Input | Uitleg |
|---|---|
| `InpDirection` | `DIR_FOLLOW_TREND` (volgt snelle EMA), `DIR_BUY`, `DIR_SELL`, `DIR_ALTERNATE`. |
| `InpTrendMAPeriod` / `InpTrendTF` | Periode/timeframe van de trend-EMA bij `DIR_FOLLOW_TREND`. |

### Winstdoel (sluiten → heropenen)
| Input | Uitleg |
|---|---|
| `InpTargetMode` | `TARGET_MONEY` (vast bedrag) of `TARGET_PERCENT_BAL` (% van saldo, schaalt mee). |
| `InpTargetMoney` | Winstdoel in geld. |
| `InpTargetPercent` | Winstdoel als % van saldo. |

### Grid / averaging (optioneel, standaard uit)
| Input | Uitleg |
|---|---|
| `InpEnableGrid` | Zet averaging aan. **Verhoogt risico sterk.** |
| `InpGridStepPoints` | Afstand (points) tegen je in vóór een extra positie wordt geopend. |
| `InpGridMultiplier` | Lot-vermenigvuldiger per grid-niveau (bv. 1.5). |
| `InpMaxGridLevels` | Max aantal posities in één basket. |

### Risico-remmen
| Input | Uitleg |
|---|---|
| `InpStopLossPoints` | Stop loss in points (0 = geen; verplicht bij `LOT_RISK_PERCENT`). |
| `InpMaxSpreadPoints` | Sla nieuwe entries over boven deze spread (0 = negeren). |
| `InpDailyMaxLoss` | Dagelijks max verlies in geld → blokkeert nieuwe entries die dag (0 = uit). |
| `InpMaxDrawdownPct` | Max equity-drawdown vanaf de piek in % → stopt de EA (0 = uit). |

### Overig
| Input | Uitleg |
|---|---|
| `InpMagic` | Magic number; de EA beheert alleen eigen posities op dit symbool. |
| `InpSlippagePoints` | Max toegestane slippage. |
| `InpComment` | Order-commentaar. |

---

## Aanbevolen veilige startinstellingen (demo)

- `InpLotMode = LOT_BALANCE_RATIO`, `InpBalancePerStep = 2000`, `InpLotPerStep = 0.01`, `InpMaxLot = 0.5`
- `InpTargetMode = TARGET_PERCENT_BAL`, `InpTargetPercent = 0.3`
- `InpStopLossPoints = 300` (afhankelijk van symbool/volatiliteit)
- `InpEnableGrid = false`
- `InpDailyMaxLoss = 3% van je saldo`, `InpMaxDrawdownPct = 15`

Begin klein, meet het resultaat over genoeg trades, en schaal pas op als het over een
representatieve periode robuust blijkt.
