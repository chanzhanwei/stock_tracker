"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
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
assert(config.defaultTimeframe === "1Y", "default timeframe is 1Y");
assert(config.defaultOn.length === 2 && config.defaultOn.indexOf("smaCustom") >= 0 && config.defaultOn.indexOf("volume") >= 0, "default indicators are custom SMA and volume");
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
  assert(!fs.existsSync(path.join(root, "public/js/ledger.js")), "ledger screen removed");
  assert(!fs.existsSync(path.join(root, "public/js/ledger-feed.js")), "fixture feed removed");
  const page = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const analystClient = fs.readFileSync(path.join(root, "public/js/analyst.js"), "utf8");
  const fetchSrc = fs.readFileSync(path.join(root, "lib/analyst-fetch.js"), "utf8");
  assert(page.includes(">Analyze<") && page.includes(">Institution<") && page.includes('id="mode-stock"') && page.includes('id="mode-institution"') && !page.includes(">Analyst<") && !page.includes("ledger.js"), "stock, analyze, and institution switch");
  assert(!page.includes("LEDGER-Technical") && !page.includes("docs/LEDGER"), "spec is not shown");
  assert(!/timedtext|captionTracks|get_transcript/i.test(fetchSrc), "captions are not requested");
  assert(!/OPENROUTER_API_KEY|sk-or-|Bearer /.test(page + analystClient), "openrouter key stays off the client");
  assert(analystClient.includes("Paste the YouTube transcript"), "youtube transcript is pasted");

  const models = require("../lib/analyst-models");
  const parse = require("../lib/analyst-parse");
  const fetched = require("../lib/analyst-fetch");
  const priced = require("../lib/analyst-openrouter");
  assert(models.DEFAULT_MODEL === "deepseek/deepseek-v4.1-flash-1017" && models.knownModel(models.DEFAULT_MODEL), "default model");
  assert(models.MODELS.length === 25 && models.MODELS.indexOf("https://openrouter.ai/tencent") === -1, "model ids");
  const picks = parse.parsePicks([
    "Analyst: Ada",
    "Short-term stock: NVDA",
    "Long-term stock: AAPL",
    "Short-term industry: Semiconductors",
    "Long-term industry: Banks",
    "Short-term avoid: TSLA",
  ].join("\n"));
  assert(picks.analystName === "Ada" && picks.shortTermStock === "NVDA" && picks.longTermStock === "AAPL" && picks.shortTermIndustry === "Semiconductors" && picks.longTermIndustry === "Banks" && picks.shortTermAvoid === "TSLA", "picks");
  const missing = parse.parsePicks("no labels");
  assert(missing.analystName === "" && missing.shortTermStock === "" && missing.shortTermAvoid === "", "missing picks");
  assert(parse.parsePicks("Short-term: NVDA\nLong-term: Banks").shortTermStock === "", "old pick labels are not enough");
  assert(fetched.KINDS.indexOf("substack") !== -1, "substack is a source kind");
  assert(fetched.canonicalPostUrl("https://youtu.be/abcdefghijk?t=3") === "https://www.youtube.com/watch?v=abcdefghijk", "youtube url");
  assert(fetched.canonicalPostUrl("https://twitter.com/Ada/status/20?s=1") === "https://x.com/ada/status/20", "x url");
  assert(fetched.canonicalPostUrl("http://127.0.0.1:9/feed") === "http://127.0.0.1:9/feed", "local url keeps http");
  assert(fetched.normalizeSourceName("lenny", "substack") === "https://lenny.substack.com", "substack name");
  const status = fetched.itemFromXStatus({ tweet: { text: "Hello", author: { screen_name: "Ada" }, url: "https://twitter.com/Ada/status/20?s=1" } }, "ada", "20");
  assert(status && status.item.url === "https://x.com/ada/status/20" && status.item.body === "Hello" && status.sourceName === "Ada", "x status");
  const video = fetched.parseFeed("<entry><yt:videoId>abcdefghijk</yt:videoId><title>Hello &amp; welcome</title><media:description>not the transcript</media:description><published>2026-11-01T00:00:00+00:00</published></entry>");
  assert(video.length === 1 && video[0].url === "https://www.youtube.com/watch?v=abcdefghijk" && video[0].body === "" && video[0].title === "Hello & welcome", "youtube rss skips captions");
  assert(fetched.textForBox("youtube", video[0]) === "Hello & welcome\n\n", "youtube box starts with the title");
  const xItems = fetched.itemsFromXPayload({ results: [{ type: "status", url: "https://x.com/ada/status/1", text: "A post", created_timestamp: 1700000000 }] });
  assert(xItems.length === 1 && xItems[0].body === "A post" && xItems[0].publishedAt.startsWith("2023-11-14"), "x payload");
  const costs = priced.costsFromUsage({
    cost: 0.00015,
    cost_details: { upstream_inference_prompt_cost: 0.00005, upstream_inference_completions_cost: 0.0001 },
  });
  assert(costs.totalCost === 0.00015 && costs.inputCost === 0.00005 && costs.outputCost === 0.0001, "openrouter costs");
  const blankCosts = priced.costsFromUsage({});
  assert(blankCosts.totalCost == null && blankCosts.inputCost == null && blankCosts.outputCost == null, "costs blank without a call");

  const analystDb = require("../lib/analyst-db");
  const analyst = require("../api/analyst");
  const savedDb = process.env.DATABASE_URL;
  const savedDirect = process.env.DATABASE_URL_UNPOOLED;
  const savedKey = process.env.OPENROUTER_API_KEY;
  const testDb = process.env.ANALYST_TEST_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.OPENROUTER_API_KEY;
  await analystDb.resetForTests();

  const desk = mockRes();
  await analyst({ method: "GET", headers: { host: "localhost" } }, desk);
  assert(desk.statusCode === 200 && desk.body.database === false && desk.body.message.indexOf("DATABASE_URL") !== -1, "analyst names the missing database");
  assert(desk.body.defaultModel === models.DEFAULT_MODEL && desk.body.models.length === 25 && desk.body.sources.length === 0, "desk models without a database");
  assert(JSON.stringify(desk.body).indexOf("sk-") === -1, "desk payload has no secret");

  const missingKey = mockRes();
  await analyst({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "analyse", model: models.DEFAULT_MODEL, text: "A transcript about chips." },
  }, missingKey);
  assert(missingKey.statusCode === 503 && missingKey.body.message === "Set OPENROUTER_API_KEY on the server.", "missing openrouter key is plain");
  assert(JSON.stringify(missingKey.body).indexOf("Bearer") === -1 && JSON.stringify(missingKey.body).indexOf("sk-") === -1, "analyse does not echo a key");

  const addedReader = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "add", email: outsider },
  }, addedReader);
  const readerWrite = mockRes();
  await analyst({
    method: "POST",
    headers: { host: "localhost", "x-dev-email": outsider },
    body: { action: "add-source", name: "@example", kind: "x" },
  }, readerWrite);
  assert(readerWrite.statusCode === 403 && readerWrite.body.error === "admin_only", "reader cannot add a source");
  const readerDesk = mockRes();
  await analyst({
    method: "GET",
    headers: { host: "localhost", "x-dev-email": outsider },
  }, readerDesk);
  assert(readerDesk.statusCode === 200 && readerDesk.body.admin === false, "reader can open analyst");
  const removedReader = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "remove", email: outsider },
  }, removedReader);
  assert(removedReader.statusCode === 200, "reader removed after analyst check");

  if (testDb) {
    process.env.DATABASE_URL = testDb;
    delete process.env.OPENROUTER_API_KEY;
    await analystDb.resetForTests();
    const feedServer = http.createServer((req, res) => {
      if (req.url === "/post") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><head><title>Manual post</title></head><body><p>Manual body text</p></body></html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
      res.end("<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><item><title>Newer</title><link>https://example.com/newer</link><pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate><description>Newer body</description></item><item><title>Older</title><link>https://example.com/older</link><pubDate>Mon, 09 Nov 2026 00:00:00 GMT</pubDate><description>Older body</description></item></channel></rss>");
    });
    await new Promise((resolve) => feedServer.listen(0, "127.0.0.1", resolve));
    const feedUrl = "http://127.0.0.1:" + feedServer.address().port + "/feed";
    try {
      const created = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "add-source", name: feedUrl, kind: "website" },
      }, created);
      assert(created.statusCode === 200 && created.body.source && created.body.source.kind === "website", "admin adds a source");
      const sourceId = created.body.source.id;
      const firstItem = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "fetch", sourceId: sourceId },
      }, firstItem);
      assert(firstItem.statusCode === 200 && firstItem.body.item && firstItem.body.item.url === "https://example.com/newer" && firstItem.body.item.text.indexOf("Newer body") !== -1, "fetch returns the newest unprocessed item");
      const savedRow = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: {
          action: "save",
          itemId: firstItem.body.item.id,
          resultText: [
            "Analyst: Ada",
            "Short-term stock: NVDA",
            "Long-term stock: AAPL",
            "Short-term industry: Semiconductors",
            "Long-term industry: Banks",
            "Short-term avoid: TSLA",
            "Edited note.",
          ].join("\n"),
          model: models.DEFAULT_MODEL,
          totalCost: 0.00015,
          inputCost: 0.00005,
          outputCost: 0.0001,
        },
      }, savedRow);
      assert(savedRow.statusCode === 200 && savedRow.body.saved.postUrl === "https://example.com/newer" && savedRow.body.saved.source === feedUrl && savedRow.body.saved.analystName === "Ada" && savedRow.body.saved.shortTermStock === "NVDA" && savedRow.body.saved.longTermStock === "AAPL" && savedRow.body.saved.shortTermIndustry === "Semiconductors" && savedRow.body.saved.longTermIndustry === "Banks" && savedRow.body.saved.shortTermAvoid === "TSLA" && savedRow.body.saved.modelId === models.DEFAULT_MODEL && savedRow.body.saved.resultText.indexOf("Edited note.") !== -1, "save stores the edited result and url");
      assert(Math.abs(savedRow.body.saved.totalCost - 0.00015) < 1e-12 && Math.abs(savedRow.body.saved.inputCost - 0.00005) < 1e-12 && Math.abs(savedRow.body.saved.outputCost - 0.0001) < 1e-12, "save stores the three costs");
      const secondItem = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "fetch", sourceId: sourceId },
      }, secondItem);
      assert(secondItem.statusCode === 200 && secondItem.body.item && secondItem.body.item.url === "https://example.com/older", "processed item is skipped");
      const repeat = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "open-url", url: "https://example.com/newer?utm_source=mail" },
      }, repeat);
      assert(repeat.statusCode === 200 && !repeat.body.item && /already analysed/i.test(repeat.body.message || ""), "analysed url is not opened again");
      const manualUrl = "http://127.0.0.1:" + feedServer.address().port + "/post";
      const manual = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "open-url", url: manualUrl },
      }, manual);
      assert(manual.statusCode === 200 && manual.body.item && manual.body.item.text.indexOf("Manual body text") !== -1 && manual.body.sources.some((source) => source.name === manualUrl), "manual url opens one post and saves the source");
      const manualSaved = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: {
          action: "save",
          itemId: manual.body.item.id,
          resultText: [
            "Analyst: Bea",
            "Short-term stock: MSFT",
            "Long-term stock: none",
            "Short-term industry: Software",
            "Long-term industry: none",
            "Short-term avoid: none",
          ].join("\n"),
          model: models.DEFAULT_MODEL,
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
        },
      }, manualSaved);
      assert(manualSaved.statusCode === 200 && manualSaved.body.saved.source === manualUrl && manualSaved.body.saved.analystName === "Bea" && manualSaved.body.saved.shortTermStock === "MSFT", "manual url result is saved");
      const manualAgain = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "open-url", url: manualUrl },
      }, manualAgain);
      assert(manualAgain.statusCode === 200 && !manualAgain.body.item && /already analysed/i.test(manualAgain.body.message || ""), "saved manual url is not analysed again");
      const again = mockRes();
      await users({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "add", email: outsider },
      }, again);
      const readerRows = mockRes();
      await analyst({
        method: "GET",
        headers: { host: "localhost", "x-dev-email": outsider },
      }, readerRows);
      assert(readerRows.statusCode === 200 && readerRows.body.results.some((row) => row.postUrl === "https://example.com/newer" && row.source === feedUrl && row.analystName === "Ada" && row.shortTermStock === "NVDA" && row.shortTermAvoid === "TSLA") && readerRows.body.results.some((row) => row.postUrl === manualUrl && row.analystName === "Bea"), "reader sees the saved rows");
      await users({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "remove", email: outsider },
      }, mockRes());
    } finally {
      await new Promise((resolve) => feedServer.close(resolve));
    }
  }

  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.OPENROUTER_API_KEY;
  await analystDb.resetForTests();
  if (savedDb == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
  if (savedDirect == null) delete process.env.DATABASE_URL_UNPOOLED;
  else process.env.DATABASE_URL_UNPOOLED = savedDirect;
  if (savedKey == null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;

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
