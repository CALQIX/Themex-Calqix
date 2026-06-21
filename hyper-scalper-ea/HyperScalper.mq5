//+------------------------------------------------------------------+
//|                                                 HyperScalper.mq5  |
//|                                  Calqix - scalable hyper scalper  |
//|                                                                  |
//|  "Always in the market" profit-recycling scalper for MT5.        |
//|                                                                  |
//|  Behaviour:                                                      |
//|   - Scales lot size with account size (balance ratio / risk %).  |
//|   - Opens a position, closes it as soon as the profit target is  |
//|     reached, then immediately re-opens a new one.                |
//|   - Optional grid/averaging when price moves against the basket. |
//|   - Hard risk brakes: max spread, stop loss, daily max loss,     |
//|     max equity drawdown -> trading halts.                        |
//|                                                                  |
//|  WARNING: profit-recycling + averaging is martingale-like and    |
//|  can wipe an account in a single adverse move. Always test on a  |
//|  demo account first and keep the risk brakes enabled.            |
//+------------------------------------------------------------------+
#property copyright "Calqix"
#property version   "1.00"
#property strict
#property description "Scalable hyper scalper: scales lot with account size, closes at profit, re-opens continuously."

#include <Trade/Trade.mqh>

//--- enums --------------------------------------------------------------------
enum ENUM_LOT_MODE
  {
   LOT_FIXED,            // Fixed lot
   LOT_BALANCE_RATIO,    // Scale lot with balance (lot per balance step)
   LOT_RISK_PERCENT      // Risk % of balance per stop loss
  };

enum ENUM_DIRECTION
  {
   DIR_FOLLOW_TREND,     // Follow fast MA trend
   DIR_BUY,              // Always buy
   DIR_SELL,             // Always sell
   DIR_ALTERNATE         // Alternate buy/sell each cycle
  };

enum ENUM_TARGET_MODE
  {
   TARGET_MONEY,         // Fixed money amount (account currency)
   TARGET_PERCENT_BAL    // Percent of balance
  };

//--- inputs: lot sizing -------------------------------------------------------
input group "=== Lot sizing (scales with account size) ==="
input ENUM_LOT_MODE InpLotMode        = LOT_BALANCE_RATIO; // Lot sizing mode
input double        InpFixedLot       = 0.01;     // Fixed lot (LOT_FIXED)
input double        InpBalancePerStep = 1000.0;   // Balance per lot step (LOT_BALANCE_RATIO)
input double        InpLotPerStep     = 0.01;     // Lot added per balance step
input double        InpRiskPercent    = 1.0;      // Risk % per trade (LOT_RISK_PERCENT)
input double        InpMaxLot         = 5.0;      // Hard cap on lot size

//--- inputs: entry / direction ------------------------------------------------
input group "=== Entry (always in market) ==="
input ENUM_DIRECTION InpDirection     = DIR_FOLLOW_TREND; // Trade direction
input int           InpTrendMAPeriod  = 50;       // MA period for trend (DIR_FOLLOW_TREND)
input ENUM_TIMEFRAMES InpTrendTF      = PERIOD_M1;// Timeframe for trend MA

//--- inputs: profit target / close --------------------------------------------
input group "=== Profit target (close then re-open) ==="
input ENUM_TARGET_MODE InpTargetMode  = TARGET_MONEY;  // Profit target mode
input double        InpTargetMoney    = 5.0;      // Target profit in money (TARGET_MONEY)
input double        InpTargetPercent  = 0.5;      // Target profit % of balance (TARGET_PERCENT_BAL)

//--- inputs: grid / averaging (optional, off by default) ----------------------
input group "=== Grid / averaging (optional) ==="
input bool          InpEnableGrid     = false;    // Enable grid averaging
input double        InpGridStepPoints = 200;      // Distance (points) before adding to basket
input double        InpGridMultiplier = 1.5;      // Lot multiplier for each grid level
input int           InpMaxGridLevels  = 5;        // Max positions in a basket

//--- inputs: risk brakes ------------------------------------------------------
input group "=== Risk brakes ==="
input double        InpStopLossPoints = 0;        // Stop loss in points (0 = none, required for RISK_PERCENT)
input double        InpMaxSpreadPoints= 50;       // Skip entries above this spread (points, 0 = ignore)
input double        InpDailyMaxLoss   = 0;        // Daily max loss in money (0 = off) -> halt for the day
input double        InpMaxDrawdownPct = 25.0;     // Max equity drawdown % from peak (0 = off) -> halt

//--- inputs: misc -------------------------------------------------------------
input group "=== Misc ==="
input ulong         InpMagic          = 990011;   // Magic number
input int           InpSlippagePoints = 20;       // Max slippage (points)
input string        InpComment        = "HyperScalper";

//--- globals ------------------------------------------------------------------
CTrade   trade;
int      g_maHandle      = INVALID_HANDLE;
double   g_dayStartEquity= 0.0;
int      g_dayOfYear     = -1;
double   g_equityPeak    = 0.0;
bool     g_halted        = false;
int      g_lastDirBuy    = -1;   // for DIR_ALTERNATE: 1=last was buy, 0=last was sell

//+------------------------------------------------------------------+
//| Initialization                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints((ulong)InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(InpLotMode==LOT_RISK_PERCENT && InpStopLossPoints<=0)
     {
      Print("ERROR: LOT_RISK_PERCENT requires InpStopLossPoints > 0.");
      return(INIT_PARAMETERS_INCORRECT);
     }

   if(InpDirection==DIR_FOLLOW_TREND)
     {
      g_maHandle=iMA(_Symbol,InpTrendTF,InpTrendMAPeriod,0,MODE_EMA,PRICE_CLOSE);
      if(g_maHandle==INVALID_HANDLE)
        {
         Print("ERROR: failed to create MA handle.");
         return(INIT_FAILED);
        }
     }

   g_equityPeak    = AccountInfoDouble(ACCOUNT_EQUITY);
   ResetDayAnchor();

   PrintFormat("HyperScalper init OK on %s. LotMode=%d Target=%s",
               _Symbol,(int)InpLotMode,
               (InpTargetMode==TARGET_MONEY?"money":"percent"));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Deinit                                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   if(g_maHandle!=INVALID_HANDLE)
      IndicatorRelease(g_maHandle);
  }

//+------------------------------------------------------------------+
//| Main tick handler                                                |
//+------------------------------------------------------------------+
void OnTick()
  {
   UpdateDayAnchor();
   UpdateEquityPeak();

   // Risk brakes ------------------------------------------------------------
   if(RiskBrakeTriggered())
     {
      // brakes only stop NEW entries; existing positions still close on target
      ManageOpenBasket();
      return;
     }

   int myPositions = CountMyPositions();

   if(myPositions==0)
     {
      OpenInitialPosition();
      return;
     }

   // Manage the running basket: close on target, or add a grid level.
   ManageOpenBasket();
  }

//+------------------------------------------------------------------+
//| Manage the currently open basket                                 |
//+------------------------------------------------------------------+
void ManageOpenBasket()
  {
   int myPositions = CountMyPositions();
   if(myPositions==0)
      return;

   double basketProfit = BasketProfit();
   double target       = TargetProfitMoney();

   if(basketProfit>=target && target>0)
     {
      CloseAllMyPositions();
      return; // next tick re-opens
     }

   if(InpEnableGrid)
      MaybeAddGridLevel();
  }

//+------------------------------------------------------------------+
//| Open the first position of a new cycle                           |
//+------------------------------------------------------------------+
void OpenInitialPosition()
  {
   if(!SpreadOK())
      return;

   bool buy = DecideDirection();
   double lot = CalcLot();
   if(lot<=0)
      return;

   OpenPosition(buy,lot);
  }

//+------------------------------------------------------------------+
//| Add a grid level when price moves against the basket             |
//+------------------------------------------------------------------+
void MaybeAddGridLevel()
  {
   int levels = CountMyPositions();
   if(levels>=InpMaxGridLevels)
      return;
   if(!SpreadOK())
      return;

   // Determine basket direction from the first position and the worst price.
   bool   basketBuy   = true;
   double anchorPrice = 0.0;     // price of the most recent (worst) entry
   double firstLot    = 0.0;
   double lastLot     = 0.0;
   datetime lastTime  = 0;
   bool   found       = false;

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic)
         continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol)
         continue;

      long type=PositionGetInteger(POSITION_TYPE);
      double openP=PositionGetDouble(POSITION_PRICE_OPEN);
      double vol  =PositionGetDouble(POSITION_VOLUME);
      datetime t  =(datetime)PositionGetInteger(POSITION_TIME);

      if(!found)
        {
         basketBuy=(type==POSITION_TYPE_BUY);
         firstLot =vol;
         found=true;
        }
      if(t>=lastTime)
        {
         lastTime=t;
         anchorPrice=openP;
         lastLot=vol;
        }
     }
   if(!found)
      return;

   double point=_Point;
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);

   bool addLevel=false;
   if(basketBuy)
      addLevel = (anchorPrice - ask) >= InpGridStepPoints*point; // price dropped enough
   else
      addLevel = (bid - anchorPrice) >= InpGridStepPoints*point; // price rose enough

   if(!addLevel)
      return;

   double nextLot = NormalizeLot(lastLot*InpGridMultiplier);
   if(nextLot<=0)
      return;

   OpenPosition(basketBuy,nextLot);
  }

//+------------------------------------------------------------------+
//| Send an order                                                    |
//+------------------------------------------------------------------+
void OpenPosition(bool buy,double lot)
  {
   double sl=0.0,tp=0.0;
   double point=_Point;
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);

   if(InpStopLossPoints>0)
     {
      if(buy) sl=NormalizePrice(ask-InpStopLossPoints*point);
      else    sl=NormalizePrice(bid+InpStopLossPoints*point);
     }

   bool ok;
   if(buy)
      ok=trade.Buy(lot,_Symbol,0.0,sl,tp,InpComment);
   else
      ok=trade.Sell(lot,_Symbol,0.0,sl,tp,InpComment);

   if(!ok)
      PrintFormat("Order failed: %s lot=%.2f retcode=%d (%s)",
                  buy?"BUY":"SELL",lot,trade.ResultRetcode(),trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Decide trade direction                                           |
//+------------------------------------------------------------------+
bool DecideDirection()
  {
   switch(InpDirection)
     {
      case DIR_BUY:  return true;
      case DIR_SELL: return false;
      case DIR_ALTERNATE:
        {
         bool buy=(g_lastDirBuy!=1); // flip from last
         g_lastDirBuy=buy?1:0;
         return buy;
        }
      case DIR_FOLLOW_TREND:
      default:
        {
         double ma[2];
         if(CopyBuffer(g_maHandle,0,0,2,ma)<2)
            return true; // fallback
         double price=SymbolInfoDouble(_Symbol,SYMBOL_BID);
         return (price>=ma[0]); // above MA -> buy, below -> sell
        }
     }
  }

//+------------------------------------------------------------------+
//| Lot calculation (scales with account size)                       |
//+------------------------------------------------------------------+
double CalcLot()
  {
   double lot=0.0;
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);

   switch(InpLotMode)
     {
      case LOT_FIXED:
         lot=InpFixedLot;
         break;

      case LOT_BALANCE_RATIO:
        {
         double steps=MathFloor(balance/InpBalancePerStep);
         lot=steps*InpLotPerStep;
         if(lot<=0)
            lot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
         break;
        }

      case LOT_RISK_PERCENT:
        {
         double riskMoney=balance*InpRiskPercent/100.0;
         double valuePerPoint=ValuePerPointPerLot();
         double lossPerLot=InpStopLossPoints*valuePerPoint;
         if(lossPerLot>0)
            lot=riskMoney/lossPerLot;
         break;
        }
     }

   if(lot>InpMaxLot)
      lot=InpMaxLot;

   return NormalizeLot(lot);
  }

//+------------------------------------------------------------------+
//| Money value of 1 point for 1 lot                                 |
//+------------------------------------------------------------------+
double ValuePerPointPerLot()
  {
   double tickValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   double tickSize =SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickSize<=0)
      return tickValue; // safe fallback
   return tickValue*(_Point/tickSize);
  }

//+------------------------------------------------------------------+
//| Profit target in money                                           |
//+------------------------------------------------------------------+
double TargetProfitMoney()
  {
   if(InpTargetMode==TARGET_MONEY)
      return InpTargetMoney;
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);
   return balance*InpTargetPercent/100.0;
  }

//+------------------------------------------------------------------+
//| Sum floating P/L of my positions (incl. swap)                    |
//+------------------------------------------------------------------+
double BasketProfit()
  {
   double total=0.0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic)
         continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol)
         continue;
      total+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
     }
   return total;
  }

//+------------------------------------------------------------------+
//| Count my open positions on this symbol                           |
//+------------------------------------------------------------------+
int CountMyPositions()
  {
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic)
         continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol)
         continue;
      n++;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| Close all my positions on this symbol                            |
//+------------------------------------------------------------------+
void CloseAllMyPositions()
  {
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic)
         continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol)
         continue;
      if(!trade.PositionClose(ticket))
         PrintFormat("Close failed ticket=%I64u retcode=%d (%s)",
                     ticket,trade.ResultRetcode(),trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
//| Spread filter                                                    |
//+------------------------------------------------------------------+
bool SpreadOK()
  {
   if(InpMaxSpreadPoints<=0)
      return true;
   long spread=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   return (spread<=(long)InpMaxSpreadPoints);
  }

//+------------------------------------------------------------------+
//| Risk brakes: returns true if NEW entries must be blocked         |
//+------------------------------------------------------------------+
bool RiskBrakeTriggered()
  {
   if(g_halted)
      return true;

   double equity=AccountInfoDouble(ACCOUNT_EQUITY);

   // Daily max loss
   if(InpDailyMaxLoss>0)
     {
      double dayPnL=equity-g_dayStartEquity;
      if(dayPnL<=-InpDailyMaxLoss)
        {
         PrintFormat("RISK: daily max loss hit (%.2f). Halting new entries today.",dayPnL);
         return true;
        }
     }

   // Max equity drawdown from peak
   if(InpMaxDrawdownPct>0 && g_equityPeak>0)
     {
      double ddPct=(g_equityPeak-equity)/g_equityPeak*100.0;
      if(ddPct>=InpMaxDrawdownPct)
        {
         PrintFormat("RISK: max drawdown hit (%.2f%%). Halting EA.",ddPct);
         g_halted=true;
         return true;
        }
     }

   return false;
  }

//+------------------------------------------------------------------+
//| Day anchor handling                                              |
//+------------------------------------------------------------------+
void ResetDayAnchor()
  {
   g_dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
   MqlDateTime dt;
   TimeCurrent(dt);
   g_dayOfYear=dt.day_of_year;
  }

void UpdateDayAnchor()
  {
   MqlDateTime dt;
   TimeCurrent(dt);
   if(dt.day_of_year!=g_dayOfYear)
      ResetDayAnchor();
  }

void UpdateEquityPeak()
  {
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity>g_equityPeak)
      g_equityPeak=equity;
  }

//+------------------------------------------------------------------+
//| Normalize helpers                                                |
//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double minv=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxv=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(step<=0) step=0.01;

   lot=MathFloor(lot/step)*step;
   if(lot<minv) lot=minv;
   if(lot>maxv) lot=maxv;

   int digits=(int)MathMax(0,-MathLog10(step)+0.5);
   return NormalizeDouble(lot,digits);
  }

double NormalizePrice(double price)
  {
   return NormalizeDouble(price,_Digits);
  }
//+------------------------------------------------------------------+
