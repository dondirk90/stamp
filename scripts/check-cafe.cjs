const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../data/stamps.db"));

console.log("\n📋 Aktuelles Café in der Datenbank:\n");
const cafe = db
  .prepare(
    "SELECT id, name, email, address, location_address, password_hash, created_at FROM cafes WHERE id = 2"
  )
  .get();

if (cafe) {
  console.log("ID:", cafe.id);
  console.log("Name:", cafe.name);
  console.log("E-Mail:", cafe.email || null);
  console.log("Café Identifier:", cafe.address || null);
  console.log("Location:", cafe.location_address || null);
  console.log("Passwort gesetzt:", cafe.password_hash ? "ja" : "nein");
  console.log("Erstellt:", new Date(cafe.created_at).toLocaleString());
} else {
  console.log("❌ Kein Café gefunden");
}

db.close();
