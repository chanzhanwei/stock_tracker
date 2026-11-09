"use strict";

const fs = require("fs");
const path = require("path");

const ADMIN_EMAIL = "chanzhanwei@gmail.com";
const FILE_PATH = path.join(process.cwd(), ".data", "allowlist.json");
const KV_KEY = "stock_tracker:allowlist";

let clerkClient = null;
let listCache = null;
const emailByUser = new Map();

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function validEmail(email) {
  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(email);
}

function hostnameOf(host) {
  const raw = String(host || "").trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? raw : raw.slice(1, end);
  }
  return raw.split(":")[0];
}

function isDevBypass(req) {
  if (process.env.VERCEL) return false;
  if (process.env.CLERK_SECRET_KEY || process.env.CLERK_PUBLISHABLE_KEY) return false;
  const host = hostnameOf(req && req.headers && req.headers.host);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function send(res, status, body) {
  if (typeof res.status === "function") {
    const chained = res.status(status);
    if (chained && typeof chained.json === "function") {
      chained.json(body);
      return;
    }
  }
  res.statusCode = status;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}

function queryOf(req) {
  if (req.query && typeof req.query === "object") return req.query;
  const url = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(url.searchParams.entries());
}

async function readBody(req) {
  if (req.body != null && req.body !== "") {
    if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString("utf8").trim();
      return raw ? JSON.parse(raw) : {};
    }
    if (typeof req.body === "object") return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function bearerToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookie = req.headers && req.headers.cookie;
  if (typeof cookie === "string") {
    const parts = cookie.split(";").map((part) => part.trim());
    const session = parts.find((part) => part.startsWith("__session="));
    if (session) return decodeURIComponent(session.slice("__session=".length));
  }
  return "";
}

function devEmail(req) {
  const header = req.headers && (req.headers["x-dev-email"] || req.headers["X-Dev-Email"]);
  const email = normalizeEmail(typeof header === "string" ? header : "");
  return email || ADMIN_EMAIL;
}

function getClerk() {
  if (!clerkClient) {
    const { createClerkClient } = require("@clerk/backend");
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  }
  return clerkClient;
}

async function emailFromToken(token) {
  const { verifyToken } = require("@clerk/backend");
  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  const userId = payload && payload.sub;
  if (!userId) return "";
  if (emailByUser.has(userId)) return emailByUser.get(userId);
  const user = await getClerk().users.getUser(userId);
  const primary = (user.emailAddresses || []).find((row) => row.id === user.primaryEmailAddressId);
  const email = normalizeEmail((primary || user.emailAddresses[0] || {}).emailAddress || "");
  if (email) emailByUser.set(userId, email);
  return email;
}

async function identify(req) {
  if (isDevBypass(req)) {
    const email = devEmail(req);
    if (!validEmail(email)) return null;
    return { email, admin: email === ADMIN_EMAIL };
  }
  if (!process.env.CLERK_SECRET_KEY) return null;
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const email = await emailFromToken(token);
    if (!email) return null;
    return { email, admin: email === ADMIN_EMAIL };
  } catch (err) {
    return null;
  }
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { url, token };
}

async function kvCommand(args) {
  const cfg = kvConfig();
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error("kv");
    err.detail = data.error || res.status;
    throw err;
  }
  return data.result;
}

function uniqueEmails(list) {
  const out = [];
  for (const row of list) {
    const email = normalizeEmail(row);
    if (!validEmail(email) || out.includes(email)) continue;
    out.push(email);
  }
  if (!out.includes(ADMIN_EMAIL)) out.unshift(ADMIN_EMAIL);
  out.sort((a, b) => {
    if (a === ADMIN_EMAIL) return -1;
    if (b === ADMIN_EMAIL) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return out;
}

function readFileList() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
    if (Array.isArray(parsed)) return uniqueEmails(parsed);
  } catch (err) {
    return uniqueEmails([ADMIN_EMAIL]);
  }
  return uniqueEmails([ADMIN_EMAIL]);
}

function writeFileList(emails) {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(uniqueEmails(emails), null, 2));
}

async function listClerk() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await getClerk().allowlistIdentifiers.getAllowlistIdentifierList({ limit: 100, offset });
    const data = page.data || [];
    for (const row of data) {
      if (row && row.identifier && String(row.identifier).includes("@")) {
        rows.push({ id: row.id, email: normalizeEmail(row.identifier) });
      }
    }
    if (data.length < 100) break;
    offset += data.length;
    if (offset > 5000) break;
  }
  return rows;
}

async function storageMode() {
  if (process.env.CLERK_SECRET_KEY) return "clerk";
  if (kvConfig()) return "kv";
  if (!process.env.VERCEL) return "file";
  return "memory";
}

const memoryList = uniqueEmails([ADMIN_EMAIL]);

function remember(emails, persistent) {
  const clean = uniqueEmails(emails);
  listCache = { emails: clean, persistent, expires: Date.now() + 15000 };
  return clean;
}

async function loadEmails() {
  if (listCache && listCache.expires > Date.now()) {
    return { emails: listCache.emails.slice(), persistent: listCache.persistent };
  }
  const mode = await storageMode();
  if (mode === "clerk") {
    try {
      let rows = await listClerk();
      if (!rows.some((row) => row.email === ADMIN_EMAIL)) {
        await getClerk().allowlistIdentifiers.createAllowlistIdentifier({
          identifier: ADMIN_EMAIL,
          notify: false,
        });
        rows = await listClerk();
      }
      return { emails: remember(rows.map((row) => row.email), true), persistent: true, mode };
    } catch (err) {
      if (kvConfig()) {
        const emails = await loadKv();
        return { emails, persistent: true, mode: "kv" };
      }
      throw err;
    }
  }
  if (mode === "kv") {
    const emails = await loadKv();
    return { emails, persistent: true, mode };
  }
  if (mode === "file") {
    const emails = remember(readFileList(), true);
    writeFileList(emails);
    return { emails, persistent: true, mode };
  }
  return { emails: remember(memoryList, false), persistent: false, mode };
}

async function loadKv() {
  const raw = await kvCommand(["GET", KV_KEY]);
  let parsed = [];
  if (typeof raw === "string" && raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = [];
    }
  }
  const emails = remember(Array.isArray(parsed) ? parsed : [], true);
  await kvCommand(["SET", KV_KEY, JSON.stringify(emails)]);
  return emails;
}

async function persist(emails) {
  const mode = await storageMode();
  const clean = uniqueEmails(emails);
  listCache = null;
  if (mode === "clerk") {
    try {
      await syncClerk(clean);
      return { emails: remember(clean, true), persistent: true };
    } catch (err) {
      if (!kvConfig()) throw err;
      await kvCommand(["SET", KV_KEY, JSON.stringify(clean)]);
      return { emails: remember(clean, true), persistent: true };
    }
  }
  if (mode === "kv") {
    await kvCommand(["SET", KV_KEY, JSON.stringify(clean)]);
    return { emails: remember(clean, true), persistent: true };
  }
  if (mode === "file") {
    writeFileList(clean);
    return { emails: remember(clean, true), persistent: true };
  }
  memoryList.splice(0, memoryList.length, ...clean);
  return { emails: remember(clean, false), persistent: false };
}

async function syncClerk(emails) {
  const rows = await listClerk();
  const wanted = new Set(uniqueEmails(emails));
  wanted.add(ADMIN_EMAIL);
  for (const row of rows) {
    if (!wanted.has(row.email)) {
      if (row.email === ADMIN_EMAIL) continue;
      await getClerk().allowlistIdentifiers.deleteAllowlistIdentifier(row.id);
    }
  }
  const have = new Set(rows.map((row) => row.email));
  for (const email of wanted) {
    if (have.has(email)) continue;
    await getClerk().allowlistIdentifiers.createAllowlistIdentifier({ identifier: email, notify: false });
  }
}

async function listAllowed() {
  const loaded = await loadEmails();
  return loaded;
}

async function isAllowed(email) {
  const loaded = await loadEmails();
  return loaded.emails.includes(normalizeEmail(email));
}

async function addEmail(email) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) {
    const err = new Error("invalid_email");
    err.code = "invalid_email";
    throw err;
  }
  const loaded = await loadEmails();
  if (loaded.emails.includes(normalized)) return loaded;
  return persist(loaded.emails.concat(normalized));
}

async function removeEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) {
    const err = new Error("cannot_remove_admin");
    err.code = "cannot_remove_admin";
    throw err;
  }
  if (!validEmail(normalized)) {
    const err = new Error("invalid_email");
    err.code = "invalid_email";
    throw err;
  }
  const loaded = await loadEmails();
  if (!loaded.emails.includes(normalized)) {
    const err = new Error("not_found");
    err.code = "not_found";
    throw err;
  }
  return persist(loaded.emails.filter((row) => row !== normalized));
}

async function requireUser(req, res) {
  const ident = await identify(req);
  if (!ident) {
    send(res, 401, { error: "unauthorized" });
    return null;
  }
  let allowed = false;
  try {
    allowed = await isAllowed(ident.email);
  } catch (err) {
    send(res, 503, { error: "allowlist_unavailable" });
    return null;
  }
  if (!allowed) {
    send(res, 403, { error: "not_allowlisted", email: ident.email });
    return null;
  }
  return ident;
}

async function requireAdmin(req, res) {
  const ident = await requireUser(req, res);
  if (!ident) return null;
  if (ident.email !== ADMIN_EMAIL) {
    send(res, 403, { error: "admin_only", email: ident.email, allowed: true });
    return null;
  }
  return ident;
}

function withErrors(handler) {
  return async function wrapped(req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      if (res.headersSent || res.writableEnded) return;
      const code = err && (err.code === "invalid_email" || err instanceof SyntaxError) ? 400 : 500;
      send(res, code, { error: code === 400 ? "bad_request" : "internal" });
    }
  };
}

module.exports = {
  ADMIN_EMAIL,
  normalizeEmail,
  validEmail,
  isDevBypass,
  send,
  queryOf,
  readBody,
  identify,
  listAllowed,
  isAllowed,
  addEmail,
  removeEmail,
  requireUser,
  requireAdmin,
  withErrors,
};
