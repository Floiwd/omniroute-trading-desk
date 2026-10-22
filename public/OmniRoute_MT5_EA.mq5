//+------------------------------------------------------------------+
//|                                           OmniRoute_MT5_EA.mq5   |
//|                        Passerelle Automatique Gratuite Web -> MT5 |
//|                                  https://omniroute-trading-desk  |
//+------------------------------------------------------------------+
#property copyright "OmniRoute Trading Desk"
#property link      "https://omniroute-trading-desk.vercel.app"
#property version   "1.00"
#property description "Expert Advisor gratuit connecte a OmniRoute Trading Desk."
#property description "Ouvre et redige automatiquement les ordres detectes par l'IA."

#include <Trade\Trade.mqh>

CTrade trade;

//--- Parametres d'entree
input group "=== Configuration OmniRoute Desk ==="
input string   InpBridgeUrl         = "https://omniroute-trading-desk.vercel.app/api/mt5/orders"; // URL de la passerelle
input string   InpSecretKey         = "";                                                         // Cle secrete (optionnel)
input int      InpCheckIntervalSec  = 2;                                                          // Verification toutes les X secondes
input bool     InpAutoExecute       = true;                                                       // Executer directement sans confirmation
input ulong    InpMagicNumber       = 8882026;                                                    // Magic Number
input ulong    InpDeviationPips     = 10;                                                         // Slippage max (en points)

datetime lastExecutedTime = 0;
string   lastProcessedId  = "";

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpDeviationPips);
   trade.SetTypeFilling(ORDER_FILLING_FOK);
   
   EventSetTimer(InpCheckIntervalSec);
   Print(">>> [OmniRoute MT5 Bridge] Initialise avec succes. En ecoute sur : ", InpBridgeUrl);
   Print(">>> IMPORTANT: Assurez-vous d'avoir autorise l'URL dans MT5 (Outils -> Options -> Expert Advisors -> Autoriser WebRequest pour : https://omniroute-trading-desk.vercel.app)");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print(">>> [OmniRoute MT5 Bridge] Arrete.");
}

//+------------------------------------------------------------------+
//| Expert timer function (polling)                                  |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckPendingOrders();
}

//+------------------------------------------------------------------+
//| Interrogation de l'API OmniRoute                                 |
//+------------------------------------------------------------------+
void CheckPendingOrders()
{
   string headers = "User-Agent: OmniRoute-MT5-EA\r\nContent-Type: application/json\r\n";
   if(StringLen(InpSecretKey) > 0)
      headers += "X-Secret-Key: " + InpSecretKey + "\r\n";

   char post[], result[];
   string result_headers;
   int res = WebRequest("GET", InpBridgeUrl, headers, 3000, post, result, result_headers);

   if(res == 200)
   {
      string jsonResponse = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      ProcessOrderJson(jsonResponse);
   }
   else if(res == -1)
   {
      int err = GetLastError();
      if(err == 4014)
         Print(">>> [ERREUR] WebRequest non autorise ! Ajoutez 'https://omniroute-trading-desk.vercel.app' dans Outils -> Options -> Expert Advisors.");
   }
}

//+------------------------------------------------------------------+
//| Extraction simple du JSON sans bibliotheque externe              |
//+------------------------------------------------------------------+
string ExtractJsonString(const string json, const string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   pos += StringLen(search);
   int end = StringFind(json, "\"", pos);
   if(end < 0) return "";
   return StringSubstr(json, pos, end - pos);
}

double ExtractJsonDouble(const string json, const string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return 0.0;
   pos += StringLen(search);
   // Skip spaces or quotes
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == '\"')) pos++;
   int end = pos;
   while(end < StringLen(json))
   {
      ushort c = StringGetCharacter(json, end);
      if((c >= '0' && c <= '9') || c == '.') end++;
      else break;
   }
   return StringToDouble(StringSubstr(json, pos, end - pos));
}

//+------------------------------------------------------------------+
//| Traitement et execution de l'ordre recu                          |
//+------------------------------------------------------------------+
void ProcessOrderJson(const string json)
{
   string orderId   = ExtractJsonString(json, "id");
   if(orderId == "" || orderId == lastProcessedId) return;

   string symbol    = ExtractJsonString(json, "symbol");
   string orderType = ExtractJsonString(json, "order_type");
   double lots      = ExtractJsonDouble(json, "lots");
   double price     = ExtractJsonDouble(json, "price");
   double sl        = ExtractJsonDouble(json, "sl");
   double tp        = ExtractJsonDouble(json, "tp");

   if(symbol == "" || lots <= 0) return;

   // Adapter le symbole si votre broker utilise un suffixe (ex: EURUSD.m, XAUUSDpro)
   if(!SymbolInfoInteger(symbol, SYMBOL_SELECT))
   {
      SymbolSelect(symbol, true);
   }

   string msg = StringFormat(">>> [OmniRoute] NOUVEL ORDRE RECIPER : %s %s | Lots: %.2f | Prix: %.5f | SL: %.5f | TP: %.5f",
                             orderType, symbol, lots, price, sl, tp);
   Print(msg);

   if(!InpAutoExecute)
   {
      int answer = MessageBox("Executer l'ordre OmniRoute ?\n\n" + msg, "OmniRoute MT5", MB_YESNO | MB_ICONQUESTION);
      if(answer != IDYES)
      {
         lastProcessedId = orderId;
         return;
      }
   }

   bool ok = false;
   if(orderType == "BUY" || orderType == "MARKET_BUY")
   {
      ok = trade.Buy(lots, symbol, 0, sl, tp, "OmniRoute AI");
   }
   else if(orderType == "SELL" || orderType == "MARKET_SELL")
   {
      ok = trade.Sell(lots, symbol, 0, sl, tp, "OmniRoute AI");
   }
   else if(orderType == "SELL_STOP")
   {
      ok = trade.SellStop(lots, price, symbol, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }
   else if(orderType == "SELL_LIMIT")
   {
      ok = trade.SellLimit(lots, price, symbol, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }
   else if(orderType == "BUY_LIMIT")
   {
      ok = trade.BuyLimit(lots, price, symbol, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }
   else if(orderType == "BUY_STOP")
   {
      ok = trade.BuyStop(lots, price, symbol, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }
   else if(orderType == "SELL_STOP_LIMIT")
   {
      double stopLimit = ExtractJsonDouble(json, "stop_limit_price");
      if(stopLimit <= 0) stopLimit = price;
      ok = trade.OrderOpen(symbol, ORDER_TYPE_SELL_STOP_LIMIT, lots, stopLimit, price, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }
   else if(orderType == "BUY_STOP_LIMIT")
   {
      double stopLimit = ExtractJsonDouble(json, "stop_limit_price");
      if(stopLimit <= 0) stopLimit = price;
      ok = trade.OrderOpen(symbol, ORDER_TYPE_BUY_STOP_LIMIT, lots, stopLimit, price, sl, tp, ORDER_TIME_GTC, 0, "OmniRoute AI");
   }

   if(ok)
   {
      Print(">>> [OmniRoute] Ordre execute avec succes sur MT5 ! Ticket: ", trade.ResultOrder());
      lastProcessedId = orderId;
      ConfirmOrderExecuted(orderId);
   }
   else
   {
      Print(">>> [OmniRoute] Echec execution MT5 : ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Accuse de reception a l'API                                      |
//+------------------------------------------------------------------+
void ConfirmOrderExecuted(const string orderId)
{
   string url = "https://omniroute-trading-desk.vercel.app/api/mt5/confirm";
   string payload = "{\"id\":\"" + orderId + "\"}";
   string headers = "Content-Type: application/json\r\n";
   char post[], res[];
   StringToCharArray(payload, post, 0, StringLen(payload), CP_UTF8);
   string res_headers;
   WebRequest("POST", url, headers, 2000, post, res, res_headers);
}
//+------------------------------------------------------------------+
