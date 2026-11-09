"use strict";

const { send, withErrors } = require("../lib/allowlist");

module.exports = withErrors(async function health(_req, res) {
  send(res, 200, { ok: true, service: "stock_tracker" });
});
