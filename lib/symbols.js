"use strict";

const EXCHANGES = ["ASX", "NASDAQ", "NYSE", "SP500", "HKEX"];
const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;

function calendarDaysForVisible(visibleDays) {
  const n = Number(visibleDays) + 40;
  return Math.min(3650, Math.max(1, Math.ceil(n * 1.6) + 10));
}

function clampDays(value) {
  if (value == null || value === "") return 120;
  const n = Number(value);
  if (!Number.isFinite(n)) return 120;
  return Math.min(3650, Math.max(1, Math.floor(n)));
}

function toYahoo(exchange, symbol) {
  if (exchange === "ASX") return symbol + ".AX";
  if (exchange === "HKEX") {
    const digits = String(Number(symbol));
    return digits.padStart(4, "0") + ".HK";
  }
  return symbol;
}

function parseInstrument(query) {
  const exchange = String((query && query.exchange) || "").trim().toUpperCase();
  if (!EXCHANGES.includes(exchange)) {
    return { error: "invalid_exchange" };
  }
  let symbol = String((query && query.symbol) || "").trim().toUpperCase();
  if (exchange === "ASX") symbol = symbol.replace(/\.AX$/, "");
  if (exchange === "HKEX") symbol = symbol.replace(/\.HK$/, "");
  if (!SYMBOL_RE.test(symbol)) return { error: "invalid_symbol" };
  if (exchange === "HKEX" && !/^\d{1,5}$/.test(symbol)) return { error: "invalid_symbol" };
  return { exchange, symbol, yahoo: toYahoo(exchange, symbol) };
}

module.exports = {
  EXCHANGES,
  SYMBOL_RE,
  calendarDaysForVisible,
  clampDays,
  toYahoo,
  parseInstrument,
};
