"use strict";

// Indicator votes are computed in the browser from the loaded bars.
// public/js/indicators.js is that implementation. This module re-exports it
// so server tests and any later route use the same rules:
// SMA 20/50 stack, custom SMA, EMA 21, VWAP (close versus VWAP), RSI 14,
// MACD 12/26/9, Bollinger (20, 2), volume versus 1.3x the prior 20-bar
// average, and institutional buyPct - sellPct over 15.
// Placeholders vote N/A and are left out of the count.
// The verdict is the largest of buy, hold, and sell. A tie is HOLD.
// Confidence is that largest count divided by the active signals.

module.exports = require("../public/js/indicators.js");
