const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const Database = require("better-sqlite3");
const { ethers } = require("ethers");
const crypto = require("crypto");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  return v.replace(/^\uFEFF/, "").trim();
}

function ensureMasterKey() {
  const k = sanitizeEnv("MASTER_KEY");
  if (!k) throw new Error("Missing MASTER_KEY in .env.local");
  return Buffer.from(k, "hex");
}

function encryptPrivateKey(privHex) {
  const key = ensureMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function randomHex(bytes) {
  return "0x" + crypto.randomBytes(bytes).toString("hex");
}

try {
  const oldApiKey = "ccc5f5a304b762b273dfc4c0c342a534";

  // Delete old cafe
  console.log(`Deleting old café with API key: ${oldApiKey}...`);
  const deleteStmt = db.prepare("DELETE FROM cafes WHERE api_key = ?");
  const result = deleteStmt.run(oldApiKey);
  console.log(`✅ Deleted ${result.changes} café(s)\n`);

  // Create new cafe
  console.log("Creating new café...");
  const newWallet = ethers.Wallet.createRandom();
  const privateKey = newWallet.privateKey;
  const address = newWallet.address;
  const encrypted = encryptPrivateKey(privateKey);
  const newApiKey = randomHex(16).slice(2); // Remove 0x prefix

  const insertStmt = db.prepare(
    "INSERT INTO cafes (name, api_key, encrypted_key, created_at) VALUES (?, ?, ?, ?)"
  );

  insertStmt.run("testkaffee", newApiKey, encrypted, Date.now());

  console.log("✅ New café created!");
  console.log(`\n📋 Café Details:`);
  console.log(`   Name: testkaffee`);
  console.log(`   API Key: ${newApiKey}`);
  console.log(`   Wallet Address: ${address}`);
  console.log(`   Mnemonic: ${newWallet.mnemonic.phrase}`);
  console.log(`\n💡 Save these credentials! You'll need them to login.`);
  console.log(`\n🔄 Restart your API server now: node api/server.cjs`);
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
} finally {
  db.close();
}
