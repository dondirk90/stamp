const path = require("path");
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "..", "data", "stamps.db");
const db = new Database(dbPath, { readonly: true });

function fmtTS(ts) {
  try {
    return new Date(Number(ts)).toISOString();
  } catch (e) {
    return String(ts);
  }
}

const total = db.prepare("SELECT COUNT(*) as c FROM stamp_events").get().c;
const perCafe = db
  .prepare(
    "SELECT cafe, COUNT(*) as c FROM stamp_events GROUP BY cafe ORDER BY c DESC"
  )
  .all();
const perUser = db
  .prepare(
    "SELECT user, COUNT(*) as c FROM stamp_events GROUP BY user ORDER BY c DESC"
  )
  .all();
const recent = db
  .prepare(
    "SELECT id, ts, cafe, user, txhash FROM stamp_events ORDER BY id DESC LIMIT 50"
  )
  .all();

console.log("=== StampCard Transactions Report ===");
console.log("DB:", dbPath);
console.log("Total events:", total);
console.log("Unique cafes:", perCafe.length, "  (top 5)");
perCafe.slice(0, 5).forEach((r) => console.log(` - ${r.cafe}: ${r.c}`));
console.log("Unique users:", perUser.length, "  (top 5)");
perUser.slice(0, 5).forEach((r) => console.log(` - ${r.user}: ${r.c}`));
console.log("\nRecent events (up to 50):");
recent.forEach((r) =>
  console.log(`${r.id}	${fmtTS(r.ts)}	${r.cafe}	${r.user}	${r.txhash}`)
);

console.log("\nRaw JSON output (for copy/paste):");
console.log(JSON.stringify({ total, perCafe, perUser, recent }, null, 2));
