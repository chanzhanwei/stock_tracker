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
  const key = "events:" + parsed.exchange + ":" + parsed.symbol;
  const cached = get(key);
  if (cached) {
    send(res, 200, cached);
    return;
  }
  const mocks = mockEvents(parsed.exchange, parsed.symbol);
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
  const filled = [
    earnings || mocks.find((row) => row.type === "earnings"),
    dividend || mocks.find((row) => row.type === "dividend"),
    mocks.find((row) => row.type === "agm"),
  ];
  const source = filled.some((row) => row && row.source === "yahoo") ? "yahoo" : "mock";
  const payload = { source, events: filled };
  set(key, payload, TTL.events);
  send(res, 200, payload);
});
