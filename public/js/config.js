(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.STConfig = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var timeframes = [
    { id: "1D", days: 15 },
    { id: "1W", days: 20 },
    { id: "1M", days: 22 },
    { id: "3M", days: 65 },
    { id: "6M", days: 130 },
    { id: "1Y", days: 260 },
    { id: "5Y", days: 1300 },
  ];

  function calendarDays(visibleDays) {
    var n = Number(visibleDays) + 40;
    return Math.min(3650, Math.max(1, Math.ceil(n * 1.6) + 10));
  }

  function visibleDays(id) {
    for (var i = 0; i < timeframes.length; i += 1) {
      if (timeframes[i].id === id) return timeframes[i].days;
    }
    return 130;
  }

  return {
    disclaimer: "Not financial advice.",
    adminEmail: "chanzhanwei@gmail.com",
    exchanges: ["ASX", "NASDAQ", "NYSE", "SP500", "HKEX"],
    timeframes: timeframes,
    calendarDays: calendarDays,
    visibleDays: visibleDays,
    defaultTimeframe: "6M",
    defaultExchange: "NASDAQ",
    defaultSymbol: "AAPL",
    defaultOn: ["sma20", "sma50", "ema21", "rsi", "macd", "volume", "institutional"],
    groups: [
      {
        id: "trend",
        label: "Trend",
        items: [
          { id: "sma20", label: "SMA 20", implemented: true },
          { id: "sma50", label: "SMA 50", implemented: true },
          { id: "smaCustom", label: "Custom SMA", implemented: true, period: true },
          { id: "ema21", label: "EMA 21", implemented: true },
          { id: "vwap", label: "VWAP", implemented: true },
          { id: "ichimoku", label: "Ichimoku", implemented: false },
          { id: "psar", label: "PSAR", implemented: false },
          { id: "adx", label: "ADX/DMI", implemented: false },
        ],
      },
      {
        id: "momentum",
        label: "Momentum",
        items: [
          { id: "rsi", label: "RSI 14", implemented: true },
          { id: "macd", label: "MACD 12/26/9", implemented: true },
          { id: "stoch", label: "Stoch", implemented: false },
          { id: "cci", label: "CCI", implemented: false },
          { id: "willr", label: "Will%R", implemented: false },
          { id: "roc", label: "ROC", implemented: false },
        ],
      },
      {
        id: "volatility",
        label: "Volatility",
        items: [
          { id: "bollinger", label: "Bollinger (20, 2)", implemented: true },
          { id: "keltner", label: "Keltner", implemented: false },
          { id: "donchian", label: "Donchian", implemented: false },
          { id: "atr", label: "ATR", implemented: false },
        ],
      },
      {
        id: "volume",
        label: "Volume",
        items: [
          { id: "obv", label: "OBV", implemented: false },
          { id: "mfi", label: "MFI", implemented: false },
          { id: "adline", label: "A/D Line", implemented: false },
        ],
      },
      {
        id: "levels",
        label: "Flow and levels",
        items: [
          { id: "institutional", label: "Institutional buy/sell", implemented: true },
          { id: "pivots", label: "Pivots", implemented: false },
          { id: "fibonacci", label: "Fibonacci", implemented: false },
        ],
      },
    ],
  };
});
