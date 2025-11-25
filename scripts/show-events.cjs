#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

function usage() {
  console.log(`Usage: node scripts/show-events.cjs [--json|--csv] [--limit N] [--addr 0x..]

Examples:
  node scripts/show-events.cjs             # pretty table (limit 50)
  node scripts/show-events.cjs --limit 100 # last 100 rows
  node scripts/show-events.cjs --json      # output JSON
  node scripts/show-events.cjs --csv       # output CSV
  node scripts/show-events.cjs --addr 0x123... # filter by user address
`);
}

const argv = process.argv.slice(2);
let format = "table";
let limit = 50;
let addr = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") format = "json";
  else if (a === "--csv") format = "csv";
  else if (a === "--limit") limit = Number(argv[++i]) || limit;
  else if (a === "--addr") addr = argv[++i];
  else if (a === "-h" || a === "--help") {
    usage();
    process.exit(0);
  }
}

const dbPath = path.resolve(__dirname, "..", "data", "stamps.db");
if (!fs.existsSync(dbPath)) {
  console.error("Database not found at", dbPath);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });
let sql = "SELECT id, ts, cafe, user, txhash FROM stamp_events";
const params = [];
if (addr) {
  sql += " WHERE LOWER(user) = LOWER(?)";
  params.push(addr);
}
sql += " ORDER BY id DESC LIMIT ?";
params.push(limit);

const rows = db
  .prepare(sql)
  .all(...params)
  .map((r) => ({
    ...r,
    ts_iso: new Date(Number(r.ts)).toISOString(),
  }));

db.close();

if (format === "json") {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (format === "csv") {
  const header = ["id", "ts", "ts_iso", "cafe", "user", "txhash"];
  console.log(header.join(","));
  for (const r of rows) {
    const vals = [
      r.id,
      r.ts,
      `"${r.ts_iso}"`,
      `"${r.cafe}"`,
      `"${r.user}"`,
      `"${r.txhash}"`,
    ];
    console.log(vals.join(","));
  }
  process.exit(0);
}

// pretty table
const table = rows.map((r) => ({
  id: r.id,
  ts: r.ts_iso,
  cafe: r.cafe,
  user: r.user,
  tx: r.txhash,
}));
console.table(table);
