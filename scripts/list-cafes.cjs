const Database = require("better-sqlite3");
const db = new Database("data/stamps.db");

console.log("\n📋 Registrierte Cafés:\n");

const cafes = db
  .prepare("SELECT id, name, address, api_key, password_hash FROM cafes")
  .all();

cafes.forEach((c) => {
  console.log(`🏪 ${c.name || "Unnamed"} (ID: ${c.id})`);
  console.log(`   🔑 API-Key: ${c.api_key || "N/A"}`);
  console.log(`   📍 Address: ${c.address || "N/A"}`);
  console.log(
    `   🔒 Passwort: ${c.password_hash ? "✓ gesetzt (test123)" : "✗ fehlt"}`
  );
  console.log();
});

console.log(`Total: ${cafes.length} Café(s)\n`);

db.close();
