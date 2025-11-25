const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "..", "data", "stamps.db");
const outPath = path.join(__dirname, "..", "data", "events.csv");

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    "SELECT id, ts, cafe, user, txhash FROM stamp_events ORDER BY id ASC"
  )
  .all();

function iso(ts) {
  try {
    return new Date(Number(ts)).toISOString();
  } catch (e) {
    return ts;
  }
}

const header = "id,ts_iso,cafe,user,txhash";
const lines = [header];
for (const r of rows) {
  const line = [r.id, '"' + iso(r.ts) + '"', r.cafe, r.user, r.txhash].join(
    ","
  );
  lines.push(line);
}
fs.writeFileSync(outPath, lines.join("\n"));
console.log("Wrote", outPath, "rows=", rows.length);
