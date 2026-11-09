"use strict";

const { TTL, get, set } = require("../lib/cache");
const { parseInstrument, clampDays } = require("../lib/symbols");
const { mockBars } = require("../lib/mock");
const { fetchDailyBars } = require("../lib/yahoo");
const { queryOf, requireUser, send, withErrors } = require("../lib/allowlist");

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
  const key = "ohlcv:" + parsed.exchange + ":" + parsed.symbol + ":" + days;
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
  if (!payload) payload = { source: "mock", bars: mockBars(parsed.exchange, parsed.symbol, days) };
  set(key, payload, TTL.ohlcv);
  send(res, 200, payload);
});
