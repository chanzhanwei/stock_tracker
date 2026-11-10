"use strict";

const { TTL, get, set } = require("../lib/cache");
const { parseInstrument } = require("../lib/symbols");
const { mockEvents } = require("../lib/mock");
const { fetchEventParts } = require("../lib/yahoo");
const { queryOf, requireUser, send, withErrors } = require("../lib/allowlist");

module.exports = withErrors(async function events(req, res) {
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
  const allowMock = String(query.mock) === "1";
  const key = "events:" + parsed.exchange + ":" + parsed.symbol + ":mock" + (allowMock ? "1" : "0");
  const cached = get(key);
  if (cached) {
    send(res, 200, cached);
    return;
  }
  const mocks = allowMock ? mockEvents(parsed.exchange, parsed.symbol) : [];
  let earnings = null;
  let dividend = null;
  try {
    const live = await fetchEventParts(parsed.yahoo);
    earnings = live && live.earnings;
    dividend = live && live.dividend;
  } catch (err) {
    earnings = null;
    dividend = null;
  }
  const filled = [];
  const earningsRow = earnings || mocks.find((row) => row.type === "earnings");
  const dividendRow = dividend || mocks.find((row) => row.type === "dividend");
  if (earningsRow) filled.push(earningsRow);
  if (dividendRow) filled.push(dividendRow);
  if (allowMock) {
    const agm = mocks.find((row) => row.type === "agm");
    if (agm) filled.push(agm);
  }
  let source = "none";
  if (filled.some((row) => row.source === "yahoo")) source = "yahoo";
  else if (filled.length) source = "mock";
  const payload = { source, events: filled };
  set(key, payload, TTL.events);
  send(res, 200, payload);
});
