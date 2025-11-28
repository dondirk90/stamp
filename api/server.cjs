const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const { ethers, verifyTypedData } = require("ethers");
const crypto = require("crypto");
const util = require("util");
const nodemailer = require("nodemailer");

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
  txhash TEXT NOT NULL
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
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT UNIQUE,
  address TEXT,
  encrypted_key TEXT,
  created_at INTEGER
);
`);

// Prepare statements
const insertEvent = db.prepare(
  "INSERT INTO stamp_events (ts, cafe, user, customer_name, txhash) VALUES (@ts, @cafe, @user, @customer_name, @txhash)"
);
const listEvents = db.prepare(
  "SELECT * FROM stamp_events ORDER BY id DESC LIMIT 50"
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
  "INSERT INTO cafes (name, api_key, encrypted_key, created_at) VALUES (@name, @api_key, @encrypted_key, @created_at)"
);
const getCafeByApiKey = db.prepare("SELECT * FROM cafes WHERE api_key = ?");
const getCafeById = db.prepare("SELECT * FROM cafes WHERE id = ?");

// Customers prepared statements
const insertCustomer = db.prepare(
  "INSERT INTO customers (customer_id, address, encrypted_key, created_at) VALUES (@customer_id, @address, @encrypted_key, @created_at)"
);
const listCustomers = db.prepare("SELECT * FROM customers ORDER BY id DESC");

// === Express setup ===
const express = require("express");
const app = express();
// Capture raw request body for debugging JSON parse errors (verify option)
app.use(
  express.json({
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
const contract = new ethers.Contract(
  process.env.STAMPCARD_ADDRESS,
  stampCardJson.abi,
  wallet
);

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
      chainId: net.chainId,
      blockNumber,
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
    const tx = await contract.addStamp(customer);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed");

    // Speichere Event und broadcast für SSE-Clients
    const ev = {
      ts: Date.now(),
      cafe: wallet.address,
      user: customer,
      txhash: tx.hash,
    };
    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    console.error("Error in /stamp:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempel direkt durch das Café (API-Key required)
app.post("/stamp-by-cafe", requireApiKey, async (req, res) => {
  console.log("[DEBUG] /stamp-by-cafe reached");
  try {
    const { customer, count, customerName } = req.body || {};
    const cnt = Math.max(1, Math.min(20, Number(count || 1)));

    if (!customer || !/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    // Ensure requireApiKey attached a cafe wallet to the request
    if (!req.cafeWallet) {
      console.error(
        "No cafe wallet available on request (missing or not decrypted)"
      );
      return res.status(500).json({ error: "no_cafe_wallet" });
    }

    const signer = req.cafeWallet;
    const cafeAddress = req.cafeAddress || (signer && signer.address) || null;
    // Create a contract instance bound to the cafe's signer so the txs are signed by the cafe
    const cafeContract = new ethers.Contract(
      process.env.STAMPCARD_ADDRESS,
      stampCardJson.abi,
      signer
    );

    let tx,
      txHashes = [];
    if (cnt === 1) {
      console.log(`Cafe ${cafeAddress} awarding 1 stamp to ${customer}`);
      tx = await cafeContract.addStamp(customer);
      console.log("sent tx", tx.hash);
      await tx.wait();
      const ev = {
        ts: Date.now(),
        cafe: cafeAddress,
        customer_name: customerName || null,
        user: customer,
        txhash: tx.hash,
      };
      insertEvent.run(ev);
      try {
        broadcastEvent(ev);
      } catch (e) {}
      txHashes.push(tx.hash);
    } else {
      console.log(
        `Cafe ${cafeAddress} awarding ${cnt} stamps to ${customer} in one tx`
      );
      tx = await cafeContract.addStamps(customer, cnt);
      console.log("sent tx", tx.hash);
      await tx.wait();
      const ev = {
        ts: Date.now(),
        cafe: cafeAddress,
        customer_name: customerName || null,
        user: customer,
        txhash: tx.hash,
      };
      insertEvent.run(ev);
      try {
        broadcastEvent(ev);
      } catch (e) {}
      txHashes.push(tx.hash);
    }

    res.json({ success: true, count: cnt, txHashes: txHashes });
  } catch (err) {
    console.error("Error in /stamp-by-cafe:", err);
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

    // If specific cafe requested, get stamps from that cafe only
    if (cafeAddress && /^0x[0-9a-fA-F]{40}$/i.test(cafeAddress)) {
      const count = await contract.getStamps(cafeAddress, user);
      stamps =
        typeof count === "bigint"
          ? Number(count)
          : count?.toNumber
          ? count.toNumber()
          : Number(count);
      return res.json({ cafe: cafeAddress, user, stamps });
    }

    // Otherwise, sum stamps across all cafes
    const allCafes = db
      .prepare("SELECT address, api_key, encrypted_key FROM cafes")
      .all();
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
          const count = await contract.getStamps(cafeAddr, user);
          const num =
            typeof count === "bigint"
              ? Number(count)
              : count?.toNumber
              ? count.toNumber()
              : Number(count);
          stamps += num;
        }
      } catch (e) {
        console.warn(
          `Error getting stamps for cafe ${cafe.api_key}:`,
          e.message
        );
      }
    }

    res.json({ user, stamps, note: "total_across_all_cafes" });
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
        cafe: wallet && wallet.address ? wallet.address : null,
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
        "SELECT * FROM stamp_events WHERE user = ? ORDER BY ts DESC LIMIT 50"
      )
      .all(addr);

    res.json(events);
  } catch (err) {
    console.error("Error fetching stamp history:", err);
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

// --- Temporary debug endpoints ---
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
      if (
        contract &&
        contract.interface &&
        contract.interface.functions &&
        typeof contract.interface.functions === "object"
      ) {
        abiFunctions = Object.keys(contract.interface.functions);
      }
    } catch (e) {
      console.warn(
        "Could not enumerate contract.interface.functions:",
        e && e.message ? e.message : e
      );
      abiFunctions = null;
    }
    const contractAddr = process.env.STAMPCARD_ADDRESS || null;
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
    const contractAddr = process.env.STAMPCARD_ADDRESS;
    if (!contractAddr)
      return res.status(500).json({ error: "no_contract_address" });
    const code = await provider.getCode(contractAddr);
    if (!code || code === "0x" || code === "0x0")
      return res
        .status(500)
        .json({ error: "no_contract_code", address: contractAddr });

    // Try to get cafe address from query or use server wallet as fallback
    const cafeAddr = req.query.cafe || wallet.address;
    const raw = await contract.getStamps(cafeAddr, user);
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
      raw: raw,
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
  res.json({
    ok: true,
    rpcUrl: RPC_URL || null,
    stampcard: process.env.STAMPCARD_ADDRESS || null,
    cafeApiKeyMasked: mask(process.env.CAFE_API_KEY || null),
  });
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

// Register a customer (server-generated wallet, custodial backup encrypted with MASTER_KEY)
app.post("/customers/register", async (req, res) => {
  try {
    const { name, email } = req.body || {};
    const customer_id = randomHex(8).slice(2);

    // create wallet for customer
    const newWallet = ethers.Wallet.createRandom();
    const priv = newWallet.privateKey; // 0x...
    const encrypted = encryptPrivateKey(priv);

    const info = {
      customer_id: customer_id,
      address: newWallet.address,
      encrypted_key: encrypted,
      created_at: Date.now(),
    };
    insertCustomer.run(info);

    res.json({
      ok: true,
      customer_id,
      address: newWallet.address,
      name: name || null,
      email: email || null,
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

// Get customer by customer_id (dev/debug)
app.get("/customers/:cid", (req, res) => {
  try {
    const cid = req.params && req.params.cid;
    if (!cid) return res.status(400).json({ error: "missing customer id" });
    const row = db
      .prepare(
        "SELECT id, customer_id, address, substr(encrypted_key,1,48) as encrypted_preview, created_at FROM customers WHERE customer_id = ?"
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
