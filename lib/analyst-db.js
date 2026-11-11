"use strict";

const { Pool } = require("pg");
const { parsePicks } = require("./analyst-parse");
const { canonicalPostUrl, normalizeSourceName, textForBox } = require("./analyst-fetch");

const DATABASE_MESSAGE = "Set DATABASE_URL to a Neon Postgres connection string. Analyze tables are created on the first successful request.";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS analyst_sources (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     kind text NOT NULL CHECK (kind IN ('youtube', 'x', 'website', 'substack')),
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
  `CREATE INDEX IF NOT EXISTS analyst_items_url ON analyst_items (url)`,
  `CREATE TABLE IF NOT EXISTS analyst_results (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     item_id uuid NOT NULL UNIQUE REFERENCES analyst_items(id) ON DELETE CASCADE,
     source_id uuid NOT NULL REFERENCES analyst_sources(id) ON DELETE CASCADE,
     saved_at timestamptz NOT NULL DEFAULT now(),
     source_name text NOT NULL DEFAULT '',
     analyst_name text NOT NULL,
     short_term text NOT NULL DEFAULT '',
     long_term text NOT NULL DEFAULT '',
     short_term_stock text NOT NULL DEFAULT '',
     long_term_stock text NOT NULL DEFAULT '',
     short_term_industry text NOT NULL DEFAULT '',
     long_term_industry text NOT NULL DEFAULT '',
     short_term_avoid text NOT NULL DEFAULT '',
     post_url text NOT NULL,
     result_text text NOT NULL,
     model_id text NOT NULL,
     total_cost double precision,
     input_cost double precision,
     output_cost double precision,
     saved_by text NOT NULL
   )`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS short_term_stock text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS long_term_stock text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS short_term_industry text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS long_term_industry text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS short_term_avoid text NOT NULL DEFAULT ''`,
  `DO $$
   DECLARE cname text;
   BEGIN
     IF to_regclass('public.analyst_sources') IS NULL THEN
       RETURN;
     END IF;
     FOR cname IN
       SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = 'public'
         AND rel.relname = 'analyst_sources'
         AND con.contype = 'c'
         AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
     LOOP
       EXECUTE format('ALTER TABLE analyst_sources DROP CONSTRAINT %I', cname);
     END LOOP;
     ALTER TABLE analyst_sources
       ADD CONSTRAINT analyst_sources_kind_check
       CHECK (kind IN ('youtube', 'x', 'website', 'substack'));
   END $$`,
  `UPDATE analyst_results
     SET short_term_stock = short_term
     WHERE short_term_stock = '' AND short_term <> ''`,
  `UPDATE analyst_results
     SET long_term_stock = long_term
     WHERE long_term_stock = '' AND long_term <> ''`,
  `UPDATE analyst_results r
     SET source_name = s.name
     FROM analyst_sources s
     WHERE r.source_id = s.id AND r.source_name = ''`,
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
    source: row.source_name || "",
    analystName: row.analyst_name,
    shortTermStock: row.short_term_stock || "",
    longTermStock: row.long_term_stock || "",
    shortTermIndustry: row.short_term_industry || "",
    longTermIndustry: row.long_term_industry || "",
    shortTermAvoid: row.short_term_avoid || "",
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
    sourceId: source.id,
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

const RESULT_COLUMNS = `id, saved_at, source_name, analyst_name, short_term_stock, long_term_stock,
  short_term_industry, long_term_industry, short_term_avoid, post_url, result_text,
  model_id, total_cost, input_cost, output_cost`;

async function listResults() {
  const result = await query(
    `SELECT ${RESULT_COLUMNS}
     FROM analyst_results
     ORDER BY saved_at DESC
     LIMIT 200`
  );
  return result.rows.map(mapResult);
}

async function findSource(name, kind) {
  const result = await query(
    `SELECT id, name, kind, created_at
     FROM analyst_sources
     WHERE lower(name) = lower($1) AND kind = $2`,
    [name, kind]
  );
  return result.rows[0] ? mapSource(result.rows[0]) : null;
}

async function ensureSource(name, kind, email) {
  const normalized = normalizeSourceName(name, kind);
  const existing = await findSource(normalized, kind);
  if (existing) return existing;
  try {
    return await addSource(normalized, kind, email);
  } catch (err) {
    if (err && err.code === "duplicate_source") {
      const again = await findSource(normalized, kind);
      if (again) return again;
    }
    throw err;
  }
}

async function isProcessedUrl(url) {
  const result = await query(
    "SELECT 1 FROM analyst_items WHERE url = $1 AND processed = true LIMIT 1",
    [url]
  );
  return result.rows.length > 0;
}

async function itemByUrl(url) {
  const result = await query(
    `SELECT i.id, i.url, i.title, i.body, i.processed, i.source_id, s.kind
     FROM analyst_items i
     JOIN analyst_sources s ON s.id = i.source_id
     WHERE i.url = $1
     ORDER BY i.processed ASC, i.created_at DESC
     LIMIT 1`,
    [url]
  );
  return result.rows[0] || null;
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
    let url = "";
    try {
      url = canonicalPostUrl(item.url);
    } catch (err) {
      continue;
    }
    await query(
      `INSERT INTO analyst_items (source_id, url, title, body, published_at)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM analyst_items WHERE url = $2)
       ON CONFLICT (source_id, url) DO NOTHING`,
      [
        sourceId,
        url.slice(0, 2000),
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
       AND NOT EXISTS (
         SELECT 1 FROM analyst_items done
         WHERE done.url = analyst_items.url AND done.processed = true
       )
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [sourceId]
  );
  return result.rows[0] || null;
}

async function openManual(target, email) {
  const source = await ensureSource(target.sourceName, target.kind, email);
  await insertItems(source.id, target.items || []);
  const sources = await listSources();
  if (target.focusUrl) {
    let focus = target.focusUrl;
    try { focus = canonicalPostUrl(target.focusUrl); } catch (err) { /* the caller already checked this URL */ }
    const found = await itemByUrl(focus);
    if (!found || found.processed) {
      return { item: null, message: "That post is already analysed.", sources: sources };
    }
    return {
      item: presentItem({ id: found.source_id, kind: found.kind }, found),
      message: "",
      sources: sources,
    };
  }
  const row = await nextUnprocessed(source.id);
  if (!row) {
    return { item: null, message: "No unprocessed item is waiting for this source.", sources: sources };
  }
  return { item: presentItem(source, row), message: "", sources: sources };
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
  const required = [
    picks.analystName,
    picks.shortTermStock,
    picks.longTermStock,
    picks.shortTermIndustry,
    picks.longTermIndustry,
    picks.shortTermAvoid,
  ];
  if (required.some(function (value) { return !value; })) {
    throw dbError(
      "picks_required",
      "The result needs an Analyst line, a short-term stock, a long-term stock, a short-term industry, a long-term industry, and a short-term avoid. Use none when a line does not apply."
    );
  }
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const item = await client.query(
      `SELECT i.id, i.url, i.processed, s.name AS source_name, s.id AS source_id
       FROM analyst_items i
       JOIN analyst_sources s ON s.id = i.source_id
       WHERE i.id = $1
       FOR UPDATE`,
      [input.itemId]
    );
    const row = item.rows[0];
    if (!row) throw dbError("not_found", "Fetch an item before saving.");
    if (row.processed) throw dbError("already_processed", "That item is already saved.");
    const prior = await client.query(
      "SELECT 1 FROM analyst_items WHERE url = $1 AND processed = true LIMIT 1",
      [row.url]
    );
    if (prior.rows.length) throw dbError("already_processed", "That post is already analysed.");
    const inserted = await client.query(
      `INSERT INTO analyst_results
         (item_id, source_id, source_name, analyst_name, short_term, long_term,
          short_term_stock, long_term_stock, short_term_industry, long_term_industry, short_term_avoid,
          post_url, result_text, model_id, total_cost, input_cost, output_cost, saved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING ${RESULT_COLUMNS}`,
      [
        row.id,
        row.source_id,
        String(row.source_name || "").slice(0, 300),
        picks.analystName.slice(0, 200),
        picks.shortTermStock.slice(0, 200),
        picks.longTermStock.slice(0, 200),
        picks.shortTermStock.slice(0, 200),
        picks.longTermStock.slice(0, 200),
        picks.shortTermIndustry.slice(0, 200),
        picks.longTermIndustry.slice(0, 200),
        picks.shortTermAvoid.slice(0, 200),
        row.url,
        String(input.resultText || "").slice(0, 100000),
        input.model,
        costOrNull(input.totalCost),
        costOrNull(input.inputCost),
        costOrNull(input.outputCost),
        input.email,
      ]
    );
    await client.query("UPDATE analyst_items SET processed = true WHERE url = $1", [row.url]);
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
  isProcessedUrl,
  openManual,
};
