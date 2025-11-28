const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

try {
  console.log("Adding address column to cafes table...");

  db.exec(`
    ALTER TABLE cafes ADD COLUMN address TEXT;
  `);

  console.log("✅ Column added successfully");
} catch (err) {
  if (err.message.includes("duplicate column name")) {
    console.log("✅ Column already exists");
  } else {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
} finally {
  db.close();
}
