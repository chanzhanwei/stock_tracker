"use strict";

const { Pool } = require("pg");
const { parsePicks } = require("./analyst-parse");
const { textForBox } = require("./analyst-fetch");

const DATABASE_MESSAGE = "Set DATABASE_URL to a Neon Postgres connection string. Analyst tables are created on the first successful request.";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS analyst_sources (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     kind text NOT NULL CHECK (kind IN ('youtube', 'x', 'website')),
     created_by text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS analyst_sources_name_kind
     ON analyst_sources (lower(name), kind)`,
  `CREATE TABLE IF NOT EXISTS analyst_items (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     source_id uuid NOT NULL REFERENCES analyst_sources(id) ON DELETE CASCADE,
     url text NOT NULL,
     title text NOT NULL DEFAULT '',
     body text NOT NULL DEFAULT '',
     published_at timestamptz,
     processed boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (source_id, url)
   )`,
  `CREATE INDEX IF NOT EXISTS analyst_items_next
     ON analyst_items (source_id, processed, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS analyst_results (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     item_id uuid NOT NULL UNIQUE REFERENCES analyst_items(id) ON DELETE CASCADE,
     source_id uuid NOT NULL REFERENCES analyst_sources(id) ON DELETE CASCADE,
     saved_at timestamptz NOT NULL DEFAULT now(),
     analyst_name text NOT NULL,
     short_term text NOT NULL,
     long_term text NOT NULL,
     post_url text NOT NULL,
     result_text text NOT NULL,
     model_id text NOT NULL,
     total_cost double precision,
     input_cost double precision,
     output_cost double precision,
     saved_by text NOT NULL
   )`,
];

let pool = null;
let schemaPromise = null;

function dbError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function configured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!configured()) return null;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
    pool = new Pool({
      connectionString: connectionString,
      max: 1,
      idleTimeoutMillis: 10000,
      ssl: local ? false : { rejectUnauthorized: false },
    });
    pool.on("error", function () { /* the next query reports a plain failure */ });
  }
  return pool;
}

async function applySchema() {
  const db = getPool();
  if (!db) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  for (const statement of SCHEMA) {
    await db.query(statement);
  }
}

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = applySchema().catch(function (err) {
      schemaPromise = null;
      if (err && (err.code === "database_unconfigured" || err.code === "database_unavailable")) throw err;
      throw dbError("database_unavailable", "The database could not be reached.");
    });
  }
  return schemaPromise;
}

async function resetForTests() {
  schemaPromise = null;
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function num(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSource(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function mapResult(row) {
  return {
    id: row.id,
    date: dateOnly(row.saved_at),
    analystName: row.analyst_name,
    shortTerm: row.short_term,
    longTerm: row.long_term,
    postUrl: row.post_url,
    resultText: row.result_text,
    modelId: row.model_id,
    totalCost: num(row.total_cost),
    inputCost: num(row.input_cost),
    outputCost: num(row.output_cost),
  };
}

function presentItem(source, row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title || "",
    text: textForBox(source.kind, row),
    kind: source.kind,
    pasteTranscript: source.kind === "youtube",
  };
}

async function query(text, params) {
  if (!configured()) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  try {
    await ensureSchema();
    return await getPool().query(text, params);
  } catch (err) {
    if (err && err.code === "database_unconfigured") throw err;
    if (err && err.code === "23505") throw err;
    const wrapped = dbError("database_unavailable", "The database could not be reached.");
    wrapped.cause = err;
    throw wrapped;
  }
}

async function listSources() {
  const result = await query(
    "SELECT id, name, kind, created_at FROM analyst_sources ORDER BY lower(name), kind"
  );
  return result.rows.map(mapSource);
}

async function listResults() {
  const result = await query(
    `SELECT id, saved_at, analyst_name, short_term, long_term, post_url, result_text,
            model_id, total_cost, input_cost, output_cost
     FROM analyst_results
     ORDER BY saved_at DESC
     LIMIT 200`
  );
  return result.rows.map(mapResult);
}

async function addSource(name, kind, email) {
  try {
    const result = await query(
      `INSERT INTO analyst_sources (name, kind, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, kind, created_at`,
      [name, kind, email]
    );
    return mapSource(result.rows[0]);
  } catch (err) {
    if (err && err.code === "23505") {
      throw dbError("duplicate_source", "That source is already saved.");
    }
    throw err;
  }
}

async function getSource(id) {
  const result = await query(
    "SELECT id, name, kind, created_at FROM analyst_sources WHERE id = $1",
    [id]
  );
  return result.rows[0] ? mapSource(result.rows[0]) : null;
}

async function insertItems(sourceId, items) {
  for (const item of items) {
    if (!item || !item.url) continue;
    await query(
      `INSERT INTO analyst_items (source_id, url, title, body, published_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, url) DO NOTHING`,
      [
        sourceId,
        String(item.url).slice(0, 2000),
        String(item.title || "").slice(0, 300),
        String(item.body || "").slice(0, 20000),
        item.publishedAt || null,
      ]
    );
  }
}

async function nextUnprocessed(sourceId) {
  const result = await query(
    `SELECT id, url, title, body, published_at
     FROM analyst_items
     WHERE source_id = $1 AND processed = false
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [sourceId]
  );
  return result.rows[0] || null;
}

async function takeNext(source, discovered, warning) {
  if (discovered) await insertItems(source.id, discovered);
  const row = await nextUnprocessed(source.id);
  if (!row) {
    throw dbError("no_items", warning || "No unprocessed item is waiting for this source.");
  }
  return {
    item: presentItem(source, row),
    message: warning || "",
  };
}

function costOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) {
    throw dbError("bad_cost", "The cost from the last Analyse call was not a number.");
  }
  return n;
}

async function saveResult(input) {
  if (!configured()) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  const picks = parsePicks(input.resultText);
  if (!picks.shortTerm || !picks.longTerm) {
    throw dbError("picks_required", "The result needs one Short-term line and one Long-term line.");
  }
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const item = await client.query(
      `SELECT i.id, i.url, i.processed, s.name AS analyst_name, s.id AS source_id
       FROM analyst_items i
       JOIN analyst_sources s ON s.id = i.source_id
       WHERE i.id = $1
       FOR UPDATE`,
      [input.itemId]
    );
    const row = item.rows[0];
    if (!row) throw dbError("not_found", "Fetch an item before saving.");
    if (row.processed) throw dbError("already_processed", "That item is already saved.");
    const inserted = await client.query(
      `INSERT INTO analyst_results
         (item_id, source_id, analyst_name, short_term, long_term, post_url, result_text,
          model_id, total_cost, input_cost, output_cost, saved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, saved_at, analyst_name, short_term, long_term, post_url, result_text,
                 model_id, total_cost, input_cost, output_cost`,
      [
        row.id,
        row.source_id,
        row.analyst_name,
        picks.shortTerm.slice(0, 200),
        picks.longTerm.slice(0, 200),
        row.url,
        String(input.resultText || "").slice(0, 100000),
        input.model,
        costOrNull(input.totalCost),
        costOrNull(input.inputCost),
        costOrNull(input.outputCost),
        input.email,
      ]
    );
    await client.query("UPDATE analyst_items SET processed = true WHERE id = $1", [row.id]);
    await client.query("COMMIT");
    return mapResult(inserted.rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (rollbackErr) { /* the original error is the one to report */ }
    if (err && (err.code === "not_found" || err.code === "already_processed" || err.code === "picks_required" || err.code === "bad_cost")) {
      throw err;
    }
    if (err && err.code === "23505") throw dbError("already_processed", "That item is already saved.");
    throw dbError("database_unavailable", "The database could not be reached.");
  } finally {
    client.release();
  }
}

module.exports = {
  DATABASE_MESSAGE,
  configured,
  resetForTests,
  listSources,
  listResults,
  addSource,
  getSource,
  takeNext,
  saveResult,
  presentItem,
};
