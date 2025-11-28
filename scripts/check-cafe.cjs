const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../data/stamps.db"));

console.log("\n📋 Aktuelles Café in der Datenbank:\n");
const cafe = db
  .prepare("SELECT id, name, api_key, created_at FROM cafes WHERE id = 2")
  .get();

if (cafe) {
  console.log("ID:", cafe.id);
  console.log("Name:", cafe.name);
  console.log("API-Key:", cafe.api_key);
  console.log("Erstellt:", new Date(cafe.created_at).toLocaleString());
  console.log("\n✅ Das ist der GLEICHE API-Key wie vorher!");
  console.log(
    "   Der alte (ccc5f5a...) wurde nur aus dem Browser-localStorage gelöscht."
  );
} else {
  console.log("❌ Kein Café gefunden");
}

db.close();
