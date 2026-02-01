const Database = require("better-sqlite3");
const db = new Database("data/stamps.db");

console.log("\n📋 Registrierte Cafés:\n");

const cafes = db
  .prepare(
    "SELECT id, name, email, address, location_address, password_hash FROM cafes"
  )
  .all();

cafes.forEach((c) => {
  console.log(`🏪 ${c.name || "Unnamed"} (ID: ${c.id})`);
  console.log(`   📧 E-Mail: ${c.email || "N/A"}`);
  console.log(`   📍 Address: ${c.address || "N/A"}`);
  console.log(`   🗺️ Location: ${c.location_address || "N/A"}`);
  console.log(
    `   🔒 Passwort: ${c.password_hash ? "✓ gesetzt (test123)" : "✗ fehlt"}`
  );
  console.log();
});

console.log(`Total: ${cafes.length} Café(s)\n`);

db.close();
