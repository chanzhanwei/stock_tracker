"use strict";

const { TTL, get, set } = require("../lib/cache");
const { parseInstrument } = require("../lib/symbols");
const { mockInstitutional } = require("../lib/mock");
const { queryOf, requireUser, send, withErrors } = require("../lib/allowlist");

module.exports = withErrors(async function institutional(req, res) {
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
  const key = "institutional:" + parsed.exchange + ":" + parsed.symbol + ":mock" + (allowMock ? "1" : "0");
  const cached = get(key);
  if (cached) {
    send(res, 200, cached);
    return;
  }
  const payload = allowMock
    ? mockInstitutional(parsed.exchange, parsed.symbol)
    : { source: "none", buyPct: null, sellPct: null };
  set(key, payload, TTL.institutional);
  send(res, 200, payload);
});
