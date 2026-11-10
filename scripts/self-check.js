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
  assert(live.statusCode === 200 && (live.body.source === "yahoo" || live.body.source === "none"), "ohlcv source");
  if (live.body.source === "yahoo") {
    assert(live.body.bars && live.body.bars.length > 10 && live.body.bars[0].time && live.body.bars[0].close != null, "ohlcv bars");
  }

  const fallback = mockRes();
  await ohlcv({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "NOTREAL123", days: "40", mock: "0" },
  }, fallback);
  assert(fallback.statusCode === 200 && fallback.body.source === "none" && fallback.body.bars.length === 0, "mock off returns no fabricated bars");

  const mocked = mockRes();
  await ohlcv({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "NOTREAL123", days: "40", mock: "1" },
  }, mocked);
  assert(mocked.statusCode === 200 && mocked.body.source === "mock" && mocked.body.bars.length > 5, "mock on still fabricates bars");

  const events = require("../api/events");
  const quietEvents = mockRes();
  await events({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "NOTREAL123", mock: "0" },
  }, quietEvents);
  assert(quietEvents.statusCode === 200 && (quietEvents.body.events || []).every((row) => row.source !== "mock"), "events mock off");
  assert(!(quietEvents.body.events || []).some((row) => row.type === "agm" && row.source === "mock"), "events mock off drops the mock AGM");

  const institutional = require("../api/institutional");
  const quietInst = mockRes();
  await institutional({
    method: "GET",
    headers: { host: "localhost" },
    query: { exchange: "NASDAQ", symbol: "NOTREAL123", mock: "0" },
  }, quietInst);
  assert(quietInst.statusCode === 200 && quietInst.body.source === "none" && quietInst.body.buyPct === null && quietInst.body.sellPct === null, "institutional mock off");

  const offVote = signals.compute([{ time: "2020-01-02", open: 1, high: 1, low: 1, close: 1, volume: 1 }], {
    toggles: { institutional: true },
    institutional: { source: "none", buyPct: null, sellPct: null },
  });
  assert(offVote.votes.some((row) => row.id === "institutional" && row.vote === "na"), "institutional off stays out of the average");
  assert(!config.groups.some((group) => group.items.some((item) => item.id === "volume")), "volume bars are outside the volume group");

  const ledger = require("../lib/ledger-score");
  assert(ledger.modelVersion === "v4-hypothesis", "ledger model version");
  assert(ledger.KIND_ORDER.length === 16, "sixteen source kinds");
  const excluded = { id: "tsla", kind: "FORM 4", action: "sell", excluded: true, daysAgo: 1, ticker: "TSLA", sector: "Consumer", from: 0.4, to: 0.1, marketCapB: 800 };
  assert(ledger.contribution(excluded, "count", [excluded]) === 0, "excluded count");
  assert(ledger.contribution(excluded, "dollar", [excluded]) === 0, "excluded dollar");
  assert(ledger.contribution(excluded, "weighted", [excluded]) === 0, "excluded weighted");
  const flat = { id: "brk", kind: "13F", action: "flat", daysAgo: 2, ticker: "BRK.A", sector: "Financials", from: 5, to: 5, marketCapB: 900 };
  assert(ledger.contribution(flat, "count", [flat]) === 0 && ledger.contribution(flat, "dollar", [flat]) === 0 && ledger.contribution(flat, "weighted", [flat]) === 0, "flat contribution 0");
  const nvda = { id: 1, kind: "FORM 4", action: "buy", daysAgo: 0, ticker: "NVDA", sector: "Technology", from: 0.2, to: 0.5, marketCapB: 3200, filerType: "insider" };
  const nvdaOpt = { id: 11, kind: "OPTIONS", action: "buy", daysAgo: 0, ticker: "NVDA", sector: "Technology", from: 1, to: 2.2, marketCapB: 3200 };
  assert(ledger.confirmationFor(nvda, [nvda, nvdaOpt]).count === 1 && ledger.confirmationFor(nvda, [nvda, nvdaOpt]).multiplier === 1.25, "one other kind confirms");
  assert(ledger.confirmationFor(nvdaOpt, [nvda, nvdaOpt]).multiplier === 1.25, "options side confirms");
  const sameA = { id: "a", kind: "FORM 4", action: "buy", daysAgo: 0, ticker: "GE", sector: "Industrials", from: 0, to: 1, marketCapB: 10 };
  const sameB = { id: "b", kind: "FORM 4", action: "sell", daysAgo: 3, ticker: "GE", sector: "Industrials", from: 1, to: 0, marketCapB: 10 };
  assert(ledger.confirmationFor(sameA, [sameA, sameB]).count === 0, "same kind does not confirm");
  const indexRow = { id: "idx", kind: "INDEX", action: "buy", daysAgo: 3, ticker: "CAT", sector: "Industrials", from: 0, to: 1, marketCapB: 10, filerType: "activist", daysToEarnings: 6 };
  assert(ledger.reputationWeight(indexRow) === 0.7 && ledger.earningsFactor(indexRow) === 1 && ledger.isMechanical(indexRow), "index mechanical factors");
  const filing = { id: "f13", kind: "13F", action: "buy", daysAgo: 0, ticker: "UNH", sector: "Healthcare", from: 1, to: 2, marketCapB: 400, filerType: "passive-index" };
  assert(ledger.decay(filing) === 0 && ledger.contribution(filing, "weighted", [filing]) === 0, "13f conviction is zero at calendar age 0");
  assert(ledger.contribution(filing, "dollar", [filing]) === ((2 - 1) / 100) * 400, "13f dollar still uses market cap");
  const earning = { id: "earn", kind: "FORM 4", action: "buy", daysAgo: 0, ticker: "NVDA", sector: "Technology", from: 0, to: 1, marketCapB: 1, daysToEarnings: 6, filerType: "insider" };
  assert(ledger.earningsFactor(earning) === 1.25, "earnings factor inside 10 days");
  const stale = { id: 31, kind: "FORM 4", action: "buy", daysAgo: 31, ticker: "TGT", sector: "Consumer", from: 0, to: 1, marketCapB: 100, filerType: "insider" };
  assert(ledger.freshnessTier(31) === 4, "day 31 is freshness tier 4");
  const series = ledger.trendSeries([stale], "dollar");
  assert(series.length === 31 && series.every((point) => point.values.Consumer === 1), "day 31 is inside every chart point");
  assert(ledger.historyLine({ historicalStats: { sampleSize: 3, winRate: 0.67, avgExcessReturn60d: 2.1 } }) === "History: insufficient sample (n=3) — hidden below n=5", "small history sample");
  assert(ledger.historyLine({ historicalStats: { sampleSize: 8, winRate: 0.625, avgExcessReturn60d: 1.4 } }) === "History: net buyer on 5/8 similar signals, avg +1.4% 60d", "history sentence");
  assert(fs.existsSync(path.join(root, "docs/LEDGER-Technical-Specification-v5.md")), "v5 spec is in the repo");

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
