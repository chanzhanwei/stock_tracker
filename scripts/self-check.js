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

const quoteFacts = require("../lib/quote-facts");
const symbols = require("../lib/symbols");
const signals = require("../lib/signals");
const mock = require("../lib/mock");
const allowlist = require("../lib/allowlist");
const config = require("../public/js/config");

const sampleFacts = quoteFacts.priceFacts([
  { time: "2024-01-02", high: 12, low: 9, close: 10 },
  { time: "2024-03-01", high: 15, low: 11, close: 14 },
  { time: "2024-06-01", high: 20, low: 16, close: 19 },
  { time: "2024-12-01", high: 14, low: 10, close: 11 },
]);
assert(sampleFacts.high === 20 && sampleFacts.highDate === "2024-06-01", "quote high is the highest daily high");
assert(Math.abs(sampleFacts.declinePct - 45) < 0.001 && sampleFacts.lastVisit === "2024-03-01", "quote decline uses an earlier session that traded the close");
assert(quoteFacts.priceFacts([{ time: "2024-06-01", high: 20, low: 18, close: 20 }]).declinePct == null, "quote hides the decline when the close is the high");

assert(symbols.calendarDaysForVisible(15) === 98, "1D calendar span");
assert(symbols.calendarDaysForVisible(20) === 106, "1W calendar span");
assert(symbols.calendarDaysForVisible(22) === 110, "1M calendar span");
assert(symbols.calendarDaysForVisible(65) === 178, "3M calendar span");
assert(symbols.calendarDaysForVisible(130) === 282, "6M calendar span");
assert(symbols.calendarDaysForVisible(260) === 490, "1Y calendar span");
assert(symbols.calendarDaysForVisible(1300) === 2154, "5Y calendar span");
assert(config.calendarDays(1300) === 2154, "client calendar span");
assert(config.defaultTimeframe === "1Y", "default timeframe is 1Y");
assert(config.defaultOn.length === 2 && config.defaultOn.indexOf("smaCustom") >= 0 && config.defaultOn.indexOf("volume") >= 0 && config.defaultOn.indexOf("pe") === -1 && config.defaultOn.indexOf("futurePe") === -1, "default indicators are custom SMA and volume");
const fundamental = config.groups.find(function (group) { return group.id === "fundamental"; });
assert(fundamental && fundamental.label === "Fundamentals" && config.groups[0].id === "fundamental" && fundamental.items.map(function (item) { return item.id; }).join(",") === "pe,futurePe" && fundamental.items.map(function (item) { return item.label; }).join(",") === "PE,Forward PE", "fundamentals category sits above trend and holds PE and Forward PE");
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
assert(summary.verdict === "HOLD" && summary.average === 0.2 && summary.confidence === 80 && summary.holdCount === 4 && summary.buyCount === 1 && summary.slider === 0.5 && summary.detail === "4 holds and 1 buy across 5 active signals.", "hold boundary");
const buy = signals.aggregate([1, 1, 0, 0, 0]);
assert(buy.verdict === "HOLD" && buy.confidence === 60 && buy.buyCount === 2 && buy.holdCount === 3 && buy.detail === "3 holds and 2 buys across 5 active signals.", "two buys stay hold");
const buyWin = signals.aggregate([1, 1, 1, 0, 0]);
assert(buyWin.verdict === "BUY" && buyWin.confidence === 60 && Math.abs(buyWin.slider - 0.8) < 0.001 && buyWin.detail === "3 buys and 2 holds across 5 active signals.", "three buys");
const sellEdge = signals.aggregate([-1, 0, 0, 0, 0]);
assert(sellEdge.verdict === "HOLD" && sellEdge.confidence === 80 && sellEdge.slider === 0.5, "one sell stays hold");
const sell = signals.aggregate([-1, -1, 0, 0, 0]);
assert(sell.verdict === "HOLD" && sell.confidence === 60 && sell.sellCount === 2, "two sells stay hold");
const sellWin = signals.aggregate([-1, -1, -1, 0, 0]);
assert(sellWin.verdict === "SELL" && sellWin.confidence === 60 && Math.abs(sellWin.slider - 0.2) < 0.001, "three sells");
assert(signals.aggregate([]).verdict === "HOLD" && signals.aggregate([]).confidence === 50 && signals.aggregate([]).slider === 0.5, "empty mean");
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
  assert(notAdmin.statusCode === 200 && notAdmin.body.admin === false && !notAdmin.body.emails && notAdmin.body.userAgent === "" && notAdmin.body.cookie === "", "non-admin reads their own fetch settings");
  const savedIdentity = mockRes();
  await users({
    method: "POST",
    headers: { host: "localhost", "x-dev-email": outsider },
    body: { action: "save-fetch", userAgent: "Browser/1", cookie: "a=b" },
  }, savedIdentity);
  assert(savedIdentity.statusCode === 503 && savedIdentity.body.error === "database_unconfigured", "fetch settings need the database");

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
  assert(mocked.body.facts && mocked.body.facts.pe == null && mocked.body.facts.forwardPe == null && mocked.body.facts.high > 0, "mock quote facts leave PE blank and keep the high");

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
  const analystCss = fs.readFileSync(path.join(root, "public/css/style.css"), "utf8");
  const analystClient = fs.readFileSync(path.join(root, "public/js/analyst.js"), "utf8");
  const fetchSrc = fs.readFileSync(path.join(root, "lib/analyst-fetch.js"), "utf8");
  const dbSrc = fs.readFileSync(path.join(root, "lib/analyst-db.js"), "utf8");
  assert(page.includes(">View:<") && page.includes(">Analyse<") && page.includes(">Institution<") && page.includes('id="mode-stock"') && page.includes('id="mode-institution"') && !page.includes(">Analyst<") && !page.includes(">Analyze<") && !page.includes("ledger.js"), "stock, analyse, and institution switch");
  assert(!page.includes("LEDGER-Technical") && !page.includes("docs/LEDGER"), "spec is not shown");
  assert(!/timedtext|captionTracks|get_transcript/i.test(fetchSrc), "captions are not requested");
  assert(/EXISTS \(\s*SELECT 1 FROM analyst_items i WHERE i\.source_id = s\.id\s*\)/.test(dbSrc), "existing source lists only sources with a post");
  assert(dbSrc.includes("CREATE TABLE IF NOT EXISTS analyst_fetch_settings") && dbSrc.includes("DELETE FROM analyst_sources WHERE btrim(label)") && dbSrc.includes("resultDate(row.result_text)"), "fetch settings, quote labels, and calendar dates");
  assert(!/OPENROUTER_API_KEY|sk-or-|Bearer /.test(page + analystClient), "openrouter key stays off the client");
  assert(analystClient.includes("Paste the YouTube transcript"), "youtube transcript is pasted");
  assert(page.includes(">New URL<") && page.includes(">New Channel<") && page.includes(">Clipboard<") && page.includes(">Existing Source<") && page.includes(">Paste from clipboard<"), "source tabs");
  assert(!page.includes("Not financial advice."), "advice line is gone");
  assert(/id="analyst-extract"[^>]*disabled/.test(page) && /id="analyst-run"[^>]*disabled/.test(page), "extract and analyse start disabled");
  assert(page.includes('id="analyst-use-ai"') && page.includes('data-mode="no"') && page.includes(">No<") && page.includes(">Yes<") && page.includes(">Use Bot<") && analystClient.includes("useBot: useBotOn()"), "use bot slider defaults to no");
  assert(page.includes('id="last-change" hidden') && page.includes('id="source-badge" class="badge" hidden') && !page.includes('id="chart-fundamentals"'), "price hides the daily change and the yahoo badge");
  assert(page.includes('id="analyst-debug-request-label">To OpenRouter') && page.includes('id="analyst-debug-response-label">From OpenRouter') && page.includes('id="analyst-http-request-label">HTTP Request') && page.includes('id="analyst-http-response-label">HTTP Response') && analystClient.includes("function showHttp") && analystClient.includes('tab === "url" || tab === "channel"') && analystClient.includes("if (body && body.bot)") && analystClient.includes("aiLine.hidden = clipboard") && analystClient.includes('function labelDebug(kind)') && !analystClient.includes("setDebugLabels") && analystCss.includes("#users-button { margin-top: 29.25px; }") && analystCss.includes("margin-left: 52.5px;") && analystCss.includes(".analyst-debug .analyst-columns + .analyst-columns { margin-top: 1.25rem; }"), "debug keeps openrouter above the page fetch and a bot job retitles the boxes");
  assert(page.includes(">Extracted Text<") && page.includes(">Analysed Result<"), "text and result sit apart");
  assert(/id="analyst-save"[^>]*disabled/.test(page), "save starts disabled");
  assert(!page.includes("flaticon") && page.includes('id="analyst-thinking"') && analystCss.includes(".analyst-thinking i"), "thinking dots");
  assert(analystClient.includes("function placeThinking") && analystClient.includes('busy === "paste"') && analystClient.includes('busy === "save"'), "thinking mark follows the running button");
  assert(/function showTab\(next\) \{[\s\S]*?showTranscript\(null\)/.test(analystClient), "tab change hides the transcript line");
  assert(page.includes('id="analyst-debug"') && !/id="analyst-debug"[^>]*\bopen\b/.test(page) && analystCss.includes(".analyst-debug { margin-top: 3rem; }") && page.includes(">To OpenRouter<") && page.includes(">From OpenRouter<"), "debug starts closed under the columns");
  assert(page.includes('id="analyst-debug-request" rows="20"') && page.includes('id="analyst-debug-response" rows="20"'), "debug boxes show 20 lines");
  assert(page.includes('id="analyst-text-field"'), "extracted text field can be hidden");
  assert(page.includes(">Sources<") && page.includes('class="sources-card"') && page.includes('id="analyst-reasoning"') && /id="analyst-reasoning"[\s\S]*id="analyst-debug-request"/.test(page) && /<details id="analyst-debug"[\s\S]*class="analyst-columns"[\s\S]*id="analyst-debug-request"[\s\S]*id="analyst-debug-response"/.test(page), "sources card and debug columns");
  assert(/id="analyst-reasoning"[\s\S]*data-mode="off"[\s\S]*aria-pressed="true">Disable<\/button>[\s\S]*aria-pressed="false">Enable<\/button>/.test(page), "reasoning slider defaults to Disable");
  assert(/id="analyst-paste"[\s\S]*id="analyst-paste-preview"/.test(page) && analystCss.includes(".analyst-desk { width: 100%; margin: 0 auto; }") && analystCss.includes(".sources-card {"), "sources card and pasted image");
  assert(page.includes(">Notes<") && page.includes("<th>Website</th>") && analystClient.includes("row.note") && analystClient.includes('inputCell(tr, "website", row.website)') && analystClient.includes("textCell(tr, row.website)"), "institution shows the note and website");
  assert(analystClient.includes("httpUrl(row.postUrl) || httpUrl(row.url)") && analystClient.includes("minimax/minimax-m3.1-flash") && analystClient.includes("xiaomi/mimo-v2.6-pro") && analystClient.includes("deepseek/deepseek-v4.1-flash-1017") && analystClient.includes("anthropic/claude-haiku-5.5") && analystClient.includes("reasoning: reasoningOn()") && /function runAnalyse\(\) \{[\s\S]*?\$\("analyst-result"\)\.value = ""/.test(analystClient), "reasoning, image models, and a cleared result");
  assert(page.includes('id="model-extract-error"') && !analystClient.includes("blocksUrlExtract") && !analystClient.includes('setError("Not implemented yet")') && analystClient.includes('setStatus("Waiting for Grok Bot")') && analystClient.includes('setError("Grok Bot has not picked up this job.")') && analystClient.includes('action: "bot-job"') && /function extract\(\) \{[\s\S]*?reasoning: reasoningOn\(\)/.test(analystClient), "use bot waits for a job and does not block a model");
  assert(analystCss.includes("@keyframes hourglass-flip") && analystCss.includes("@keyframes sand-top") && analystCss.includes(".hourglass.is-idle .sand-top") && /prefers-reduced-motion: reduce\) \{[\s\S]*\.sand-top/.test(analystCss), "the hourglass drains then flips");
  assert(/function showTab\(next\) \{[\s\S]*?if \(changed\) clearAnalysis\(\)/.test(analystClient) && /\$\("analyst-source"\)\.addEventListener\("change", function \(\) \{\s*showSourceUrl\(\);\s*clearAnalysis\(\);/.test(analystClient), "tab and existing source clear the text and the result");
  assert(/function syncExtractedText\(\) \{\s*var field = \$\("analyst-text-field"\);\s*if \(field\) field\.hidden = tab === "clipboard";/.test(analystClient), "clipboard hides extracted text");
  assert(/function applyReasoningForModel\(modelId\) \{\s*setReasoning\(modelId === MINIMAX_MODEL\);/.test(analystClient), "only minimax turns reasoning on");
  assert(analystClient.includes('action: "update-result"') && analystClient.includes('action: "delete-result"') && analystClient.includes('aria-label", label') && analystClient.includes("Delete this saved analysis?"), "rows edit and delete");
  assert(!analystClient.includes("about:blank") && analystClient.includes('window.open(opened.url, "_blank", "noopener,noreferrer")') && analystClient.includes("function resetDebug"), "url is shown before a window and debug resets");
  const appClient = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  const fundamentalMarks = appClient.slice(appClient.indexOf("function fundamentalMarkers"), appClient.indexOf("function quoteDate"));
  assert((fundamentalMarks.match(/color: "#e36a6a"/g) || []).length === 2 && (fundamentalMarks.match(/size: 2/g) || []).length === 2 && fundamentalMarks.includes('shape: "arrowUp"') && fundamentalMarks.includes('text: "PE "') && fundamentalMarks.includes('shape: "arrowDown"') && fundamentalMarks.includes('text: "Forward PE "') && appClient.includes("state.toggles.pe || state.toggles.futurePe ? 16 : 2") && !appClient.includes("paintFundamentals"), "the chart marks PE and Forward PE with large red triangles");
  assert(appClient.includes("mock.hidden = analyze || institution") && appClient.includes('$("stock-tools")') && appClient.includes("tools.hidden = analyze || institution") && page.includes('id="stock-tools"') && !analystCss.includes("margin-left: calc(100px - 0.4rem)") && analystCss.includes("background: var(--info)"), "mock stays on stock and the selected view is info blue");
  assert(page.includes("<h1>Authorised emails</h1>") && page.includes(">Authorised emails<") && !page.includes("Allowed emails"), "authorised emails");
  assert(analystCss.includes(".analyst-note-cell { white-space: pre-wrap; min-width: 16rem; max-width: 36rem; font-size: 0.72rem; }") && analystCss.includes(".analyst-saved input.note-input") && analystClient.includes('input.className = "note-input"'), "notes column is wider and smaller");
  assert(analystCss.includes("color: var(--muted); word-break: break-all;") && page.includes('id="analyst-remove-source"') && analystClient.includes('action: "remove-source"') && analystClient.includes("Remove this source?"), "source url is grey and an admin can remove it");
  assert(analystCss.includes(".view-switch {\n  display: inline-flex;\n  align-items: center;\n  gap: 0.45rem;\n  margin-right: 0.8rem;\n}") && analystCss.includes(".who { color: var(--muted); font-size: 0.82rem; margin: 0 0 29.25px; overflow-wrap: anywhere; }") && analystCss.includes("#fetch-settings-save { margin-bottom: 0; }") && analystCss.includes("#users-button { margin-top: 29.25px; }"), "view and account spacing");
  assert(page.includes('aria-label="Help"') && page.includes('aria-label="Account"') && /id="account-menu"[\s\S]*id="who"/.test(page) && /id="info-button"[\s\S]*id="signout"/.test(page) && !page.includes(">Help<") && !page.includes(">Users<"), "the gear menu holds the email and help sits left of sign out");
  assert(appClient.includes("function setAccountMenu") && appClient.includes('users-button").hidden = !state.admin') && appClient.includes("state.admin = body.admin === true") && appClient.includes('action: "save-fetch"'), "the gear menu toggles, allowed emails stays admin-only, and fetch settings save for the signed-in user");
  assert(page.includes('id="fetch-user-agent"') && page.includes('id="fetch-cookie"') && page.includes('id="analyst-source-url"') && analystClient.includes('textContent = "URL: " + url') && analystClient.includes('inputCell(tr, "date", row.date, "date")') && analystClient.includes('classList.add("is-waiting")') && analystCss.includes("body.is-waiting, body.is-waiting * { cursor: wait !important; }"), "fetch fields, source url, institution date, and wait cursor");
  const eventsSrc = fs.readFileSync(path.join(root, "api/events.js"), "utf8");
  assert(eventsSrc.includes("filled.sort") && appClient.includes("function byEventDate"), "event cards run oldest to newest");
  assert(page.includes('id="verdict-knob"') && analystCss.includes("linear-gradient(90deg, #e36a6a 0%, #e4b06a 50%, #3fbf8a 100%)") && appClient.includes('pair[0] + ": " + pair[1]'), "overall slider and vote counts");
  assert(page.includes("Extract transcript from:"), "youtube transcript line");
  assert(page.includes('class="analyst-work"'), "gap before the text row");
  assert(analystCss.includes(".analyst-work { margin-top: 3rem; }") && analystCss.includes(".analyst-model { margin: 0 0 3rem; }"), "three rem gaps around model");
  assert(/\.analyst-tabs button\[aria-selected="true"\][\s\S]*border-bottom-color: var\(--copper\)/.test(analystCss), "active tab is underlined");
  assert(!/total " \+ money/.test(analystClient) && analystClient.includes('Input " + rate') && analystClient.includes('Output " + rate') && analystClient.includes('Total " + rate'), "model label is the per-million rate");

  const models = require("../lib/analyst-models");
  const parse = require("../lib/analyst-parse");
  const fetched = require("../lib/analyst-fetch");
  const priced = require("../lib/analyst-openrouter");
  assert(models.DEFAULT_MODEL === "deepseek/deepseek-v4.1-flash-1017" && models.knownModel(models.DEFAULT_MODEL), "default model");
  const kept = parse.replaceLabeledLine("Date: 2026-01-01\nWebsite: TheStreet\nNotes: old", "Notes", "edited");
  assert(kept.includes("Notes: edited") && kept.includes("Website: TheStreet") && !kept.includes("Notes: old"), "edit rewrites the notes line");
  const addedLine = parse.replaceLabeledLine("Date: 2026-01-01", "Notes", "");
  assert(addedLine === "Date: 2026-01-01\nNotes: ", "edit adds a missing line");
  assert(models.MODELS.length === 26 && models.MODELS.indexOf("thinkingmachines/inkling-2-small:free") === -1 && models.MODELS.indexOf("xiaomi/mimo-v2.6-pro") !== -1 && models.MODELS.indexOf("tencent/hy4") !== -1 && models.MODELS.indexOf("tencent/hy4-flash") !== -1 && models.MODELS.indexOf("https://openrouter.ai/tencent") === -1 && models.refusesUrlExtract("google/gemini-4-carbon") && models.refusesUrlExtract("openai/gpt-6-sol") && models.refusesUrlExtract("x-ai/grok-4.7") && models.refusesUrlExtract("deepseek/deepseek-v4.1-flash-1017") && !models.refusesUrlExtract("tencent/hy4") && models.URL_EXTRACT_ERROR === "This model do not extract URL contents", "model ids");
  const picks = parse.parsePicks([
    "Website: TheStreet",
    "Analyst: Ada",
    "Short-term stock buy: NVDA, AMD",
    "Long-term stock buy: AAPL",
    "Short-term industry buy: Semiconductors",
    "Long-term industry buy: Banks",
    "Long-term industry avoid: Coal",
    "Short-term stock avoid: TSLA",
  ].join("\n"));
  assert(picks.website === "TheStreet" && picks.analystName === "Ada" && picks.shortTermStock === "NVDA, AMD" && picks.longTermStock === "AAPL" && picks.shortTermIndustry === "Semiconductors" && picks.longTermIndustry === "Banks" && picks.longTermIndustryAvoid === "Coal" && picks.shortTermAvoid === "TSLA", "picks");
  const counted = parse.parsePicks("Short-term stock buy: NVDA (3), AAPL\nShort-term stock avoid: TSLA");
  assert(counted.shortTermStock === "NVDA (3), AAPL" && counted.shortTermAvoid === "TSLA", "a repeated ticker keeps its count on the same line");
  const missing = parse.parsePicks("no labels");
  assert(missing.analystName === "" && missing.shortTermStock === "" && missing.shortTermAvoid === "", "missing picks");
  assert(parse.parsePicks("Short-term: NVDA\nLong-term: Banks").shortTermStock === "", "old pick labels are not enough");
  const dated = parse.parsePicks("Date: 2026-11-01\nURL: https://example.com/post\nAnalyst: Ada");
  assert(dated.date === "2026-11-01" && dated.url === "https://example.com/post" && dated.analystName === "Ada" && dated.note === "", "date and url lines");
  assert(parse.parsePicks("Analyst: Ada (TheStreet)").analystName === "Ada (TheStreet)", "analyst keeps the organisation");
  assert(parse.parsePicks("Date: 2026-11-01\nNotes: A short note").note === "A short note", "note is the Notes line");
  assert(parse.parsePicks("Date: 2026-11-01\nA short note").note === "", "unlabeled lines are not the note");
  assert(parse.resultDate("Date: 2026-11-01") === "2026-11-01", "result date");
  assert(parse.resultDate("Date: yesterday") === "", "result date must be a calendar day");
  const dates = require("../lib/analyst-dates");
  const window = dates.tradeWindow(new Date("2026-11-15T03:00:00Z"));
  assert(window.today === "2026-11-15" && window.cutoffDay === "2026-09-15", "two calendar months");
  assert(dates.isWithinWindow(null, window.cutoffIso) && !dates.isWithinWindow("2026-07-01T00:00:00Z", window.cutoffIso), "old posts are outside the window");
  const replaced = dates.channelChoice([
    { url: "https://example.com/old", publishedAt: "2026-11-01T00:00:00Z", processed: false },
    { url: "https://example.com/new", publishedAt: "2026-11-10T00:00:00Z", processed: true },
  ], window.cutoffIso);
  assert(!replaced.item && /already analysed/i.test(replaced.message), "newest analysed post is not replaced");
  const staleChoice = dates.channelChoice([
    { url: "https://example.com/stale", publishedAt: "2026-01-01T00:00:00Z", processed: false },
  ], window.cutoffIso);
  assert(!staleChoice.item && /two months/i.test(staleChoice.message), "channel skips posts older than two months");
  const urlPrompt = priced.instructions("https://example.com/post", true);
  assert(urlPrompt.startsWith("Analyse the URL, text or image.") && urlPrompt.includes("URL: <the post address>") && !urlPrompt.includes("URL: https://example.com/post"), "url analyse keeps the address out of the system message");
  const urlMessage = priced.userContent("Extracted page", "", "https://example.com/post", true);
  assert(urlMessage.indexOf("URL: https://example.com/post\n\nExtracted page") === 0, "url analyse puts the address in the user message");
  const urlExtract = priced.plannedExtractDebug("tencent/hy4", "Page text", "https://example.com/post", true, true);
  assert(urlExtract.includes("Analyse the URL, text or image.") && urlExtract.includes("URL: <the post address>") && urlExtract.includes("URL: https://example.com/post\\n\\nPage text") && urlExtract.includes('"model": "tencent/hy4"') && urlExtract.includes('"enabled": true') && urlExtract.includes('"type": "openrouter:web_fetch"') && urlExtract.includes('"engine": "openrouter"') && urlExtract.includes('"max_uses": 1'), "new url extract with ai sends the selected model, reasoning, and web fetch");
  const channelExtract = priced.plannedExtractDebug("deepseek/deepseek-v4.1-flash-1017", "Page text", "https://example.com/feed", false);
  assert(channelExtract.includes("Extract the article or post text from this page.") && channelExtract.indexOf("Analyse the URL") === -1, "channel extract with ai keeps the short prompt");
  const prompt = priced.instructions("https://example.com/post", new Date("2026-11-15T03:00:00Z"));
  assert(prompt.includes("Analyse the text or image.") && prompt.includes("Ignore trades older than 2 months.") && prompt.includes("Ignore Treasury Bills & Notes, Government Bonds") && prompt.includes("A increase/buy in that window is the short-term stock.") && prompt.includes("A decrease/sale in that window is the short-term avoid.\nAlways use ticker symbol when possible.") && prompt.includes("Short-term stock buy: NVDA (3), AAPL") && prompt.includes("A ticker mentioned once has no count.") && prompt.includes("strong short-term stock buy") && prompt.includes("strong short-term stock avoid") && prompt.includes("Website: <post platform>") && prompt.includes("URL: https://example.com/post") && prompt.includes("Analyst: <the commentator's name or portfolio owner> (<the commentator's organisation>)") && prompt.includes("Notes: <a short note the reader can edit>") && !prompt.includes("Today is ") && !prompt.includes("This is not financial advice."), "prompt template");
  const imageMessage = priced.userContent("", "data:image/png;base64,aaaa");
  assert(Array.isArray(imageMessage) && imageMessage[1].type === "image_url" && imageMessage[1].image_url.url.indexOf("data:image/png") === 0, "image analysis message");
  const shown = priced.debugBody({
    model: models.DEFAULT_MODEL,
    messages: [
      { role: "system", content: priced.instructions("https://example.com/post") },
      { role: "user", content: imageMessage },
    ],
    reasoning: { enabled: false },
  });
  assert(shown.includes('"image_url"') && shown.includes("data:image/png;base64,[3 bytes]") && shown.indexOf("aaaa") === -1 && shown.includes("Read the attached image.") && shown.includes('"reasoning"'), "debug body is the request json");
  assert(priced.replyText({ content: [{ type: "text", text: "Date: 2026-11-01" }, { text: "\nAnalyst: Ada" }] }) === "Date: 2026-11-01\nAnalyst: Ada", "content parts join");
  const openrouterSrc = fs.readFileSync(path.join(root, "lib/analyst-openrouter.js"), "utf8");
  assert(openrouterSrc.includes("reasoning: { enabled: reasoning === true }") && !openrouterSrc.includes("payload.reasoning = { enabled: false }") && openrouterSrc.includes("fetchPage ? 180000") && openrouterSrc.includes("withImage ? 60000 : 25000"), "reasoning follows the slider, web fetch waits 180 seconds, and image calls wait 60 seconds");
  const analystApi = fs.readFileSync(path.join(root, "api/analyst.js"), "utf8");
  const vercelConfig = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  assert(analystApi.includes('action === "bot-job"') && analystApi.includes("createBotJob") && analystApi.includes("recordPage(canonical, text)") && !analystApi.includes("Not implemented yet") && !analystApi.includes("XAI_API_KEY") && vercelConfig.includes('"maxDuration": 300'), "use bot queues a job and the analyse function can wait 300 seconds");
  const recorded = fetched.recordPage("https://example.com/post", "Extracted");
  assert(recorded.kind === "website" && recorded.focusUrl === "https://example.com/post" && recorded.items[0].body === "Extracted" && recorded.items[0].publishedAt == null, "ai page record stores the model text without fetching");
  const realFetch = global.fetch;
  const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key-not-sent";
  let sentImage = null;
  global.fetch = async function (_url, options) {
    sentImage = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: [{ type: "text", text: "Date: 2026-11-01" }], reasoning: "hidden work" } }],
        leak: "sk-or-abcdefghijklmnop",
      }),
    };
  };
  const imageRun = await priced.analyse(models.DEFAULT_MODEL, "", "", "data:image/png;base64,aaaa", true);
  assert(sentImage.reasoning.enabled === true && imageRun.text === "Date: 2026-11-01" && imageRun.debug.prompt.includes("data:image/png;base64,[3 bytes]") && imageRun.debug.prompt.indexOf("aaaa") === -1 && imageRun.debug.response.includes("hidden work") && imageRun.debug.response.indexOf("sk-or-") === -1, "image reply follows the reasoning slider");
  global.fetch = async function () {
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "", reasoning: "only reasoning" } }] }) };
  };
  let emptyImage = "";
  try {
    await priced.analyse(models.DEFAULT_MODEL, "", "", "data:image/png;base64,aaaa");
  } catch (err) {
    emptyImage = err.message;
    assert(err.debug && err.debug.response.includes("only reasoning"), "empty image keeps the response");
  }
  assert(emptyImage === models.DEFAULT_MODEL + " returned no labelled result.", "empty image names the model");
  let sentText = null;
  global.fetch = async function (_url, options) {
    sentText = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "" } }] }) };
  };
  let emptyText = "";
  try {
    await priced.analyse(models.DEFAULT_MODEL, "hello", "", "");
  } catch (err) {
    emptyText = err.message;
  }
  assert(sentText.reasoning.enabled === false && sentText.messages[1].content === "hello" && !sentText.tools && emptyText === "OpenRouter returned an empty result.", "text analyse stays on the empty result message");
  let sentFetch = null;
  global.fetch = async function (_url, options) {
    sentFetch = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "Date: 2026-11-01" } }] }) };
  };
  const fetchedPage = await priced.analyse("tencent/hy4", "Page text", "https://example.com/post", "", true, true, true);
  assert(sentFetch.model === "tencent/hy4" && sentFetch.reasoning.enabled === true && sentFetch.tools[0].type === "openrouter:web_fetch" && sentFetch.tools[0].parameters.engine === "openrouter" && sentFetch.tools[0].parameters.max_uses === 1 && fetchedPage.text === "Date: 2026-11-01" && fetchedPage.debug.prompt.includes("openrouter:web_fetch") && fetchedPage.debug.response.includes('"choices"'), "new url extract sends the selected model with web fetch and keeps the response json");
  global.fetch = async function (_url, options) {
    sentFetch = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "Date: 2026-11-02" }] } }] }) };
  };
  const fromParts = await priced.analyse("tencent/hy4-flash", "", "https://example.com/only", "", false, true, true);
  assert(sentFetch.messages[1].content === "URL: https://example.com/only" && fromParts.text === "Date: 2026-11-02" && fromParts.debug.response.includes("Date: 2026-11-02"), "a url with no page text still reaches openrouter and array content is kept");
  let sentExtract = null;
  global.fetch = async function (_url, options) {
    sentExtract = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "Article body" } }] }) };
  };
  const extracted = await priced.extractPage(models.DEFAULT_MODEL, "nav article", "https://example.com/post");
  assert(sentExtract.messages[0].content === priced.extractInstructions() && sentExtract.messages[1].content.indexOf("URL: https://example.com/post") === 0 && extracted.text === "Article body" && sentExtract.reasoning.enabled === false, "use ai extract sends the extract instructions");
  global.fetch = realFetch;
  if (savedOpenRouterKey == null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
  let badImage = "";
  try { priced.userContent("", "not-an-image"); } catch (err) { badImage = err.code; }
  assert(badImage === "bad_image", "image must be a data url");
  assert(fetched.websiteLabel('<meta property="og:site_name" content="Stock Circle">', "https://stockcircle.com/portfolio") === "Stock Circle", "site name");
  assert(fetched.websiteLabel("<html></html>", "https://www.stockcircle.com/x") === "stockcircle.com", "site name falls back to the host");
  assert(fetched.websiteLabel('<meta property="og:site_name" content="">', "https://www.thestreet.com/story") === "thestreet.com", "empty site name is not quote marks");
  assert(fetched.channelLabel('<meta property="og:site_name" content="TheStreet">', "https://www.thestreet.com/investing") === "TheStreet-Investing", "channel name uses the site and the directory");
  assert(fetched.channelLabel("<title>Investing News | TheStreet</title>", "https://www.thestreet.com/investing") === "TheStreet-Investing", "channel name can come from the title");
  assert(fetched.channelLabel("<html></html>", "https://www.thestreet.com") === "Thestreet", "a site root has no section suffix");
  assert(fetched.articleInDirectory("https://www.thestreet.com/investing", "https://thestreet.com/investing/bill-ackman-sells-microsoft") === true, "an article under the channel directory counts");
  assert(fetched.articleInDirectory("https://www.thestreet.com/investing/", "https://www.thestreet.com/markets/some-other-story") === false, "another section is not the channel directory");
  assert(fetched.articleInDirectory("https://www.thestreet.com/investing", "https://www.thestreet.com/investing") === false, "the channel index is not an article");
  const customHeaders = await fetched.runWithFetchIdentity({ userAgent: "Browser/1\nbad", cookie: "a=b" }, function () { return fetched.fetchHeaders(); });
  const plainHeaders = fetched.fetchHeaders();
  assert(customHeaders["User-Agent"] === "Browser/1 bad" && customHeaders.Cookie === "a=b" && plainHeaders["User-Agent"] === "stock_tracker/1.0 (analyst desk)" && !plainHeaders.Cookie, "fetch uses a saved identity only inside that request");
  const pricedRates = require("../lib/analyst-prices");
  const flash = pricedRates.perMillion("0.00000015", "0.0000006");
  assert(flash && flash.input === 0.15 && flash.output === 0.6 && flash.total === 0.75, "price per million tokens");
  const catalog = pricedRates.ratesFromCatalog([
    { id: "deepseek/deepseek-v4.1-flash-1017", pricing: { prompt: "0.00000015", completion: "0.0000006" } },
    { id: "missing/price" },
  ], ["deepseek/deepseek-v4.1-flash-1017", "missing/price"]);
  assert(catalog["deepseek/deepseek-v4.1-flash-1017"].total === 0.75 && !catalog["missing/price"], "catalog keeps only published prices");
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
  const youtubeJob = analystDb.buildBotRequest({ mode: "page", url: "https://www.youtube.com/watch?v=abcdefghijk", kind: "youtube", skip: [] });
  assert(youtubeJob.instruction.includes("public spoken transcript") && youtubeJob.instruction.includes("pasteTranscript") && youtubeJob.kind === "youtube", "a youtube bot job asks for a public transcript");
  const channelJob = analystDb.buildBotRequest({ mode: "channel", url: "https://example.com/investing", kind: "website", skip: ["https://example.com/older"], sourceName: "https://example.com/investing" });
  assert(channelJob.instruction.includes("newest post") && channelJob.instruction.includes("https://example.com/older") && channelJob.cutoff, "a channel bot job skips posts that are already analysed");
  const botScript = fs.readFileSync(path.join(root, "scripts/bot-job.js"), "utf8");
  assert(botScript.includes('command === "claim"') && botScript.includes('command === "complete"') && botScript.includes("DATABASE_URL") && !botScript.includes("XAI_API_KEY") && dbSrc.includes("CREATE TABLE IF NOT EXISTS analyst_bot_jobs") && dbSrc.includes("interval '15 minutes'"), "the bot script claims a neon job and a stale claim returns to pending");
  const ordered = analystDb.sortResults([
    { date: "2026-01-01" },
    { date: "" },
    { date: "2026-11-02" },
    { date: "2026-03-01" },
  ]);
  assert(ordered.map(function (row) { return row.date; }).join(",") === "2026-11-02,2026-03-01,2026-01-01,", "institution dates sort newest first");
  await analystDb.rememberLabel("unused", '""');
  await analystDb.rememberLabel("unused", '"');
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
  assert(desk.body.defaultModel === models.DEFAULT_MODEL && desk.body.models.length === 26 && desk.body.models.indexOf("thinkingmachines/inkling-2-small:free") === -1 && desk.body.sources.length === 0, "desk models without a database");
  assert(JSON.stringify(desk.body).indexOf("sk-") === -1, "desk payload has no secret");

  const missingKey = mockRes();
  await analyst({
    method: "POST",
    headers: { host: "localhost" },
    body: { action: "analyse", model: models.DEFAULT_MODEL, text: "A transcript about chips." },
  }, missingKey);
      assert(missingKey.statusCode === 503 && missingKey.body.message === "Set OPENROUTER_API_KEY on the server." && missingKey.body.debug && missingKey.body.debug.prompt.indexOf("Analyst:") !== -1 && missingKey.body.debug.response === "", "missing openrouter key is plain");
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
  const readerRemove = mockRes();
  await analyst({
    method: "POST",
    headers: { host: "localhost", "x-dev-email": outsider },
    body: { action: "remove-source", sourceId: "00000000-0000-4000-8000-000000000000" },
  }, readerRemove);
  assert(readerRemove.statusCode === 403 && readerRemove.body.error === "admin_only", "reader cannot remove a source");
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
        res.end("<html><head><title>Manual post</title><meta property=\"og:site_name\" content=\"Manual Desk\"></head><body><p>Manual body text</p></body></html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
      res.end("<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><item><title>Newer</title><link>https://example.com/newer</link><pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate><description>Newer body</description></item><item><title>Older</title><link>https://example.com/older</link><pubDate>Mon, 09 Nov 2026 00:00:00 GMT</pubDate><description>Older body</description></item></channel></rss>");
    });
    await new Promise((resolve) => feedServer.listen(0, "127.0.0.1", resolve));
    const feedUrl = "http://127.0.0.1:" + feedServer.address().port + "/feed";
    try {
      const queued = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "open-url", url: "https://example.com/bot-post", mode: "page", useBot: true },
      }, queued);
      assert(queued.statusCode === 200 && queued.body.waiting === true && queued.body.bot === true && queued.body.jobId, "use bot queues a page job");
      const claimed = await analystDb.claimBotJob();
      assert(claimed && claimed.id === queued.body.jobId && claimed.status === "claimed" && claimed.request.instruction.indexOf("example.com/bot-post") !== -1, "claim takes the oldest pending job");
      await analystDb.completeBotJob(claimed.id, {
        url: "https://example.com/bot-post",
        title: "Bot post",
        text: "Extracted by the bot.",
        pasteTranscript: false,
      });
      const done = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "bot-job", jobId: claimed.id },
      }, done);
      assert(done.statusCode === 200 && done.body.waiting === false && done.body.item && done.body.item.text.indexOf("Extracted by the bot.") !== -1, "a finished bot job fills the text");
      const videoQueued = await analystDb.createBotJob({
        mode: "page",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        kind: "youtube",
        skip: [],
      });
      const videoClaim = await analystDb.claimBotJob();
      assert(videoClaim && videoClaim.id === videoQueued.id, "claim takes the youtube job next");
      await analystDb.completeBotJob(videoClaim.id, {
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        title: "Chip talk",
        text: "",
        pasteTranscript: true,
      });
      const videoDone = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "bot-job", jobId: videoClaim.id },
      }, videoDone);
      assert(videoDone.statusCode === 200 && videoDone.body.item && videoDone.body.item.pasteTranscript === true && videoDone.body.item.text.indexOf("Chip talk") !== -1, "a youtube bot job without a transcript stays pasteable");
      assert(await analystDb.claimBotJob() == null, "claim is empty when nothing is pending");
      const created = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "add-source", name: feedUrl, kind: "website" },
      }, created);
      assert(created.statusCode === 200 && created.body.source && created.body.source.kind === "website" && !(created.body.sources || []).some((source) => source.id === created.body.source.id), "admin adds a source that stays off the list until it has a post");
      const sourceId = created.body.source.id;
      const firstItem = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "fetch", sourceId: sourceId },
      }, firstItem);
      assert(firstItem.statusCode === 200 && firstItem.body.item && firstItem.body.item.url === "https://example.com/newer" && firstItem.body.item.text.indexOf("Newer body") !== -1 && (firstItem.body.sources || []).some((source) => source.id === sourceId), "fetch returns the newest unprocessed item and lists that source");
      const savedRow = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: {
          action: "save",
          itemId: firstItem.body.item.id,
          resultText: [
            "Date: 2026-11-01",
            "Website: Example",
            "URL: https://example.com/newer",
            "Analyst: Ada",
            "Short-term stock buy: NVDA",
            "Long-term stock buy: AAPL",
            "Short-term industry buy: Semiconductors",
            "Long-term industry buy: Banks",
            "Long-term industry avoid: Coal",
            "Short-term stock avoid: TSLA",
            "Notes: Edited note.",
          ].join("\n"),
          model: models.DEFAULT_MODEL,
          totalCost: 0.00015,
          inputCost: 0.00005,
          outputCost: 0.0001,
        },
      }, savedRow);
      const savedView = savedRow.body.results[0];
      assert(savedRow.statusCode === 200 && savedView.postUrl === "https://example.com/newer" && savedView.source === "127.0.0.1" && savedView.website === "Example" && savedView.date === "2026-11-01" && savedView.analystName === "Ada" && savedView.shortTermStock === "NVDA" && savedView.longTermStock === "AAPL" && savedView.shortTermIndustry === "Semiconductors" && savedView.longTermIndustry === "Banks" && savedView.longTermIndustryAvoid === "Coal" && savedView.shortTermAvoid === "TSLA" && savedView.note === "Edited note." && savedView.modelId === models.DEFAULT_MODEL && savedView.resultText.indexOf("Edited note.") !== -1, "save stores the edited result and url");
      assert(Math.abs(savedView.totalCost - 0.00015) < 1e-12 && Math.abs(savedView.inputCost - 0.00005) < 1e-12 && Math.abs(savedView.outputCost - 0.0001) < 1e-12, "save stores the three costs");
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
            "Date: 2026-11-02",
            "Website: Manual Desk",
            "URL: " + manualUrl,
            "Analyst: Bea",
            "Short-term stock buy: MSFT",
            "Long-term stock buy: none",
            "Short-term industry buy: Software",
            "Long-term industry buy: none",
            "Long-term industry avoid: none",
            "Short-term stock avoid: none",
          ].join("\n"),
          model: models.DEFAULT_MODEL,
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
        },
      }, manualSaved);
      const manualView = manualSaved.body.results[0];
      assert(manualSaved.statusCode === 200 && manualView.source === "Manual Desk" && manualView.website === "Manual Desk" && manualView.analystName === "Bea" && manualView.shortTermStock === "MSFT" && manualView.note === "", "manual url result is saved");
      const clip = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: {
          action: "save",
          clipboard: true,
          resultText: [
            "Date: 2026-11-03",
            "Website: Clipboard",
            "URL: none",
            "Analyst: Cleo",
            "Short-term stock buy: NVDA",
            "Long-term stock buy: none",
            "Short-term industry buy: none",
            "Long-term industry buy: none",
            "Long-term industry avoid: none",
            "Short-term stock avoid: none",
          ].join("\n"),
          model: models.DEFAULT_MODEL,
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
        },
      }, clip);
      const clipView = (clip.body.results || []).find((row) => row.analystName === "Cleo");
      assert(clip.statusCode === 200 && clipView && clipView.source === "Clipboard" && clipView.postUrl === "" && clipView.url === "none" && clipView.website === "Clipboard" && clipView.shortTermStock === "NVDA", "clipboard save has no post");
      const editedSite = mockRes();
      await analyst({
        method: "POST",
        headers: { host: "localhost" },
        body: {
          action: "update-result",
          id: savedView.id,
          date: "2026-11-01",
          website: "Edited Site",
          analystName: "Ada",
          shortTermStock: "NVDA",
          longTermStock: "AAPL",
          shortTermIndustry: "Semiconductors",
          longTermIndustry: "Banks",
          longTermIndustryAvoid: "Coal",
          shortTermAvoid: "TSLA",
          note: "Edited note.",
        },
      }, editedSite);
      const editedView = (editedSite.body.results || []).find((row) => row.id === savedView.id);
      assert(editedSite.statusCode === 200 && editedView && editedView.website === "Edited Site" && editedView.resultText.indexOf("Website: Edited Site") !== -1 && editedView.url === "https://example.com/newer", "edit stores the website line");
      const afterClip = mockRes();
      await analyst({ method: "GET", headers: { host: "localhost" } }, afterClip);
      assert(afterClip.statusCode === 200 && (afterClip.body.sources || []).every((source) => source.kind !== "clipboard"), "clipboard source stays out of the list");
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
      assert(readerRows.statusCode === 200 && readerRows.body.results.some((row) => row.postUrl === "https://example.com/newer" && row.source === "127.0.0.1" && row.analystName === "Ada" && row.shortTermStock === "NVDA" && row.shortTermAvoid === "TSLA") && readerRows.body.results.some((row) => row.postUrl === manualUrl && row.analystName === "Bea"), "reader sees the saved rows");
      await users({
        method: "POST",
        headers: { host: "localhost" },
        body: { action: "remove", email: outsider },
      }, mockRes());
      const channelServer = http.createServer((req, res) => {
        const path = req.url.split("?")[0];
        const article = "<html><head><title>Ackman</title></head><body><article>Bill Ackman sold Microsoft and bought Netflix in the latest filing.</article></body></html>";
        const pages = {
          "/investing": "<html><head><title>Investing</title><meta property=\"og:site_name\" content=\"TheStreet\"></head><body><a href=\"/markets/some-other-market-story\">Markets</a><a href=\"/investing/bill-ackman-sells-microsoft\">Lead</a></body></html>",
          "/investing/bill-ackman-sells-microsoft": article,
          "/markets/some-other-market-story": "<html><body><article>This markets story is outside the investing directory and must not be extracted.</article></body></html>",
          "/section": "<html><head><meta property=\"og:site_name\" content=\"TheStreet\"></head><body><a href=\"/markets/some-other-market-story\">Markets</a><a href=\"/section/desk\">Desk</a></body></html>",
          "/section/desk": "<html><body><a href=\"/section/one-extracted-article\">Story</a></body></html>",
          "/section/one-extracted-article": "<html><body><article>The traversed section article names one holding and explains the trade.</article></body></html>",
          "/empty": "<html><head><meta property=\"og:site_name\" content=\"TheStreet\"></head><body><a href=\"/markets/some-other-market-story\">Elsewhere</a></body></html>",
        };
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pages[path] || "<html><body>Missing</body></html>");
      });
      await new Promise((resolve) => channelServer.listen(0, "127.0.0.1", resolve));
      const channelBase = "http://127.0.0.1:" + channelServer.address().port;
      try {
        const channel = mockRes();
        await analyst({
          method: "POST",
          headers: { host: "localhost" },
          body: { action: "open-url", url: channelBase + "/investing", mode: "channel" },
        }, channel);
        const channelSource = (channel.body.sources || []).find((source) => source.name === channelBase + "/investing");
        assert(channel.statusCode === 200 && channel.body.item && channel.body.item.url === channelBase + "/investing/bill-ackman-sells-microsoft" && channel.body.item.text.indexOf("bought Netflix") !== -1 && channel.body.item.text.indexOf("outside the investing directory") === -1 && channelSource && channelSource.displayName === "TheStreet-Investing", "channel extract keeps one same-directory article and names the source");
        const traversed = mockRes();
        await analyst({
          method: "POST",
          headers: { host: "localhost" },
          body: { action: "open-url", url: channelBase + "/section", mode: "channel" },
        }, traversed);
        assert(traversed.statusCode === 200 && traversed.body.item && traversed.body.item.url === channelBase + "/section/one-extracted-article" && traversed.body.item.text.indexOf("traversed section article") !== -1, "channel extract follows one page inside the directory");
        const beforeEmpty = (traversed.body.sources || []).length;
        const empty = mockRes();
        await analyst({
          method: "POST",
          headers: { host: "localhost" },
          body: { action: "open-url", url: channelBase + "/empty", mode: "channel" },
        }, empty);
        const afterEmpty = mockRes();
        await analyst({ method: "GET", headers: { host: "localhost" } }, afterEmpty);
        assert(empty.statusCode === 200 && empty.body.error === "no_items" && !(afterEmpty.body.sources || []).some((source) => source.name === channelBase + "/empty") && (afterEmpty.body.sources || []).length === beforeEmpty, "a channel with no article is not saved");
        const removed = mockRes();
        if (channelSource) {
          await analyst({
            method: "POST",
            headers: { host: "localhost" },
            body: { action: "remove-source", sourceId: channelSource.id },
          }, removed);
        }
        assert(channelSource && removed.statusCode === 200 && !(removed.body.sources || []).some((source) => source.id === channelSource.id), "remove drops the channel and its article");
      } finally {
        await new Promise((resolve) => channelServer.close(resolve));
      }
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
