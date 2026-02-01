const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
const crypto = require("crypto");
const util = require("util");
const https = require("https");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  // Entfernt BOM, Whitespaces, CRLF
  return v.replace(/^\uFEFF/, "").trim();
}

// === Constants & Config ===
// Admin-only shared secret for optional admin endpoints.
// Backwards compatible with older env var names.
const ADMIN_TOKEN =
  sanitizeEnv("ADMIN_TOKEN") ||
  sanitizeEnv("ADMIN_API_KEY") ||
  sanitizeEnv("ADMIN_DASHBOARD_KEY");

function randomHex(bytes) {
  return "0x" + crypto.randomBytes(bytes).toString("hex");
}

function randomAddress() {
  // Generates an Ethereum-looking address used purely as an identifier.
  // No private keys are stored; the system runs fully off-chain.
  return "0x" + crypto.randomBytes(20).toString("hex");
}

function ensureCafeAddress(row) {
  if (!row) return null;
  if (row.address && /^0x[0-9a-fA-F]{40}$/.test(row.address)) {
    return row.address;
  }
  return null;
}

function toEventSummary(row) {
  if (!row) return null;
  const delta = Number(row.delta || 0);
  return {
    id: row.id,
    timestamp: row.ts != null ? Number(row.ts) : null,
    customer: row.user || null,
    customerName: row.customer_name || null,
    eventType: row.event_type || (delta < 0 ? "redeem" : "stamp"),
    delta,
    status: row.status || "confirmed",
    hasExplorer: false,
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
    explorerUrl: null,
  };
}

// harte Checks mit hilfreichem Log
// NOTE: This project now runs fully off-chain; no RPC/contract keys required.

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
  locationAddress,
  config,
}) {
  const appsBaseUrl = (
    process.env.APPS_BASE_URL || "http://localhost:8080"
  ).replace(/\/$/, "");
  const loginUrl = `${appsBaseUrl}/cafe-onboarding`;
  const scannerUrl = `${appsBaseUrl}/cafe-scanner`;

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
              <div class="credential-label">🔐 Anmeldung</div>
              <div class="credential-value">E-Mail + Passwort</div>
            </div>

            <div class="credential-box">
              <div class="credential-label">🗺️ Standort-Adresse</div>
              <div class="credential-value">${
                locationAddress ? locationAddress : "(nicht angegeben)"
              }</div>
            </div>
            
            <div class="warning">
              <strong>⚠️ Hinweis</strong><br>
              Melde dich mit deiner E-Mail und deinem Passwort an. Teile dein Passwort nicht.
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
              <a href="${loginUrl}" class="button">🔐 Zum Login</a>
            </center>

            <p style="margin-top: 10px; color: #666; font-size: 0.9em; text-align:center;">
              Nach dem Login kannst du direkt zum Scanner: <a href="${scannerUrl}">${scannerUrl}</a>
            </p>
            
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
Standort-Adresse: ${locationAddress ? locationAddress : "(nicht angegeben)"}

⚠️ Hinweis: Melde dich mit E-Mail + Passwort an.

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

Login: ${loginUrl}
Scanner (nach Login): ${scannerUrl}

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

CREATE TABLE IF NOT EXISTS redeem_tokens (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  cafe TEXT,
  user TEXT,
  used_by_cafe TEXT,
  used_txhash TEXT
);

CREATE TABLE IF NOT EXISTS cafes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  api_key TEXT UNIQUE,
  encrypted_key TEXT,
  address TEXT,
  location_address TEXT,
  street TEXT,
  house_number TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT,
  lat REAL,
  lng REAL,
  password_hash TEXT,
  about_text TEXT,
  redeem_message TEXT,
  logo_mime TEXT,
  logo_data TEXT,
  updated_at INTEGER,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS cafe_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
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
  db.prepare("ALTER TABLE cafes ADD COLUMN email TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.email column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN location_address TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn(
      "Failed to add cafes.location_address column:",
      e.message || e
    );
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN street TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.street column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN house_number TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.house_number column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN postal_code TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.postal_code column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN city TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.city column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN country TEXT").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.country column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN lat REAL").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.lat column:", e.message || e);
  }
}
try {
  db.prepare("ALTER TABLE cafes ADD COLUMN lng REAL").run();
} catch (e) {
  if (!/duplicate column/i.test(e.message || "")) {
    console.warn("Failed to add cafes.lng column:", e.message || e);
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
const countEventsByUser = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(user) = LOWER(?) AND status = 'confirmed'"
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

const getRedeemToken = db.prepare(
  "SELECT * FROM redeem_tokens WHERE token = ?"
);
const insertRedeemToken = db.prepare(
  "INSERT INTO redeem_tokens (token, created_at) VALUES (?, ?)"
);
const deleteRedeemTokenIfUnused = db.prepare(
  "DELETE FROM redeem_tokens WHERE token = ? AND used_at IS NULL"
);
const markRedeemTokenUsed = db.prepare(
  "UPDATE redeem_tokens SET used_at = ?, cafe = ?, user = ?, used_by_cafe = ?, used_txhash = ? WHERE token = ? AND used_at IS NULL"
);

// Cafes prepared statements
const insertCafe = db.prepare(
  "INSERT INTO cafes (name, email, address, location_address, street, house_number, postal_code, city, country, lat, lng, password_hash, about_text, redeem_message, logo_mime, logo_data, updated_at, created_at) VALUES (@name, @email, @address, @location_address, @street, @house_number, @postal_code, @city, @country, @lat, @lng, @password_hash, @about_text, @redeem_message, @logo_mime, @logo_data, @updated_at, @created_at)"
);
const getCafeById = db.prepare("SELECT * FROM cafes WHERE id = ?");
const getCafeByName = db.prepare(
  "SELECT * FROM cafes WHERE name = ? COLLATE NOCASE"
);

const getCafeAuthByEmail = db.prepare(
  "SELECT * FROM cafes WHERE LOWER(email) = LOWER(?) LIMIT 1"
);

const insertCafeSession = db.prepare(
  "INSERT INTO cafe_sessions (cafe_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
);
const getCafeSessionByHash = db.prepare(
  "SELECT * FROM cafe_sessions WHERE token_hash = ? LIMIT 1"
);
const deleteCafeSessionByHash = db.prepare(
  "DELETE FROM cafe_sessions WHERE token_hash = ?"
);

const updateCafeProfileById = db.prepare(
  "UPDATE cafes SET about_text = ?, redeem_message = ?, logo_mime = ?, logo_data = ?, location_address = ?, lat = ?, lng = ?, updated_at = ? WHERE id = ?"
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

// === Off-chain mode ===
// This server no longer depends on RPC/ethers/contract wiring.
// Existing DB rows may still contain legacy on-chain tx hashes; those are treated as opaque identifiers.
const provider = null;
const wallet = null;

// === Café Auth (Email+Passwort Login -> Bearer Token Session) ===
function requireCafeAuth(req, res, next) {
  try {
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    const raw = auth ? String(auth) : "";
    const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
    const token = m && m[1] ? String(m[1]).trim() : "";
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = getCafeSessionByHash.get(tokenHash);
    if (!session) return res.status(401).json({ error: "unauthorized" });

    const now = Date.now();
    const expiresAt =
      session.expires_at != null ? Number(session.expires_at) : 0;
    if (!expiresAt || now > expiresAt) {
      try {
        deleteCafeSessionByHash.run(tokenHash);
      } catch (e) {}
      return res.status(401).json({ error: "session_expired" });
    }

    const cafe = getCafeById.get(session.cafe_id);
    if (!cafe) return res.status(401).json({ error: "unauthorized" });

    req.cafe = cafe;
    req.cafeSession = session;
    return next();
  } catch (e) {
    console.error("Auth error:", e && e.stack ? e.stack : e);
    return res.status(401).json({ error: "unauthorized" });
  }
}

function buildLocationAddress({
  street,
  houseNumber,
  postalCode,
  city,
  country,
}) {
  const parts = [];
  const streetLine = [street, houseNumber].filter(Boolean).join(" ").trim();
  const cityLine = [postalCode, city].filter(Boolean).join(" ").trim();
  const countryLine = country ? String(country).trim() : "";
  if (streetLine) parts.push(streetLine);
  if (cityLine) parts.push(cityLine);
  if (countryLine) parts.push(countryLine);
  return parts.join(", ") || null;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function httpGetJson(url, timeoutMs = 5000) {
  if (typeof fetch === "function") {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "stampcard/1.0 (address validation)",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  return await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "stampcard/1.0 (address validation)",
          Accept: "application/json",
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) {
            return reject(new Error(`http_${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

async function validateAddressExists({
  street,
  houseNumber,
  postalCode,
  city,
  country,
}) {
  const skip =
    String(process.env.SKIP_ADDRESS_VALIDATION || "").toLowerCase() === "true";
  if (skip) {
    return { ok: true, provider: "skipped", lat: null, lng: null };
  }

  const base = (
    process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org"
  ).replace(/\/$/, "");
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    addressdetails: "1",
  });
  if (street || houseNumber) {
    params.set("street", [street, houseNumber].filter(Boolean).join(" "));
  }
  if (postalCode) params.set("postalcode", String(postalCode));
  if (city) params.set("city", String(city));
  if (country) params.set("country", String(country));

  const url = `${base}/search?${params.toString()}`;
  const results = await httpGetJson(url, 6000);
  const first = Array.isArray(results) ? results[0] : null;
  const lat = first && first.lat != null ? Number(first.lat) : null;
  const lng = first && first.lon != null ? Number(first.lon) : null;
  const ok = Number.isFinite(lat) && Number.isFinite(lng);
  return {
    ok,
    provider: "nominatim",
    lat: ok ? lat : null,
    lng: ok ? lng : null,
  };
}

function requireAdminKey(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ error: "admin_key_not_configured" });
  }

  const providedRaw =
    req.headers["x-admin-key"] || req.query?.adminKey || req.query?.key || null;
  const provided = providedRaw ? String(providedRaw).trim() : "";

  if (provided && provided === ADMIN_TOKEN) {
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
  res.json({
    ok: true,
    mode: "offchain",
    note: "Off-chain: SQLite ledger is source of truth",
  });
});

// QR Code für Stempel ausstellen (Café-Rolle)
app.post("/qr/issue", requireCafeAuth, async (req, res) => {
  try {
    const cafeId = ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");
    if (!cafeId) return res.status(500).json({ error: "missing_cafe_context" });
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

// Stempel vergeben (off-chain, via server-issued QR nonce)
app.post("/stamp", async (req, res) => {
  try {
    console.log("POST /stamp received:", req.body);
    const { cafeId, nonce, expires, customer } = req.body || {};

    // Validiere Input
    if (!cafeId || !nonce || !expires || !customer) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    // Prüfe Nonce
    const nonceRecord = getNonce.get(nonce);
    if (!nonceRecord) {
      return res.status(400).json({ error: "Invalid or used nonce" });
    }
    if (
      String(nonceRecord.cafe_id || "").toLowerCase() !==
      String(cafeId || "").toLowerCase()
    ) {
      return res.status(400).json({ error: "CafeId mismatch" });
    }
    if (Math.floor(Date.now() / 1000) > nonceRecord.expires) {
      return res.status(400).json({ error: "QR code expired" });
    }

    // Off-chain mode: no signature verification (QR nonce is single-use + short-lived)

    // Markiere Nonce als verwendet BEVOR wir die Chain-Transaktion senden
    consumeNonce.run(Date.now(), nonce);

    const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;

    // Speichere Event und broadcast für SSE-Clients
    const ev = {
      ts: Date.now(),
      cafe: String(cafeId),
      user: customer,
      txhash: localTx,
      status: "confirmed",
      event_type: "stamp",
      delta: 1,
    };
    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    res.json({ success: true, status: "confirmed", txHash: localTx });
  } catch (err) {
    console.error("Error in /stamp:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Stempel direkt durch das Café (Bearer Token required)
app.post("/stamp-by-cafe", requireCafeAuth, async (req, res) => {
  console.log("[DEBUG] /stamp-by-cafe reached");
  try {
    const { customer, count, customerName, qrCafe } = req.body || {};
    const cnt = Math.max(1, Math.min(20, Number(count || 1)));

    if (!customer || !/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    const cafeAddress =
      ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");
    if (!cafeAddress)
      return res.status(500).json({ error: "missing_cafe_context" });

    if (
      qrCafe != null &&
      String(qrCafe).toLowerCase() !== String(cafeAddress).toLowerCase()
    ) {
      return res.status(403).json({
        error: "wrong_cafe",
        expected: cafeAddress,
        provided: qrCafe,
        message:
          "Dieser QR-Code gehört zu einem anderen Café. Bitte mit dem korrekten Konto anmelden.",
      });
    }

    const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;

    const ev = {
      ts: Date.now(),
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: localTx,
      status: "confirmed",
      event_type: "stamp",
      delta: cnt,
    };
    insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    res.json({
      success: true,
      status: "confirmed",
      count: cnt,
      txHash: localTx,
    });
  } catch (err) {
    console.error("Error in /stamp-by-cafe:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Redeem reward (café scans customer redemption QR)
app.post("/redeem-reward", requireCafeAuth, async (req, res) => {
  console.log("[DEBUG] /redeem-reward reached");
  try {
    const { customer, customerName, qrCafe, redeemToken } = req.body || {};

    if (!customer || !/^0x[0-9a-fA-F]{40}$/.test(customer)) {
      return res.status(400).json({ error: "invalid customer address" });
    }

    const cafeAddress =
      ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");
    if (!cafeAddress)
      return res.status(500).json({ error: "missing_cafe_context" });

    if (
      qrCafe != null &&
      String(qrCafe).toLowerCase() !== String(cafeAddress).toLowerCase()
    ) {
      return res.status(403).json({
        error: "wrong_cafe",
        expected: cafeAddress,
        provided: qrCafe,
        message:
          "Dieser Einlöse-QR gehört zu einem anderen Café. Bitte mit dem passenden Konto anmelden.",
      });
    }

    const rt = redeemToken != null ? String(redeemToken).trim() : "";
    if (!rt) {
      return res.status(400).json({
        error: "redeem_token_missing",
        message:
          "Dieser Einlöse-QR ist veraltet. Bitte einen neuen Einlöse-QR verwenden.",
      });
    }
    if (!/^[a-f0-9]{16,128}$/i.test(rt)) {
      return res.status(400).json({
        error: "redeem_token_invalid",
        message: "Ungültiger Einlöse-Token.",
      });
    }

    const now = Date.now();
    const redeemTx = db.transaction(() => {
      const existing = getRedeemToken.get(rt);
      if (existing && existing.used_at) {
        const e = new Error("redeem_token_used");
        e.code = "REDEEM_TOKEN_USED";
        throw e;
      }

      // Create token row early so concurrent uses are rejected.
      if (!existing) {
        insertRedeemToken.run(rt, now);
      }

      const row = countEventsByCafeUser.get(cafeAddress, customer);
      const currentStamps =
        row && typeof row.total === "number" ? Number(row.total) : 0;

      if (currentStamps < 10) {
        // Don't consume the token on failure.
        deleteRedeemTokenIfUnused.run(rt);
        const e = new Error("insufficient_stamps");
        e.code = "INSUFFICIENT_STAMPS";
        e.currentStamps = currentStamps;
        throw e;
      }

      const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
      const usedBy = ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");

      const updated = markRedeemTokenUsed.run(
        now,
        cafeAddress,
        customer,
        usedBy,
        localTx,
        rt
      );
      if (!updated || updated.changes !== 1) {
        const e = new Error("redeem_token_used");
        e.code = "REDEEM_TOKEN_USED";
        throw e;
      }

      const ev = {
        ts: now,
        cafe: cafeAddress,
        customer_name: customerName || null,
        user: customer,
        txhash: localTx,
        status: "confirmed",
        event_type: "redeem",
        delta: -10,
      };

      insertEvent.run(ev);
      return { ev, currentStamps, localTx };
    });

    let result;
    try {
      result = redeemTx();
    } catch (e) {
      if (e && e.code === "REDEEM_TOKEN_USED") {
        return res.status(409).json({
          error: "redeem_token_used",
          message:
            "Dieser Einlöse-QR wurde bereits verwendet. Bitte einen neuen Einlöse-QR öffnen.",
        });
      }
      if (e && e.code === "INSUFFICIENT_STAMPS") {
        return res.status(400).json({
          error: "insufficient_stamps",
          current: Number(e.currentStamps || 0),
          required: 10,
          message: "Customer needs at least 10 stamps to redeem reward",
        });
      }
      throw e;
    }

    try {
      broadcastEvent(result.ev);
    } catch (e) {}

    res.json({
      success: true,
      status: "confirmed",
      redeemed: true,
      previousStamps: Number(result.currentStamps),
      txHash: result.localTx,
      message: "Reward redeemed.",
    });
  } catch (err) {
    console.error("Error in /redeem-reward:", err);
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
    const cafeAddress = req.query && req.query.cafe;

    if (cafeAddress && /^0x[0-9a-fA-F]{40}$/i.test(cafeAddress)) {
      const row = countEventsByCafeUser.get(cafeAddress, user);
      const stamps = row && typeof row.total === "number" ? row.total : 0;
      return res.json({ cafe: cafeAddress, user, stamps });
    }

    const rowAll = countEventsByUser.get(user);
    const stamps =
      rowAll && typeof rowAll.total === "number" ? rowAll.total : 0;
    res.json({ user, stamps, note: "db_total" });
  } catch (err) {
    console.error(
      "Error in GET /stamps/:addr",
      err && err.stack ? err.stack : err
    );
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

app.get("/cafes/:cafeId/overview", requireCafeAuth, (req, res) => {
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

    const cafeAddress = ensureCafeAddress(cafeRow) || String(cafeRow?.id || "");
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
        locationAddress: cafeRow.location_address || null,
        lat: cafeRow.lat != null ? Number(cafeRow.lat) : null,
        lng: cafeRow.lng != null ? Number(cafeRow.lng) : null,
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
app.put("/cafes/me/profile", requireCafeAuth, (req, res) => {
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

    let locationAddress = current.location_address || null;
    if (Object.prototype.hasOwnProperty.call(body, "locationAddress")) {
      const raw =
        body.locationAddress == null ? "" : String(body.locationAddress);
      const trimmed = raw.trim();
      locationAddress = trimmed ? trimmed.slice(0, 256) : null;
    }

    let lat = current.lat != null ? Number(current.lat) : null;
    let lng = current.lng != null ? Number(current.lng) : null;
    if (Object.prototype.hasOwnProperty.call(body, "lat")) {
      const raw = body.lat;
      if (raw == null || String(raw).trim() === "") {
        lat = null;
      } else {
        const n = Number(raw);
        lat = Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "lng")) {
      const raw = body.lng;
      if (raw == null || String(raw).trim() === "") {
        lng = null;
      } else {
        const n = Number(raw);
        lng = Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
      }
    }

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
      locationAddress,
      lat,
      lng,
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
        locationAddress: updated.location_address || null,
        lat: updated.lat != null ? Number(updated.lat) : null,
        lng: updated.lng != null ? Number(updated.lng) : null,
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

app.get(
  "/cafes/:cafeId/events/:eventId/detail",
  requireCafeAuth,
  (req, res) => {
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

      const cafeAddress =
        ensureCafeAddress(cafeRow) || String(cafeRow?.id || "");
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
  }
);

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
          "SELECT id, name, address, created_at FROM cafes ORDER BY name COLLATE NOCASE"
        )
        .all();
    } catch (selectErr) {
      cafeRows = db
        .prepare(
          "SELECT id, name, created_at FROM cafes ORDER BY name COLLATE NOCASE"
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
      const resolvedAddress = row.address || null;

      const entry = {
        id: row.id,
        name: row.name || `Café ${row.id}`,
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

// Get café statistics for dashboard (Bearer auth)
app.get("/cafes/:cafeId/stats", requireCafeAuth, (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow)
      return res.status(500).json({ error: "missing_cafe_context" });

    const param = String(req.params.cafeId || "");
    if (param && param !== "me" && String(cafeRow.id) !== param) {
      return res.status(403).json({ error: "forbidden" });
    }

    const cafeAddr = (ensureCafeAddress(cafeRow) || "").toLowerCase();
    if (!cafeAddr)
      return res.status(500).json({ error: "cafe_address_missing" });

    const allEvents = db
      .prepare(
        "SELECT ts, user, status, event_type, delta FROM stamp_events WHERE LOWER(cafe) = ?"
      )
      .all(cafeAddr);

    const totalStamps = allEvents.reduce(
      (sum, e) => sum + (Number(e.delta || 0) > 0 ? Number(e.delta || 0) : 0),
      0
    );
    const uniqueCustomers = new Set(
      allEvents.map((e) => (e.user || "").toLowerCase())
    ).size;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStamps = allEvents.reduce((sum, e) => {
      const isToday = Number(e.ts) >= today.getTime();
      const d = Number(e.delta || 0);
      return sum + (isToday && d > 0 ? d : 0);
    }, 0);

    const totalRedemptions = allEvents.filter(
      (e) =>
        String(e.event_type || "") === "redeem" &&
        String(e.status || "") === "confirmed"
    ).length;

    res.json({ totalStamps, uniqueCustomers, todayStamps, totalRedemptions });
  } catch (err) {
    console.error("Error fetching café stats:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Validate address existence (server-side)
app.post("/address/validate", async (req, res) => {
  try {
    const body = req.body || {};
    const street =
      body.street != null ? String(body.street).trim().slice(0, 128) : "";
    const houseNumber =
      body.houseNumber != null
        ? String(body.houseNumber).trim().slice(0, 32)
        : "";
    const postalCode =
      body.postalCode != null
        ? String(body.postalCode).trim().slice(0, 16)
        : "";
    const city = body.city != null ? String(body.city).trim().slice(0, 64) : "";
    const country =
      body.country != null ? String(body.country).trim().slice(0, 64) : "";

    if (!street || !postalCode || !city || !country) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const result = await validateAddressExists({
      street,
      houseNumber,
      postalCode,
      city,
      country,
    });

    res.json({
      ok: result.ok,
      provider: result.provider,
      locationAddress: buildLocationAddress({
        street,
        houseNumber,
        postalCode,
        city,
        country,
      }),
      lat: result.lat,
      lng: result.lng,
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: "validation_failed" });
  }
});

// Extended health check (legacy name; kept for compatibility)
app.get("/health/block", async (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({
      status: "ok",
      mode: "offchain",
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

app.post("/debug/rehydrate", async (req, res) => {
  res.status(410).json({
    ok: false,
    error: "offchain_mode",
    message: "On-chain rehydration is no longer supported.",
  });
});

app.get("/debug/info", async (req, res) => {
  try {
    const totalEvents = Number(
      db.prepare("SELECT COUNT(1) AS n FROM stamp_events").get()?.n ?? 0
    );
    const totalCafes = Number(
      db.prepare("SELECT COUNT(1) AS n FROM cafes").get()?.n ?? 0
    );
    res.json({
      ok: true,
      mode: "offchain",
      totals: {
        cafes: totalCafes,
        events: totalEvents,
      },
    });
  } catch (err) {
    console.error("Error in /debug/info", err && err.stack ? err.stack : err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Legacy debug endpoint removed (deprecated auth)
app.get("/debug/cafe/:apiKey", (req, res) => {
  res.status(410).json({ ok: false, error: "deprecated" });
});

app.get("/debug/getStamps/:addr", async (req, res) => {
  const user = req.params.addr;
  if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
    return res.status(400).json({ error: "invalid user address" });
  }
  try {
    const cafeAddr = req.query.cafe || null;
    if (cafeAddr && /^0x[0-9a-fA-F]{40}$/i.test(cafeAddr)) {
      const row = countEventsByCafeUser.get(cafeAddr, user);
      const normalized = row && typeof row.total === "number" ? row.total : 0;
      return res.json({ ok: true, cafe: cafeAddr, user, normalized });
    }

    const rowAll = countEventsByUser.get(user);
    const normalized =
      rowAll && typeof rowAll.total === "number" ? rowAll.total : 0;
    res.json({
      ok: true,
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
  res.status(410).json({ ok: false, error: "deprecated" });
});

app.post("/debug/sync/onchain", async (req, res) => {
  res.status(410).json({
    ok: false,
    error: "offchain_mode",
    message: "On-chain sync removed; DB is source of truth.",
  });
});

// Debug: compare DB aggregates for a specific cafe+user
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

    const chain = null;

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

// Legacy endpoint: replaced by /cafes/register-with-email (email+password only)
app.post("/cafes/register", async (req, res) => {
  res.status(410).json({
    ok: false,
    error: "deprecated",
    message: "Use /cafes/register-with-email (email+password).",
  });
});

// Café Login (email + password)
app.post("/cafes/login", async (req, res) => {
  try {
    const emailRaw = req.body?.email != null ? String(req.body.email) : "";
    const password =
      req.body?.password != null ? String(req.body.password) : "";
    const email = emailRaw.trim().slice(0, 254);

    if (!email || !email.includes("@") || !password) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const cafe = getCafeAuthByEmail.get(email);
    if (!cafe || !cafe.password_hash) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const passwordValid = await bcrypt.compare(password, cafe.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 60 * 24 * 30; // 30 days
    insertCafeSession.run(cafe.id, tokenHash, now, expiresAt);

    res.json({
      ok: true,
      token,
      cafe: {
        id: cafe.id,
        name: cafe.name || null,
        cafeAddress: cafe.address || null,
        email: cafe.email || null,
        locationAddress: cafe.location_address || null,
        lat: cafe.lat != null ? Number(cafe.lat) : null,
        lng: cafe.lng != null ? Number(cafe.lng) : null,
        createdAt: cafe.created_at != null ? Number(cafe.created_at) : null,
      },
    });
  } catch (err) {
    console.error("Error in /cafes/login:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post("/cafes/logout", requireCafeAuth, (req, res) => {
  try {
    const tokenHash = req.cafeSession?.token_hash;
    if (tokenHash) {
      try {
        deleteCafeSessionByHash.run(tokenHash);
      } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

app.post("/cafes/register-with-email", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      street,
      houseNumber,
      postalCode,
      city,
      country,
      stampMode,
      stampsForReward,
      rewardDescription,
      products,
    } = req.body || {};

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_required_fields" });
    }

    const normalizedEmail = String(email).trim().slice(0, 254);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, error: "weak_password" });
    }

    const sStreet = street != null ? String(street).trim().slice(0, 128) : "";
    const sHouseNumber =
      houseNumber != null ? String(houseNumber).trim().slice(0, 32) : "";
    const sPostalCode =
      postalCode != null ? String(postalCode).trim().slice(0, 16) : "";
    const sCity = city != null ? String(city).trim().slice(0, 64) : "";
    const sCountry = country != null ? String(country).trim().slice(0, 64) : "";

    if (!sStreet || !sPostalCode || !sCity || !sCountry) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_address_fields" });
    }

    const existing = getCafeAuthByEmail.get(normalizedEmail);
    if (existing) {
      return res
        .status(409)
        .json({ ok: false, error: "email_already_registered" });
    }

    const locationAddress = buildLocationAddress({
      street: sStreet,
      houseNumber: sHouseNumber,
      postalCode: sPostalCode,
      city: sCity,
      country: sCountry,
    });

    const addrCheck = await validateAddressExists({
      street: sStreet,
      houseNumber: sHouseNumber,
      postalCode: sPostalCode,
      city: sCity,
      country: sCountry,
    });
    if (!addrCheck.ok) {
      return res.status(400).json({ ok: false, error: "address_not_found" });
    }

    const address = randomAddress();

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
      email: normalizedEmail,
      address,
      location_address: locationAddress
        ? String(locationAddress).slice(0, 256)
        : null,
      street: sStreet,
      house_number: sHouseNumber || null,
      postal_code: sPostalCode,
      city: sCity,
      country: sCountry,
      lat: addrCheck.lat,
      lng: addrCheck.lng,
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
    console.log(`📧 Email: ${normalizedEmail}`);
    console.log(`📍 Cafe Identifier: ${address}`);
    if (info.location_address) {
      console.log(`🗺️ Location: ${info.location_address}`);
    }

    // Send email with credentials
    try {
      await sendCafeCredentialsEmail({
        email: normalizedEmail,
        cafeName: name,
        locationAddress: info.location_address,
        config,
      });
      console.log(`✅ Email sent to: ${normalizedEmail}\n`);
    } catch (emailErr) {
      console.error(
        `❌ Failed to send email to ${normalizedEmail}:`,
        emailErr.message
      );
      // Don't fail the registration if email fails
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 60 * 24 * 30; // 30 days
    insertCafeSession.run(id, tokenHash, now, expiresAt);

    res.json({
      ok: true,
      token,
      cafe: {
        id,
        name: info.name,
        cafeAddress: address,
        email: normalizedEmail,
        locationAddress: info.location_address,
        lat: info.lat,
        lng: info.lng,
      },
    });
  } catch (err) {
    console.error("Error in /cafes/register-with-email:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Legacy endpoint: keystore/wallet based registration removed
app.post("/cafes/register-self", async (req, res) => {
  res.status(410).json({
    ok: false,
    error: "deprecated",
    message: "Keystore registration removed. Use /cafes/register-with-email.",
  });
});

// Dev-only: list cafes (non-sensitive preview)
app.get("/cafes", (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, name, email, address, location_address, lat, lng, created_at FROM cafes ORDER BY id DESC"
      )
      .all();

    res.json(rows);
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
        "SELECT id, name, address, location_address, lat, lng, about_text, logo_data, created_at, updated_at FROM cafes ORDER BY id DESC"
      )
      .all();

    const cafes = rows
      .map((row) => {
        const address = row.location_address || null;
        return {
          id: row.id,
          name: row.name || null,
          address,
          cafeAddress: row.address || null,
          lat: row.lat != null ? Number(row.lat) : null,
          lng: row.lng != null ? Number(row.lng) : null,
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
        "SELECT id, name, location_address, lat, lng, about_text, redeem_message, logo_mime, logo_data, created_at, updated_at FROM cafes WHERE id = ?"
      )
      .get(id);

    if (!row) {
      return res.status(404).json({ ok: false, error: "cafe_not_found" });
    }

    res.json({
      ok: true,
      cafe: {
        id: row.id,
        name: row.name || null,
        address: row.location_address || null,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
        about: row.about_text ? String(row.about_text).slice(0, 1200) : null,
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

// Customer cards overview (off-chain; customer address is an identifier)
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

    const address = randomAddress();

    const password_hash = await bcrypt.hash(pw, 10);

    const info = {
      customer_id: customer_id,
      username: uname,
      email: em,
      address,
      encrypted_key: null,
      password_hash,
      created_at: Date.now(),
    };
    insertCustomer.run(info);

    res.json({
      ok: true,
      customer_id,
      address,
      username: uname,
      email: em,
      createdAt: info.created_at,
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
