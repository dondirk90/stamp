// Quick fix: Replace substr with full encrypted_key in server.cjs
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "../api/server.cjs");
let content = fs.readFileSync(serverPath, "utf8");

const oldLine =
  '"SELECT id, name, api_key, substr(encrypted_key,1,48) as encrypted_preview, created_at FROM cafes ORDER BY id DESC"';
const newLine =
  '"SELECT id, name, api_key, encrypted_key, created_at FROM cafes ORDER BY id DESC"';

if (content.includes(oldLine)) {
  content = content.replace(oldLine, newLine);
  fs.writeFileSync(serverPath, content, "utf8");
  console.log("✅ Fixed /cafes route to load full encrypted_key");
  console.log("🔄 Restart API server: node api/server.cjs");
} else {
  console.log("⚠️ Pattern not found or already fixed");
}
