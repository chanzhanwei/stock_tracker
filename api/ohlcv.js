"use strict";

const { TTL, get, set } = require("../lib/cache");
const { parseInstrument, clampDays } = require("../lib/symbols");
const { mockBars } = require("../lib/mock");
const { fetchDailyBars, fetchValuation } = require("../lib/yahoo");
const { priceFacts } = require("../lib/quote-facts");
const { queryOf, requireUser, send, withErrors } = require("../lib/allowlist");

const HISTORY_DAYS = 3650;

function blankFacts() {
  return { pe: null, forwardPe: null, high: null, highDate: "", declinePct: null, lastVisit: "" };
}

async function quoteFactsFor(payload, parsed) {
  try {
    let history = payload.bars || [];
    if (payload.source === "mock") {
      history = mockBars(parsed.exchange, parsed.symbol, HISTORY_DAYS);
    } else if (payload.source === "yahoo") {
      const cacheKey = "ohlcv-history:" + parsed.yahoo;
      const cached = get(cacheKey);
      if (cached) history = cached;
      else {
        const long = await fetchDailyBars(parsed.yahoo, HISTORY_DAYS);
        if (long && long.bars && long.bars.length) {
          history = long.bars;
          set(cacheKey, history, TTL.ohlcv);
        }
      }
    }
    const facts = priceFacts(history);
    if (payload.source === "yahoo") {
      const value = await fetchValuation(parsed.yahoo);
      facts.pe = value.pe;
      facts.forwardPe = value.forwardPe;
    }
    return facts;
  } catch (err) {
    return blankFacts();
  }
}

module.exports = withErrors(async function ohlcv(req, res) {
  if (req.method !== "GET") {
    send(res, 405, { error: "method_not_allowed" });
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;
  const query = queryOf(req);
  const parsed = parseInstrument(query);
  if (parsed.error) {
    send(res, 400, { error: parsed.error });
    return;
  }
  const days = clampDays(query.days);
  const allowMock = String(query.mock) === "1";
  const key = "ohlcv:" + parsed.exchange + ":" + parsed.symbol + ":" + days + ":mock" + (allowMock ? "1" : "0");
  const cached = get(key);
  if (cached) {
    send(res, 200, cached);
    return;
  }
  let payload = null;
  try {
    const live = await fetchDailyBars(parsed.yahoo, days);
    if (live && live.bars && live.bars.length) payload = { source: "yahoo", bars: live.bars };
  } catch (err) {
    payload = null;
  }
  if (!payload && allowMock) payload = { source: "mock", bars: mockBars(parsed.exchange, parsed.symbol, days) };
  if (!payload) payload = { source: "none", bars: [] };
  payload.facts = await quoteFactsFor(payload, parsed);
  set(key, payload, TTL.ohlcv);
  send(res, 200, payload);
});
