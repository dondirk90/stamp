const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const Database = require("better-sqlite3");
const { ethers } = require("ethers");

const dbPath = path.join(__dirname, "../data/stamps.db");
const db = new Database(dbPath);

function decryptPrivateKey(encryptedData) {
  const crypto = require("crypto");
  const MASTER_KEY = process.env.MASTER_KEY;
  if (!MASTER_KEY) throw new Error("MASTER_KEY not set");

  const buf = Buffer.from(encryptedData, "base64");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(MASTER_KEY, "hex"),
    iv
  );
  decipher.setAuthTag(tag);

  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

console.log("Updating café addresses...\n");

const cafes = db
  .prepare("SELECT id, name, encrypted_key, address FROM cafes")
  .all();

for (const cafe of cafes) {
  if (cafe.address) {
    console.log(`✓ ${cafe.name}: Already has address ${cafe.address}`);
    continue;
  }

  try {
    const privateKey = decryptPrivateKey(cafe.encrypted_key);
    const wallet = new ethers.Wallet(privateKey);

    db.prepare("UPDATE cafes SET address = ? WHERE id = ?").run(
      wallet.address,
      cafe.id
    );

    console.log(`✅ ${cafe.name}: Updated with address ${wallet.address}`);
  } catch (err) {
    console.error(`❌ ${cafe.name}: Failed to decrypt/update - ${err.message}`);
  }
}

db.close();
console.log("\n✅ Done!");
