"use strict";

const {
  readBody,
  requireAdmin,
  requireUser,
  listAllowed,
  addEmail,
  removeEmail,
  send,
  withErrors,
} = require("../lib/allowlist");
const { getFetchSettings, saveFetchSettings } = require("../lib/analyst-db");

async function settingsFor(email) {
  try {
    return await getFetchSettings(email);
  } catch (err) {
    return { userAgent: "", cookie: "" };
  }
}

module.exports = withErrors(async function users(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    const settings = await settingsFor(user.email);
    if (!user.admin) {
      send(res, 200, {
        me: user.email,
        admin: false,
        allowed: true,
        userAgent: settings.userAgent,
        cookie: settings.cookie,
      });
      return;
    }
    const loaded = await listAllowed();
    send(res, 200, {
      emails: loaded.emails,
      me: user.email,
      admin: true,
      persistent: loaded.persistent,
      userAgent: settings.userAgent,
      cookie: settings.cookie,
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
  if (action === "save-fetch") {
    const user = await requireUser(req, res);
    if (!user) return;
    try {
      send(res, 200, await saveFetchSettings(user.email, body.userAgent, body.cookie));
    } catch (err) {
      if (err && err.code === "database_unconfigured") {
        send(res, 503, { error: "database_unconfigured" });
        return;
      }
      throw err;
    }
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
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
