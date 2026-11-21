"use strict";

const { DEFAULT_MODEL, MODELS, knownModel } = require("../lib/analyst-models");
const { loadPrices } = require("../lib/analyst-prices");
const { attachFetch, canonicalPostUrl, discover, normalizeSourceName, openTarget, readSiteLabel, recordPage, runWithFetchIdentity } = require("../lib/analyst-fetch");
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
  saveClipboard,
  updateResult,
  deleteResult,
  removeSource,
  rememberLabel,
  isProcessedUrl,
  openManual,
  getFetchSettings,
  processedUrls,
  createBotJob,
  getBotJob,
  failBotJob,
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
  bad_image: 400,
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
  bot_failed: 502,
  cursor_unconfigured: 503,
  cursor_failed: 502,
  no_items: 200,
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sendMapped(res, err) {
  const code = err && err.code;
  const status = STATUS[code] || 500;
  const message = STATUS[code]
    ? (err.message || "The Analyze desk could not complete that step.")
    : "The Analyze desk could not complete that step.";
  const payload = { error: STATUS[code] ? code : "internal", message: message };
  const exchange = err && err.fetch && typeof err.fetch.request === "string" ? err.fetch : null;
  const debug = err && err.debug && typeof err.debug.prompt === "string" ? err.debug : null;
  if (exchange) {
    payload.fetch = {
      request: String(exchange.request).slice(0, 200000),
      response: String(exchange.response || "").slice(0, 200000),
    };
  }
  if (debug) {
    payload.debug = {
      prompt: String(debug.prompt).slice(0, 200000),
      response: String(debug.response || "").slice(0, 200000),
    };
  }
  if (err && err.bot) payload.bot = true;
  if (err && err.jobId) payload.jobId = err.jobId;
  send(res, status, payload);
}

const CURSOR_REPO = "https://github.com/chanzhanwei/stock_tracker";
let cachedGrokModel = "";

function isAgentId(value) {
  return /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function agentUrl(id) {
  return "https://cursor.com/agents/" + id;
}

function botRunName(url) {
  let host = "page";
  try {
    host = new URL(String(url || "")).hostname.replace(/^www\./, "") || "page";
  } catch (err) { /* a request without a url still gets a short name */ }
  return ("Read " + host).slice(0, 100);
}

function cursorError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function cursorJson(method, url, body) {
  const key = process.env.CURSOR_API_KEY || "";
  if (!key) throw cursorError("cursor_unconfigured", "Set CURSOR_API_KEY on the server.");
  let res;
  try {
    const headers = {
      Authorization: "Basic " + Buffer.from(key + ":").toString("base64"),
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";
    res = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw cursorError("cursor_failed", "Grok Bot could not be started.");
  }
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = {}; }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw cursorError("cursor_failed", "CURSOR_API_KEY cannot start a Grok Bot.");
    const message = parsed && typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim().slice(0, 300)
      : "Grok Bot could not be started.";
    throw cursorError("cursor_failed", message);
  }
  return parsed;
}

async function grokModelId() {
  if (cachedGrokModel) return cachedGrokModel;
  const listed = await cursorJson("GET", "https://api.cursor.com/v1/models");
  const items = listed && Array.isArray(listed.items) ? listed.items : [];
  const grok = items.filter(function (item) {
    const id = String(item && item.id || "");
    const name = String(item && item.displayName || "");
    return /grok/i.test(id + " " + name);
  });
  const preferred = grok.find(function (item) { return item.id === "grok-4.7"; });
  const chosen = preferred || grok[0];
  if (!chosen || !chosen.id) throw cursorError("cursor_unconfigured", "Cursor has no Grok model for this key.");
  cachedGrokModel = String(chosen.id);
  return cachedGrokModel;
}

async function startGrokBot(job) {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw cursorError("database_unconfigured", DATABASE_MESSAGE);
  const modelId = await grokModelId();
  const request = job.request || {};
  const prompt = [
    "Run this one analyst bot job. Do not edit files, do not commit, and do not open a pull request.",
    "Job id: " + job.id,
    "Claim only this job:",
    "node scripts/bot-job.js claim " + job.id,
    "Read the page described in the printed job request. Keep the title, date, author, and the body.",
    "Complete only this job by piping a JSON object to:",
    "node scripts/bot-job.js complete " + job.id,
    "The JSON object has url, title, text, and pasteTranscript.",
    String(request.instruction || ""),
  ].join("\n");
  const created = await cursorJson("POST", "https://api.cursor.com/v1/agents", {
    prompt: { text: prompt },
    model: { id: modelId },
    name: botRunName(request.url),
    repos: [{ url: CURSOR_REPO, startingRef: "main" }],
    autoCreatePR: false,
    envVars: { DATABASE_URL: databaseUrl },
  });
  const agent = created && created.agent ? created.agent : {};
  const id = String(agent.id || "");
  if (!isAgentId(id)) throw cursorError("cursor_failed", "Grok Bot did not return an id.");
  return { id: id, url: agentUrl(id) };
}

function deskPayload(admin, extra) {
  return Object.assign({
    admin: admin,
    database: configured(),
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    prices: {},
    sources: [],
    results: [],
    message: configured() ? "" : DATABASE_MESSAGE,
  }, extra || {});
}

async function readDesk(user) {
  const prices = await loadPrices(MODELS);
  if (!configured()) return deskPayload(user.admin, { prices: prices });
  const sources = await listSources();
  const results = await listResults();
  return deskPayload(user.admin, { prices: prices, sources: sources, results: results, message: "" });
}

function botDebug(job) {
  return {
    prompt: JSON.stringify(job && job.request || {}, null, 2),
    response: JSON.stringify(job && job.result || {}, null, 2),
  };
}

function waitingPayload(job, agent) {
  const url = agent && agent.url ? agent.url : "";
  return {
    waiting: true,
    bot: true,
    jobId: job.id,
    agentId: agent && agent.id ? agent.id : "",
    agentUrl: url,
    debug: { prompt: JSON.stringify(job.request || {}, null, 2), response: url },
  };
}

async function queueBotJob(input) {
  const job = await createBotJob(input);
  try {
    const agent = await startGrokBot(job);
    return waitingPayload(job, agent);
  } catch (err) {
    const message = String(err && err.message || "Grok Bot could not be started.").slice(0, 500);
    try { await failBotJob(job.id, message); } catch (failErr) { /* the launch error is the one to report */ }
    const wrapped = new Error(message);
    wrapped.code = err && err.code ? err.code : "cursor_failed";
    wrapped.bot = true;
    wrapped.jobId = job.id;
    wrapped.debug = { prompt: JSON.stringify(job.request || {}, null, 2), response: "" };
    throw wrapped;
  }
}

async function readBotJob(id, email) {
  const job = await getBotJob(id);
  if (!job) {
    const err = new Error("That job is gone.");
    err.code = "not_found";
    throw err;
  }
  if (job.status === "pending" || job.status === "claimed") return waitingPayload(job);
  const result = job.result || {};
  const debug = botDebug(job);
  if (job.status === "error" || result.error) {
    const err = new Error(result.error || "Grok Bot could not read that page.");
    err.code = "bot_failed";
    err.bot = true;
    err.debug = debug;
    throw err;
  }
  let canonical = result.url || (job.request && job.request.url) || "";
  try {
    canonical = canonicalPostUrl(canonical);
  } catch (err) {
    const bad = new Error("Grok Bot did not return a page address.");
    bad.code = "bad_url";
    bad.bot = true;
    bad.debug = debug;
    throw bad;
  }
  const text = String(result.text || "");
  const title = String(result.title || "");
  const target = recordPage(canonical, text);
  if (job.mode !== "page") {
    if (job.request && job.request.sourceName) target.sourceName = job.request.sourceName;
    if (job.request && job.request.kind) target.kind = job.request.kind;
  }
  if (target.items[0]) target.items[0].title = title;
  const opened = await openManual(target, email, job.mode === "page" ? "page" : "channel");
  if (opened.item) {
    const transcript = result.pasteTranscript === true || (opened.item.kind === "youtube" && !text.trim());
    if (transcript) {
      opened.item.pasteTranscript = true;
      opened.item.text = title ? title + "\n\n" : "";
    } else if (opened.item.kind === "youtube") {
      opened.item.pasteTranscript = false;
      opened.item.text = text;
    }
  }
  opened.bot = true;
  opened.waiting = false;
  opened.jobId = job.id;
  opened.debug = debug;
  return opened;
}

async function withIdentity(email, fn) {
  let identity = { userAgent: "", cookie: "" };
  try {
    identity = await getFetchSettings(email);
  } catch (err) {
    identity = { userAgent: "", cookie: "" };
  }
  return runWithFetchIdentity(identity, fn);
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
  if (source.kind === "website" && !String(source.label || "").trim()) {
    try {
      await rememberLabel(source.id, await readSiteLabel(source.name));
    } catch (err) { /* the hostname is shown until a later extract stores a name */ }
  }
  try {
    const next = await takeNext(source, discovered, warning);
    next.sources = await listSources();
    return next;
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
    send(res, 405, { error: "method_not_allowed", message: "The Analyze desk did not understand that request." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    send(res, 400, { error: "bad_request", message: "The Analyze desk did not understand that request." });
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
    if (body.useBot === true) {
      const source = await getSource(body.sourceId);
      if (!source) {
        send(res, 404, { error: "not_found", message: "That source is not saved." });
        return;
      }
      const skip = await processedUrls(source.id, 30);
      send(res, 200, await queueBotJob({
        mode: "source",
        url: source.url || source.name,
        kind: source.kind,
        sourceName: source.name,
        sourceId: source.id,
        skip: skip,
      }));
      return;
    }
    const fetched = await withIdentity(admin.email, function () { return fetchNext(body.sourceId); });
    send(res, 200, fetched);
    return;
  }
  if (action === "bot-job") {
    if (!isUuid(body.jobId)) {
      send(res, 400, { error: "bad_request", message: "That job is gone." });
      return;
    }
    send(res, 200, await readBotJob(body.jobId, admin.email));
    return;
  }
  if (action === "remove-source") {
    if (!isUuid(body.sourceId)) {
      send(res, 400, { error: "bad_request", message: "Choose a saved source." });
      return;
    }
    send(res, 200, { sources: await removeSource(body.sourceId) });
    return;
  }
  if (action === "open-url") {
    const mode = body.mode === "channel" || body.mode === "page" ? body.mode : "";
    if (body.useBot === true && (mode === "page" || mode === "channel")) {
      const canonical = canonicalPostUrl(body && body.url);
      if (mode === "page") {
        let already = false;
        try {
          already = await isProcessedUrl(canonical);
        } catch (err) {
          if (!err || err.code !== "database_unconfigured") throw err;
        }
        if (already) {
          send(res, 200, {
            item: null,
            message: "That post is already analysed.",
            sources: await listSources(),
          });
          return;
        }
      }
      send(res, 200, await queueBotJob({
        mode: mode,
        url: canonical,
        sourceName: mode === "channel" ? canonical : "",
      }));
      return;
    }
    let target = null;
    try {
      if (mode !== "channel") {
        const canonical = canonicalPostUrl(body && body.url);
        let already = false;
        try {
          already = await isProcessedUrl(canonical);
        } catch (err) {
          if (!err || err.code !== "database_unconfigured") throw err;
        }
        if (already) {
          send(res, 200, {
            item: null,
            message: "That post is already analysed.",
            sources: await listSources(),
          });
          return;
        }
      }
      target = await withIdentity(admin.email, async function () {
        try {
          const opened = await openTarget(body.url, { mode: mode });
          return attachFetch(opened);
        } catch (err) {
          attachFetch(err);
          throw err;
        }
      });
      const opened = await openManual(target, admin.email, mode);
      if ((mode === "page" || mode === "channel") && target && target.fetch) opened.fetch = target.fetch;
      send(res, 200, opened);
    } catch (err) {
      if ((mode === "page" || mode === "channel") && target && target.fetch && err && !err.fetch) err.fetch = target.fetch;
      throw err;
    }
    return;
  }
  if (action === "analyse") {
    const postUrl = typeof body.url === "string" ? body.url : "";
    const image = typeof body.image === "string" ? body.image : "";
    const reasoning = body.reasoning === true;
    const urlAware = body.useBot === true;
    send(res, 200, await analyse(body.model, body.text, postUrl, image, reasoning, urlAware));
    return;
  }
  if (action === "save") {
    if (body.clipboard) {
      if (!knownModel(body.model)) {
        send(res, 400, { error: "bad_model", message: "Choose a model from the list." });
        return;
      }
      await saveClipboard({
        resultText: body.resultText,
        model: body.model,
        totalCost: body.totalCost,
        inputCost: body.inputCost,
        outputCost: body.outputCost,
        email: admin.email,
      });
      send(res, 200, { results: await listResults() });
      return;
    }
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
  if (action === "update-result") {
    if (!isUuid(body.id)) {
      send(res, 400, { error: "bad_request", message: "That saved row is gone." });
      return;
    }
    send(res, 200, { results: await updateResult(body) });
    return;
  }
  if (action === "delete-result") {
    if (!isUuid(body.id)) {
      send(res, 400, { error: "bad_request", message: "That saved row is gone." });
      return;
    }
    send(res, 200, { results: await deleteResult(body.id) });
    return;
  }
  send(res, 400, { error: "invalid_action", message: "The Analyze desk did not understand that request." });
}

module.exports = withErrors(async function analyst(req, res) {
  try {
    await handle(req, res);
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    sendMapped(res, err);
  }
});
