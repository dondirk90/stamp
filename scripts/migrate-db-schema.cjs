#!/usr/bin/env node
/**
 * Migration Script: Add missing columns to cafes table
 *
 * Adds:
 * - address (wallet address)
 * - password_hash (bcrypt hash)
 *
 * Safe to run multiple times (checks if columns exist first)
 */

const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../data/stamps.db");
console.log("📦 Opening database:", dbPath);

const db = new Database(dbPath);

// Function to check if a column exists
function columnExists(table, column) {
  const info = db.pragma(`table_info(${table})`);
  return info.some((col) => col.name === column);
}

console.log("\n🔍 Checking current schema...");

// Check and add address column
if (!columnExists("cafes", "address")) {
  console.log("➕ Adding 'address' column to cafes table...");
  db.exec("ALTER TABLE cafes ADD COLUMN address TEXT");
  console.log("✅ Added 'address' column");
} else {
  console.log("✓ 'address' column already exists");
}

// Check and add password_hash column
if (!columnExists("cafes", "password_hash")) {
  console.log("➕ Adding 'password_hash' column to cafes table...");
  db.exec("ALTER TABLE cafes ADD COLUMN password_hash TEXT");
  console.log("✅ Added 'password_hash' column");
} else {
  console.log("✓ 'password_hash' column already exists");
}

// Show current cafes table schema
console.log("\n📋 Current cafes table schema:");
const schema = db.pragma("table_info(cafes)");
schema.forEach((col) => {
  console.log(`  - ${col.name} (${col.type})${col.notnull ? " NOT NULL" : ""}`);
});

// Show existing cafes
const cafes = db
  .prepare("SELECT id, name, email, address, location_address FROM cafes")
  .all();
console.log(`\n📊 Existing cafes: ${cafes.length}`);
cafes.forEach((cafe) => {
  console.log(
    `  - ${cafe.name || "Unnamed"} (ID: ${cafe.id}, Address: ${
      cafe.address || "NULL"
    }, Email: ${cafe.email || "NULL"})`
  );
});

db.close();
console.log("\n✅ Migration complete!");
