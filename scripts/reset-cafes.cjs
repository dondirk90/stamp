const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec("BEGIN");
try {
  // Delete cafe-related data so you can start fresh
  db.prepare("DELETE FROM qr_nonces").run();
  db.prepare("DELETE FROM stamp_events").run();
  db.prepare("DELETE FROM cafes").run();

  // Reset AUTOINCREMENT counters (optional but nice)
  try {
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('cafes','qr_nonces','stamp_events')"
    ).run();
  } catch (e) {
    // sqlite_sequence may not exist in some DB configurations
  }

  db.exec("COMMIT");
  console.log("OK: deleted all cafes + related rows (qr_nonces, stamp_events)");
} catch (e) {
  try {
    db.exec("ROLLBACK");
  } catch (_) {}
  console.error("FAILED:", e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  try {
    db.close();
  } catch (_) {}
}
