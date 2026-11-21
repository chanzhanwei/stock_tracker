"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../lib/analyst-db");

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readStdin() {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    process.stdin.on("data", function (chunk) { chunks.push(chunk); });
    process.stdin.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    process.stdin.on("error", reject);
  });
}

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }) + "\n");
  process.exit(1);
}

async function main() {
  loadLocalEnv(path.join(__dirname, "..", ".env.local"));
  const command = process.argv[2];
  if (!process.env.DATABASE_URL) fail("Set DATABASE_URL to the same Neon connection string the app uses.");
  if (command === "claim") {
    const job = await db.claimBotJob();
    process.stdout.write(JSON.stringify({ job: job }) + "\n");
    return;
  }
  if (command === "complete") {
    const id = process.argv[3];
    if (!id) fail("Pass the job id: node scripts/bot-job.js complete <id>");
    let parsed = {};
    try {
      parsed = JSON.parse(await readStdin() || "{}");
    } catch (err) {
      fail("The result must be a JSON object.");
    }
    const saved = await db.completeBotJob(id, parsed);
    process.stdout.write(JSON.stringify(saved) + "\n");
    return;
  }
  fail("Use claim, or complete <id> with a JSON result on stdin.");
}

main().catch(function (err) {
  fail(err && err.message ? err.message : "The job was not updated.");
}).finally(function () {
  return db.resetForTests();
});
