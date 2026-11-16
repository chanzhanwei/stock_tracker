"use strict";

const { Pool } = require("pg");
const { parsePicks, replaceLabeledLine } = require("./analyst-parse");
const { canonicalPostUrl, normalizeSourceName, textForBox } = require("./analyst-fetch");
const { TWO_MONTH_MESSAGE, tradeWindow, isWithinWindow, channelChoice } = require("./analyst-dates");

const DATABASE_MESSAGE = "Set DATABASE_URL to a Neon Postgres connection string. Analyze tables are created on the first successful request.";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS analyst_sources (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     label text NOT NULL DEFAULT '',
     kind text NOT NULL CHECK (kind IN ('youtube', 'x', 'website', 'substack', 'clipboard')),
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
     item_id uuid UNIQUE REFERENCES analyst_items(id) ON DELETE CASCADE,
     source_id uuid NOT NULL REFERENCES analyst_sources(id) ON DELETE CASCADE,
     saved_at timestamptz NOT NULL DEFAULT now(),
     source_name text NOT NULL DEFAULT '',
     website text NOT NULL DEFAULT '',
     analyst_name text NOT NULL,
     short_term text NOT NULL DEFAULT '',
     long_term text NOT NULL DEFAULT '',
     short_term_stock text NOT NULL DEFAULT '',
     long_term_stock text NOT NULL DEFAULT '',
     short_term_industry text NOT NULL DEFAULT '',
     long_term_industry text NOT NULL DEFAULT '',
     long_term_industry_avoid text NOT NULL DEFAULT '',
     short_term_avoid text NOT NULL DEFAULT '',
     note text NOT NULL DEFAULT '',
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
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS long_term_industry_avoid text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_sources ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT ''`,
  `ALTER TABLE analyst_results ALTER COLUMN item_id DROP NOT NULL`,
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
       CHECK (kind IN ('youtube', 'x', 'website', 'substack', 'clipboard'));
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
let schemaPool = null;
let schemaPromise = null;

function dbError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function configured() {
  return Boolean(process.env.DATABASE_URL);
}

function poolOptions(connectionString) {
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
  return {
    connectionString: connectionString,
    max: 1,
    idleTimeoutMillis: 10000,
    ssl: local ? false : { rejectUnauthorized: false },
  };
}

function getPool() {
  if (!configured()) return null;
  if (!pool) {
    pool = new Pool(poolOptions(process.env.DATABASE_URL));
    pool.on("error", function () { /* the next query reports a plain failure */ });
    if (process.env.VERCEL) {
      require("@vercel/functions").attachDatabasePool(pool);
    }
  }
  return pool;
}

function getSchemaPool() {
  const direct = process.env.DATABASE_URL_UNPOOLED;
  if (!direct || direct === process.env.DATABASE_URL) return getPool();
  if (!schemaPool) {
    schemaPool = new Pool(poolOptions(direct));
    schemaPool.on("error", function () { /* the next query reports a plain failure */ });
  }
  return schemaPool;
}

async function applySchema() {
  const db = getSchemaPool();
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
  const closing = [];
  if (pool) {
    closing.push(pool.end());
    pool = null;
  }
  if (schemaPool) {
    closing.push(schemaPool.end());
    schemaPool = null;
  }
  await Promise.all(closing);
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

function hostLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (err) {
    return "";
  }
}

function visibleSourceName(name, label, kind) {
  const pretty = String(label || "").trim();
  if (pretty) return pretty;
  const raw = String(name || "").trim();
  if (kind === "website" && /^https?:\/\//i.test(raw)) return hostLabel(raw) || raw;
  return raw;
}

function mapSource(row) {
  return {
    id: row.id,
    name: row.name,
    label: row.label || "",
    displayName: visibleSourceName(row.name, row.label, row.kind),
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function mapResult(row) {
  return {
    id: row.id,
    date: parsePicks(row.result_text).date.slice(0, 40) || dateOnly(row.saved_at),
    source: visibleSourceName(row.source_name, row.source_label, row.source_kind),
    website: row.website || "",
    analystName: row.analyst_name,
    shortTermStock: row.short_term_stock || "",
    longTermStock: row.long_term_stock || "",
    shortTermIndustry: row.short_term_industry || "",
    longTermIndustry: row.long_term_industry || "",
    longTermIndustryAvoid: row.long_term_industry_avoid || "",
    shortTermAvoid: row.short_term_avoid || "",
    note: row.note || "",
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
    "SELECT id, name, label, kind, created_at FROM analyst_sources WHERE kind <> 'clipboard' ORDER BY lower(name), kind"
  );
  return result.rows.map(mapSource);
}

const RESULT_COLUMNS = `id, saved_at, source_name, website, analyst_name, short_term_stock, long_term_stock,
  short_term_industry, long_term_industry, long_term_industry_avoid, short_term_avoid, note, post_url, result_text,
  model_id, total_cost, input_cost, output_cost`;

async function listResults() {
  const result = await query(
    `SELECT r.id, r.saved_at, r.source_name, r.website, r.analyst_name, r.short_term_stock, r.long_term_stock,
            r.short_term_industry, r.long_term_industry, r.long_term_industry_avoid, r.short_term_avoid, r.note,
            r.post_url, r.result_text, r.model_id, r.total_cost, r.input_cost, r.output_cost,
            s.label AS source_label, s.kind AS source_kind
     FROM analyst_results r
     LEFT JOIN analyst_sources s ON s.id = r.source_id
     ORDER BY r.saved_at DESC
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
    `SELECT i.id, i.url, i.title, i.body, i.processed, i.published_at, i.source_id, s.kind
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
    "SELECT id, name, label, kind, created_at FROM analyst_sources WHERE id = $1",
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
  const cutoff = tradeWindow().cutoffIso;
  const result = await query(
    `SELECT id, url, title, body, published_at
     FROM analyst_items
     WHERE source_id = $1 AND processed = false
       AND (published_at IS NULL OR published_at >= $2)
       AND NOT EXISTS (
         SELECT 1 FROM analyst_items done
         WHERE done.url = analyst_items.url AND done.processed = true
       )
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [sourceId, cutoff]
  );
  return result.rows[0] || null;
}

async function itemsInWindow(sourceId) {
  const cutoff = tradeWindow().cutoffIso;
  const result = await query(
    `SELECT id, url, title, body, published_at, processed
     FROM analyst_items
     WHERE source_id = $1
       AND (published_at IS NULL OR published_at >= $2)`,
    [sourceId, cutoff]
  );
  return result.rows.map(function (row) {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      body: row.body,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      processed: row.processed,
    };
  });
}

async function openManual(target, email, mode) {
  if (mode === "page" && !target.focusUrl) {
    return {
      item: null,
      message: "That address is a channel or a feed. Use New Channel.",
      sources: await listSources(),
    };
  }
  const source = await ensureSource(target.sourceName, target.kind, email);
  if (target.siteLabel) await rememberLabel(source.id, target.siteLabel);
  await insertItems(source.id, target.items || []);
  const sources = await listSources();
  if (mode === "channel" && !target.focusUrl) {
    const choice = channelChoice(await itemsInWindow(source.id), tradeWindow().cutoffIso);
    if (!choice.item) return { item: null, message: choice.message, sources: sources };
    return { item: presentItem(source, choice.item), message: "", sources: sources };
  }
  if (target.focusUrl) {
    let focus = target.focusUrl;
    try { focus = canonicalPostUrl(target.focusUrl); } catch (err) { /* the caller already checked this URL */ }
    const found = await itemByUrl(focus);
    if (!found || found.processed) {
      return { item: null, message: "That post is already analysed.", sources: sources };
    }
    if (!isWithinWindow(found.published_at, tradeWindow().cutoffIso)) {
      return { item: null, message: TWO_MONTH_MESSAGE, sources: sources };
    }
    return {
      item: presentItem({ id: found.source_id, kind: found.kind }, found),
      message: "",
      sources: sources,
    };
  }
  const row = await nextUnprocessed(source.id);
  if (!row) {
    return { item: null, message: TWO_MONTH_MESSAGE, sources: sources };
  }
  return { item: presentItem(source, row), message: "", sources: sources };
}

async function takeNext(source, discovered, warning) {
  if (discovered) await insertItems(source.id, discovered);
  const row = await nextUnprocessed(source.id);
  if (!row) {
    throw dbError("no_items", warning || TWO_MONTH_MESSAGE);
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

function requirePicks(resultText) {
  const picks = parsePicks(resultText);
  const required = [
    picks.date,
    picks.website,
    picks.url,
    picks.analystName,
    picks.shortTermStock,
    picks.longTermStock,
    picks.shortTermIndustry,
    picks.longTermIndustry,
    picks.longTermIndustryAvoid,
    picks.shortTermAvoid,
  ];
  if (required.some(function (value) { return !value; })) {
    throw dbError(
      "picks_required",
      "The result needs Date, Website, URL, Analyst, Short-term stock buy, Long-term stock buy, Short-term industry buy, Long-term industry buy, Long-term industry avoid, and Short-term stock avoid lines. Use none when a line does not apply."
    );
  }
  return picks;
}

async function rememberLabel(sourceId, label) {
  const text = String(label || "").trim().slice(0, 300);
  if (!sourceId || !text) return;
  await query("UPDATE analyst_sources SET label = $2 WHERE id = $1", [sourceId, text]);
}

function pickValues(picks) {
  return [
    picks.website.slice(0, 300),
    picks.analystName.slice(0, 200),
    picks.shortTermStock.slice(0, 500),
    picks.longTermStock.slice(0, 500),
    picks.shortTermStock.slice(0, 500),
    picks.longTermStock.slice(0, 500),
    picks.shortTermIndustry.slice(0, 500),
    picks.longTermIndustry.slice(0, 500),
    picks.longTermIndustryAvoid.slice(0, 500),
    picks.shortTermAvoid.slice(0, 500),
    picks.note.slice(0, 4000),
  ];
}

async function saveResult(input) {
  if (!configured()) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  const picks = requirePicks(input.resultText);
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
         (item_id, source_id, source_name, website, analyst_name, short_term, long_term,
          short_term_stock, long_term_stock, short_term_industry, long_term_industry,
          long_term_industry_avoid, short_term_avoid, note,
          post_url, result_text, model_id, total_cost, input_cost, output_cost, saved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING ${RESULT_COLUMNS}`,
      [
        row.id,
        row.source_id,
        String(row.source_name || "").slice(0, 300),
      ].concat(pickValues(picks), [
        row.url,
        String(input.resultText || "").slice(0, 100000),
        input.model,
        costOrNull(input.totalCost),
        costOrNull(input.inputCost),
        costOrNull(input.outputCost),
        input.email,
      ])
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

async function saveClipboard(input) {
  if (!configured()) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  const picks = requirePicks(input.resultText);
  const source = await ensureSource("Clipboard", "clipboard", input.email);
  const inserted = await query(
    `INSERT INTO analyst_results
       (item_id, source_id, source_name, website, analyst_name, short_term, long_term,
        short_term_stock, long_term_stock, short_term_industry, long_term_industry,
        long_term_industry_avoid, short_term_avoid, note,
        post_url, result_text, model_id, total_cost, input_cost, output_cost, saved_by)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '', $14, $15, $16, $17, $18, $19)
     RETURNING ${RESULT_COLUMNS}`,
    [source.id, "Clipboard"].concat(pickValues(picks), [
      String(input.resultText || "").slice(0, 100000),
      input.model,
      costOrNull(input.totalCost),
      costOrNull(input.inputCost),
      costOrNull(input.outputCost),
      input.email,
    ])
  );
  return mapResult(inserted.rows[0]);
}

function clipField(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

async function updateResult(input) {
  const found = await query("SELECT id, result_text FROM analyst_results WHERE id = $1", [input.id]);
  if (!found.rows[0]) throw dbError("not_found", "That saved row is gone.");
  const fields = {
    date: clipField(input.date, 40),
    analystName: clipField(input.analystName, 200),
    shortTermStock: clipField(input.shortTermStock, 500),
    longTermStock: clipField(input.longTermStock, 500),
    shortTermIndustry: clipField(input.shortTermIndustry, 500),
    longTermIndustry: clipField(input.longTermIndustry, 500),
    longTermIndustryAvoid: clipField(input.longTermIndustryAvoid, 500),
    shortTermAvoid: clipField(input.shortTermAvoid, 500),
    note: clipField(input.note, 4000),
  };
  let text = found.rows[0].result_text || "";
  [
    ["Date", fields.date],
    ["Analyst", fields.analystName],
    ["Short-term stock buy", fields.shortTermStock],
    ["Long-term stock buy", fields.longTermStock],
    ["Short-term industry buy", fields.shortTermIndustry],
    ["Long-term industry buy", fields.longTermIndustry],
    ["Long-term industry avoid", fields.longTermIndustryAvoid],
    ["Short-term stock avoid", fields.shortTermAvoid],
    ["Notes", fields.note],
  ].forEach(function (pair) {
    text = replaceLabeledLine(text, pair[0], pair[1]);
  });
  await query(
    `UPDATE analyst_results
        SET analyst_name = $2,
            short_term = $3,
            long_term = $4,
            short_term_stock = $3,
            long_term_stock = $4,
            short_term_industry = $5,
            long_term_industry = $6,
            long_term_industry_avoid = $7,
            short_term_avoid = $8,
            note = $9,
            result_text = $10
      WHERE id = $1`,
    [
      input.id,
      fields.analystName,
      fields.shortTermStock,
      fields.longTermStock,
      fields.shortTermIndustry,
      fields.longTermIndustry,
      fields.longTermIndustryAvoid,
      fields.shortTermAvoid,
      fields.note,
      text.slice(0, 100000),
    ]
  );
  return listResults();
}

async function deleteResult(id) {
  if (!configured()) throw dbError("database_unconfigured", DATABASE_MESSAGE);
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id, post_url FROM analyst_results WHERE id = $1 FOR UPDATE",
      [id]
    );
    const row = found.rows[0];
    if (!row) throw dbError("not_found", "That saved row is gone.");
    await client.query("DELETE FROM analyst_results WHERE id = $1", [id]);
    if (row.post_url) {
      await client.query("UPDATE analyst_items SET processed = false WHERE url = $1", [row.post_url]);
    }
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (rollbackErr) { /* the original error is the one to report */ }
    if (err && err.code === "not_found") throw err;
    throw dbError("database_unavailable", "The database could not be reached.");
  } finally {
    client.release();
  }
  return listResults();
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
  saveClipboard,
  updateResult,
  deleteResult,
  rememberLabel,
  presentItem,
  isProcessedUrl,
  openManual,
};
