"use strict";

const { DEFAULT_MODEL, MODELS, knownModel } = require("../lib/analyst-models");
const { discover, normalizeSourceName } = require("../lib/analyst-fetch");
const { analyse } = require("../lib/analyst-openrouter");
const {
  DATABASE_MESSAGE,
  configured,
  listSources,
  listResults,
  addSource,
  getSource,
  takeNext,
  saveResult,
} = require("../lib/analyst-db");
const { readBody, requireAdmin, requireUser, send, withErrors } = require("../lib/allowlist");

const STATUS = {
  bad_request: 400,
  bad_name: 400,
  bad_kind: 400,
  bad_url: 400,
  bad_x_user: 400,
  bad_youtube: 400,
  bad_model: 400,
  empty_text: 400,
  picks_required: 400,
  bad_cost: 400,
  invalid_action: 400,
  not_found: 404,
  duplicate_source: 409,
  already_processed: 409,
  database_unconfigured: 503,
  database_unavailable: 503,
  openrouter_unconfigured: 503,
  openrouter_timeout: 502,
  openrouter_failed: 502,
  openrouter_empty: 502,
  youtube_channel_not_found: 502,
  x_unavailable: 502,
  fetch_failed: 502,
  no_items: 200,
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sendMapped(res, err) {
  const code = err && err.code;
  const status = STATUS[code] || 500;
  const message = STATUS[code]
    ? (err.message || "The Analyst desk could not complete that step.")
    : "The Analyst desk could not complete that step.";
  send(res, status, { error: STATUS[code] ? code : "internal", message: message });
}

function deskPayload(admin, extra) {
  return Object.assign({
    admin: admin,
    database: configured(),
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    sources: [],
    results: [],
    message: configured() ? "" : DATABASE_MESSAGE,
  }, extra || {});
}

async function readDesk(user) {
  if (!configured()) return deskPayload(user.admin);
  const sources = await listSources();
  const results = await listResults();
  return deskPayload(user.admin, { sources: sources, results: results, message: "" });
}

async function fetchNext(sourceId) {
  const source = await getSource(sourceId);
  if (!source) {
    const err = new Error("That source is not saved.");
    err.code = "not_found";
    throw err;
  }
  let discovered = null;
  let warning = "";
  try {
    discovered = await discover(source);
  } catch (err) {
    warning = err && err.code && err.message ? err.message : "The source could not be fetched.";
  }
  try {
    return await takeNext(source, discovered, warning);
  } catch (err) {
    if (err && err.code === "no_items") {
      return { item: null, message: err.message };
    }
    throw err;
  }
}

async function handle(req, res) {
  if (req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    send(res, 200, await readDesk(user));
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { error: "method_not_allowed", message: "The Analyst desk did not understand that request." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    send(res, 400, { error: "bad_request", message: "The Analyst desk did not understand that request." });
    return;
  }
  const action = body && body.action;
  if (action === "add-source") {
    const name = normalizeSourceName(body.name, body.kind);
    const source = await addSource(name, body.kind, admin.email);
    const sources = await listSources();
    send(res, 200, { source: source, sources: sources });
    return;
  }
  if (action === "fetch") {
    if (!isUuid(body.sourceId)) {
      send(res, 400, { error: "bad_request", message: "Choose a saved source." });
      return;
    }
    send(res, 200, await fetchNext(body.sourceId));
    return;
  }
  if (action === "analyse") {
    send(res, 200, await analyse(body.model, body.text));
    return;
  }
  if (action === "save") {
    if (!isUuid(body.itemId)) {
      send(res, 400, { error: "bad_request", message: "Fetch an item before saving." });
      return;
    }
    if (!knownModel(body.model)) {
      send(res, 400, { error: "bad_model", message: "Choose a model from the list." });
      return;
    }
    const saved = await saveResult({
      itemId: body.itemId,
      resultText: body.resultText,
      model: body.model,
      totalCost: body.totalCost,
      inputCost: body.inputCost,
      outputCost: body.outputCost,
      email: admin.email,
    });
    const results = await listResults();
    send(res, 200, { saved: saved, results: results });
    return;
  }
  send(res, 400, { error: "invalid_action", message: "The Analyst desk did not understand that request." });
}

module.exports = withErrors(async function analyst(req, res) {
  try {
    await handle(req, res);
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    sendMapped(res, err);
  }
});
