const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  // Entfernt BOM, Whitespaces, CRLF
  return v.replace(/^\uFEFF/, "").trim();
}

const RPC_URL = sanitizeEnv("RPC_URL");
const PRIVATE_KEY = sanitizeEnv("CAFE_PRIVATE_KEY");

// harte Checks mit hilfreichem Log
if (!RPC_URL) throw new Error("❌ Missing RPC_URL in .env.local");
if (!PRIVATE_KEY) throw new Error("❌ Missing CAFE_PRIVATE_KEY in .env.local");
if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  throw new Error(
    `❌ CAFE_PRIVATE_KEY has wrong format (len=${PRIVATE_KEY.length})`
  );
}

const { ethers } = require("ethers");

// === SQLite (better-sqlite3) ===
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "../data/stamps.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS stamp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  cafe TEXT NOT NULL,
  user TEXT NOT NULL,
  txhash TEXT NOT NULL
);
`);
const insertEvent = db.prepare(
  "INSERT INTO stamp_events (ts, cafe, user, txhash) VALUES (@ts, @cafe, @user, @txhash)"
);
const listEvents = db.prepare(
  "SELECT * FROM stamp_events ORDER BY id DESC LIMIT 50"
);

// create express app
const express = require("express");
const app = express();
// parse JSON bodies
app.use(express.json());

// === Blockchain wiring ===
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const rawPk = (process.env.CAFE_PRIVATE_KEY || "")
  .trim()
  .replace(/^"(.*)"$/, "$1");
if (!/^0x[0-9a-fA-F]{64}$/.test(rawPk)) {
  throw new Error(
    "CAFE_PRIVATE_KEY in .env.local ist ungültig (erwartet 0x + 64 Hex, ohne Anführungszeichen)."
  );
}
const wallet = new ethers.Wallet(rawPk, provider);
const stampCardJson = require("../artifacts/contracts/StampCard.sol/StampCard.json");
const contract = new ethers.Contract(
  process.env.STAMPCARD_ADDRESS,
  stampCardJson.abi,
  wallet
);

// === Mini-Auth (ein API-Key für MVP) ===
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!process.env.CAFE_API_KEY || key !== process.env.CAFE_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// Health (inkl. DB-Ping)
app.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "db_error" });
  }
});

// Stempel vergeben
app.post("/stamp", requireApiKey, async (req, res) => {
  try {
    console.log("POST /stamp received:", req.body);
    const { user } = req.body || {};
    if (!/^0x[0-9a-fA-F]{40}$/.test(user || "")) {
      console.log("Invalid user address:", user);
      return res.status(400).json({ error: "invalid user address" });
    }

    console.log("Calling contract.addStamp for user:", user);
    const tx = await contract.addStamp(user);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed");

    console.log("Inserting event into database");
    insertEvent.run({
      ts: Date.now(),
      cafe: wallet.address,
      user,
      txhash: tx.hash,
    });
    console.log("Event inserted");

    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error in /stamp:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempelstand abfragen
app.get("/stamps/:addr", async (req, res) => {
  try {
    const user = req.params.addr;
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
      return res.status(400).json({ error: "invalid user address" });
    }
    const count = await contract.getStamps(wallet.address, user);
    res.json({ cafe: wallet.address, user, stamps: Number(count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Events (letzte 50)
app.get("/events", (req, res) => {
  const rows = listEvents.all();
  res.json(rows);
});

const PORT = Number(process.env.PORT || 3000);

// Wichtig: 0.0.0.0 bindet sowohl localhost als auch andere Adapter
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API listening on http://127.0.0.1:${PORT}`);
});
