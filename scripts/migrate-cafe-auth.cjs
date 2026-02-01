const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

console.log("🔄 Migrating cafes table for password authentication...\n");

try {
  // Check if columns already exist
  const tableInfo = db.pragma("table_info(cafes)");
  const hasPasswordHash = tableInfo.some((col) => col.name === "password_hash");
  const hasAddress = tableInfo.some((col) => col.name === "address");

  // Add password_hash column if not exists
  if (!hasPasswordHash) {
    console.log("➕ Adding password_hash column...");
    db.exec("ALTER TABLE cafes ADD COLUMN password_hash TEXT");
  } else {
    console.log("✓ password_hash column already exists");
  }

  // Add address column if not exists (should already exist from previous migration)
  if (!hasAddress) {
    console.log("➕ Adding address column...");
    db.exec("ALTER TABLE cafes ADD COLUMN address TEXT");
  } else {
    console.log("✓ address column already exists");
  }

  // Set default password hash for existing cafes (password: "test123")
  const defaultPasswordHash = bcrypt.hashSync("test123", 10);
  const cafesWithoutPassword = db
    .prepare("SELECT id, name, email FROM cafes WHERE password_hash IS NULL")
    .all();

  if (cafesWithoutPassword.length > 0) {
    console.log(
      `\n🔐 Setting default password for ${cafesWithoutPassword.length} existing cafes...`
    );
    const updatePassword = db.prepare(
      "UPDATE cafes SET password_hash = ? WHERE id = ?"
    );

    cafesWithoutPassword.forEach((cafe) => {
      updatePassword.run(defaultPasswordHash, cafe.id);
      console.log(
        `   ✓ ${cafe.name || "Unnamed"} (ID: ${cafe.id}) - password: test123`
      );
    });
  }

  console.log("\n✅ Migration completed successfully!");
  console.log("\n📋 Existing cafes now have password: test123");
  console.log("   (Change password in cafe settings later)\n");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
}

db.close();
