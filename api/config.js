"use strict";

const { isDevBypass, send, withErrors } = require("../lib/allowlist");

module.exports = withErrors(async function config(req, res) {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || "";
  send(res, 200, {
    publishableKey: publishableKey || null,
    devBypass: isDevBypass(req),
  });
});
