"use strict";

const EPOCH = Date.UTC(2005, 0, 3);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hashString(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ymdFromUtc(ms) {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function todayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function formatIso(iso) {
  const parts = iso.split("-").map(Number);
  return parts[2] + " " + MONTHS[parts[1] - 1] + " " + parts[0];
}

function eventStatus(iso, todayIso) {
  return iso >= todayIso ? "upcoming" : "past";
}

function makeEvent(type, label, iso, todayIso, detail) {
  return {
    type,
    label,
    iso,
    date: formatIso(iso),
    status: eventStatus(iso, todayIso),
    detail,
    source: "mock",
  };
}

function mockBars(exchange, symbol, calendarDays) {
  const rnd = mulberry32(hashString(exchange + ":" + symbol));
  const today = todayUtc();
  const cutoff = today - calendarDays * 86400000;
  let price = 18 + rnd() * 220;
  const bars = [];
  for (let t = EPOCH; t <= today; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    const shock = (rnd() - 0.48) * 0.045;
    const wickUp = rnd() * 0.012;
    const wickDown = rnd() * 0.012;
    const volume = Math.round(40000 + rnd() * 5200000);
    if (dow === 0 || dow === 6) continue;
    let open = price;
    let close = Math.max(0.5, open * (1 + shock));
    let high = Math.max(open, close) * (1 + wickUp);
    let low = Math.min(open, close) * (1 - wickDown);
    open = round2(open);
    close = round2(close);
    high = round2(Math.max(high, open, close));
    low = round2(Math.min(Math.max(low, 0.01), open, close));
    price = close;
    if (t >= cutoff) {
      bars.push({
        time: ymdFromUtc(t),
        open,
        high,
        low,
        close,
        volume,
      });
    }
  }
  return bars;
}

function mockEvents(exchange, symbol) {
  const rnd = mulberry32(hashString(exchange + ":" + symbol + ":events"));
  const today = todayUtc();
  const todayIso = ymdFromUtc(today);
  const earnOff = Math.round((rnd() - 0.45) * 80);
  const divOff = Math.round((rnd() - 0.7) * 70);
  const agmOff = 12 + Math.floor(rnd() * 45);
  return [
    makeEvent("earnings", "Earnings", ymdFromUtc(today + earnOff * 86400000), todayIso, "Mock earnings date"),
    makeEvent("dividend", "Dividend", ymdFromUtc(today + divOff * 86400000), todayIso, "Mock dividend"),
    makeEvent("agm", "AGM", ymdFromUtc(today + agmOff * 86400000), todayIso, "Mock annual general meeting"),
  ];
}

function mockInstitutional(exchange, symbol) {
  const rnd = mulberry32(hashString(exchange + ":" + symbol + ":institutional"));
  const buyPct = 15 + Math.floor(rnd() * 70);
  const sellRoom = Math.min(70, 100 - buyPct);
  const sellPct = Math.floor(rnd() * (sellRoom + 1));
  return { source: "mock", buyPct, sellPct };
}

module.exports = {
  hashString,
  mulberry32,
  ymdFromUtc,
  todayUtc,
  formatIso,
  eventStatus,
  mockBars,
  mockEvents,
  mockInstitutional,
};
