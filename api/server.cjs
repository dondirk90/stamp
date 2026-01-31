const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const { ethers, verifyTypedData } = require("ethers");
const crypto = require("crypto");
const util = require("util");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  // Entfernt BOM, Whitespaces, CRLF
  return v.replace(/^\uFEFF/, "").trim();
}

// === Constants & Config ===
const RPC_URL = sanitizeEnv("RPC_URL");
const PRIVATE_KEY = sanitizeEnv("CAFE_PRIVATE_KEY");
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const ADMIN_API_KEY =
  sanitizeEnv("ADMIN_API_KEY") ||
  sanitizeEnv("ADMIN_DASHBOARD_KEY") ||
  sanitizeEnv("CAFE_API_KEY");

// === EIP-712 Setup ===
const domain = {
  name: "StampCard",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: process.env.STAMPCARD_ADDRESS,
};

const types = {
  StampRequest: [
    { name: "cafeId", type: "bytes16" },
    { name: "nonce", type: "bytes32" },
    { name: "expires", type: "uint256" },
    { name: "customer", type: "address" },
  ],
};

function randomHex(bytes) {
  return "0x" + crypto.randomBytes(bytes).toString("hex");
}

// --- Encryption helpers (AES-256-GCM) ---
function ensureMasterKey() {
  const k = sanitizeEnv("MASTER_KEY");
  if (!k)
    throw new Error("Missing MASTER_KEY in .env.local for encrypting wallets");
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

function decryptPrivateKey(dataB64) {
  const key = ensureMasterKey();
  const buf = Buffer.from(dataB64, "base64");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

function ensureCafeAddress(row) {
  if (!row) return null;
  if (row.address && /^0x[0-9a-fA-F]{40}$/.test(row.address)) {
    return row.address;
  }
  if (row.encrypted_key) {
    try {
      const priv = decryptPrivateKey(row.encrypted_key);
      const wallet = new ethers.Wallet(priv);
      return wallet.address;
    } catch (e) {
      // ignore decryption errors; caller will handle missing address
    }
  }
  return null;
}

function buildExplorerTxUrl(txHash) {
  if (!txHash || typeof txHash !== "string") return null;
  if (!txHash.startsWith("0x") || txHash.length !== 66) return null;

  switch (CHAIN_ID) {
    case 1:
      return `https://etherscan.io/tx/${txHash}`;
    case 5:
      return `https://goerli.etherscan.io/tx/${txHash}`;
    case 11155111:
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case 137:
      return `https://polygonscan.com/tx/${txHash}`;
    case 80001:
      return `https://mumbai.polygonscan.com/tx/${txHash}`;
    default:
      return null;
  }
}

function toEventSummary(row) {
  if (!row) return null;
  const delta = Number(row.delta || 0);
  const hasExplorer =
    typeof row.txhash === "string" &&
    row.txhash.startsWith("0x") &&
    row.txhash.length === 66;
  return {
    id: row.id,
    timestamp: row.ts != null ? Number(row.ts) : null,
    customer: row.user || null,
    customerName: row.customer_name || null,
    eventType: row.event_type || (delta < 0 ? "redeem" : "stamp"),
    delta,
    status: row.status || "confirmed",
    hasExplorer,
  };
}

function toEventDetail(row) {
  const summary = toEventSummary(row);
  if (!summary) return null;
  const txHash = row.txhash || null;
  return {
    ...summary,
    cafeAddress: row.cafe || null,
    txHash,
    explorerUrl: buildExplorerTxUrl(txHash),
  };
}

// harte Checks mit hilfreichem Log
if (!RPC_URL) throw new Error("❌ Missing RPC_URL in .env.local");
if (!PRIVATE_KEY) throw new Error("❌ Missing CAFE_PRIVATE_KEY in .env.local");
if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  throw new Error(
    `❌ CAFE_PRIVATE_KEY has wrong format (len=${PRIVATE_KEY.length})`
  );
}

// === Email Configuration ===
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
// (moved) Café statistics route is registered after Express setup below

async function sendCafeCredentialsEmail({
  email,
  cafeName,
  apiKey,
  address,
  seedPhrase,
  config,
}) {
  const scannerUrl = `http://192.168.0.175:8080/cafe-scanner`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `🎉 Willkommen bei Stampcard - Zugangsdaten für ${cafeName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .credential-box { background: white; border: 2px solid #667eea; border-radius: 8px; padding: 15px; margin: 15px 0; }
          .credential-label { font-weight: bold; color: #667eea; margin-bottom: 5px; }
          .credential-value { font-family: 'Courier New', monospace; background: #f5f5f5; padding: 10px; border-radius: 5px; word-break: break-all; }
          .warning { background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 20px 0; color: #856404; }
          .button { display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>☕ Willkommen bei Stampcard!</h1>
            <p>Dein Café wurde erfolgreich registriert</p>
          </div>
          <div class="content">
            <h2>Hallo ${cafeName}!</h2>
            <p>Dein digitales Stempelkarten-System ist jetzt einsatzbereit. Hier sind deine Zugangsdaten:</p>
            
            <div class="credential-box">
              <div class="credential-label">🔑 API-Key</div>
              <div class="credential-value">${apiKey}</div>
            </div>
            
            <div class="credential-box">
              <div class="credential-label">📍 Wallet-Adresse</div>
              <div class="credential-value">${address}</div>
            </div>
            
            <div class="credential-box">
              <div class="credential-label">🌱 Seed Phrase (12 Wörter)</div>
              <div class="credential-value">${seedPhrase}</div>
            </div>
            
            <div class="warning">
              <strong>⚠️ WICHTIG - Bitte sicher aufbewahren!</strong><br>
              Der Seed Phrase ermöglicht den vollständigen Zugriff auf dein Wallet und kann NICHT wiederhergestellt werden. 
              Speichere diese Informationen an einem sicheren Ort ab!
            </div>
            
            <h3>⚙️ Deine Konfiguration:</h3>
            <ul>
              <li><strong>Stempel-Modus:</strong> ${
                config.stampMode === "general"
                  ? "Allgemein (für alle Käufe)"
                  : "Spezifisch (für bestimmte Produkte)"
              }</li>
              <li><strong>Stempel für Belohnung:</strong> ${
                config.stampsForReward
              }</li>
              <li><strong>Belohnung:</strong> ${config.rewardDescription}</li>
              ${
                config.products && config.products.length > 0
                  ? `<li><strong>Produkte:</strong> ${config.products.join(
                      ", "
                    )}</li>`
                  : ""
              }
            </ul>
            
            <center>
              <a href="${scannerUrl}" class="button">🚀 Zum Scanner</a>
            </center>
            
            <p style="margin-top: 30px; color: #666; font-size: 0.9em;">
              Bei Fragen oder Problemen kannst du dich jederzeit an uns wenden.<br>
              Viel Erfolg mit deinem Stampcard-System!
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Willkommen bei Stampcard!

Dein Café "${cafeName}" wurde erfolgreich registriert.

ZUGANGSDATEN:
=============
API-Key: ${apiKey}
Wallet-Adresse: ${address}
Seed Phrase: ${seedPhrase}

⚠️ WICHTIG: Bitte speichere diese Informationen sicher ab! Der Seed Phrase kann nicht wiederhergestellt werden.

KONFIGURATION:
==============
Stempel-Modus: ${config.stampMode === "general" ? "Allgemein" : "Spezifisch"}
Stempel für Belohnung: ${config.stampsForReward}
Belohnung: ${config.rewardDescription}
${
  config.products && config.products.length > 0
    ? `Produkte: ${config.products.join(", ")}`
    : ""
}

Scanner-Zugang: ${scannerUrl}

Viel Erfolg mit deinem Stampcard-System!
    `.trim(),
  };

  // Only send if email credentials are configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("⚠️  Email credentials not configured. Email content:");
    console.log("To:", email);
    console.log("Subject:", mailOptions.subject);
    console.log("Text:", mailOptions.text);
    return;
  }

  const info = await emailTransporter.sendMail(mailOptions);
  return info;
}

// === SQLite (better-sqlite3) ===
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "../data/stamps.db"));
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS stamp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  cafe TEXT NOT NULL,
  user TEXT NOT NULL,
  customer_name TEXT,
  txhash TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',
  event_type TEXT DEFAULT 'stamp',
  delta INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS qr_nonces (
  nonce TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  consumed BOOLEAN DEFAULT 0,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS cafes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  api_key TEXT UNIQUE,
  encrypted_key TEXT,
  address TEXT,
  password_hash TEXT,
  about_text TEXT,
  redeem_message TEXT,
  logo_mime TEXT,
  logo_data TEXT,
  updated_at INTEGER,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT UNIQUE,
  username TEXT,
  email TEXT,
  address TEXT,
  encrypted_key TEXT,
  password_hash TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Ensure legacy databases pick up newer cafe columns
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN address TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.address column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN password_hash TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.password_hash column:", e.message || e);
  }
}

// Cafe public profile fields
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN about_text TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.about_text column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN logo_mime TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.logo_mime column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN logo_data TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.logo_data column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN redeem_message TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.redeem_message column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN updated_at INTEGER").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.updated_at column:", e.message || e);
  }
}

// Ensure legacy databases pick up newer customer columns
try {
  db.prepare("ALTER TABLE customers ADD COLUMN username TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add customers.username column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE customers ADD COLUMN email TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add customers.email column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE customers ADD COLUMN password_hash TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn(
      "Failed to add customers.password_hash column:",
      e.message || e
    );
  }
}

// Ensure legacy databases pick up the additional columns for event tracking
try {
  db.prepare(
    "ALTER TABLE stamp_events ADD COLUMN event_type TEXT DEFAULT 'stamp'"
  ).run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add event_type column:", e.message || e);
  }
}
try {
  db.prepare(
    "ALTER TABLE stamp_events ADD COLUMN delta INTEGER DEFAULT 1"
  ).run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add delta column:", e.message || e);
  }
}

// Event status tracking (submitted/confirmed/failed)
try {
  db.prepare(
    "ALTER TABLE stamp_events ADD COLUMN status TEXT DEFAULT 'confirmed'"
  ).run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add status column:", e.message || e);
  }
}

// Prepare statements
const insertEvent = db.prepare(
  "INSERT INTO stamp_events (ts, cafe, user, customer_name, txhash, status, event_type, delta) VALUES (@ts, @cafe, @user, @customer_name, @txhash, @status, @event_type, @delta)"
);
const listEvents = db.prepare(
  "SELECT * FROM stamp_events ORDER BY id DESC LIMIT 50"
);
// Count net stamps for a specific cafe+user (DB fallback when chain state lost)
const countEventsByCafeUser = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(user) = LOWER(?) AND status = 'confirmed'"
);
const updateEventMetadata = db.prepare(
  "UPDATE stamp_events SET event_type = ?, delta = ? WHERE id = ?"
);
const updateEventStatusByTx = db.prepare(
  "UPDATE stamp_events SET status = ? WHERE txhash = ?"
);
const hasEventByTx = db.prepare(
  "SELECT 1 as ok FROM stamp_events WHERE txhash = ? LIMIT 1"
);

const getSyncState = db.prepare(
  "SELECT value FROM sync_state WHERE key = ? LIMIT 1"
);
const setSyncState = db.prepare(
  "INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
);
const insertNonce = db.prepare(
  "INSERT INTO qr_nonces (nonce, cafe_id, expires) VALUES (@nonce, @cafeId, @expires)"
);
const getNonce = db.prepare(
  "SELECT * FROM qr_nonces WHERE nonce = ? AND consumed = 0"
);
const consumeNonce = db.prepare(
  "UPDATE qr_nonces SET consumed = 1, consumed_at = ? WHERE nonce = ? AND consumed = 0"
);

// Cafes prepared statements
const insertCafe = db.prepare(
  "INSERT INTO cafes (name, api_key, encrypted_key, address, password_hash, about_text, redeem_message, logo_mime, logo_data, updated_at, created_at) VALUES (@name, @api_key, @encrypted_key, @address, @password_hash, @about_text, @redeem_message, @logo_mime, @logo_data, @updated_at, @created_at)"
);
const getCafeByApiKey = db.prepare("SELECT * FROM cafes WHERE api_key = ?");
const getCafeById = db.prepare("SELECT * FROM cafes WHERE id = ?");
const getCafeByName = db.prepare(
  "SELECT * FROM cafes WHERE name = ? COLLATE NOCASE"
);

const updateCafeProfileById = db.prepare(
  "UPDATE cafes SET about_text = ?, redeem_message = ?, logo_mime = ?, logo_data = ?, updated_at = ? WHERE id = ?"
);

// Customers prepared statements
const insertCustomer = db.prepare(
  "INSERT INTO customers (customer_id, username, email, address, encrypted_key, password_hash, created_at) VALUES (@customer_id, @username, @email, @address, @encrypted_key, @password_hash, @created_at)"
);
const listCustomers = db.prepare("SELECT * FROM customers ORDER BY id DESC");
const getCustomerByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1"
);
const getCustomerAuthByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, password_hash, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1"
);
const setCustomerPasswordHashById = db.prepare(
  "UPDATE customers SET password_hash = ? WHERE id = ?"
);

// === Express setup ===
const express = require("express");
const app = express();
// Capture raw request body for debugging JSON parse errors (verify option)
app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf, encoding) => {
      try {
        req.rawBody = buf.toString(encoding || "utf8");
      } catch (e) {
        req.rawBody = undefined;
      }
    },
  })
);

// Quick liveness route to verify route registration
app.get("/__alive", (req, res) => res.json({ ok: true, time: Date.now() }));

// --- DEBUG: Logge alle Requests ---
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});
// Enable CORS for the simple browser apps
try {
  const cors = require("cors");
  app.use(cors());
} catch (e) {
  console.warn(
    "cors module not installed; browser-based apps may need a proxy or disabled CORS."
  );
}

// --- Server-Sent Events (SSE) für Echtzeit-Notifications an die Apps ---
const sseClients = new Set();
function broadcastEvent(row) {
  const data = JSON.stringify(row);
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (e) {
      // ignore broken clients
    }
  }
}

app.get("/events/stream", async (req, res) => {
  try {
    // Proper SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Non-fatal diagnostics: warn if wallet/contract are not configured.
    // We don't abort the SSE connection; clients can still receive events from DB or future broadcasts.
    try {
      if (!wallet || !wallet.address) {
        console.error("Wallet not initialized for SSE");
      }
      const contractAddr = process.env.STAMPCARD_ADDRESS;
      if (!contractAddr) {
        console.warn("STAMPCARD_ADDRESS not set for SSE");
      } else {
        try {
          const code = await provider.getCode(contractAddr);
          if (!code || code === "0x" || code === "0x0") {
            console.warn("No contract code at", contractAddr);
          }
        } catch (e) {
          console.warn(
            "Error while checking contract code for SSE:",
            e && e.message ? e.message : e
          );
        }
      }
    } catch (e) {
      // swallow diagnostics errors to keep SSE alive
      console.warn(
        "SSE diagnostic check failed:",
        e && e.message ? e.message : e
      );
    }

    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
  } catch (e) {
    console.error("Error in /events/stream route:", e && e.stack ? e.stack : e);
    try {
      res.end();
    } catch (er) {}
  }
});

// === Blockchain wiring ===
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const stampCardJson = require("../artifacts/contracts/StampCard.sol/StampCard.json");
const stampCardInterface = new ethers.Interface(stampCardJson.abi);

const TOPIC_STAMP_ADDED = ethers.id("StampAdded(address,address,uint32)");
const TOPIC_REWARD_REDEEMED = ethers.id(
  "RewardRedeemed(address,address,uint32)"
);

function readEnvLocalValue(key) {
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.resolve(__dirname, "..", ".env.local");
    if (!fs.existsSync(envPath)) return null;
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line || /^\s*#/.test(line)) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      if (k !== key) continue;
      return line.slice(idx + 1).trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getActiveStampcardAddress() {
  // Prefer network-specific var; fall back to STAMPCARD_ADDRESS.
  // Additionally, read .env.local on demand so a deploy can update the address without requiring a restart.
  const fromEnv =
    process.env.SEPOLIA_STAMPCARD_ADDRESS || process.env.STAMPCARD_ADDRESS;
  const fromFile =
    readEnvLocalValue("SEPOLIA_STAMPCARD_ADDRESS") ||
    readEnvLocalValue("STAMPCARD_ADDRESS");
  const addr = fromEnv || fromFile || null;
  if (
    addr &&
    (!process.env.STAMPCARD_ADDRESS || process.env.STAMPCARD_ADDRESS !== addr)
  ) {
    process.env.STAMPCARD_ADDRESS = addr;
  }
  return addr;
}

function getStampCardContract(signerOrProvider) {
  const addr = getActiveStampcardAddress();
  return new ethers.Contract(addr, stampCardJson.abi, signerOrProvider);
}

function isEthersDecodeError(err) {
  const code = err && err.code ? String(err.code) : "";
  const msg = err && err.message ? String(err.message) : "";
  return (
    code === "BAD_DATA" ||
    msg.includes("could not decode result data") ||
    msg.includes("BAD_DATA")
  );
}

async function backfillEventMetadata() {
  try {
    const rows = db
      .prepare(
        "SELECT id, txhash, event_type, delta FROM stamp_events WHERE txhash IS NOT NULL AND LENGTH(txhash) = 66"
      )
      .all();

    for (const row of rows) {
      try {
        const tx = await provider.getTransaction(row.txhash);
        if (!tx || !tx.data) continue;

        let parsed;
        try {
          parsed = stampCardInterface.parseTransaction({
            data: tx.data,
            value: tx.value,
          });
        } catch (parseErr) {
          continue;
        }

        if (!parsed || !parsed.name) continue;

        let targetType = null;
        let targetDelta = null;

        if (parsed.name === "addStamp") {
          targetType = "stamp";
          targetDelta = 1;
        } else if (parsed.name === "addStamps") {
          const amount = Number(parsed.args?.[1] ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          targetType = "stamp";
          targetDelta = amount;
        } else if (parsed.name === "redeemReward") {
          targetType = "redeem";
          targetDelta = -10;
        } else {
          continue;
        }

        const currentDelta =
          typeof row.delta === "number" ? row.delta : Number(row.delta ?? 0);

        if (row.event_type !== targetType || currentDelta !== targetDelta) {
          updateEventMetadata.run(targetType, targetDelta, row.id);
        }
      } catch (innerErr) {
        console.warn(
          "Failed to reconcile stamp event metadata:",
          row.txhash,
          innerErr && innerErr.message ? innerErr.message : innerErr
        );
      }
    }
  } catch (err) {
    console.warn(
      "Backfill query for stamp event metadata failed:",
      err && err.message ? err.message : err
    );
  }
}

backfillEventMetadata().catch((err) => {
  console.warn(
    "Async event metadata reconciliation failed:",
    err && err.message ? err.message : err
  );
});

async function reconcileEventStatuses() {
  // Best-effort: mark submitted/confirmed/failed based on on-chain receipt.
  // Limit rows to keep startup fast.
  try {
    const rows = db
      .prepare(
        "SELECT txhash, status FROM stamp_events WHERE txhash IS NOT NULL AND LENGTH(txhash) = 66 ORDER BY id DESC LIMIT 2000"
      )
      .all();

    for (const row of rows) {
      const txh = row && row.txhash ? String(row.txhash) : "";
      if (!txh || !txh.startsWith("0x") || txh.length !== 66) continue;

      let receipt = null;
      try {
        receipt = await provider.getTransactionReceipt(txh);
      } catch (e) {
        continue;
      }

      if (!receipt) {
        // Still pending/unknown
        try {
          updateEventStatusByTx.run("submitted", txh);
        } catch (e) {}
        continue;
      }

      const ok = receipt.status === 1;
      try {
        updateEventStatusByTx.run(ok ? "confirmed" : "failed", txh);
      } catch (e) {}
    }
  } catch (err) {
    console.warn(
      "Async event status reconciliation failed:",
      err && err.message ? err.message : err
    );
  }
}

reconcileEventStatuses().catch((err) => {
  console.warn(
    "Async event status reconciliation failed:",
    err && err.message ? err.message : err
  );
});

function getLastSyncedBlock() {
  try {
    const row = getSyncState.get("stampcard_last_block");
    const n = row && row.value != null ? Number(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

function setLastSyncedBlock(blockNumber) {
  try {
    const n = Number(blockNumber);
    if (!Number.isFinite(n) || n < 0) return;
    setSyncState.run("stampcard_last_block", String(Math.floor(n)));
  } catch (e) {}
}

async function syncStampEventsFromChain({
  maxBlocksPerRun = 10,
  maxChunksPerRun = 3,
} = {}) {
  const contractAddr = getActiveStampcardAddress();
  if (!contractAddr || !/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) {
    return { ok: false, error: "no_contract_address" };
  }

  const latest = await provider.getBlockNumber();
  let last = getLastSyncedBlock();

  // If we never synced before, start a bit back to cover recent activity.
  // You can set STAMPCARD_SYNC_START_BLOCK in .env.local for full history.
  if (last == null) {
    const startEnv = sanitizeEnv("STAMPCARD_SYNC_START_BLOCK");
    const start = startEnv != null ? Number(startEnv) : NaN;
    last =
      Number.isFinite(start) && start >= 0
        ? Math.floor(start)
        : Math.max(0, latest - 500);
  }

  // Stored value is "last processed block"; next run starts at +1.
  let cursor = Math.min(last + 1, latest);
  let processedTo = last;
  let inserted = 0;

  let chunks = 0;
  while (cursor <= latest) {
    if (chunks >= maxChunksPerRun) break;
    let to = Math.min(latest, cursor + maxBlocksPerRun - 1);

    let logs = [];
    try {
      logs = await provider.getLogs({
        address: contractAddr,
        fromBlock: cursor,
        toBlock: to,
        topics: [[TOPIC_STAMP_ADDED, TOPIC_REWARD_REDEEMED]],
      });
    } catch (e) {
      // Alchemy free-tier can enforce very small getLogs ranges.
      const msg = String(e && e.message ? e.message : e);
      const lower = msg.toLowerCase();
      const isRateLimited =
        lower.includes("exceeded its compute units") ||
        lower.includes("compute units per second") ||
        lower.includes('"code": 429') ||
        e?.code === 429 ||
        e?.error?.code === 429;
      if (
        msg.toLowerCase().includes("10 block range") &&
        to - cursor + 1 > 10
      ) {
        to = Math.min(latest, cursor + 9);
        logs = await provider.getLogs({
          address: contractAddr,
          fromBlock: cursor,
          toBlock: to,
          topics: [[TOPIC_STAMP_ADDED, TOPIC_REWARD_REDEEMED]],
        });
      } else if (isRateLimited) {
        return {
          ok: false,
          error: "rate_limited",
          latest,
          processedTo,
          inserted,
          chunks,
        };
      } else {
        throw e;
      }
    }

    logs.sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? a.blockNumber - b.blockNumber
        : (a.index ?? 0) - (b.index ?? 0)
    );

    const lastTotalByKey = new Map();
    const keyOf = (cafe, user) =>
      `${String(cafe).toLowerCase()}_${String(user).toLowerCase()}`;

    for (const log of logs) {
      let parsed;
      try {
        parsed = stampCardInterface.parseLog(log);
      } catch {
        continue;
      }

      const name = parsed && parsed.name ? String(parsed.name) : "";
      const cafe = parsed?.args?.cafe;
      const user = parsed?.args?.user;
      if (!cafe || !user) continue;

      const txhash = log.transactionHash;
      if (!txhash || typeof txhash !== "string") continue;
      if (hasEventByTx.get(txhash)) continue;

      let delta = 0;
      let eventType = null;

      if (name === "StampAdded") {
        eventType = "stamp";
        const total = Number(parsed?.args?.totalStamps ?? 0);
        const k = keyOf(cafe, user);
        const lastTotal = lastTotalByKey.get(k);
        const d =
          Number.isFinite(total) && Number.isFinite(lastTotal)
            ? total - lastTotal
            : Number.isFinite(total)
            ? total
            : 0;
        delta = Number.isFinite(d) ? Math.max(0, d) : 0;
        lastTotalByKey.set(k, Number.isFinite(total) ? total : 0);
      } else if (name === "RewardRedeemed") {
        eventType = "redeem";
        delta = -10;
      } else {
        continue;
      }

      const ev = {
        ts: Date.now(),
        cafe: String(cafe),
        user: String(user),
        customer_name: null,
        txhash,
        status: "confirmed",
        event_type: eventType,
        delta: Number.isFinite(delta) ? delta : 0,
      };

      try {
        insertEvent.run(ev);
        inserted += 1;
        try {
          broadcastEvent(ev);
        } catch (e) {}
      } catch (e) {
        // ignore insert issues; next run may retry
      }
    }

    processedTo = to;
    cursor = to + 1;
    chunks += 1;
  }

  setLastSyncedBlock(processedTo);
  return { ok: true, latest, processedTo, inserted, chunks };
}

let _chainSyncInFlight = false;
async function runChainSyncTick() {
  if (_chainSyncInFlight) return;
  _chainSyncInFlight = true;
  try {
    await syncStampEventsFromChain({ maxBlocksPerRun: 10, maxChunksPerRun: 3 });
  } catch (e) {
    // best-effort sync
  } finally {
    _chainSyncInFlight = false;
  }
}

// Periodic on-chain sync (keeps DB aligned with real chain state)
setInterval(runChainSyncTick, 15_000).unref?.();
setTimeout(runChainSyncTick, 2_000).unref?.();

// Real-time on-chain sync (preferred): subscribe to logs via WebSocket to avoid getLogs limits
let _wsSyncStarted = false;
let _wsProvider = null;
const _wsLastTotalByKey = new Map();

function deriveWsUrl(httpUrl) {
  try {
    const s = String(httpUrl || "").trim();
    if (!s) return null;
    if (s.startsWith("wss://") || s.startsWith("ws://")) return s;
    if (s.startsWith("https://")) return `wss://${s.slice("https://".length)}`;
    if (s.startsWith("http://")) return `ws://${s.slice("http://".length)}`;
    return null;
  } catch {
    return null;
  }
}

function _keyOfCafeUser(cafe, user) {
  return `${String(cafe).toLowerCase()}_${String(user).toLowerCase()}`;
}

function ingestRealtimeChainLog(log) {
  try {
    if (!log) return;

    let parsed;
    try {
      parsed = stampCardInterface.parseLog(log);
    } catch {
      return;
    }

    const name = parsed && parsed.name ? String(parsed.name) : "";
    const cafe = parsed?.args?.cafe;
    const user = parsed?.args?.user;
    if (!cafe || !user) return;

    const txhash = log.transactionHash;
    if (!txhash || typeof txhash !== "string") return;
    if (hasEventByTx.get(txhash)) return;

    let delta = 0;
    let eventType = null;

    const k = _keyOfCafeUser(cafe, user);
    const dbTotalRow = countEventsByCafeUser.get(String(cafe), String(user));
    const dbTotal = Number(
      dbTotalRow && dbTotalRow.total != null ? dbTotalRow.total : 0
    );
    const lastTotal = _wsLastTotalByKey.has(k)
      ? Number(_wsLastTotalByKey.get(k))
      : Number.isFinite(dbTotal)
      ? dbTotal
      : 0;

    if (name === "StampAdded") {
      eventType = "stamp";
      const total = Number(parsed?.args?.totalStamps ?? 0);
      const d = Number.isFinite(total)
        ? total - (Number.isFinite(lastTotal) ? lastTotal : 0)
        : 0;
      delta = Number.isFinite(d) ? Math.max(0, d) : 0;
      _wsLastTotalByKey.set(k, Number.isFinite(total) ? total : 0);
    } else if (name === "RewardRedeemed") {
      eventType = "redeem";
      delta = -10;
      const nextTotal = Math.max(
        0,
        (Number.isFinite(lastTotal) ? lastTotal : 0) - 10
      );
      _wsLastTotalByKey.set(k, nextTotal);
    } else {
      return;
    }

    const ev = {
      ts: Date.now(),
      cafe: String(cafe),
      user: String(user),
      customer_name: null,
      txhash,
      status: "confirmed",
      event_type: eventType,
      delta: Number.isFinite(delta) ? delta : 0,
    };

    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    if (
      typeof log.blockNumber === "number" &&
      Number.isFinite(log.blockNumber)
    ) {
      const prev = getLastSyncedBlock();
      const next =
        prev == null
          ? log.blockNumber
          : Math.max(Number(prev) || 0, log.blockNumber);
      setLastSyncedBlock(next);
    }
  } catch (e) {
    // best-effort
  }
}

function startWsChainSync() {
  if (_wsSyncStarted) return;
  _wsSyncStarted = true;

  const contractAddr = getActiveStampcardAddress();
  if (!contractAddr || !/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) {
    console.warn("WS sync skipped: no contract address");
    return;
  }

  const wsUrl =
    (process.env.RPC_WS_URL && String(process.env.RPC_WS_URL).trim()) ||
    deriveWsUrl(RPC_URL);
  if (!wsUrl) {
    console.warn("WS sync skipped: no ws url (set RPC_WS_URL to enable)");
    return;
  }

  try {
    _wsProvider = new ethers.WebSocketProvider(wsUrl);
    const filter = {
      address: contractAddr,
      topics: [[TOPIC_STAMP_ADDED, TOPIC_REWARD_REDEEMED]],
    };

    _wsProvider.on(filter, ingestRealtimeChainLog);
    console.log("🔁 WS chain sync enabled");
  } catch (e) {
    console.warn("WS sync failed to start:", e && e.message ? e.message : e);
  }
}

setTimeout(startWsChainSync, 3_000).unref?.();

// === Mini-Auth (ein API-Key für MVP) ===
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ error: "unauthorized" });

  // First try to resolve a cafe record from the DB by api_key
  try {
    const cafe = getCafeByApiKey.get(key);
    if (cafe) {
      // If the cafe has an encrypted_key, decrypt and create a transient wallet
      if (cafe.encrypted_key) {
        try {
          const priv = decryptPrivateKey(cafe.encrypted_key);
          const cafeWallet = new ethers.Wallet(priv, provider);
          req.cafe = cafe;
          req.cafeWallet = cafeWallet;
          req.cafeAddress = cafeWallet.address;
          return next();
        } catch (e) {
          console.error("Failed to decrypt cafe private key", {
            api_key: key,
            encrypted_key_len: cafe.encrypted_key.length,
            master_key_len: (process.env.MASTER_KEY || "").length,
            error: e && e.message ? e.message : e,
          });
          return res.status(500).json({ error: "server_decrypt_failed" });
        }
      }
      // No encrypted key present: fall through to check env fallback below
    }
  } catch (e) {
    console.warn(
      "Error while looking up cafe by API key:",
      e && e.message ? e.message : e
    );
  }

  // Fallback: legacy single global API key mapped to server wallet
  if (process.env.CAFE_API_KEY && key === process.env.CAFE_API_KEY) {
    req.cafe = {
      id: 0,
      name: "_global_server_wallet_",
      api_key: process.env.CAFE_API_KEY,
    };
    req.cafeWallet = wallet;
    req.cafeAddress = wallet.address;
    return next();
  }

  return res.status(401).json({ error: "unauthorized" });
}

function requireAdminKey(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(500).json({ error: "admin_key_not_configured" });
  }

  const providedRaw =
    req.headers["x-admin-key"] || req.query?.adminKey || req.query?.key || null;
  const provided = providedRaw ? String(providedRaw).trim() : "";

  if (provided && provided === ADMIN_API_KEY) {
    return next();
  }

  return res.status(401).json({ error: "unauthorized_admin" });
}

// === Routes ===

// Health (inkl. DB-Ping)
app.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "db_error" });
  }
});

// Serve static apps
const appsDir = path.resolve(__dirname, "../apps");
app.use("/static", require("express").static(appsDir));

// Friendly routes for scanner and dashboard
app.get("/cafe-scanner", (req, res) => {
  res.sendFile(path.join(appsDir, "cafe-scanner.html"));
});
app.get("/cafe-dashboard", (req, res) => {
  res.sendFile(path.join(appsDir, "cafe-dashboard.html"));
});

// Provider & Contract Debug
app.get("/debug/contract", async (req, res) => {
  try {
    const net = await provider.getNetwork();
    let blockNumber = null;
    try {
      blockNumber = await provider.getBlockNumber();
    } catch (e) {}
    res.json({
      ok: true,
      rpc: RPC_URL,
      chainId: Number(net.chainId),
      blockNumber: blockNumber !== null ? Number(blockNumber) : null,
      stampcardAddress: process.env.STAMPCARD_ADDRESS,
      walletAddress: wallet.address,
      hasContract: !!process.env.STAMPCARD_ADDRESS,
    });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// QR Code für Stempel ausstellen (Café-Rolle)
app.post("/qr/issue", requireApiKey, async (req, res) => {
  try {
    const cafeId = randomHex(16); // 16 bytes für cafeId
    const nonce = randomHex(32); // 32 bytes für nonce
    const ttlSec = Math.max(30, Math.min(120, Number(req.body?.ttl || 60)));
    const expires = Math.floor(Date.now() / 1000) + ttlSec;

    insertNonce.run({ nonce, cafeId, expires });
    res.json({ cafeId, nonce, expires });
  } catch (err) {
    console.error("Error in /qr/issue:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempel vergeben (mit EIP-712 Signatur)
app.post("/stamp", async (req, res) => {
  try {
    console.log("POST /stamp received:", req.body);
    const { cafeId, nonce, expires, customer, signature } = req.body || {};

    // Validiere Input
    if (!cafeId || !nonce || !expires || !customer || !signature) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Prüfe Nonce
    const nonceRecord = getNonce.get(nonce);
    if (!nonceRecord) {
      return res.status(400).json({ error: "Invalid or used nonce" });
    }
    if (nonceRecord.cafe_id !== cafeId) {
      return res.status(400).json({ error: "CafeId mismatch" });
    }
    if (Math.floor(Date.now() / 1000) > nonceRecord.expires) {
      return res.status(400).json({ error: "QR code expired" });
    }

    // Validiere EIP-712 Signatur
    const message = { cafeId, nonce, expires: BigInt(expires), customer };
    const recovered = verifyTypedData(domain, types, message, signature);
    if (recovered.toLowerCase() !== customer.toLowerCase()) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Markiere Nonce als verwendet BEVOR wir die Chain-Transaktion senden
    consumeNonce.run(Date.now(), nonce);

    // Sende Transaktion
    console.log("Calling contract.addStamp for customer:", customer);
    const addr = getActiveStampcardAddress();
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return res.status(500).json({
        error: "stampcard_address_missing",
        message:
          "STAMPCARD_ADDRESS fehlt/ist ungültig. Bitte .env.local prüfen.",
      });
    }
    const stampContract = getStampCardContract(wallet);
    const tx = await stampContract.addStamp(customer);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed");

    // Speichere Event und broadcast für SSE-Clients
    const ev = {
      ts: Date.now(),
      cafe: wallet.address,
      user: customer,
      txhash: tx.hash,
      event_type: "stamp",
      delta: 1,
    };
    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error in /stamp:", err);
    if (isEthersDecodeError(err)) {
      return res.status(503).json({
        error: "bad_data",
        message:
          "Ethers konnte Contract-Result nicht dekodieren. Sehr wahrscheinlich ist STAMPCARD_ADDRESS nicht der StampCard-Contract auf dem aktuellen RPC_URL.",
      });
    }
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempel direkt durch das Café (API-Key required)
app.post("/stamp-by-cafe", requireApiKey, async (req, res) => {
  console.log("[DEBUG] /stamp-by-cafe reached");
  try {
    const { customer, count, customerName, qrCafe } = req.body || {};
    const cnt = Math.max(1, Math.min(20, Number(count || 1)));

    if (!customer || !/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    // We need a decrypted cafe wallet to preserve stamp attribution (msg.sender = cafe)
    const cafeSigner = req.cafeWallet;
    const cafeAddress =
      req.cafeAddress || (cafeSigner && cafeSigner.address) || null;
    if (!cafeSigner || !cafeAddress) {
      console.error("Missing decrypted cafe wallet for stamping");
      return res.status(500).json({ error: "missing_cafe_wallet" });
    }

    if (qrCafe) {
      try {
        if (String(qrCafe).toLowerCase() !== cafeAddress.toLowerCase()) {
          return res.status(403).json({
            error: "wrong_cafe",
            expected: cafeAddress,
            provided: qrCafe,
            message:
              "Dieser QR-Code gehört zu einem anderen Café. Bitte mit dem korrekten Konto anmelden.",
          });
        }
      } catch (e) {
        console.warn("qrCafe comparison failed", e);
      }
    }

    const stampcardAddress = getActiveStampcardAddress();
    if (!stampcardAddress || !/^0x[0-9a-fA-F]{40}$/.test(stampcardAddress)) {
      return res.status(500).json({
        error: "stampcard_address_missing",
        message:
          "STAMPCARD_ADDRESS fehlt/ist ungültig. Bitte .env.local prüfen.",
      });
    }

    // Helpful guard: BAD_DATA from ethers usually means RPC_URL and STAMPCARD_ADDRESS don't match.
    try {
      const code = await provider.getCode(stampcardAddress);
      if (!code || code === "0x") {
        return res.status(503).json({
          error: "stampcard_not_deployed",
          message:
            "Kein Contract unter STAMPCARD_ADDRESS auf dem aktuellen RPC_URL. Bitte .env.local prüfen (RPC_URL vs STAMPCARD_ADDRESS).",
        });
      }
    } catch (e) {
      return res.status(503).json({
        error: "rpc_unavailable",
        message:
          "RPC_URL nicht erreichbar oder Fehler beim Contract-Check. Bitte Node/RPC starten und .env.local prüfen.",
      });
    }

    // Auto-fund cafe if balance too low for gas
    const bal = await provider.getBalance(cafeAddress);
    const minWei = ethers.parseEther("0.003");
    if (bal < minWei) {
      console.log(
        `⛽ Auto-funding cafe ${cafeAddress} (balance ${ethers.formatEther(
          bal
        )} ETH < 0.003 ETH)`
      );

      // Check if server wallet has enough ETH to fund
      const serverBal = await provider.getBalance(wallet.address);
      const fundAmount = ethers.parseEther("0.01");

      if (serverBal < fundAmount) {
        console.error(
          `❌ Server wallet has insufficient ETH: ${ethers.formatEther(
            serverBal
          )} ETH < ${ethers.formatEther(fundAmount)} ETH needed for funding`
        );
        return res.status(402).json({
          error: "server_insufficient_funds",
          message: `Server wallet has only ${ethers.formatEther(
            serverBal
          )} ETH. Please add more Sepolia ETH to ${wallet.address}`,
          faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
        });
      }

      try {
        const fundTx = await wallet.sendTransaction({
          to: cafeAddress,
          value: fundAmount,
        });
        console.log(
          `🚀 Funding submitted ${fundTx.hash}. Returning 202 to client to retry shortly.`
        );
        return res.status(202).json({
          status: "funding",
          fundTxHash: fundTx.hash,
          retryAfter: 2,
          message: "Cafe wallet funding in progress. Please retry shortly.",
        });
      } catch (fundErr) {
        console.error("Auto-funding failed:", fundErr);
        return res.status(500).json({
          error: "auto_funding_failed",
          message: fundErr.message,
        });
      }
    }

    const cafeContract = getStampCardContract(cafeSigner);

    // Some RPC providers may fail gas estimation; provide explicit gas & fees
    let overrides = { gasLimit: 180000n };
    try {
      const fee = await provider.getFeeData();
      const maxFee = fee.maxFeePerGas ?? ethers.parseUnits("30", "gwei");
      const maxPrio =
        fee.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");
      overrides = {
        gasLimit: 180000n,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxPrio,
      };
    } catch {}

    let tx;
    if (cnt === 1) {
      console.log(`Cafe ${cafeAddress} awarding 1 stamp to ${customer}`);
      tx = await cafeContract.addStamp(customer, overrides);
    } else {
      console.log(`Cafe ${cafeAddress} awarding ${cnt} stamps to ${customer}`);
      tx = await cafeContract.addStamps(customer, cnt, overrides);
    }
    console.log("sent tx", tx.hash);

    // Do not block on confirmations; respond immediately so UI stays snappy.
    const ev = {
      ts: Date.now(),
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: tx.hash,
      status: "submitted",
      event_type: "stamp",
      delta: cnt,
    };
    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    // Background: mark event status based on receipt
    Promise.resolve()
      .then(async () => {
        try {
          const receipt = await tx.wait();
          const ok = receipt && receipt.status === 1;
          updateEventStatusByTx.run(ok ? "confirmed" : "failed", tx.hash);
        } catch (e) {
          // If it reverts or never confirms, keep as submitted; do not spam logs.
        }
      })
      .catch(() => {});

    // Return submitted status; client can optimistically update and/or re-fetch later
    res.json({
      success: true,
      status: "submitted",
      count: cnt,
      txHash: tx.hash,
    });
  } catch (err) {
    console.error("Error in /stamp-by-cafe:", err);
    const code = err && err.code ? String(err.code) : null;
    if (code === "BAD_DATA" || isEthersDecodeError(err)) {
      return res.status(503).json({
        error: "bad_data",
        message:
          "Ethers BAD_DATA: RPC_URL und STAMPCARD_ADDRESS passen sehr wahrscheinlich nicht zusammen (Contract nicht deployed/anderes Netz).",
      });
    }
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Redeem reward (café scans customer redemption QR)
app.post("/redeem-reward", requireApiKey, async (req, res) => {
  console.log("[DEBUG] /redeem-reward reached");
  try {
    const { customer, customerName, qrCafe } = req.body || {};

    if (!customer || !/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    const cafeSigner = req.cafeWallet;
    const cafeAddress =
      req.cafeAddress || (cafeSigner && cafeSigner.address) || null;

    if (!cafeSigner || !cafeAddress) {
      return res.status(500).json({ error: "missing_cafe_wallet" });
    }

    if (qrCafe) {
      try {
        if (String(qrCafe).toLowerCase() !== cafeAddress.toLowerCase()) {
          return res.status(403).json({
            error: "wrong_cafe",
            expected: cafeAddress,
            provided: qrCafe,
            message:
              "Dieser Einlöse-QR gehört zu einem anderen Café. Bitte mit dem passenden Konto anmelden.",
          });
        }
      } catch (e) {
        console.warn("qrCafe comparison failed (redeem)", e);
      }
    }

    const stampcardAddress = getActiveStampcardAddress();
    if (!stampcardAddress || !/^0x[0-9a-fA-F]{40}$/.test(stampcardAddress)) {
      return res.status(500).json({
        error: "stampcard_address_missing",
        message:
          "STAMPCARD_ADDRESS fehlt/ist ungültig. Bitte .env.local prüfen.",
      });
    }

    // Helpful guard: if there's no code at the address on this RPC, ethers calls often throw BAD_DATA.
    try {
      const code = await provider.getCode(stampcardAddress);
      if (!code || code === "0x") {
        return res.status(503).json({
          error: "stampcard_not_deployed",
          message:
            "Kein Contract unter STAMPCARD_ADDRESS auf dem aktuellen RPC_URL. Bitte .env.local prüfen (RPC_URL vs STAMPCARD_ADDRESS).",
        });
      }
    } catch (e) {
      return res.status(503).json({
        error: "rpc_unavailable",
        message:
          "RPC_URL nicht erreichbar oder Fehler beim Contract-Check. Bitte Node/RPC starten und .env.local prüfen.",
      });
    }

    // Check current stamps
    const cafeContract = getStampCardContract(provider);
    const currentStamps = await cafeContract.getStamps(cafeAddress, customer);

    if (currentStamps < 10n) {
      return res.status(400).json({
        error: "insufficient_stamps",
        current: Number(currentStamps),
        required: 10,
        message: "Customer needs at least 10 stamps to redeem reward",
      });
    }

    // Auto-fund if needed (same logic as stamping)
    const bal = await provider.getBalance(cafeAddress);
    const minWei = ethers.parseEther("0.003");
    if (bal < minWei) {
      const serverBal = await provider.getBalance(wallet.address);
      const fundAmount = ethers.parseEther("0.01");

      if (serverBal < fundAmount) {
        return res.status(402).json({
          error: "server_insufficient_funds",
          message: `Server wallet has only ${ethers.formatEther(
            serverBal
          )} ETH.`,
          faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
        });
      }

      try {
        const fundTx = await wallet.sendTransaction({
          to: cafeAddress,
          value: fundAmount,
        });
        return res.status(202).json({
          status: "funding",
          fundTxHash: fundTx.hash,
          retryAfter: 2,
          message: "Cafe wallet funding in progress.",
        });
      } catch (fundErr) {
        return res
          .status(500)
          .json({ error: "auto_funding_failed", message: fundErr.message });
      }
    }

    // Call contract's redeemReward function (impl may reset to 0 or subtract 10)
    const contractWithSigner = getStampCardContract(cafeSigner);

    console.log(
      `Redeeming reward for ${customer} at café ${cafeAddress} (current: ${currentStamps} stamps)`
    );

    // Some RPC providers may fail gas estimation; provide explicit gas & fees
    let overrides = { gasLimit: 200000n };
    try {
      const fee = await provider.getFeeData();
      const maxFee = fee.maxFeePerGas ?? ethers.parseUnits("30", "gwei");
      const maxPrio =
        fee.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");
      overrides = {
        gasLimit: 200000n,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxPrio,
      };
    } catch {}

    const tx = await contractWithSigner.redeemReward(customer, overrides);
    console.log("Redemption tx sent:", tx.hash);

    // Log + broadcast immediately as "submitted" so UIs can react.
    const ev = {
      ts: Date.now(),
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: tx.hash,
      status: "submitted",
      event_type: "redeem",
      delta: -10,
    };

    try {
      insertEvent.run(ev);
    } catch (dbErr) {
      console.warn("Failed to log redemption:", dbErr);
    }

    try {
      broadcastEvent(ev);
    } catch (e) {}

    Promise.resolve()
      .then(async () => {
        try {
          const receipt = await tx.wait();
          const ok = receipt && receipt.status === 1;
          try {
            updateEventStatusByTx.run(ok ? "confirmed" : "failed", tx.hash);
          } catch (e) {}

          // Broadcast status update so clients can refresh after confirmation.
          try {
            broadcastEvent({ ...ev, status: ok ? "confirmed" : "failed" });
          } catch (e) {}

          const postStamps = await cafeContract.getStamps(
            cafeAddress,
            customer
          );
          if (currentStamps > 10n && postStamps === 0n) {
            const remainder = currentStamps - 10n;
            try {
              const addTx = await contractWithSigner.addStamps(
                customer,
                Number(remainder)
              );
              console.log("Remainder add tx sent:", addTx.hash);
            } catch (addErr) {
              console.warn(
                "Failed to add remainder stamps:",
                addErr && addErr.message ? addErr.message : addErr
              );
            }
          }
        } catch (waitErr) {
          console.warn(
            "Could not confirm redemption tx (continuing):",
            waitErr && waitErr.message ? waitErr.message : waitErr
          );
        }
      })
      .catch((backgroundErr) => {
        console.error("Async redemption handler failed:", backgroundErr);
      });

    res.json({
      success: true,
      status: "submitted",
      redeemed: true,
      previousStamps: Number(currentStamps),
      txHash: tx.hash,
      message: "Reward redeeming! Transaction submitted.",
    });
  } catch (err) {
    console.error("Error in /redeem-reward:", err);
    const code = err && err.code ? String(err.code) : null;
    if (code === "BAD_DATA" || isEthersDecodeError(err)) {
      return res.status(503).json({
        error: "bad_data",
        message:
          "Ethers BAD_DATA: RPC_URL und STAMPCARD_ADDRESS passen sehr wahrscheinlich nicht zusammen (Contract nicht deployed/anderes Netz).",
      });
    }
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempelstand abfragen
app.get("/stamps/:addr", async (req, res) => {
  // declare `user` in outer scope so it's available in the catch block for fallback responses
  let user = req.params && req.params.addr;
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
      return res.status(400).json({ error: "invalid user address" });
    }
    const fallback =
      req.query &&
      (req.query.fallback === "1" || req.query.fallback === "true");
    const strict =
      req.query && (req.query.strict === "1" || req.query.strict === "true");
    const cafeAddress = req.query && req.query.cafe;

    if (!wallet || !wallet.address) {
      console.error("Wallet not initialized");
      if (fallback)
        return res.json({
          cafe: null,
          user,
          stamps: 0,
          note: "wallet_not_initialized",
        });
      return res.status(500).json({ error: "server_wallet_not_initialized" });
    }

    let stamps = 0;

    const stampcardAddress = getActiveStampcardAddress();
    if (!stampcardAddress || !/^0x[0-9a-fA-F]{40}$/.test(stampcardAddress)) {
      if (fallback)
        return res.json({
          cafe: cafeAddress || null,
          user,
          stamps: 0,
          note: "stampcard_address_missing",
        });
      return res.status(500).json({ error: "stampcard_address_missing" });
    }

    const readContract = getStampCardContract(provider);

    // If specific cafe requested, get stamps from that cafe only
    if (cafeAddress && /^0x[0-9a-fA-F]{40}$/i.test(cafeAddress)) {
      try {
        const count = await readContract.getStamps(cafeAddress, user);
        stamps =
          typeof count === "bigint"
            ? Number(count)
            : count?.toNumber
            ? count.toNumber()
            : Number(count);
      } catch (chainErr) {
        if (fallback) {
          try {
            const row = countEventsByCafeUser.get(cafeAddress, user);
            const total = row && typeof row.total === "number" ? row.total : 0;
            return res.json({
              cafe: cafeAddress,
              user,
              stamps: total,
              note: total > 0 ? "db_fallback" : "db_fallback_zero",
              error: String(
                chainErr && chainErr.message ? chainErr.message : chainErr
              ),
            });
          } catch (dbErr) {
            return res.json({
              cafe: cafeAddress,
              user,
              stamps: 0,
              note: "db_fallback_failed",
              error: String(
                chainErr && chainErr.message ? chainErr.message : chainErr
              ),
              dbError: String(dbErr && dbErr.message ? dbErr.message : dbErr),
            });
          }
        }

        throw chainErr;
      }
      // If chain returned 0 but we have historical events, use DB fallback so users still see their stamps after a dev chain reset.
      // strict=1 disables this behavior so redeem flows can rely on the on-chain truth.
      if (!strict && stamps === 0) {
        try {
          const row = countEventsByCafeUser.get(cafeAddress, user);
          if (row && typeof row.total === "number" && row.total > 0) {
            stamps = row.total;
            return res.json({
              cafe: cafeAddress,
              user,
              stamps,
              note: "db_fallback",
            });
          }
        } catch (e) {
          console.warn("DB fallback failed", e.message);
        }
      }
      return res.json({ cafe: cafeAddress, user, stamps });
    }

    // Otherwise, sum stamps across all cafes
    const allCafes = db
      .prepare("SELECT address, api_key, encrypted_key FROM cafes")
      .all();
    let fallbackUsed = false;
    for (const cafe of allCafes) {
      try {
        let cafeAddr = cafe.address;

        // If no address field, try to decrypt wallet to get address
        if (!cafeAddr && cafe.encrypted_key) {
          try {
            const decrypted = decryptPrivateKey(cafe.encrypted_key);
            const cafeWallet = new ethers.Wallet(decrypted, provider);
            cafeAddr = cafeWallet.address;
          } catch (e) {
            console.warn(`Could not decrypt cafe ${cafe.api_key}:`, e.message);
            continue;
          }
        }

        if (cafeAddr) {
          let num = 0;
          try {
            const count = await readContract.getStamps(cafeAddr, user);
            num =
              typeof count === "bigint"
                ? Number(count)
                : count?.toNumber
                ? count.toNumber()
                : Number(count);
          } catch (chainErr) {
            if (fallback) {
              try {
                const row = countEventsByCafeUser.get(cafeAddr, user);
                if (row && typeof row.total === "number" && row.total > 0) {
                  stamps += row.total;
                  fallbackUsed = true;
                }
              } catch (e) {
                console.warn("DB fallback failed", e.message || e);
              }
              continue;
            }
            throw chainErr;
          }
          if (num === 0) {
            if (!strict) {
              try {
                const row = countEventsByCafeUser.get(cafeAddr, user);
                if (row && typeof row.total === "number" && row.total > 0) {
                  stamps += row.total;
                  fallbackUsed = true;
                  continue;
                }
              } catch (e) {
                console.warn("DB fallback failed", e.message || e);
              }
            }
          }
          stamps += num;
        }
      } catch (e) {
        console.warn(
          `Error getting stamps for cafe ${cafe.api_key}:`,
          e.message
        );
      }
    }

    res.json({
      user,
      stamps,
      note: fallbackUsed ? "db_fallback" : "total_across_all_cafes",
    });
  } catch (err) {
    console.error(
      "Error in GET /stamps/:addr",
      err && err.stack ? err.stack : err
    );
    const fallback =
      req.query &&
      (req.query.fallback === "1" || req.query.fallback === "true");
    if (fallback)
      return res.json({
        cafe:
          req.query && /^0x[0-9a-fA-F]{40}$/i.test(req.query.cafe)
            ? req.query.cafe
            : wallet && wallet.address
            ? wallet.address
            : null,
        user,
        stamps: 0,
        error: String(err.message || err),
      });
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Get stamp history for a user
app.get("/stamps/history/:addr", (req, res) => {
  try {
    const addr = req.params.addr;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/i.test(addr)) {
      return res.status(400).json({ error: "invalid address" });
    }

    const events = db
      .prepare(
        "SELECT * FROM stamp_events WHERE LOWER(user) = LOWER(?) ORDER BY ts DESC LIMIT 50"
      )
      .all(addr);

    res.json(events);
  } catch (err) {
    console.error("Error fetching stamp history:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/cafes/:cafeId/overview", requireApiKey, (req, res) => {
  try {
    const { cafeId } = req.params;
    const eventsLimitRaw = req.query?.eventsLimit ?? req.query?.events;
    const customerLimitRaw =
      req.query?.customerLimit ?? req.query?.customers ?? req.query?.limit;

    const eventsLimit = Math.max(
      5,
      Math.min(Number(eventsLimitRaw) || 20, 200)
    );
    const customerLimit = Math.max(
      5,
      Math.min(Number(customerLimitRaw) || 25, 200)
    );

    const cafeRow = req.cafe;
    if (!cafeRow) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }

    if (cafeId && cafeId !== "me") {
      if (String(cafeRow.id) !== String(cafeId)) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    const cafeAddress = req.cafeAddress || ensureCafeAddress(cafeRow);
    if (!cafeAddress) {
      return res.status(404).json({ error: "cafe_address_missing" });
    }

    const cafeAddressLower = cafeAddress.toLowerCase();

    const statsRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total_events,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemption_count,
           COUNT(DISTINCT user) AS unique_customers,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts
         FROM stamp_events
         WHERE LOWER(cafe) = ?`
      )
      .get(cafeAddressLower);

    const stats = {
      totalEvents: Number(statsRow?.total_events || 0),
      stampsAwarded: Number(statsRow?.stamps_awarded || 0),
      stampsRedeemed: Number(statsRow?.stamps_redeemed || 0),
      netStamps: Number(statsRow?.net_stamps || 0),
      redemptionCount: Number(statsRow?.redemption_count || 0),
      uniqueCustomers: Number(statsRow?.unique_customers || 0),
      lastActivityTs:
        statsRow && statsRow.last_activity_ts != null
          ? Number(statsRow.last_activity_ts)
          : null,
      lastStampTs:
        statsRow && statsRow.last_stamp_ts != null
          ? Number(statsRow.last_stamp_ts)
          : null,
      lastRedemptionTs:
        statsRow && statsRow.last_redeem_ts != null
          ? Number(statsRow.last_redeem_ts)
          : null,
    };

    const recentEventsRows = db
      .prepare(
        `SELECT id, ts, cafe, user, customer_name, event_type, delta, txhash
         FROM stamp_events
         WHERE LOWER(cafe) = ?
         ORDER BY ts DESC
         LIMIT ?`
      )
      .all(cafeAddressLower, eventsLimit);

    const recentEvents = recentEventsRows.map((row) => toEventSummary(row));

    const customersRows = db
      .prepare(
        `SELECT
           user,
           MAX(customer_name) AS customer_name,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           MAX(ts) AS last_activity_ts
         FROM stamp_events
         WHERE LOWER(cafe) = ?
         GROUP BY user
         ORDER BY last_activity_ts DESC
         LIMIT ?`
      )
      .all(cafeAddressLower, customerLimit);

    const customers = customersRows.map((row) => ({
      address: row.user,
      customerName: row.customer_name || null,
      stampsAwarded: Number(row.stamps_awarded || 0),
      stampsRedeemed: Number(row.stamps_redeemed || 0),
      netStamps: Number(row.net_stamps || 0),
      redemptions: Number(row.redemptions || 0),
      lastActivityTs:
        row.last_activity_ts != null ? Number(row.last_activity_ts) : null,
    }));

    res.json({
      ok: true,
      cafe: {
        id: cafeRow.id,
        name: cafeRow.name || null,
        address: cafeAddress,
        about: cafeRow.about_text || null,
        redeemMessage: cafeRow.redeem_message || null,
        logoDataUrl:
          cafeRow.logo_data && cafeRow.logo_mime
            ? `data:${cafeRow.logo_mime};base64,${cafeRow.logo_data}`
            : null,
      },
      stats,
      recentEvents: recentEvents.filter(Boolean),
      customers,
      meta: {
        eventsLimit,
        customerLimit,
        generatedAt: Date.now(),
      },
    });
  } catch (err) {
    console.error("Error in /cafes/:cafeId/overview:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// Update cafe public profile (about text + logo) for the logged-in cafe
app.put("/cafes/me/profile", requireApiKey, (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }

    const current = getCafeById.get(cafeRow.id);
    if (!current) {
      return res.status(404).json({ error: "cafe_not_found" });
    }

    const body = req.body || {};

    let aboutText = current.about_text || null;
    if (Object.prototype.hasOwnProperty.call(body, "about")) {
      const rawAbout = body.about == null ? "" : String(body.about);
      const trimmed = rawAbout.trim();
      aboutText = trimmed ? trimmed.slice(0, 1200) : null;
    }

    let redeemMessage = current.redeem_message || null;
    if (Object.prototype.hasOwnProperty.call(body, "redeemMessage")) {
      const rawMsg =
        body.redeemMessage == null ? "" : String(body.redeemMessage);
      const trimmed = rawMsg.trim();
      redeemMessage = trimmed ? trimmed.slice(0, 600) : null;
    }

    let logoMime = current.logo_mime || null;
    let logoData = current.logo_data || null;
    if (Object.prototype.hasOwnProperty.call(body, "logoDataUrl")) {
      const raw = body.logoDataUrl;
      if (!raw) {
        logoMime = null;
        logoData = null;
      } else {
        const s = String(raw);
        const m =
          /^data:(image\/(png|jpeg|jpg|svg\+xml));base64,([a-z0-9+/=\r\n]+)$/i.exec(
            s
          );
        if (!m) {
          return res.status(400).json({ error: "invalid_logo_format" });
        }
        const mime =
          m[1].toLowerCase() === "image/jpg"
            ? "image/jpeg"
            : m[1].toLowerCase();
        const base64 = String(m[3] || "").replace(/\s+/g, "");

        // Rough size guard: base64 chars ~ 4/3 bytes
        if (base64.length > 300_000) {
          return res.status(413).json({ error: "logo_too_large" });
        }

        logoMime = mime;
        logoData = base64;
      }
    }

    const now = Date.now();
    updateCafeProfileById.run(
      aboutText,
      redeemMessage,
      logoMime,
      logoData,
      now,
      cafeRow.id
    );

    const updated = getCafeById.get(cafeRow.id);
    res.json({
      ok: true,
      cafe: {
        id: updated.id,
        name: updated.name || null,
        address: updated.address || null,
        about: updated.about_text || null,
        redeemMessage: updated.redeem_message || null,
        logoDataUrl:
          updated.logo_data && updated.logo_mime
            ? `data:${updated.logo_mime};base64,${updated.logo_data}`
            : null,
        updatedAt:
          updated.updated_at != null ? Number(updated.updated_at) : null,
      },
    });
  } catch (err) {
    console.error("Error in PUT /cafes/me/profile:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/cafes/:cafeId/events/:eventId/detail", requireApiKey, (req, res) => {
  try {
    const { cafeId, eventId } = req.params;
    const cafeRow = req.cafe;
    if (!cafeRow) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }

    if (cafeId && cafeId !== "me") {
      if (String(cafeRow.id) !== String(cafeId)) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    const numericId = Number(eventId);
    if (!Number.isFinite(numericId)) {
      return res.status(400).json({ error: "invalid_event_id" });
    }

    const eventRow = db
      .prepare("SELECT * FROM stamp_events WHERE id = ?")
      .get(numericId);
    if (!eventRow) {
      return res.status(404).json({ error: "event_not_found" });
    }

    const cafeAddress = req.cafeAddress || ensureCafeAddress(cafeRow);
    if (!cafeAddress) {
      return res.status(404).json({ error: "cafe_address_missing" });
    }

    if (
      eventRow.cafe &&
      eventRow.cafe.toLowerCase() !== cafeAddress.toLowerCase()
    ) {
      return res.status(403).json({ error: "event_not_owned_by_cafe" });
    }

    const detail = toEventDetail(eventRow);
    if (!detail) {
      return res.status(500).json({ error: "event_detail_unavailable" });
    }

    detail.cafeName = cafeRow.name || null;

    res.json({ ok: true, event: detail });
  } catch (err) {
    console.error("Error in cafe event detail:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/admin/events/:eventId/detail", requireAdminKey, (req, res) => {
  try {
    const numericId = Number(req.params.eventId);
    if (!Number.isFinite(numericId)) {
      return res.status(400).json({ error: "invalid_event_id" });
    }

    const eventRow = db
      .prepare("SELECT * FROM stamp_events WHERE id = ?")
      .get(numericId);
    if (!eventRow) {
      return res.status(404).json({ error: "event_not_found" });
    }

    const detail = toEventDetail(eventRow);
    if (!detail) {
      return res.status(500).json({ error: "event_detail_unavailable" });
    }

    let cafeName = null;
    try {
      const cafeRow = db
        .prepare("SELECT name FROM cafes WHERE LOWER(address) = ?")
        .get((eventRow.cafe || "").toLowerCase());
      cafeName = cafeRow?.name || null;
    } catch (e) {
      // ignore name lookup errors
    }

    detail.cafeName = cafeName;

    res.json({ ok: true, event: detail });
  } catch (err) {
    console.error("Error in admin event detail:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/admin/cafes/activity", requireAdminKey, (req, res) => {
  try {
    const eventsPerCafeRaw =
      req.query?.eventsPerCafe ?? req.query?.limit ?? req.query?.events;
    const customerLimitRaw =
      req.query?.customerLimit ??
      req.query?.customerCount ??
      req.query?.customers;

    const eventsPerCafe = Math.max(
      5,
      Math.min(Number(eventsPerCafeRaw) || 50, 200)
    );
    const customerLimit = Math.max(
      5,
      Math.min(Number(customerLimitRaw) || 25, 500)
    );
    const maxEvents = Math.max(
      eventsPerCafe,
      Math.min(Number(req.query?.maxEvents) || eventsPerCafe * 40, 5000)
    );

    let cafeRows;
    try {
      cafeRows = db
        .prepare(
          "SELECT id, name, api_key, encrypted_key, address, created_at FROM cafes ORDER BY name COLLATE NOCASE"
        )
        .all();
    } catch (selectErr) {
      cafeRows = db
        .prepare(
          "SELECT id, name, api_key, encrypted_key, created_at FROM cafes ORDER BY name COLLATE NOCASE"
        )
        .all()
        .map((row) => ({ ...row, address: null }));
    }

    const createStats = () => ({
      totalEvents: 0,
      stampsAwarded: 0,
      stampsRedeemed: 0,
      redemptions: 0,
      netStamps: 0,
      uniqueCustomers: 0,
      lastActivityTs: null,
      lastStampTs: null,
      lastRedemptionTs: null,
    });

    const results = [];
    const cafeByAddress = new Map();

    for (const row of cafeRows) {
      let resolvedAddress = row.address || null;
      if (!resolvedAddress && row.encrypted_key) {
        try {
          const priv = decryptPrivateKey(row.encrypted_key);
          const walletForCafe = new ethers.Wallet(priv);
          resolvedAddress = walletForCafe.address;
        } catch (e) {
          // leave address null if decryption fails
        }
      }

      const entry = {
        id: row.id,
        name: row.name || `Café ${row.id}`,
        apiKey: row.api_key || null,
        address: resolvedAddress,
        createdAt: row.created_at || null,
        stats: createStats(),
        customers: [],
        events: [],
        isUnknown: false,
      };
      results.push(entry);
      if (resolvedAddress) {
        cafeByAddress.set(resolvedAddress.toLowerCase(), entry);
      }
    }

    const ensureEntry = (addr) => {
      if (addr) {
        const key = addr.toLowerCase();
        if (cafeByAddress.has(key)) {
          return cafeByAddress.get(key);
        }
        const entry = {
          id: null,
          name: "Unbekanntes Café",
          apiKey: null,
          address: addr,
          createdAt: null,
          stats: createStats(),
          customers: [],
          events: [],
          isUnknown: true,
        };
        results.push(entry);
        cafeByAddress.set(key, entry);
        return entry;
      }

      const fallback = results.find((c) => c.address === null && c.isUnknown);
      if (fallback) return fallback;
      const entry = {
        id: null,
        name: "Unbekanntes Café",
        apiKey: null,
        address: null,
        createdAt: null,
        stats: createStats(),
        customers: [],
        events: [],
        isUnknown: true,
      };
      results.push(entry);
      return entry;
    };

    const aggregateRows = db
      .prepare(
        `SELECT
           cafe,
           COUNT(*) AS total_events,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts,
           MAX(ts) AS last_activity_ts,
           COUNT(DISTINCT user) AS unique_customers
         FROM stamp_events
         GROUP BY cafe`
      )
      .all();

    for (const row of aggregateRows) {
      const entry = ensureEntry(row.cafe);
      const stats = entry.stats;
      stats.totalEvents = Number(row.total_events || 0);
      stats.stampsAwarded = Number(row.stamps_awarded || 0);
      stats.stampsRedeemed = Number(row.stamps_redeemed || 0);
      stats.netStamps = Number(row.net_stamps || 0);
      stats.redemptions = Number(row.redemptions || 0);
      stats.uniqueCustomers = Number(row.unique_customers || 0);
      stats.lastActivityTs =
        row.last_activity_ts != null ? Number(row.last_activity_ts) : null;
      stats.lastStampTs =
        row.last_stamp_ts != null ? Number(row.last_stamp_ts) : null;
      stats.lastRedemptionTs =
        row.last_redeem_ts != null ? Number(row.last_redeem_ts) : null;
      if (!entry.address && row.cafe) {
        entry.address = row.cafe;
      }
    }

    const customerRows = db
      .prepare(
        `SELECT
           cafe,
           user,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           MAX(CASE WHEN customer_name IS NOT NULL AND customer_name != '' THEN customer_name ELSE NULL END) AS customer_name
         FROM stamp_events
         GROUP BY cafe, user`
      )
      .all();

    for (const row of customerRows) {
      const entry = ensureEntry(row.cafe);
      entry.customers.push({
        user: row.user,
        customerName: row.customer_name || null,
        stampsAwarded: Number(row.stamps_awarded || 0),
        stampsRedeemed: Number(row.stamps_redeemed || 0),
        redemptions: Number(row.redemptions || 0),
        netStamps: Number(row.net_stamps || 0),
        lastActivityTs:
          row.last_activity_ts != null ? Number(row.last_activity_ts) : null,
        lastStampTs:
          row.last_stamp_ts != null ? Number(row.last_stamp_ts) : null,
        lastRedemptionTs:
          row.last_redeem_ts != null ? Number(row.last_redeem_ts) : null,
      });
    }

    const rawEvents = db
      .prepare(
        "SELECT id, ts, cafe, user, customer_name, txhash, event_type, delta FROM stamp_events ORDER BY ts DESC LIMIT ?"
      )
      .all(maxEvents);

    for (const ev of rawEvents) {
      const entry = ensureEntry(ev.cafe);
      if (entry.events.length >= eventsPerCafe) continue;
      entry.events.push({
        id: ev.id,
        ts: ev.ts != null ? Number(ev.ts) : null,
        user: ev.user,
        customerName: ev.customer_name || null,
        txhash: ev.txhash,
        eventType: ev.event_type || (ev.delta < 0 ? "redeem" : "stamp"),
        delta: typeof ev.delta === "number" ? ev.delta : Number(ev.delta || 0),
      });
    }

    for (const entry of results) {
      entry.createdAt = entry.createdAt ? Number(entry.createdAt) : null;

      entry.customers.sort(
        (a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
      );
      if (entry.customers.length > customerLimit) {
        entry.customers = entry.customers.slice(0, customerLimit);
      }
      if (!entry.stats.uniqueCustomers) {
        entry.stats.uniqueCustomers = entry.customers.length;
      }

      entry.events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    }

    results.sort((a, b) => {
      const bTs = b.stats.lastActivityTs || 0;
      const aTs = a.stats.lastActivityTs || 0;
      if (bTs !== aTs) return bTs - aTs;
      return (a.name || "").localeCompare(b.name || "");
    });

    res.json({
      ok: true,
      cafes: results.map((entry) => ({
        id: entry.id,
        name: entry.name,
        apiKey: entry.apiKey,
        address: entry.address,
        createdAt: entry.createdAt,
        stats: entry.stats,
        customers: entry.customers,
        events: entry.events,
        isUnknown: entry.isUnknown || false,
      })),
      meta: {
        eventsPerCafe,
        customerLimit,
        fetchedEvents: rawEvents.length,
        generatedAt: Date.now(),
      },
    });
  } catch (err) {
    console.error("Error in /admin/cafes/activity:", err);
    res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
});

// Get café statistics for dashboard
app.get("/cafes/:cafeId/stats", (req, res) => {
  try {
    const cafeId = parseInt(req.params.cafeId);
    if (isNaN(cafeId)) {
      return res.status(400).json({ error: "invalid cafe id" });
    }

    const cafe = db.prepare("SELECT * FROM cafes WHERE id = ?").get(cafeId);
    if (!cafe) {
      return res.status(404).json({ error: "cafe not found" });
    }

    const apiKey = req.headers["x-api-key"];
    if (!apiKey || apiKey !== cafe.api_key) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const cafeAddr = (cafe.address || "").toLowerCase();

    const allEvents = db
      .prepare("SELECT * FROM stamp_events WHERE LOWER(cafe) = ?")
      .all(cafeAddr);

    const totalStamps = allEvents.length;
    const uniqueCustomers = new Set(
      allEvents.map((e) => (e.user || "").toLowerCase())
    ).size;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStamps = allEvents.filter(
      (e) => Number(e.ts) >= today.getTime()
    ).length;

    const totalRedemptions = allEvents.filter((e) => {
      const tx = e.txhash || "";
      return tx.startsWith("REDEMPTION_");
    }).length;

    res.json({ totalStamps, uniqueCustomers, todayStamps, totalRedemptions });
  } catch (err) {
    console.error("Error fetching café stats:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Extended health check including RPC connectivity
app.get("/health/block", async (req, res) => {
  try {
    const block = await provider.getBlockNumber();
    res.json({
      status: "ok",
      blockNumber: Number(block),
      contract: process.env.STAMPCARD_ADDRESS || null,
      wallet: wallet && wallet.address ? wallet.address : null,
    });
  } catch (err) {
    console.error("Error in /health/block", err && err.stack ? err.stack : err);
    res
      .status(500)
      .json({ status: "error", error: String(err.message || err) });
  }
});

// Events (letzte 50)
app.get("/events", (req, res) => {
  const rows = listEvents.all();
  res.json(rows);
});

// Debug: count DB events for a cafe+user pairing
app.get("/debug/db-stamp-count", (req, res) => {
  try {
    const cafe = req.query.cafe;
    const user = req.query.user;
    if (!cafe || !/^0x[0-9a-fA-F]{40}$/.test(cafe)) {
      return res.status(400).json({ error: "invalid cafe" });
    }
    if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
      return res.status(400).json({ error: "invalid user" });
    }
    const row = countEventsByCafeUser.get(cafe, user);
    res.json({ ok: true, cafe, user, dbCount: row ? row.total : 0 });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// --- Temporary debug endpoints ---

// Rehydrate on-chain state from DB events (dev-only)
// Groups events by cafe+user and calls addStamps with the total per pair.
// Query params: dryRun=1 to only report planned actions
app.post("/debug/rehydrate", async (req, res) => {
  try {
    const dryRun =
      req.query && (req.query.dryRun === "1" || req.query.dryRun === "true");

    // Build aggregation of counts from DB
    const rows = db
      .prepare(
        "SELECT cafe, user, COALESCE(SUM(delta), 0) as total FROM stamp_events GROUP BY cafe, user"
      )
      .all();

    // Validate contract presence
    const contractAddr = process.env.STAMPCARD_ADDRESS;
    if (!contractAddr)
      return res.status(500).json({ ok: false, error: "no_contract_address" });
    const code = await provider.getCode(contractAddr);
    if (!code || code === "0x" || code === "0x0") {
      return res.status(500).json({
        ok: false,
        error: "no_contract_code",
        address: contractAddr,
      });
    }

    const actions = [];

    for (const row of rows) {
      const cafeAddr = row.cafe;
      const userAddr = row.user;
      const cnt = Number(row.total || 0);
      if (
        !/^0x[0-9a-fA-F]{40}$/i.test(cafeAddr) ||
        !/^0x[0-9a-fA-F]{40}$/i.test(userAddr)
      ) {
        continue; // skip invalid
      }
      if (cnt <= 0) continue;

      // Find cafe record to decrypt wallet
      let cafeRec = null;
      try {
        cafeRec = db
          .prepare("SELECT * FROM cafes WHERE address = ?")
          .get(cafeAddr);
      } catch (e) {}
      if (!cafeRec || !cafeRec.encrypted_key) {
        actions.push({
          cafe: cafeAddr,
          user: userAddr,
          count: cnt,
          status: "skip_no_wallet",
        });
        continue;
      }

      let cafePriv = null;
      try {
        cafePriv = decryptPrivateKey(cafeRec.encrypted_key);
      } catch (e) {
        actions.push({
          cafe: cafeAddr,
          user: userAddr,
          count: cnt,
          status: "decrypt_failed",
          error: e.message,
        });
        continue;
      }

      const cafeSigner = new ethers.Wallet(cafePriv, provider);
      const cafeContract = new ethers.Contract(
        contractAddr,
        stampCardJson.abi,
        cafeSigner
      );

      // Build action record
      const act = {
        cafe: cafeAddr,
        user: userAddr,
        count: cnt,
        status: dryRun ? "planned" : "pending",
      };
      actions.push(act);

      if (dryRun) continue;

      try {
        // Auto-fund if balance low
        const bal = await provider.getBalance(cafeAddr);
        const minWei = ethers.parseEther("0.005");
        if (bal < minWei) {
          const fundTx = await wallet.sendTransaction({
            to: cafeAddr,
            value: ethers.parseEther("0.05"),
          });
          await fundTx.wait();
          act.fundedTx = fundTx.hash;
        }

        let tx;
        if (cnt === 1) tx = await cafeContract.addStamp(userAddr);
        else tx = await cafeContract.addStamps(userAddr, cnt);
        act.txHash = tx.hash;
        await tx.wait();
        act.status = "rehydrated";
      } catch (e) {
        act.status = "error";
        act.error = e && e.message ? e.message : String(e);
      }
    }

    res.json({ ok: true, dryRun: !!dryRun, actions });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.get("/debug/info", async (req, res) => {
  try {
    let block = null;
    try {
      block = await provider.getBlockNumber();
    } catch (e) {
      console.warn(
        "Provider blockNumber failed",
        e && e.message ? e.message : e
      );
    }
    // compute ABI functions defensively (some ethers Contract shapes can be unexpected)
    let abiFunctions = null;
    try {
      const dbg = getStampCardContract(provider);
      if (dbg && dbg.interface && dbg.interface.fragments) {
        abiFunctions = dbg.interface.fragments
          .filter((f) => f && f.type === "function")
          .map((f) => f.format());
      }
    } catch (e) {
      console.warn(
        "Could not enumerate contract.interface.functions:",
        e && e.message ? e.message : e
      );
      abiFunctions = null;
    }
    const contractAddr = getActiveStampcardAddress() || null;
    let contractCodeStatus = null;
    if (contractAddr) {
      try {
        const code = await provider.getCode(contractAddr);
        contractCodeStatus =
          code && code !== "0x" && code !== "0x0" ? "present" : "missing";
      } catch (e) {
        contractCodeStatus = "error:" + (e && e.message ? e.message : e);
      }
    }
    res.json({
      ok: true,
      blockNumber: block !== null ? Number(block) : null,
      rpcUrl: RPC_URL || null,
      contract: contractAddr,
      contractCodeStatus,
      wallet: wallet && wallet.address ? wallet.address : null,
      abiFunctions,
    });
  } catch (err) {
    console.error("Error in /debug/info", err && err.stack ? err.stack : err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Debug decrypt cafe by api key
app.get("/debug/cafe/:apiKey", (req, res) => {
  try {
    const apiKey = req.params.apiKey;
    const cafe = getCafeByApiKey.get(apiKey);
    if (!cafe) return res.status(404).json({ ok: false, error: "not_found" });
    let decrypted = null,
      error = null;
    if (cafe.encrypted_key) {
      try {
        decrypted = decryptPrivateKey(cafe.encrypted_key);
      } catch (e) {
        error = String(e && e.message ? e.message : e);
      }
    }
    res.json({
      ok: true,
      id: cafe.id,
      name: cafe.name,
      encrypted_key_len: cafe.encrypted_key ? cafe.encrypted_key.length : 0,
      decrypted_ok: !!decrypted,
      decrypt_error: error,
    });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.get("/debug/getStamps/:addr", async (req, res) => {
  const user = req.params.addr;
  if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
    return res.status(400).json({ error: "invalid user address" });
  }
  try {
    if (!wallet || !wallet.address) {
      return res.status(500).json({ error: "wallet_not_initialized" });
    }
    const contractAddr = getActiveStampcardAddress();
    if (!contractAddr)
      return res.status(500).json({ error: "no_contract_address" });
    const code = await provider.getCode(contractAddr);
    if (!code || code === "0x" || code === "0x0")
      return res
        .status(500)
        .json({ error: "no_contract_code", address: contractAddr });

    // Try to get cafe address from query or use server wallet as fallback
    const cafeAddr = req.query.cafe || wallet.address;
    const raw = await getStampCardContract(provider).getStamps(cafeAddr, user);
    // try to normalize
    let normalized = null;
    try {
      if (typeof raw === "bigint") normalized = Number(raw);
      else if (raw && typeof raw.toNumber === "function")
        normalized = raw.toNumber();
      else normalized = Number(raw);
    } catch (e) {
      normalized = String(raw);
    }
    res.json({
      ok: true,
      raw: typeof raw === "bigint" ? raw.toString() : raw,
      type: typeof raw,
      normalized,
      cafe: cafeAddr,
    });
  } catch (err) {
    console.error(
      "Error in /debug/getStamps",
      err && err.stack ? err.stack : err
    );
    res
      .status(500)
      .json({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
});

// Temporary: expose masked env for local debugging only
app.get("/debug/env", (req, res) => {
  const mask = (s) => (s ? s.replace(/.(?=.{4})/g, "*") : null);
  const activeStampcard = getActiveStampcardAddress();
  const fileStampcard =
    readEnvLocalValue("SEPOLIA_STAMPCARD_ADDRESS") ||
    readEnvLocalValue("STAMPCARD_ADDRESS");
  res.json({
    ok: true,
    rpcUrl: RPC_URL || null,
    stampcard: activeStampcard || null,
    stampcardFromFile: fileStampcard || null,
    cafeApiKeyMasked: mask(process.env.CAFE_API_KEY || null),
  });
});

app.post("/debug/sync/onchain", async (req, res) => {
  try {
    const blocksRaw = req.query?.blocks ?? req.query?.range ?? null;
    const blocks = blocksRaw != null ? Number(blocksRaw) : NaN;
    const maxBlocksPerRun =
      Number.isFinite(blocks) && blocks > 0 ? Math.floor(blocks) : 10;
    const chunksRaw = req.query?.chunks ?? null;
    const chunks = chunksRaw != null ? Number(chunksRaw) : NaN;
    const maxChunksPerRun =
      Number.isFinite(chunks) && chunks > 0 ? Math.floor(chunks) : 3;
    const result = await syncStampEventsFromChain({
      maxBlocksPerRun,
      maxChunksPerRun,
    });
    const ok = result && result.ok === false ? false : true;
    res.json({ ok, ...result, lastSyncedBlock: getLastSyncedBlock() });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Debug: compare DB vs on-chain stamps for a specific cafe+user
app.get("/debug/consistency", async (req, res) => {
  try {
    const cafe = String(req.query?.cafe || "").trim();
    const user = String(req.query?.user || "").trim();
    if (
      !/^0x[0-9a-fA-F]{40}$/.test(cafe) ||
      !/^0x[0-9a-fA-F]{40}$/.test(user)
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_or_invalid_cafe_or_user" });
    }

    const dbConfirmed = Number(
      countEventsByCafeUser.get(cafe, user)?.total ?? 0
    );
    const dbAll = db
      .prepare(
        "SELECT status, COALESCE(SUM(delta),0) as total FROM stamp_events WHERE LOWER(cafe)=LOWER(?) AND LOWER(user)=LOWER(?) GROUP BY status"
      )
      .all(cafe, user);

    let chain = null;
    try {
      const read = getStampCardContract(provider);
      const n = await read.getStamps(cafe, user);
      chain = Number(n);
    } catch (e) {
      chain = { error: String(e && e.message ? e.message : e) };
    }

    const recent = db
      .prepare(
        "SELECT id, ts, cafe, user, txhash, status, event_type, delta FROM stamp_events WHERE LOWER(cafe)=LOWER(?) AND LOWER(user)=LOWER(?) ORDER BY id DESC LIMIT 20"
      )
      .all(cafe, user);

    res.json({
      ok: true,
      cafe,
      user,
      chain,
      dbConfirmed,
      dbByStatus: dbAll,
      recent,
    });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Error handler: log raw body on JSON parse errors to help debugging malformed payloads
app.use((err, req, res, next) => {
  try {
    const isSyntax =
      err && (err instanceof SyntaxError || err.type === "entity.parse.failed");
    if (isSyntax) {
      console.error("JSON parse error on request:", req.method, req.url);
      console.error(
        "Raw request body (first 2000 chars):",
        req.rawBody ? req.rawBody.slice(0, 2000) : "<no rawBody>"
      );
    }
  } catch (e) {
    console.error("Error in JSON error logger:", e && e.stack ? e.stack : e);
  }
  next(err);
});

// Register a new cafe (creates a custodial wallet and returns an api_key)
// Protected by the legacy global CAFE_API_KEY so only an admin/script can create cafes.
app.post("/cafes/register", async (req, res) => {
  try {
    console.log("[DEBUG] /cafes/register request body:", req.body);
    const callerKey = req.headers["x-api-key"];
    if (!process.env.CAFE_API_KEY || callerKey !== process.env.CAFE_API_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const name =
      req.body && req.body.name ? String(req.body.name).slice(0, 128) : null;

    // create a random wallet for the cafe
    const newWallet = ethers.Wallet.createRandom();
    const priv = newWallet.privateKey; // 0x...
    const encrypted = encryptPrivateKey(priv);

    // api_key for the cafe (unguessable)
    const api_key = randomHex(16).slice(2); // 32 hex chars

    const info = {
      name: name,
      api_key: api_key,
      encrypted_key: encrypted,
      address: newWallet.address,
      password_hash: null,
      about_text: null,
      redeem_message: null,
      logo_mime: null,
      logo_data: null,
      updated_at: Date.now(),
      created_at: Date.now(),
    };
    const r = insertCafe.run(info);
    const id = r.lastInsertRowid || null;

    res.json({ ok: true, id, name, api_key, address: newWallet.address });
  } catch (err) {
    console.error(
      "Error in /cafes/register:",
      err && err.stack ? err.stack : err
    );
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// Self-service cafe registration: client supplies a keystore JSON (encrypted with a password)
// Server stores the provided keystore as `encrypted_key` and returns an api_key.
// Register cafe with email notification and configuration
// Café Login (with password)
app.post("/cafes/login", async (req, res) => {
  try {
    const { name, apiKey, password } = req.body || {};

    if (!name && !apiKey) {
      return res.status(400).json({ error: "Name oder API-Key erforderlich" });
    }

    // Find cafe by API-Key or Name
    let cafe;
    if (apiKey) {
      cafe = getCafeByApiKey.get(apiKey);
      if (!cafe) {
        return res.status(401).json({ error: "API-Key nicht gefunden" });
      }
    } else {
      cafe = getCafeByName.get(name);
      if (!cafe) {
        return res.status(401).json({ error: "Café nicht gefunden" });
      }
    }

    // If a cafe has no password configured (e.g., created via /cafes/register),
    // allow API-key-only login.
    if (cafe.password_hash) {
      if (!password) {
        return res.status(400).json({ error: "Passwort erforderlich" });
      }

      const passwordValid = await bcrypt.compare(password, cafe.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: "Falsches Passwort" });
      }
    } else {
      // Without a configured password, only API-key login is permitted.
      if (!apiKey) {
        return res.status(401).json({
          error:
            "Passwort nicht konfiguriert. Bitte nutze den API-Key oder kontaktiere den Administrator.",
        });
      }
    }

    // Return cafe info (without sensitive data)
    res.json({
      ok: true,
      id: cafe.id,
      name: cafe.name,
      apiKey: cafe.api_key,
      address: cafe.address,
      created_at: cafe.created_at,
    });
  } catch (err) {
    console.error("Error in /cafes/login:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/cafes/register-with-email", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      stampMode,
      stampsForReward,
      rewardDescription,
      products,
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: "missing required fields" });
    }

    // Create new wallet
    const newWallet = ethers.Wallet.createRandom();
    const privateKey = newWallet.privateKey;
    const address = newWallet.address;
    const seedPhrase = newWallet.mnemonic.phrase;

    // Encrypt private key
    const encrypted_key = encryptPrivateKey(privateKey);

    // Generate API key
    const api_key = randomHex(16).slice(2);

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Store cafe configuration
    const config = {
      stampMode: stampMode || "general",
      stampsForReward: stampsForReward || 10,
      rewardDescription: rewardDescription || "1 Freigetränk",
      products: products || [],
    };

    const info = {
      name: String(name).slice(0, 128),
      api_key,
      encrypted_key,
      address,
      password_hash,
      about_text: null,
      redeem_message: null,
      logo_mime: null,
      logo_data: null,
      updated_at: Date.now(),
      created_at: Date.now(),
    };

    const r = insertCafe.run(info);
    const id = r.lastInsertRowid || null;

    console.log(`\n🎉 New Café Registered: ${name}`);
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 API-Key: ${api_key}`);
    console.log(`📍 Address: ${address}`);

    // Send email with credentials
    try {
      await sendCafeCredentialsEmail({
        email,
        cafeName: name,
        apiKey: api_key,
        address,
        seedPhrase,
        config,
      });
      console.log(`✅ Email sent to: ${email}\n`);
    } catch (emailErr) {
      console.error(`❌ Failed to send email to ${email}:`, emailErr.message);
      // Don't fail the registration if email fails
    }

    res.json({
      ok: true,
      id,
      name: info.name,
      apiKey: api_key,
      address,
      seedPhrase,
    });
  } catch (err) {
    console.error("Error in /cafes/register-with-email:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/cafes/register-self", async (req, res) => {
  try {
    const { name, keystore } = req.body || {};
    if (!keystore) return res.status(400).json({ error: "missing keystore" });

    // try to extract address from keystore JSON if present
    let address = null;
    try {
      const ks = typeof keystore === "string" ? JSON.parse(keystore) : keystore;
      if (ks && ks.address) {
        let a = String(ks.address || "");
        if (a && !a.startsWith("0x")) a = "0x" + a;
        address = a.toLowerCase();
      }
    } catch (e) {
      // ignore parse errors
    }

    const api_key = randomHex(16).slice(2);
    const info = {
      name: name ? String(name).slice(0, 128) : null,
      api_key,
      encrypted_key:
        typeof keystore === "string" ? keystore : JSON.stringify(keystore),
      address,
      password_hash: null,
      about_text: null,
      redeem_message: null,
      logo_mime: null,
      logo_data: null,
      updated_at: Date.now(),
      created_at: Date.now(),
    };
    const r = insertCafe.run(info);
    const id = r.lastInsertRowid || null;

    res.json({ ok: true, id, name: info.name, api_key, address });
  } catch (err) {
    console.error(
      "Error in /cafes/register-self:",
      err && err.stack ? err.stack : err
    );
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// Dev-only: list cafes (non-sensitive preview)
app.get("/cafes", (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, name, api_key, encrypted_key, created_at FROM cafes ORDER BY id DESC"
      )
      .all();

    // Decrypt and add wallet addresses
    const rowsWithAddress = rows.map((row) => {
      let address = null;
      if (row.encrypted_key) {
        try {
          const priv = decryptPrivateKey(row.encrypted_key);
          const wallet = new ethers.Wallet(priv);
          address = wallet.address;
        } catch (e) {
          // Could not decrypt, leave address null
        }
      }
      return { ...row, address };
    });

    res.json(rowsWithAddress);
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Public café list (safe for customer-facing apps)
app.get("/cafes/public", (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, name, address, encrypted_key, about_text, logo_data, created_at, updated_at FROM cafes ORDER BY id DESC"
      )
      .all();

    const cafes = rows
      .map((row) => {
        let address = row.address || null;
        if (!address && row.encrypted_key) {
          try {
            const priv = decryptPrivateKey(row.encrypted_key);
            const wallet = new ethers.Wallet(priv);
            address = wallet.address;
          } catch (e) {
            address = null;
          }
        }
        return {
          id: row.id,
          name: row.name || null,
          address,
          about: row.about_text ? String(row.about_text).slice(0, 280) : null,
          hasLogo: !!(row.logo_data && String(row.logo_data).length),
          createdAt: row.created_at != null ? Number(row.created_at) : null,
          updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
        };
      })
      .filter((c) => c.address);

    res.json({ ok: true, cafes });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Public café profile (full about + logo) for customer-facing apps
app.get("/cafes/public/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "invalid_cafe_id" });
    }

    const row = db
      .prepare(
        "SELECT id, name, address, encrypted_key, about_text, redeem_message, logo_mime, logo_data, created_at, updated_at FROM cafes WHERE id = ?"
      )
      .get(id);

    if (!row) {
      return res.status(404).json({ ok: false, error: "cafe_not_found" });
    }

    let address = row.address || null;
    if (!address && row.encrypted_key) {
      try {
        const priv = decryptPrivateKey(row.encrypted_key);
        const wallet = new ethers.Wallet(priv);
        address = wallet.address;
      } catch (e) {
        address = null;
      }
    }

    res.json({
      ok: true,
      cafe: {
        id: row.id,
        name: row.name || null,
        address,
        about: row.about_text || null,
        redeemMessage: row.redeem_message || null,
        logoDataUrl:
          row.logo_data && row.logo_mime
            ? `data:${row.logo_mime};base64,${row.logo_data}`
            : null,
        createdAt: row.created_at != null ? Number(row.created_at) : null,
        updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
      },
    });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Register a customer (server-generated wallet, custodial backup encrypted with MASTER_KEY)
app.get("/customers/:customerAddress/cards", (req, res) => {
  try {
    const rawAddress = req.params?.customerAddress || "";
    const address = rawAddress.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) {
      return res.status(400).json({ error: "invalid_customer_address" });
    }

    const eventsPerCafe = Math.min(
      Math.max(Number(req.query?.eventsPerCafe) || 5, 1),
      20
    );

    const aggregates = db
      .prepare(
        `SELECT
           cafe,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           SUM(delta) AS net_stamps,
           COUNT(*) AS total_events,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts,
           MAX(CASE WHEN customer_name IS NOT NULL AND customer_name != '' THEN customer_name ELSE NULL END) AS customer_name
         FROM stamp_events
         WHERE LOWER(user) = ?
         GROUP BY cafe`
      )
      .all(address);

    if (!aggregates.length) {
      return res.json({
        ok: true,
        customer: {
          address: rawAddress,
          name: null,
        },
        cards: [],
        meta: { eventsPerCafe, generatedAt: Date.now() },
      });
    }

    const cafesByAddress = new Map();
    try {
      const cafeRows = db
        .prepare(
          "SELECT id, name, address FROM cafes WHERE address IS NOT NULL"
        )
        .all();
      for (const cafe of cafeRows) {
        if (!cafe.address) continue;
        cafesByAddress.set(cafe.address.toLowerCase(), cafe);
      }
    } catch (err) {
      console.warn("Could not load cafe metadata for cards summary:", err);
    }

    const eventsLimit = Math.min(eventsPerCafe * aggregates.length, 200);
    const rawEvents = db
      .prepare(
        "SELECT id, ts, cafe, user, customer_name, txhash, event_type, delta FROM stamp_events WHERE LOWER(user) = ? ORDER BY ts DESC LIMIT ?"
      )
      .all(address, eventsLimit);

    const cardsByCafe = new Map();

    for (const agg of aggregates) {
      const cafeAddr = (agg.cafe || "").toLowerCase();
      const cafeInfo = cafesByAddress.get(cafeAddr) || null;
      const card = {
        cafeAddress: agg.cafe || null,
        cafeName: cafeInfo?.name || null,
        cafeId: cafeInfo?.id || null,
        stats: {
          stampsAwarded: Number(agg.stamps_awarded || 0),
          stampsRedeemed: Number(agg.stamps_redeemed || 0),
          redemptions: Number(agg.redemptions || 0),
          netStamps: Number(agg.net_stamps || 0),
          totalEvents: Number(agg.total_events || 0),
          lastActivityTs:
            agg.last_activity_ts != null ? Number(agg.last_activity_ts) : null,
          lastStampTs:
            agg.last_stamp_ts != null ? Number(agg.last_stamp_ts) : null,
          lastRedeemTs:
            agg.last_redeem_ts != null ? Number(agg.last_redeem_ts) : null,
        },
        recentEvents: [],
      };
      cardsByCafe.set(cafeAddr, card);
    }

    for (const ev of rawEvents) {
      const cafeAddr = (ev.cafe || "").toLowerCase();
      const card = cardsByCafe.get(cafeAddr);
      if (!card) continue;
      if (card.recentEvents.length >= eventsPerCafe) continue;
      const summary = toEventSummary(ev);
      if (summary) {
        card.recentEvents.push(summary);
      }
    }

    const cards = Array.from(cardsByCafe.values()).sort((a, b) => {
      const bTs = b.stats.lastActivityTs || 0;
      const aTs = a.stats.lastActivityTs || 0;
      if (bTs !== aTs) return bTs - aTs;
      return (b.cafeName || "").localeCompare(a.cafeName || "");
    });

    const primaryName =
      aggregates.find((agg) => agg.customer_name)?.customer_name || null;

    res.json({
      ok: true,
      customer: {
        address: rawAddress,
        name: primaryName,
      },
      cards,
      meta: {
        eventsPerCafe,
        fetchedEvents: rawEvents.length,
        generatedAt: Date.now(),
      },
    });
  } catch (err) {
    console.error("Error in /customers/:customerAddress/cards:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.post("/customers/register", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const uname = username != null ? String(username).trim() : "";
    const em = email != null ? String(email).trim() : "";
    const pw = password != null ? String(password) : "";

    if (!uname || uname.length < 2) {
      return res.status(400).json({ error: "invalid_username" });
    }
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      return res.status(400).json({ error: "invalid_email" });
    }

    if (!pw || pw.length < 6) {
      return res.status(400).json({ error: "invalid_password" });
    }

    // If email already exists: treat as login (requires password)
    const existing = getCustomerAuthByEmail.get(em);
    if (existing && existing.address) {
      if (existing.password_hash) {
        const okPw = await bcrypt.compare(pw, existing.password_hash);
        if (!okPw) return res.status(401).json({ error: "wrong_password" });
      } else {
        // Legacy account: allow first-time password set
        const newHash = await bcrypt.hash(pw, 10);
        setCustomerPasswordHashById.run(newHash, existing.id);
      }

      return res.json({
        ok: true,
        existed: true,
        customer_id: existing.customer_id,
        username: existing.username || uname,
        email: existing.email || em,
        address: existing.address,
        createdAt: existing.created_at || null,
      });
    }

    const customer_id = randomHex(8).slice(2);

    // create wallet for customer
    const newWallet = ethers.Wallet.createRandom();
    const seedPhrase =
      newWallet && newWallet.mnemonic && newWallet.mnemonic.phrase
        ? newWallet.mnemonic.phrase
        : null;
    const priv = newWallet.privateKey; // 0x...
    const encrypted = encryptPrivateKey(priv);

    const password_hash = await bcrypt.hash(pw, 10);

    const info = {
      customer_id: customer_id,
      username: uname,
      email: em,
      address: newWallet.address,
      encrypted_key: encrypted,
      password_hash,
      created_at: Date.now(),
    };
    insertCustomer.run(info);

    res.json({
      ok: true,
      customer_id,
      address: newWallet.address,
      username: uname,
      email: em,
      createdAt: info.created_at,
      seedPhrase,
    });
  } catch (err) {
    console.error(
      "Error in /customers/register:",
      err && err.stack ? err.stack : err
    );
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.post("/customers/login", (req, res) => {
  try {
    const { email, password } = req.body || {};
    const em = email != null ? String(email).trim() : "";
    const pw = password != null ? String(password) : "";
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!pw) {
      return res.status(400).json({ error: "invalid_password" });
    }

    const row = getCustomerAuthByEmail.get(em);
    if (!row) return res.status(404).json({ error: "not_found" });

    if (!row.password_hash) {
      return res.status(401).json({ error: "password_not_set" });
    }

    bcrypt
      .compare(pw, row.password_hash)
      .then((okPw) => {
        if (!okPw) return res.status(401).json({ error: "wrong_password" });
        res.json({
          ok: true,
          customer_id: row.customer_id,
          username: row.username || null,
          email: row.email || em,
          address: row.address,
          createdAt: row.created_at || null,
        });
      })
      .catch((e) => {
        res.status(500).json({ error: String(e && e.message ? e.message : e) });
      });
    return;
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// Get customer by customer_id (dev/debug)
app.get("/customers/:cid", (req, res) => {
  try {
    const cid = req.params && req.params.cid;
    if (!cid) return res.status(400).json({ error: "missing customer id" });
    const row = db
      .prepare(
        "SELECT id, customer_id, username, email, address, substr(encrypted_key,1,48) as encrypted_preview, created_at FROM customers WHERE customer_id = ?"
      )
      .get(cid);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// Dev helper: list registered routes (dev-only)
app.get("/debug/routes", (req, res) => {
  try {
    const routes = [];
    const router = (app && (app._router || app.router)) || null;
    const stack = (router && router.stack) || [];

    stack.forEach((layer) => {
      if (layer && layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {})
          .map((m) => m.toUpperCase())
          .join(",");
        routes.push({ path: layer.route.path, methods });
      }
    });
    res.json({ ok: true, routes });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

const PORT = Number(process.env.PORT || 3000);

// Wichtig: 0.0.0.0 bindet sowohl localhost als auch andere Adapter
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API listening on http://127.0.0.1:${PORT}`);

  // Print registered routes for easy debugging at startup
  try {
    const routes = [];
    if (app && app._router && app._router.stack) {
      app._router.stack.forEach((layer) => {
        if (layer.route && layer.route.path) {
          const methods = Object.keys(layer.route.methods || {})
            .map((m) => m.toUpperCase())
            .join(",");
          routes.push({ path: layer.route.path, methods });
        }
      });
    }
    console.log("Registered routes:", JSON.stringify(routes, null, 2));
  } catch (e) {
    console.warn(
      "Could not enumerate routes at startup:",
      e && e.message ? e.message : e
    );
  }
});
