"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const failures = [];

function assert(cond, message) {
  if (!cond) failures.push(message);
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".data" || name === "vendor") continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const files = walk(root, []);
files.push(path.join(root, "public/vendor/lightweight-charts.standalone.production.js"));
for (const file of files) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) failures.push("syntax " + file + "\n" + check.stderr);
}

const symbols = require("../lib/symbols");
const signals = require("../lib/signals");
const mock = require("../lib/mock");
const allowlist = require("../lib/allowlist");
const config = require("../public/js/config");

assert(symbols.calendarDaysForVisible(15) === 98, "1D calendar span");
assert(symbols.calendarDaysForVisible(20) === 106, "1W calendar span");
assert(symbols.calendarDaysForVisible(22) === 110, "1M calendar span");
assert(symbols.calendarDaysForVisible(65) === 178, "3M calendar span");
assert(symbols.calendarDaysForVisible(130) === 282, "6M calendar span");
assert(symbols.calendarDaysForVisible(260) === 490, "1Y calendar span");
assert(symbols.calendarDaysForVisible(1300) === 2154, "5Y calendar span");
assert(config.calendarDays(1300) === 2154, "client calendar span");
assert(symbols.clampDays(undefined) === 120, "default days");
assert(symbols.clampDays("99999") === 3650, "max days");
assert(symbols.clampDays("0") === 1, "min days");
assert(symbols.clampDays("-4") === 1, "negative days");
assert(symbols.clampDays("10.9") === 10, "floor days");
assert(symbols.toYahoo("ASX", "BHP") === "BHP.AX", "asx map");
assert(symbols.toYahoo("HKEX", "700") === "0700.HK", "hk pad");
assert(symbols.toYahoo("HKEX", "00700") === "0700.HK", "hk strip");
assert(symbols.toYahoo("NYSE", "BRK.B") === "BRK.B", "us bare");
assert(symbols.parseInstrument({ exchange: "nasdaq", symbol: "aapl" }).yahoo === "AAPL", "normalize");
assert(symbols.parseInstrument({ exchange: "ASX", symbol: "bhp.ax" }).yahoo === "BHP.AX", "strip ax");
assert(symbols.parseInstrument({ exchange: "LSE", symbol: "BARC" }).error === "invalid_exchange", "exchange");
assert(symbols.parseInstrument({ exchange: "NASDAQ", symbol: "TOO LONG!!" }).error === "invalid_symbol", "symbol");

const saved = {
  VERCEL: process.env.VERCEL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
};
delete process.env.VERCEL;
delete process.env.CLERK_SECRET_KEY;
delete process.env.CLERK_PUBLISHABLE_KEY;
assert(allowlist.isDevBypass({ headers: { host: "localhost:4173" } }) === true, "localhost bypass");
assert(allowlist.isDevBypass({ headers: { host: "127.0.0.1:4173" } }) === true, "loopback bypass");
assert(allowlist.isDevBypass({ headers: { host: "stock-tracker.vercel.app" } }) === false, "public host");
process.env.VERCEL = "1";
assert(allowlist.isDevBypass({ headers: { host: "localhost" } }) === false, "vercel never bypasses");
delete process.env.VERCEL;
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
assert(allowlist.isDevBypass({ headers: { host: "localhost" } }) === false, "keys disable bypass");
delete process.env.CLERK_PUBLISHABLE_KEY;
if (saved.VERCEL == null) delete process.env.VERCEL;
else process.env.VERCEL = saved.VERCEL;
if (saved.CLERK_SECRET_KEY == null) delete process.env.CLERK_SECRET_KEY;
else process.env.CLERK_SECRET_KEY = saved.CLERK_SECRET_KEY;
if (saved.CLERK_PUBLISHABLE_KEY == null) delete process.env.CLERK_PUBLISHABLE_KEY;
else process.env.CLERK_PUBLISHABLE_KEY = saved.CLERK_PUBLISHABLE_KEY;

const summary = signals.aggregate([1, 0, 0, 0, 0]);
assert(summary.verdict === "HOLD" && summary.average === 0.2 && summary.confidence === 60, "hold boundary");
const buy = signals.aggregate([1, 1, 0, 0, 0]);
assert(buy.verdict === "BUY" && buy.confidence === 70, "buy boundary");
const sellEdge = signals.aggregate([-1, 0, 0, 0, 0]);
assert(sellEdge.verdict === "HOLD" && sellEdge.confidence === 40, "sell boundary");
const sell = signals.aggregate([-1, -1, 0, 0, 0]);
assert(sell.verdict === "SELL" && sell.confidence === 30, "sell");
assert(signals.aggregate([]).verdict === "HOLD" && signals.aggregate([]).confidence === 50, "empty mean");
assert(signals.voteRsi(29) === 1 && signals.voteRsi(70) === 0 && signals.voteRsi(71) === -1, "rsi votes");
assert(signals.voteSmaStack(11, 10, 9) === 1 && signals.voteSmaStack(8, 9, 10) === -1 && signals.voteSmaStack(10, 10, 9) === 0, "sma stack");
assert(signals.voteVolume(140, 100, 11, 10) === 1 && signals.voteVolume(140, 100, 9, 10) === -1 && signals.voteVolume(120, 100, 11, 10) === 0, "volume votes");
assert(signals.voteInstitutional(40, 20) === 1 && signals.voteInstitutional(20, 40) === -1 && signals.voteInstitutional(50, 35) === 0, "institutional votes");
assert(signals.voteBollinger(9, 10, 12) === 1 && signals.voteBollinger(13, 10, 12) === -1 && signals.voteBollinger(11, 10, 12) === 0, "bollinger votes");

function datedBars() {
  const bars = [];
  for (let i = 0; i < 80; i += 1) {
    const day = new Date(Date.UTC(2024, 0, 2) + i * 86400000);
    const close = 100 + i;
    bars.push({
      time: day.toISOString().slice(0, 10),
      open: close - 0.4,
      high: close + 0.6,
      low: close - 0.8,
      close: close,
      volume: 1000,
    });
  }
  return bars;
}

const rising = datedBars();
const withRsi = signals.compute(rising, {
  toggles: { sma20: true, sma50: true, rsi: true },
  institutional: { buyPct: 10, sellPct: 10 },
});
const withoutRsi = signals.compute(rising, {
  toggles: { sma20: true, sma50: true, rsi: false },
  institutional: { buyPct: 10, sellPct: 10 },
});
assert(withRsi.votes.some((row) => row.id === "rsi" && row.vote === -1), "rising rsi sells");
assert(withRsi.votes.some((row) => row.id === "sma20_50" && row.vote === 1), "rising sma buys");
assert(withRsi.votes.some((row) => row.id === "ichimoku" && row.vote === "na"), "placeholder na");
assert(withoutRsi.average !== withRsi.average, "toggle changes the mean");
assert(withRsi.verdict !== withoutRsi.verdict || withRsi.confidence !== withoutRsi.confidence, "toggle changes the verdict");

const first = mock.mockBars("NASDAQ", "ZZMOCK", 120);
const second = mock.mockBars("NASDAQ", "ZZMOCK", 120);
assert(JSON.stringify(first) === JSON.stringify(second), "mock is deterministic");
assert(first.length > 40, "mock has bars");
const inst = mock.mockInstitutional("HKEX", "0700");
assert(inst.source === "mock" && inst.buyPct + inst.sellPct <= 100, "institutional mock");
const events = mock.mockEvents("ASX", "BHP");
assert(events.some((row) => row.type === "agm" && row.source === "mock" && row.status === "upcoming"), "agm is future mock");

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; },
  };
}

async function main() {
  const health = require("../api/health");
  const healthRes = mockRes();
  await health({ method: "GET", headers: { host: "localhost" } }, healthRes);
  assert(healthRes.statusCode === 200 && healthRes.body.ok === true && healthRes.body.service === "stock_tracker", "health handler");
  assert(Object.keys(healthRes.body).sort().join() === "ok,service", "health shape");

  const users = require("../api/users");
  const removeAdmin = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "remove", email: "chanzhanwei@gmail.com" },
  }, removeAdmin);
  assert(removeAdmin.statusCode === 400 && removeAdmin.body.error === "cannot_remove_admin", "admin stays");

  const outsider = "outsider@example.com";
  const blocked = mockRes();
  await users({
    method: "GET",
    headers: { host: "localhost", "x-dev-email": outsider },
  }, blocked);
  assert(blocked.statusCode === 403 && blocked.body.error === "not_allowlisted" && !blocked.body.emails, "stranger denied");

  const added = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "add", email: "Outsider@Example.com" },
  }, added);
  assert(added.statusCode === 200 && added.body.emails.includes(outsider), "admin adds lowercase");

  const notAdmin = mockRes();
  await users({
    method: "GET",
    headers: { host: "localhost", "x-dev-email": outsider },
  }, notAdmin);
  assert(notAdmin.statusCode === 403 && notAdmin.body.error === "admin_only" && !notAdmin.body.emails, "non-admin user screen");

  const removed = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "remove", email: outsider },
  }, removed);
  assert(removed.statusCode === 200 && !removed.body.emails.includes(outsider), "admin removes");

  const ohlcv = require("../api/ohlcv");
  const refused = mockRes();
  await ohlcv({
    method: "GET",
    headers: { host: "example.com" },
    query: { exchange: "NASDAQ", symbol: "AAPL", days: "30" },
  }, refused);
  assert(refused.statusCode === 401, "ohlcv requires an allowlisted user off localhost");

  const live = mockRes();
  await ohlcv({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "AAPL", days: "90" },
  }, live);
  assert(live.statusCode === 200 && (live.body.source === "yahoo" || live.body.source === "mock"), "ohlcv source");
  assert(live.body.bars && live.body.bars.length > 10 && live.body.bars[0].time && live.body.bars[0].close != null, "ohlcv bars");

  const fallback = mockRes();
  await ohlcv({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "NOTREAL123", days: "40" },
  }, fallback);
  assert(fallback.statusCode === 200 && fallback.body.source === "mock" && fallback.body.bars.length > 5, "mock fallback");

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("self-check ok (" + files.length + " files, ohlcv " + live.body.source + ", " + live.body.bars.length + " bars)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
