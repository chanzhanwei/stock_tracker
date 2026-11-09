"use strict";

const {
  readBody,
  requireAdmin,
  listAllowed,
  addEmail,
  removeEmail,
  send,
  withErrors,
} = require("../lib/allowlist");

module.exports = withErrors(async function users(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, { error: "method_not_allowed" });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method === "GET") {
    const loaded = await listAllowed();
    send(res, 200, {
      emails: loaded.emails,
      me: admin.email,
      admin: true,
      persistent: loaded.persistent,
    });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    send(res, 400, { error: "bad_request" });
    return;
  }
  const action = body && body.action;
  try {
    if (action === "add") {
      const loaded = await addEmail(body.email);
      if (!loaded.persistent && process.env.VERCEL) {
        send(res, 503, { error: "allowlist_persistence_unconfigured" });
        return;
      }
      send(res, 200, { emails: loaded.emails, persistent: loaded.persistent });
      return;
    }
    if (action === "remove") {
      const loaded = await removeEmail(body.email);
      if (!loaded.persistent && process.env.VERCEL) {
        send(res, 503, { error: "allowlist_persistence_unconfigured" });
        return;
      }
      send(res, 200, { emails: loaded.emails, persistent: loaded.persistent });
      return;
    }
    send(res, 400, { error: "invalid_action" });
  } catch (err) {
    const code = err && err.code;
    if (code === "invalid_email" || code === "cannot_remove_admin") {
      send(res, 400, { error: code });
      return;
    }
    if (code === "not_found") {
      send(res, 404, { error: code });
      return;
    }
    throw err;
  }
});
