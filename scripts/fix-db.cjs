const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

try {
  // Check if column exists
  const tableInfo = db.pragma("table_info(stamp_events)");
  const hasCustomerName = tableInfo.some((col) => col.name === "customer_name");

  if (!hasCustomerName) {
    console.log("Adding customer_name column to stamp_events...");
    db.exec("ALTER TABLE stamp_events ADD COLUMN customer_name TEXT;");
    console.log("✅ Column added successfully!");
  } else {
    console.log("✅ Column customer_name already exists.");
  }

  // Show current structure
  console.log("\nCurrent stamp_events columns:");
  db.pragma("table_info(stamp_events)").forEach((col) => {
    console.log(`  - ${col.name} (${col.type})`);
  });
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
} finally {
  db.close();
}
