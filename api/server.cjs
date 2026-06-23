const path = require("path");
const fs = require("fs");
// Load env with sensible precedence:
// - Production: rely on real environment (optionally .env)
// - Dev: allow .env.local for convenience
try {
  const dotenv = require("dotenv");
  const envLocalPath = path.resolve(__dirname, "../.env.local");
  const envPath = path.resolve(__dirname, "../.env");
  const isProd =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!isProd && fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }
} catch {
  // dotenv optional
}
const crypto = require("crypto");
const util = require("util");
const https = require("https");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const os = require("os");

const { z } = require("zod");

const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  // Entfernt BOM, Whitespaces, CRLF
  return v.replace(/^\uFEFF/, "").trim();
}

function parseBool(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function pickLanIpv4() {
  try {
    const nets = os.networkInterfaces();
    let best = null;
    let bestScore = -999;
    for (const name of Object.keys(nets || {})) {
      for (const net of nets[name] || []) {
        if (!net || net.family !== "IPv4" || net.internal) continue;
        const ip = String(net.address || "").trim();
        if (!ip) continue;

        const is192 = ip.startsWith("192.168.");
        const is10 = ip.startsWith("10.");
        const is172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);

        let score = 0;
        if (is192) score += 30;
        else if (is10) score += 20;
        else if (is172) score += 10;

        const lname = String(name || "").toLowerCase();
        if (lname.includes("wi-fi") || lname.includes("wifi")) score += 6;
        if (lname.includes("ethernet")) score += 5;
        if (lname.includes("vethernet") || lname.includes("hyper-v"))
          score -= 25;
        if (lname.includes("wsl")) score -= 25;
        if (lname.includes("virtual")) score -= 10;

        if (score > bestScore) {
          bestScore = score;
          best = ip;
        }
      }
    }
    return best || null;
  } catch {
    return null;
  }
}

function sanitizeForwardedHost(raw) {
  if (!raw) return "";
  // Some proxies send a comma-separated list.
  const first = String(raw).split(",")[0].trim();
  // Only allow typical host:port characters to avoid header injection.
  const cleaned = first.replace(/[^a-zA-Z0-9.:-]/g, "");
  return cleaned;
}

function getAppsBaseUrlFromRequest(req) {
  const envBase = (process.env.APPS_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const proto = forwardedProto === "https" ? "https" : "http";

  const fwdHost = sanitizeForwardedHost(req?.headers?.["x-forwarded-host"]);
  if (fwdHost) {
    return `${proto}://${fwdHost}`.replace(/\/$/, "");
  }

  const host = sanitizeForwardedHost(req?.headers?.host);
  if (host) {
    // If this request hits the API directly (e.g. :3000), point to apps server (:8080)
    const rewritten = host.replace(/:(3000)\b/, ":8080");
    return `${proto}://${rewritten}`.replace(/\/$/, "");
  }

  const lanIp = (process.env.LAN_IP || "").trim() || pickLanIpv4();
  if (lanIp) return `http://${lanIp}:8080`;
  return "http://localhost:8080";
}

const ENV = (() => {
  const schema = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .optional()
        .default("development"),
      PORT: z.coerce.number().int().positive().optional().default(3000),
      TRUST_PROXY: z.string().optional(),
      LOG_LEVEL: z.string().optional().default("info"),
      CORS_ORIGINS: z.string().optional(),
      RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
      RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
      AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
      AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
    })
    .passthrough();

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.issues);
    process.exit(1);
  }

  const raw = parsed.data;
  const isProd = raw.NODE_ENV === "production";
  const trustProxy = parseBool(raw.TRUST_PROXY, isProd);
  const corsOrigins = (raw.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    nodeEnv: raw.NODE_ENV,
    isProd,
    port: raw.PORT,
    trustProxy,
    logLevel: raw.LOG_LEVEL,
    corsOrigins,
    rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MS || 60_000,
    rateLimitMax: raw.RATE_LIMIT_MAX || (isProd ? 300 : 0),
    authRateLimitWindowMs: raw.AUTH_RATE_LIMIT_WINDOW_MS || 60_000,
    authRateLimitMax: raw.AUTH_RATE_LIMIT_MAX || (isProd ? 25 : 0),
  };
})();

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

function normalizeExternalUrl(raw) {
  const trimmed = String(raw == null ? "" : raw).trim();
  if (!trimmed) return null;
  if (/^mailto:/i.test(trimmed)) return trimmed.slice(0, 240);
  if (/^(https?:)?\/\//i.test(trimmed)) {
    return (/^\/\//.test(trimmed) ? `https:${trimmed}` : trimmed).slice(0, 240);
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(trimmed)) {
    return `mailto:${trimmed}`.slice(0, 240);
  }
  return `https://${trimmed.replace(/^\/+/, "")}`.slice(0, 240);
}

function normalizeInstagramUrl(raw) {
  const trimmed = String(raw == null ? "" : raw).trim();
  if (!trimmed) return null;
  if (/^(https?:)?\/\//i.test(trimmed)) {
    return (/^\/\//.test(trimmed) ? `https:${trimmed}` : trimmed).slice(0, 240);
  }
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
  if (!withoutAt) return null;
  if (/^instagram\.com\//i.test(withoutAt)) {
    return `https://${withoutAt}`.slice(0, 240);
  }
  if (/^[a-z0-9._]+$/i.test(withoutAt)) {
    return `https://instagram.com/${withoutAt}`.slice(0, 240);
  }
  return normalizeExternalUrl(withoutAt);
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

function ensureEmailConfigured() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const err = new Error("email_not_configured");
    err.code = "email_not_configured";
    throw err;
  }
}
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
                      ", ",
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
  ensureEmailConfigured();

  const info = await emailTransporter.sendMail(mailOptions);
  return info;
}

async function sendCustomerPasswordResetEmail({ email, resetUrl }) {
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Passwort zurücksetzen (Stampcard)",
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="margin: 0 0 12px 0;">Passwort zurücksetzen</h2>
            <p>Du hast einen Reset-Link angefordert.</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;padding:12px 16px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;">Reset-Link öffnen</a>
            </p>
            <p style="color:#666;font-size:12px;">Wenn du das nicht warst, ignoriere diese E-Mail.</p>
            <p style="color:#666;font-size:12px;">Link: ${resetUrl}</p>
          </div>
        </body>
      </html>
    `,
    text: `Passwort zurücksetzen\n\nÖffne diesen Link: ${resetUrl}\n\nWenn du das nicht warst, ignoriere diese E-Mail.`,
  };

  ensureEmailConfigured();

  const info = await emailTransporter.sendMail(mailOptions);
  return info;
}

async function sendCustomerWelcomeEmail({ email, username, appsBaseUrl }) {
  const baseUrl = String(
    appsBaseUrl || process.env.APPS_BASE_URL || "http://localhost:8080",
  ).replace(/\/$/, "");
  const walletUrl = `${baseUrl}/customer-register`;
  const profileUrl = `${baseUrl}/customer-profile`;
  const displayName = String(username || "").trim() || "Kaffeekarte Gast";

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `Willkommen bei Kaffeekarte, ${displayName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 30px; line-height: 1.05; color: #181311;">Willkommen, ${displayName}.</h1>
              <p style="margin: 0; color: #5f544a;">Dein Konto ist bereit. Ab jetzt kannst du digitale Stempelkarten sammeln und deine Lieblingscafés schneller wiederfinden.</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              <div style="padding: 16px 18px; border: 1px dashed rgba(34, 24, 18, 0.18); border-radius: 12px; background: rgba(255,255,255,0.72);">
                <div style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b625a; font-weight: 700; margin-bottom: 8px;">Dein Login</div>
                <div style="font-size: 15px; color: #181311; word-break: break-word;">${email}</div>
              </div>
              <p style="margin: 20px 0 0; color: #4d443c;">Du kannst dich jederzeit mit deiner E-Mail-Adresse und deinem Passwort anmelden.</p>
              <div style="margin-top: 24px;">
                <a href="${walletUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">Zur Wallet</a>
              </div>
              <p style="margin: 18px 0 0; color: #6b625a; font-size: 13px;">Profil und Passwort-Reset findest du hier: <a href="${profileUrl}" style="color: #1c1917;">${profileUrl}</a></p>
              <p style="margin: 24px 0 0; color: #8a7d70; font-size: 12px;">Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Willkommen bei Kaffeekarte, ${displayName}.

Dein Konto ist bereit.

Login: ${email}
Wallet: ${walletUrl}
Profil / Passwort-Reset: ${profileUrl}

Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.
    `.trim(),
  };

  ensureEmailConfigured();

  const info = await emailTransporter.sendMail(mailOptions);
  return info;
}

async function sendCustomerVerificationEmail({
  email,
  username,
  verifyUrl,
}) {
  const displayName = String(username || "").trim() || "Kaffeekarte Gast";
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `Bitte bestaetige deine E-Mail fuer Kaffekarte`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 30px; line-height: 1.05; color: #181311;">Fast geschafft, ${displayName}.</h1>
              <p style="margin: 0; color: #5f544a;">Ein kurzer Klick noch, dann ist dein Konto bereit. Danach kannst du Stempelkarten sammeln, neue Orte entdecken und direkt loslegen.</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              <p style="margin: 0 0 18px; color: #4d443c;">Hier geht es weiter:</p>
              <div style="margin-top: 8px;">
                <a href="${verifyUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">E-Mail bestaetigen</a>
              </div>
              <p style="margin: 18px 0 0; color: #6b625a; font-size: 13px;">Falls der Button gerade keine Lust hat, funktioniert auch dieser Link: <a href="${verifyUrl}" style="color: #1c1917;">${verifyUrl}</a></p>
              <p style="margin: 24px 0 0; color: #8a7d70; font-size: 12px;">Wenn du dich nicht registriert hast, kannst du diese E-Mail ignorieren.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Fast geschafft, ${displayName}.\n\nBestaetige bitte kurz deine E-Mail-Adresse:\n${verifyUrl}\n\nDanach ist dein Konto bereit.\n\nWenn du dich nicht registriert hast, kannst du diese E-Mail ignorieren.`,
  };

  ensureEmailConfigured();

  return emailTransporter.sendMail(mailOptions);
}

async function sendCafePasswordResetEmail({ email, resetUrl, resetLinks }) {
  const links =
    Array.isArray(resetLinks) && resetLinks.length
      ? resetLinks
      : resetUrl
        ? [{ label: "Reset-Link", url: String(resetUrl) }]
        : [];

  const linksHtml = links
    .map((l) => {
      const label = l && l.label ? String(l.label) : "Reset-Link";
      const url = l && l.url ? String(l.url) : "";
      return `<li style="margin: 8px 0;"><strong>${label}</strong><br/><a href="${url}">${url}</a></li>`;
    })
    .join("\n");

  const linksText = links
    .map((l) => {
      const label = l && l.label ? String(l.label) : "Reset-Link";
      const url = l && l.url ? String(l.url) : "";
      return `${label}: ${url}`;
    })
    .join("\n");

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Café Passwort zurücksetzen (Stampcard)",
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="margin: 0 0 12px 0;">Passwort zurücksetzen</h2>
            <p>Du hast einen Reset-Link für dein Café-Konto angefordert.</p>
            <ul style="padding-left: 18px;">${linksHtml}</ul>
            <p style="color:#666;font-size:12px;">Wenn du das nicht warst, ignoriere diese E-Mail.</p>
            <p style="color:#666;font-size:12px;">${linksText.replace(/\n/g, "<br/>")}</p>
          </div>
        </body>
      </html>
    `,
    text: `Café Passwort zurücksetzen\n\n${linksText}\n\nWenn du das nicht warst, ignoriere diese E-Mail.`,
  };

  ensureEmailConfigured();

  const info = await emailTransporter.sendMail(mailOptions);
  return info;
}

async function sendCafeVerificationEmail({ email, cafeName, verifyUrl }) {
  const displayName = String(cafeName || "").trim() || "dein Café";
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `Bitte bestaetige die E-Mail fuer ${displayName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 30px; line-height: 1.05; color: #181311;">Noch ein Klick, dann kann es losgehen.</h1>
              <p style="margin: 0; color: #5f544a;">Bitte bestaetige kurz die E-Mail-Adresse fuer <strong>${displayName}</strong>. Danach ist der Zugang freigeschaltet und dein Café kann direkt starten.</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              <p style="margin: 0 0 18px; color: #4d443c;">Hier geht es weiter:</p>
              <div style="margin-top: 8px;">
                <a href="${verifyUrl}" style="display:inline-block;padding:14px 18px;background:#1c1917;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">E-Mail bestaetigen</a>
              </div>
              <p style="margin: 18px 0 0; color:#6b625a;font-size:13px;">Falls der Button gerade keine Lust hat, funktioniert auch dieser Link: <a href="${verifyUrl}" style="color:#1c1917;">${verifyUrl}</a></p>
              <p style="margin: 24px 0 0; color:#8a7d70;font-size:12px;">Wenn du die Registrierung nicht angestoßen hast, kannst du diese E-Mail ignorieren.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Noch ein Klick, dann kann es losgehen.\n\nBitte bestaetige die E-Mail-Adresse fuer ${displayName}:\n${verifyUrl}\n\nDanach ist der Zugang freigeschaltet.\n\nWenn du die Registrierung nicht angestoßen hast, kannst du diese E-Mail ignorieren.`,
  };

  ensureEmailConfigured();

  return emailTransporter.sendMail(mailOptions);
}

// === Database (SQLite for local dev; Postgres in cloud via DATABASE_URL) ===
const { createDb } = require("./db.cjs");
let db;

function initDatabase() {
  db = createDb();

  if (db.client !== "sqlite") {
    // Postgres schema must be migrated explicitly via `pnpm db:migrate`.
    return;
  }

  // SQLite schema init (local/dev)
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

CREATE TABLE IF NOT EXISTS cafe_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  data_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cafe_images_cafe_id ON cafe_images(cafe_id);

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
  website_url TEXT,
  instagram_url TEXT,
  password_hash TEXT,
  about_text TEXT,
  redeem_message TEXT,
  logo_mime TEXT,
  logo_data TEXT,
  card_bg_mime TEXT,
  card_bg_data TEXT,
  card_back_text TEXT,
  card_theme TEXT DEFAULT 'paper',
  stamp_style TEXT DEFAULT 'bean',
  stamps_for_reward INTEGER DEFAULT 10,
  reward_description TEXT,
  popup_inactive_enabled INTEGER DEFAULT 1,
  popup_inactive_days INTEGER DEFAULT 21,
  popup_inactive_message TEXT,
  popup_almost_reward_enabled INTEGER DEFAULT 1,
  popup_almost_reward_remaining INTEGER DEFAULT 2,
  popup_almost_reward_message TEXT,
  accepted_privacy_at INTEGER,
  accepted_terms_at INTEGER,
  privacy_version TEXT,
  terms_version TEXT,
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
  accepted_privacy_at INTEGER,
  accepted_terms_at INTEGER,
  privacy_version TEXT,
  terms_version TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS customer_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS cafe_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS cafe_email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_password_resets_hash ON customer_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_password_resets_customer ON customer_password_resets(customer_id);

CREATE INDEX IF NOT EXISTS idx_cafe_password_resets_hash ON cafe_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_cafe_password_resets_cafe ON cafe_password_resets(cafe_id);

CREATE INDEX IF NOT EXISTS idx_customer_email_verifications_hash ON customer_email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_email_verifications_customer ON customer_email_verifications(customer_id);

CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_hash ON cafe_email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_cafe ON cafe_email_verifications(cafe_id);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);
}

initDatabase();

// Ensure legacy databases pick up newer cafe columns (SQLite only)
function isSqliteDb() {
  return db && db.client === "sqlite";
}

function runSqliteOnlyAlter(sql, warnLabel) {
  if (!isSqliteDb()) return;
  try {
    db.prepare(sql).run();
  } catch (e) {
    if (!/duplicate column/i.test(e.message || "")) {
      console.warn(warnLabel, e.message || e);
    }
  }
}

runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN address TEXT",
  "Failed to add cafes.address column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN email TEXT",
  "Failed to add cafes.email column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN location_address TEXT",
  "Failed to add cafes.location_address column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN street TEXT",
  "Failed to add cafes.street column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN house_number TEXT",
  "Failed to add cafes.house_number column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN postal_code TEXT",
  "Failed to add cafes.postal_code column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN city TEXT",
  "Failed to add cafes.city column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN country TEXT",
  "Failed to add cafes.country column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN lat REAL",
  "Failed to add cafes.lat column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN lng REAL",
  "Failed to add cafes.lng column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN website_url TEXT",
  "Failed to add cafes.website_url column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN instagram_url TEXT",
  "Failed to add cafes.instagram_url column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN password_hash TEXT",
  "Failed to add cafes.password_hash column:",
);

// Cafe public profile fields
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN about_text TEXT",
  "Failed to add cafes.about_text column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN logo_mime TEXT",
  "Failed to add cafes.logo_mime column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN logo_data TEXT",
  "Failed to add cafes.logo_data column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN redeem_message TEXT",
  "Failed to add cafes.redeem_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN card_theme TEXT DEFAULT 'paper'",
  "Failed to add cafes.card_theme column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN stamp_style TEXT DEFAULT 'bean'",
  "Failed to add cafes.stamp_style column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN stamps_for_reward INTEGER DEFAULT 10",
  "Failed to add cafes.stamps_for_reward column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reward_description TEXT",
  "Failed to add cafes.reward_description column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_inactive_enabled INTEGER DEFAULT 1",
  "Failed to add cafes.popup_inactive_enabled column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_inactive_days INTEGER DEFAULT 21",
  "Failed to add cafes.popup_inactive_days column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_inactive_message TEXT",
  "Failed to add cafes.popup_inactive_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_almost_reward_enabled INTEGER DEFAULT 1",
  "Failed to add cafes.popup_almost_reward_enabled column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_almost_reward_remaining INTEGER DEFAULT 2",
  "Failed to add cafes.popup_almost_reward_remaining column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN popup_almost_reward_message TEXT",
  "Failed to add cafes.popup_almost_reward_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN card_bg_mime TEXT",
  "Failed to add cafes.card_bg_mime column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN card_bg_data TEXT",
  "Failed to add cafes.card_bg_data column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN card_back_text TEXT",
  "Failed to add cafes.card_back_text column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN updated_at INTEGER",
  "Failed to add cafes.updated_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN accepted_privacy_at INTEGER",
  "Failed to add cafes.accepted_privacy_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN accepted_terms_at INTEGER",
  "Failed to add cafes.accepted_terms_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN privacy_version TEXT",
  "Failed to add cafes.privacy_version column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN terms_version TEXT",
  "Failed to add cafes.terms_version column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN email_verified_at INTEGER",
  "Failed to add cafes.email_verified_at column:",
);

// Ensure legacy databases pick up newer customer columns
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN username TEXT",
  "Failed to add customers.username column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN email TEXT",
  "Failed to add customers.email column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN password_hash TEXT",
  "Failed to add customers.password_hash column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN accepted_privacy_at INTEGER",
  "Failed to add customers.accepted_privacy_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN accepted_terms_at INTEGER",
  "Failed to add customers.accepted_terms_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN privacy_version TEXT",
  "Failed to add customers.privacy_version column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN terms_version TEXT",
  "Failed to add customers.terms_version column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN email_verified_at INTEGER",
  "Failed to add customers.email_verified_at column:",
);

// Ensure legacy databases pick up the additional columns for event tracking
runSqliteOnlyAlter(
  "ALTER TABLE stamp_events ADD COLUMN event_type TEXT DEFAULT 'stamp'",
  "Failed to add event_type column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE stamp_events ADD COLUMN delta INTEGER DEFAULT 1",
  "Failed to add delta column:",
);

// Multi-card support: group events by a stable card_id (nullable for legacy cards)
runSqliteOnlyAlter(
  "ALTER TABLE stamp_events ADD COLUMN card_id TEXT",
  "Failed to add stamp_events.card_id column:",
);

// Event status tracking (submitted/confirmed/failed)
runSqliteOnlyAlter(
  "ALTER TABLE stamp_events ADD COLUMN status TEXT DEFAULT 'confirmed'",
  "Failed to add status column:",
);

// Prepare statements
const insertEvent = db.prepare(
  'INSERT INTO stamp_events (ts, cafe, "user", customer_name, txhash, status, event_type, delta, card_id) VALUES (@ts, @cafe, @user, @customer_name, @txhash, @status, @event_type, @delta, @card_id)',
);
const listEvents = db.prepare(
  "SELECT * FROM stamp_events ORDER BY id DESC LIMIT 50",
);
// Count net stamps for a specific cafe+user (DB fallback when chain state lost)
const countEventsByCafeUser = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed')",
);

// Count net stamps for a specific cafe+user+cardId
const countEventsByCafeUserCardId = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') AND card_id = ?",
);

// Card boundaries: starting a new card should not delete old stamps.
// We treat both legacy `reset` and future `card_start` as boundaries.
const getLastCardBoundaryTsByCafeUser = db.prepare(
  "SELECT COALESCE(MAX(ts), 0) AS ts FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') AND LOWER(COALESCE(event_type,'')) IN ('reset','card_start')",
);
const countEventsByCafeUserSinceTs = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) AS total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') AND ts >= ? AND LOWER(COALESCE(event_type,'')) NOT IN ('reset','card_start')",
);
const countEventsByUser = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed')",
);

async function getCurrentCardStampsByCafeUser(cafeAddress, userAddress) {
  const boundaryRow = await getLastCardBoundaryTsByCafeUser.get(
    cafeAddress,
    userAddress,
  );
  const boundaryTs =
    boundaryRow && boundaryRow.ts != null ? Number(boundaryRow.ts) : 0;
  const ts = Number.isFinite(boundaryTs) ? boundaryTs : 0;
  const row = await countEventsByCafeUserSinceTs.get(
    cafeAddress,
    userAddress,
    ts,
  );
  const totalRaw = row && row.total != null ? Number(row.total) : 0;
  return Number.isFinite(totalRaw) ? totalRaw : 0;
}

async function getStampsByCafeUserCardId(cafeAddress, userAddress, cardId) {
  const cid = cardId != null ? String(cardId).trim() : "";
  // Legacy/unknown cardId falls back to the historical single-card boundary logic.
  if (!cid || cid === "__legacy__") {
    return getCurrentCardStampsByCafeUser(cafeAddress, userAddress);
  }

  const row = await countEventsByCafeUserCardId.get(
    cafeAddress,
    userAddress,
    cid,
  );
  const totalRaw = row && row.total != null ? Number(row.total) : 0;
  return Number.isFinite(totalRaw) ? totalRaw : 0;
}
const updateEventMetadata = db.prepare(
  "UPDATE stamp_events SET event_type = ?, delta = ? WHERE id = ?",
);
const updateEventStatusByTx = db.prepare(
  "UPDATE stamp_events SET status = ? WHERE txhash = ?",
);
const hasEventByTx = db.prepare(
  "SELECT 1 as ok FROM stamp_events WHERE txhash = ? LIMIT 1",
);

const getSyncState = db.prepare(
  "SELECT value FROM sync_state WHERE key = ? LIMIT 1",
);
const setSyncState = db.prepare(
  "INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
);
const insertNonce = db.prepare(
  "INSERT INTO qr_nonces (nonce, cafe_id, expires) VALUES (@nonce, @cafeId, @expires)",
);
const getNonce = db.prepare(
  "SELECT * FROM qr_nonces WHERE nonce = ? AND consumed = 0",
);
const consumeNonce = db.prepare(
  "UPDATE qr_nonces SET consumed = 1, consumed_at = ? WHERE nonce = ? AND consumed = 0",
);

const getRedeemToken = db.prepare(
  "SELECT * FROM redeem_tokens WHERE token = ?",
);
const insertRedeemToken = db.prepare(
  "INSERT INTO redeem_tokens (token, created_at) VALUES (?, ?)",
);
const deleteRedeemTokenIfUnused = db.prepare(
  "DELETE FROM redeem_tokens WHERE token = ? AND used_at IS NULL",
);
const markRedeemTokenUsed = db.prepare(
  'UPDATE redeem_tokens SET used_at = ?, cafe = ?, "user" = ?, used_by_cafe = ?, used_txhash = ? WHERE token = ? AND used_at IS NULL',
);

// Cafes prepared statements
const insertCafe = db.prepare(
  db.client === "postgres"
    ? "INSERT INTO cafes (name, email, address, location_address, street, house_number, postal_code, city, country, lat, lng, website_url, instagram_url, password_hash, about_text, redeem_message, logo_mime, logo_data, stamp_style, stamps_for_reward, reward_description, popup_inactive_enabled, popup_inactive_days, popup_inactive_message, popup_almost_reward_enabled, popup_almost_reward_remaining, popup_almost_reward_message, accepted_privacy_at, accepted_terms_at, privacy_version, terms_version, email_verified_at, updated_at, created_at) VALUES (@name, @email, @address, @location_address, @street, @house_number, @postal_code, @city, @country, @lat, @lng, @website_url, @instagram_url, @password_hash, @about_text, @redeem_message, @logo_mime, @logo_data, @stamp_style, @stamps_for_reward, @reward_description, @popup_inactive_enabled, @popup_inactive_days, @popup_inactive_message, @popup_almost_reward_enabled, @popup_almost_reward_remaining, @popup_almost_reward_message, @accepted_privacy_at, @accepted_terms_at, @privacy_version, @terms_version, @email_verified_at, @updated_at, @created_at) RETURNING id"
    : "INSERT INTO cafes (name, email, address, location_address, street, house_number, postal_code, city, country, lat, lng, website_url, instagram_url, password_hash, about_text, redeem_message, logo_mime, logo_data, stamp_style, stamps_for_reward, reward_description, popup_inactive_enabled, popup_inactive_days, popup_inactive_message, popup_almost_reward_enabled, popup_almost_reward_remaining, popup_almost_reward_message, accepted_privacy_at, accepted_terms_at, privacy_version, terms_version, email_verified_at, updated_at, created_at) VALUES (@name, @email, @address, @location_address, @street, @house_number, @postal_code, @city, @country, @lat, @lng, @website_url, @instagram_url, @password_hash, @about_text, @redeem_message, @logo_mime, @logo_data, @stamp_style, @stamps_for_reward, @reward_description, @popup_inactive_enabled, @popup_inactive_days, @popup_inactive_message, @popup_almost_reward_enabled, @popup_almost_reward_remaining, @popup_almost_reward_message, @accepted_privacy_at, @accepted_terms_at, @privacy_version, @terms_version, @email_verified_at, @updated_at, @created_at)",
);
const getCafeById = db.prepare("SELECT * FROM cafes WHERE id = ?");
const getCafeByName = db.prepare(
  db.client === "postgres"
    ? "SELECT * FROM cafes WHERE LOWER(name) = LOWER(?)"
    : "SELECT * FROM cafes WHERE name = ? COLLATE NOCASE",
);

const getCafeAuthByEmail = db.prepare(
  "SELECT * FROM cafes WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1",
);

const listCafeAuthByEmail = db.prepare(
  "SELECT * FROM cafes WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))",
);

const insertCafeSession = db.prepare(
  "INSERT INTO cafe_sessions (cafe_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const getCafeSessionByHash = db.prepare(
  "SELECT * FROM cafe_sessions WHERE token_hash = ? LIMIT 1",
);
const deleteCafeSessionByHash = db.prepare(
  "DELETE FROM cafe_sessions WHERE token_hash = ?",
);

const setCafePasswordHashById = db.prepare(
  "UPDATE cafes SET password_hash = ? WHERE id = ?",
);
const setCafeEmailVerifiedAtById = db.prepare(
  "UPDATE cafes SET email_verified_at = ? WHERE id = ?",
);

const insertCafePasswordReset = db.prepare(
  "INSERT INTO cafe_password_resets (cafe_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const insertCafeEmailVerification = db.prepare(
  "INSERT INTO cafe_email_verifications (cafe_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const deleteUnusedCafeEmailVerificationsByCafeId = db.prepare(
  "DELETE FROM cafe_email_verifications WHERE cafe_id = ? AND used_at IS NULL",
);
const getCafeEmailVerificationByHash = db.prepare(
  "SELECT * FROM cafe_email_verifications WHERE token_hash = ? LIMIT 1",
);
const markCafeEmailVerificationUsedById = db.prepare(
  "UPDATE cafe_email_verifications SET used_at = ? WHERE id = ? AND used_at IS NULL",
);
const deleteUnusedCafePasswordResetsByCafeId = db.prepare(
  "DELETE FROM cafe_password_resets WHERE cafe_id = ? AND used_at IS NULL",
);
const getCafePasswordResetByHash = db.prepare(
  "SELECT * FROM cafe_password_resets WHERE token_hash = ? LIMIT 1",
);
const markCafePasswordResetUsedById = db.prepare(
  "UPDATE cafe_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL",
);

const updateCafeProfileById = db.prepare(
  "UPDATE cafes SET about_text = ?, redeem_message = ?, logo_mime = ?, logo_data = ?, card_bg_mime = ?, card_bg_data = ?, card_back_text = ?, location_address = ?, lat = ?, lng = ?, website_url = ?, instagram_url = ?, card_theme = ?, stamp_style = ?, stamps_for_reward = ?, reward_description = ?, popup_inactive_enabled = ?, popup_inactive_days = ?, popup_inactive_message = ?, popup_almost_reward_enabled = ?, popup_almost_reward_remaining = ?, popup_almost_reward_message = ?, updated_at = ? WHERE id = ?",
);

const listCafeImagesByCafeId = db.prepare(
  "SELECT id, mime, data_b64, created_at FROM cafe_images WHERE cafe_id = ? ORDER BY id DESC",
);
const countCafeImagesByCafeId = db.prepare(
  "SELECT COUNT(*) AS cnt FROM cafe_images WHERE cafe_id = ?",
);
const insertCafeImage = db.prepare(
  db.client === "postgres"
    ? "INSERT INTO cafe_images (cafe_id, mime, data_b64, created_at) VALUES (?, ?, ?, ?) RETURNING id"
    : "INSERT INTO cafe_images (cafe_id, mime, data_b64, created_at) VALUES (?, ?, ?, ?)",
);
const deleteCafeImageByIdForCafe = db.prepare(
  "DELETE FROM cafe_images WHERE id = ? AND cafe_id = ?",
);

// Customers prepared statements
const insertCustomer = db.prepare(
  "INSERT INTO customers (customer_id, username, email, address, encrypted_key, password_hash, accepted_privacy_at, accepted_terms_at, privacy_version, terms_version, email_verified_at, created_at) VALUES (@customer_id, @username, @email, @address, @encrypted_key, @password_hash, @accepted_privacy_at, @accepted_terms_at, @privacy_version, @terms_version, @email_verified_at, @created_at)",
);
const listCustomers = db.prepare("SELECT * FROM customers ORDER BY id DESC");
const getCustomerByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1",
);
const getCustomerAuthByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, password_hash, email_verified_at, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1",
);
const setCustomerPasswordHashById = db.prepare(
  "UPDATE customers SET password_hash = ? WHERE id = ?",
);
const setCustomerEmailVerifiedAtById = db.prepare(
  "UPDATE customers SET email_verified_at = ? WHERE id = ?",
);

const insertCustomerPasswordReset = db.prepare(
  "INSERT INTO customer_password_resets (customer_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const insertCustomerEmailVerification = db.prepare(
  "INSERT INTO customer_email_verifications (customer_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const deleteUnusedCustomerEmailVerificationsByCustomerId = db.prepare(
  "DELETE FROM customer_email_verifications WHERE customer_id = ? AND used_at IS NULL",
);
const getCustomerEmailVerificationByHash = db.prepare(
  "SELECT * FROM customer_email_verifications WHERE token_hash = ? LIMIT 1",
);
const markCustomerEmailVerificationUsedById = db.prepare(
  "UPDATE customer_email_verifications SET used_at = ? WHERE id = ? AND used_at IS NULL",
);
const deleteUnusedCustomerPasswordResetsByCustomerId = db.prepare(
  "DELETE FROM customer_password_resets WHERE customer_id = ? AND used_at IS NULL",
);
const getCustomerPasswordResetByHash = db.prepare(
  "SELECT * FROM customer_password_resets WHERE token_hash = ? LIMIT 1",
);
const markCustomerPasswordResetUsedById = db.prepare(
  "UPDATE customer_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL",
);

// === Express setup ===
const express = require("express");
const app = express();
app.disable("x-powered-by");
if (ENV.trustProxy) app.set("trust proxy", true);

function getOrCreateRequestId(req) {
  const existing =
    req.headers["x-request-id"] || req.headers["x-correlation-id"];
  if (existing) return String(existing).slice(0, 128);
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

app.use((req, res, next) => {
  const rid = getOrCreateRequestId(req);
  req.requestId = rid;
  res.setHeader("X-Request-Id", rid);
  next();
});

// Structured HTTP logging (redact secrets)
try {
  const pinoHttp = require("pino-http");
  app.use(
    pinoHttp({
      level: ENV.logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      customProps: (req) => ({ requestId: req.requestId }),
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );
} catch {
  // pino-http optional
}

// Security headers
try {
  const helmet = require("helmet");
  app.use(
    helmet({
      // This app serves multiple HTML pages; keep CSP off by default unless we explicitly wire it.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
} catch {
  // helmet optional
}

// Rate limiting (only enabled in production unless overridden)
try {
  const rateLimit = require("express-rate-limit");
  if (ENV.rateLimitMax > 0) {
    app.use(
      rateLimit({
        windowMs: ENV.rateLimitWindowMs,
        max: ENV.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { xForwardedForHeader: false },
        keyGenerator: (req) => {
          const ip = req.ip || req.connection?.remoteAddress || "unknown";
          return String(ip);
        },
      }),
    );
  }

  const authLimiterEnabled = ENV.authRateLimitMax > 0;
  if (authLimiterEnabled) {
    const authLimiter = rateLimit({
      windowMs: ENV.authRateLimitWindowMs,
      max: ENV.authRateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      message: { error: "rate_limited" },
      keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || "unknown";
        return String(ip);
      },
    });
    app.use((req, res, next) => {
      const p = String(req.path || "");
      if (
        p.startsWith("/cafes/login") ||
        p.startsWith("/cafes/forgot-password") ||
        p.startsWith("/cafes/reset-password") ||
        p.startsWith("/customers/login") ||
        p.startsWith("/customers/forgot-password") ||
        p.startsWith("/customers/reset-password")
      ) {
        return authLimiter(req, res, next);
      }
      next();
    });
  }
} catch {
  // express-rate-limit optional
}

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
  }),
);

// Quick liveness route to verify route registration
app.get("/__alive", (req, res) => res.json({ ok: true, time: Date.now() }));

// Dev-only request logger (keep console noise low in production)
if (!ENV.isProd) {
  app.use((req, res, next) => {
    console.log(`[DEBUG] ${req.method} ${req.url}`);
    next();
  });
}
// Enable CORS for the simple browser apps
try {
  const cors = require("cors");
  if (!ENV.isProd || ENV.corsOrigins.length === 0) {
    app.use(cors());
  } else {
    app.use(
      cors({
        origin: (origin, cb) => {
          if (!origin) return cb(null, true);
          if (ENV.corsOrigins.includes(origin)) return cb(null, true);
          return cb(new Error("CORS blocked"));
        },
        credentials: true,
      }),
    );
  }
} catch (e) {
  console.warn(
    "cors module not installed; browser-based apps may need a proxy or disabled CORS.",
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
      "X-Accel-Buffering": "no",
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
async function requireCafeAuth(req, res, next) {
  try {
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    const raw = auth ? String(auth) : "";
    const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
    const token = m && m[1] ? String(m[1]).trim() : "";
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await getCafeSessionByHash.get(tokenHash);
    if (!session) return res.status(401).json({ error: "unauthorized" });

    const now = Date.now();
    const expiresAt =
      session.expires_at != null ? Number(session.expires_at) : 0;
    if (!expiresAt || now > expiresAt) {
      try {
        await deleteCafeSessionByHash.run(tokenHash);
      } catch (e) {}
      return res.status(401).json({ error: "session_expired" });
    }

    const cafe = await getCafeById.get(session.cafe_id);
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

function toBoundInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toBoundBoolInt(value, fallback) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  return fallback ? 1 : 0;
}

function toOptionalTrimmedText(value, maxLen) {
  const raw = value == null ? "" : String(value);
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function getCafeProgramSettings(row) {
  const src = row || {};
  const rawStampStyle = toOptionalTrimmedText(src.stamp_style, 32) || "bean";
  const normalizedStampStyle =
    String(rawStampStyle).trim().toLowerCase() === "cup"
      ? "bean"
      : String(rawStampStyle).trim().toLowerCase();
  return {
    stampStyle: normalizedStampStyle || "bean",
    stampsForReward: toBoundInt(src.stamps_for_reward, 10, 1, 50),
    rewardDescription:
      toOptionalTrimmedText(src.reward_description, 240) || "1 Freigetr?nk",
    popupInactiveEnabled: toBoundBoolInt(src.popup_inactive_enabled, 1),
    popupInactiveDays: toBoundInt(src.popup_inactive_days, 21, 7, 365),
    popupInactiveMessage: toOptionalTrimmedText(
      src.popup_inactive_message,
      280,
    ),
    popupAlmostRewardEnabled: toBoundBoolInt(
      src.popup_almost_reward_enabled,
      1,
    ),
    popupAlmostRewardRemaining: toBoundInt(
      src.popup_almost_reward_remaining,
      2,
      1,
      10,
    ),
    popupAlmostRewardMessage: toOptionalTrimmedText(
      src.popup_almost_reward_message,
      280,
    ),
  };
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
      },
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
app.get("/health", async (req, res) => {
  try {
    await db.prepare("SELECT 1").get();
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
  res.sendFile(path.join(appsDir, "cafe-scanner-new.html"));
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

    await insertNonce.run({ nonce, cafeId, expires });
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
    const nonceRecord = await getNonce.get(nonce);
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
    await consumeNonce.run(Date.now(), nonce);

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
      card_id: null,
    };
    await insertEvent.run(ev);
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
    const { customer, count, customerName, qrCafe, cardId, cid, card } =
      req.body || {};
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

    let normalizedCardId = null;
    try {
      const raw =
        cardId != null
          ? cardId
          : cid != null
            ? cid
            : card != null
              ? card
              : null;
      const s = raw != null ? String(raw).trim() : "";
      if (s && s !== "__legacy__") {
        if (s.length > 128) {
          return res.status(400).json({ error: "card_id_invalid" });
        }
        normalizedCardId = s;
      }
    } catch (e) {}

    const ev = {
      ts: Date.now(),
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: localTx,
      status: "confirmed",
      event_type: "stamp",
      delta: cnt,
      card_id: normalizedCardId,
    };
    await insertEvent.run(ev);
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
    const { customer, customerName, qrCafe, redeemToken, cardId, cid, card } =
      req.body || {};

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
    // Ensure token row exists (idempotent)
    try {
      await insertRedeemToken.run(rt, now);
    } catch (e) {
      // Ignore unique constraint race (token already exists)
    }

    const existing = await getRedeemToken.get(rt);
    if (existing && existing.used_at) {
      return res.status(409).json({
        error: "redeem_token_used",
        message:
          "Dieser Einlöse-QR wurde bereits verwendet. Bitte einen neuen Einlöse-QR öffnen.",
      });
    }

    let normalizedCardId = null;
    try {
      const raw =
        cardId != null
          ? cardId
          : cid != null
            ? cid
            : card != null
              ? card
              : null;
      const s = raw != null ? String(raw).trim() : "";
      if (s && s !== "__legacy__") {
        if (s.length > 128) {
          return res.status(400).json({ error: "card_id_invalid" });
        }
        normalizedCardId = s;
      }
    } catch (e) {}

    const currentStamps = await getStampsByCafeUserCardId(
      cafeAddress,
      customer,
      normalizedCardId,
    );
    const cafeProgram = getCafeProgramSettings(req.cafe || null);
    const rewardThreshold = toBoundInt(cafeProgram.stampsForReward, 10, 1, 50);

    if (currentStamps < rewardThreshold) {
      // Don't consume the token on failure.
      try {
        await deleteRedeemTokenIfUnused.run(rt);
      } catch (e) {}
      return res.status(400).json({
        error: "insufficient_stamps",
        current: Number(currentStamps || 0),
        required: rewardThreshold,
        message: `Customer needs at least ${rewardThreshold} stamps to redeem reward`,
      });
    }

    const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
    const usedBy = ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");

    const updated = await markRedeemTokenUsed.run(
      now,
      cafeAddress,
      customer,
      usedBy,
      localTx,
      rt,
    );
    if (!updated || updated.changes !== 1) {
      return res.status(409).json({
        error: "redeem_token_used",
        message:
          "Dieser Einlöse-QR wurde bereits verwendet. Bitte einen neuen Einlöse-QR öffnen.",
      });
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
      card_id: normalizedCardId,
    };

    await insertEvent.run(ev);
    const result = { ev, currentStamps, localTx };

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

// Start a new stamp card (reset balance) without redeeming (café scans customer reset QR)
app.post("/reset-card", requireCafeAuth, async (req, res) => {
  console.log("[DEBUG] /reset-card reached");
  try {
    const { customer, customerName, qrCafe } = req.body || {};
    const tokenRaw =
      (req.body &&
        (req.body.resetToken || req.body.redeemToken || req.body.rt)) ||
      null;

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
          "Dieser QR-Code gehört zu einem anderen Café. Bitte mit dem passenden Konto anmelden.",
      });
    }

    const rt = tokenRaw != null ? String(tokenRaw).trim() : "";
    if (!rt) {
      return res.status(400).json({
        error: "reset_token_missing",
        message:
          "Dieser QR ist veraltet. Bitte einen neuen QR zum Starten einer neuen Karte öffnen.",
      });
    }
    if (!/^[a-f0-9]{16,128}$/i.test(rt)) {
      return res.status(400).json({
        error: "reset_token_invalid",
        message: "Ungültiger Token.",
      });
    }

    const now = Date.now();

    // Ensure token row exists (idempotent)
    try {
      await insertRedeemToken.run(rt, now);
    } catch (e) {
      // Ignore unique constraint race (token already exists)
    }

    const existing = await getRedeemToken.get(rt);
    if (existing && existing.used_at) {
      return res.status(409).json({
        error: "reset_token_used",
        message:
          "Dieser QR wurde bereits verwendet. Bitte einen neuen QR öffnen.",
      });
    }

    const stamps = await getCurrentCardStampsByCafeUser(cafeAddress, customer);
    if (stamps <= 0) {
      // Don't consume the token on failure.
      try {
        await deleteRedeemTokenIfUnused.run(rt);
      } catch (e) {}
      return res.status(400).json({
        error: "nothing_to_reset",
        current: 0,
        message: "No stamps to reset.",
      });
    }

    const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
    const usedBy = ensureCafeAddress(req.cafe) || String(req.cafe?.id || "");

    const updated = await markRedeemTokenUsed.run(
      now,
      cafeAddress,
      customer,
      usedBy,
      localTx,
      rt,
    );
    if (!updated || updated.changes !== 1) {
      return res.status(409).json({
        error: "reset_token_used",
        message:
          "Dieser QR wurde bereits verwendet. Bitte einen neuen QR öffnen.",
      });
    }

    const ev = {
      ts: now,
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: localTx,
      status: "confirmed",
      event_type: "card_start",
      delta: 0,
      card_id: null,
    };

    await insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}

    res.json({
      success: true,
      status: "confirmed",
      reset: true,
      previousStamps: Number(stamps),
      txHash: localTx,
      message: "New stamp card started.",
    });
  } catch (err) {
    console.error("Error in /reset-card:", err);
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
    const qCardId =
      (req.query && (req.query.cardId || req.query.cid || req.query.card)) ||
      null;

    if (cafeAddress && /^0x[0-9a-fA-F]{40}$/i.test(cafeAddress)) {
      const stamps = await getStampsByCafeUserCardId(
        cafeAddress,
        user,
        qCardId,
      );
      return res.json({ cafe: cafeAddress, user, stamps });
    }

    const rowAll = await countEventsByUser.get(user);
    const stampsRaw = rowAll && rowAll.total != null ? Number(rowAll.total) : 0;
    const stamps = Number.isFinite(stampsRaw) ? stampsRaw : 0;
    res.json({ user, stamps, note: "db_total" });
  } catch (err) {
    console.error(
      "Error in GET /stamps/:addr",
      err && err.stack ? err.stack : err,
    );
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Get stamp history for a user
app.get("/stamps/history/:addr", async (req, res) => {
  try {
    const addr = req.params.addr;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/i.test(addr)) {
      return res.status(400).json({ error: "invalid address" });
    }

    const toCustomerLedgerItem = (row) => {
      if (!row) return null;
      const deltaRaw = row.delta != null ? Number(row.delta) : 0;
      const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
      const timestampRaw = row.ts != null ? Number(row.ts) : null;
      const timestamp =
        timestampRaw != null && Number.isFinite(timestampRaw)
          ? timestampRaw
          : null;
      const eventType =
        row.event_type || (delta < 0 ? "redeem" : delta > 0 ? "stamp" : "");
      return {
        id: row.id != null ? String(row.id) : null,
        timestamp,
        cafe: row.cafe || null,
        cafeName: row.cafe_name || null,
        cafeLocationAddress: row.cafe_location_address || null,
        user: row.user || null,
        customerName: row.customer_name || null,
        txHash: row.txhash || null,
        status: row.status || "confirmed",
        eventType,
        delta,
        cardId: row.card_id || null,
      };
    };

    const rows = await db
      .prepare(
        'SELECT e.id, e.ts, e.cafe, "user" as user, e.customer_name, e.txhash, e.status, e.event_type, e.delta, e.card_id, c.name AS cafe_name, c.location_address AS cafe_location_address\n' +
          "FROM stamp_events e\n" +
          "LEFT JOIN cafes c ON LOWER(c.address) = LOWER(e.cafe)\n" +
          'WHERE LOWER("user") = LOWER(?)\n' +
          "ORDER BY e.ts DESC\n" +
          "LIMIT 50",
      )
      .all(addr);

    res.json(
      (Array.isArray(rows) ? rows : [])
        .map(toCustomerLedgerItem)
        .filter(Boolean),
    );
  } catch (err) {
    console.error("Error fetching stamp history:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/cafes/:cafeId/overview", requireCafeAuth, async (req, res) => {
  try {
    const { cafeId } = req.params;
    const eventsLimitRaw = req.query?.eventsLimit ?? req.query?.events;
    const customerLimitRaw =
      req.query?.customerLimit ?? req.query?.customers ?? req.query?.limit;

    const eventsLimit = Math.max(
      5,
      Math.min(Number(eventsLimitRaw) || 20, 200),
    );
    const customerLimit = Math.max(
      5,
      Math.min(Number(customerLimitRaw) || 25, 200),
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

    const statsRow = await db
      .prepare(
        `SELECT
           COUNT(*) AS total_events,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemption_count,
           COUNT(DISTINCT "user") AS unique_customers,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts
         FROM stamp_events
         WHERE LOWER(cafe) = ?`,
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

    const recentEventsRows = await db
      .prepare(
        `SELECT id, ts, cafe, "user" as user, customer_name, event_type, delta, txhash
         FROM stamp_events
         WHERE LOWER(cafe) = ?
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(cafeAddressLower, eventsLimit);

    const recentEvents = recentEventsRows.map((row) => toEventSummary(row));

    const customersRows = await db
      .prepare(
        `SELECT
           "user" as user,
           MAX(customer_name) AS customer_name,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           MAX(ts) AS last_activity_ts
         FROM stamp_events
         WHERE LOWER(cafe) = ?
         GROUP BY "user"
         ORDER BY last_activity_ts DESC
         LIMIT ?`,
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
        websiteUrl: cafeRow.website_url || null,
        instagramUrl: cafeRow.instagram_url || null,
        about: cafeRow.about_text || null,
        redeemMessage: cafeRow.redeem_message || null,
        cardTheme: cafeRow.card_theme || "paper",
        cardBackText: cafeRow.card_back_text || null,
        program: getCafeProgramSettings(cafeRow),
        logoDataUrl:
          cafeRow.logo_data && cafeRow.logo_mime
            ? `data:${cafeRow.logo_mime};base64,${cafeRow.logo_data}`
            : null,
        cardBackgroundDataUrl:
          cafeRow.card_bg_data && cafeRow.card_bg_mime
            ? `data:${cafeRow.card_bg_mime};base64,${cafeRow.card_bg_data}`
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
app.put("/cafes/me/profile", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }

    const current = await getCafeById.get(cafeRow.id);
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

    let websiteUrl = current.website_url || null;
    if (Object.prototype.hasOwnProperty.call(body, "websiteUrl")) {
      websiteUrl = normalizeExternalUrl(body.websiteUrl);
    }

    let instagramUrl = current.instagram_url || null;
    if (Object.prototype.hasOwnProperty.call(body, "instagramUrl")) {
      instagramUrl = normalizeInstagramUrl(body.instagramUrl);
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
          /^data:(image\/(png|jpeg|jpg|svg\+xml|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(
            s,
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

    let cardBgMime = current.card_bg_mime || null;
    let cardBgData = current.card_bg_data || null;
    if (Object.prototype.hasOwnProperty.call(body, "cardBgDataUrl")) {
      const raw = body.cardBgDataUrl;
      if (!raw) {
        cardBgMime = null;
        cardBgData = null;
      } else {
        const s = String(raw);
        const m =
          /^data:(image\/(png|jpeg|jpg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(
            s,
          );
        if (!m) {
          return res.status(400).json({ error: "invalid_card_bg_format" });
        }
        const mime =
          m[1].toLowerCase() === "image/jpg"
            ? "image/jpeg"
            : m[1].toLowerCase();
        const base64 = String(m[3] || "").replace(/\s+/g, "");

        // Rough size guard: base64 chars ~ 4/3 bytes
        if (base64.length > 650_000) {
          return res.status(413).json({ error: "card_bg_too_large" });
        }

        cardBgMime = mime;
        cardBgData = base64;
      }
    }

    let cardBackText = current.card_back_text || null;
    if (Object.prototype.hasOwnProperty.call(body, "cardBackText")) {
      const raw = body.cardBackText == null ? "" : String(body.cardBackText);
      const trimmed = raw.trim();
      cardBackText = trimmed ? trimmed.slice(0, 400) : null;
    }

    const allowedCardThemes = new Set([
      "paper",
      "clean",
      "ink",
      "brand",
      "latte",
      "mono",
    ]);
    let cardTheme = current.card_theme || "paper";
    if (Object.prototype.hasOwnProperty.call(body, "cardTheme")) {
      const raw = body.cardTheme == null ? "" : String(body.cardTheme);
      const trimmed = raw.trim().toLowerCase();
      if (trimmed && !allowedCardThemes.has(trimmed)) {
        return res.status(400).json({ error: "invalid_card_theme" });
      }
      cardTheme = trimmed || "paper";
    }

    const allowedStampStyles = new Set(["cup", "bean", "star", "circle"]);
    let stampStyle = current.stamp_style || "bean";
    if (Object.prototype.hasOwnProperty.call(body, "stampStyle")) {
      const raw = body.stampStyle == null ? "" : String(body.stampStyle);
      const trimmed = raw.trim().toLowerCase();
      if (trimmed && !allowedStampStyles.has(trimmed)) {
        return res.status(400).json({ error: "invalid_stamp_style" });
      }
      stampStyle = trimmed || "bean";
    }

    const currentProgram = getCafeProgramSettings(current);
    let stampsForReward = currentProgram.stampsForReward;
    if (Object.prototype.hasOwnProperty.call(body, "stampsForReward")) {
      stampsForReward = toBoundInt(body.stampsForReward, stampsForReward, 1, 50);
    }

    let rewardDescription = currentProgram.rewardDescription;
    if (Object.prototype.hasOwnProperty.call(body, "rewardDescription")) {
      rewardDescription =
        toOptionalTrimmedText(body.rewardDescription, 240) || rewardDescription;
    }

    let popupInactiveEnabled = currentProgram.popupInactiveEnabled;
    if (Object.prototype.hasOwnProperty.call(body, "popupInactiveEnabled")) {
      popupInactiveEnabled = toBoundBoolInt(
        body.popupInactiveEnabled,
        popupInactiveEnabled,
      );
    }

    let popupInactiveDays = currentProgram.popupInactiveDays;
    if (Object.prototype.hasOwnProperty.call(body, "popupInactiveDays")) {
      popupInactiveDays = toBoundInt(
        body.popupInactiveDays,
        popupInactiveDays,
        7,
        365,
      );
    }

    let popupInactiveMessage = currentProgram.popupInactiveMessage;
    if (Object.prototype.hasOwnProperty.call(body, "popupInactiveMessage")) {
      popupInactiveMessage = toOptionalTrimmedText(body.popupInactiveMessage, 280);
    }

    let popupAlmostRewardEnabled = currentProgram.popupAlmostRewardEnabled;
    if (Object.prototype.hasOwnProperty.call(body, "popupAlmostRewardEnabled")) {
      popupAlmostRewardEnabled = toBoundBoolInt(
        body.popupAlmostRewardEnabled,
        popupAlmostRewardEnabled,
      );
    }

    let popupAlmostRewardRemaining = currentProgram.popupAlmostRewardRemaining;
    if (Object.prototype.hasOwnProperty.call(body, "popupAlmostRewardRemaining")) {
      popupAlmostRewardRemaining = toBoundInt(
        body.popupAlmostRewardRemaining,
        popupAlmostRewardRemaining,
        1,
        10,
      );
    }

    let popupAlmostRewardMessage = currentProgram.popupAlmostRewardMessage;
    if (Object.prototype.hasOwnProperty.call(body, "popupAlmostRewardMessage")) {
      popupAlmostRewardMessage = toOptionalTrimmedText(
        body.popupAlmostRewardMessage,
        280,
      );
    }

    const now = Date.now();
    await updateCafeProfileById.run(
      aboutText,
      redeemMessage,
      logoMime,
      logoData,
      cardBgMime,
      cardBgData,
      cardBackText,
      locationAddress,
      lat,
      lng,
      websiteUrl,
      instagramUrl,
      cardTheme,
      stampStyle,
      stampsForReward,
      rewardDescription,
      popupInactiveEnabled,
      popupInactiveDays,
      popupInactiveMessage,
      popupAlmostRewardEnabled,
      popupAlmostRewardRemaining,
      popupAlmostRewardMessage,
      now,
      cafeRow.id,
    );

    const updated = await getCafeById.get(cafeRow.id);
    const updatedProgram = getCafeProgramSettings(updated);
    res.json({
      ok: true,
      cafe: {
        id: updated.id,
        name: updated.name || null,
        address: updated.address || null,
        locationAddress: updated.location_address || null,
        lat: updated.lat != null ? Number(updated.lat) : null,
        lng: updated.lng != null ? Number(updated.lng) : null,
        websiteUrl: updated.website_url || null,
        instagramUrl: updated.instagram_url || null,
        about: updated.about_text || null,
        redeemMessage: updated.redeem_message || null,
        cardTheme: updated.card_theme || "paper",
        cardBackText: updated.card_back_text || null,
        program: updatedProgram,
        logoDataUrl:
          updated.logo_data && updated.logo_mime
            ? `data:${updated.logo_mime};base64,${updated.logo_data}`
            : null,
        cardBackgroundDataUrl:
          updated.card_bg_data && updated.card_bg_mime
            ? `data:${updated.card_bg_mime};base64,${updated.card_bg_data}`
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

// Manage optional cafe gallery images
app.get("/cafes/me/images", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }
    const rows = await listCafeImagesByCafeId.all(cafeRow.id);
    const images = rows
      .map((r) => {
        const mime = r.mime ? String(r.mime) : "";
        const data = r.data_b64 ? String(r.data_b64) : "";
        if (!mime || !data) return null;
        return {
          id: r.id,
          dataUrl: `data:${mime};base64,${data}`,
          createdAt: r.created_at != null ? Number(r.created_at) : null,
        };
      })
      .filter(Boolean);
    res.json({ ok: true, images });
  } catch (err) {
    console.error("Error in GET /cafes/me/images:", err);
    res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
});

app.post("/cafes/me/images", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }
    const body = req.body || {};
    const raw = body.dataUrl || body.dataUrlBase64 || body.imageDataUrl;
    if (!raw) {
      return res.status(400).json({ ok: false, error: "missing_dataUrl" });
    }

    const s = String(raw);
    const m =
      /^data:(image\/(png|jpeg|jpg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(s);
    if (!m) {
      return res.status(400).json({ ok: false, error: "invalid_image_format" });
    }
    const mime =
      m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
    const base64 = String(m[3] || "").replace(/\s+/g, "");
    if (base64.length > 650_000) {
      return res.status(413).json({ ok: false, error: "image_too_large" });
    }

    const cntRow = await countCafeImagesByCafeId.get(cafeRow.id);
    const cnt =
      cntRow && typeof cntRow.cnt === "number" ? Number(cntRow.cnt) : 0;
    if (cnt >= 6) {
      return res
        .status(400)
        .json({ ok: false, error: "too_many_images", max: 6 });
    }

    const now = Date.now();
    const info = await insertCafeImage.run(cafeRow.id, mime, base64, now);
    res.json({
      ok: true,
      id: info && info.lastInsertRowid ? Number(info.lastInsertRowid) : null,
    });
  } catch (err) {
    console.error("Error in POST /cafes/me/images:", err);
    res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
});

app.delete("/cafes/me/images/:imageId", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }
    const imageId = Number(req.params.imageId);
    if (!Number.isFinite(imageId)) {
      return res.status(400).json({ ok: false, error: "invalid_image_id" });
    }
    const info = await deleteCafeImageByIdForCafe.run(imageId, cafeRow.id);
    res.json({
      ok: true,
      deleted: info && info.changes ? Number(info.changes) : 0,
    });
  } catch (err) {
    console.error("Error in DELETE /cafes/me/images/:imageId:", err);
    res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
});

app.get(
  "/cafes/:cafeId/events/:eventId/detail",
  requireCafeAuth,
  async (req, res) => {
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

      const eventRow = await db
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
  },
);

app.get("/admin/events/:eventId/detail", requireAdminKey, async (req, res) => {
  try {
    const numericId = Number(req.params.eventId);
    if (!Number.isFinite(numericId)) {
      return res.status(400).json({ error: "invalid_event_id" });
    }

    const eventRow = await db
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
      const cafeRow = await db
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

app.get("/admin/cafes/activity", requireAdminKey, async (req, res) => {
  try {
    const eventsPerCafeRaw =
      req.query?.eventsPerCafe ?? req.query?.limit ?? req.query?.events;
    const customerLimitRaw =
      req.query?.customerLimit ??
      req.query?.customerCount ??
      req.query?.customers;

    const eventsPerCafe = Math.max(
      5,
      Math.min(Number(eventsPerCafeRaw) || 50, 200),
    );
    const customerLimit = Math.max(
      5,
      Math.min(Number(customerLimitRaw) || 25, 500),
    );
    const maxEvents = Math.max(
      eventsPerCafe,
      Math.min(Number(req.query?.maxEvents) || eventsPerCafe * 40, 5000),
    );

    let cafeRows;
    if (db.client === "postgres") {
      cafeRows = await db
        .prepare(
          "SELECT id, name, address, created_at FROM cafes ORDER BY LOWER(name)",
        )
        .all();
    } else {
      try {
        cafeRows = db
          .prepare(
            "SELECT id, name, address, created_at FROM cafes ORDER BY name COLLATE NOCASE",
          )
          .all();
      } catch (selectErr) {
        cafeRows = db
          .prepare(
            "SELECT id, name, created_at FROM cafes ORDER BY name COLLATE NOCASE",
          )
          .all()
          .map((row) => ({ ...row, address: null }));
      }
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

    const aggregateRows = await db
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
           COUNT(DISTINCT "user") AS unique_customers
         FROM stamp_events
         GROUP BY cafe`,
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

    const customerRows = await db
      .prepare(
        `SELECT
           cafe,
           "user" as user,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN delta < 0 THEN ts ELSE NULL END) AS last_redeem_ts,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS redemptions,
           MAX(CASE WHEN customer_name IS NOT NULL AND customer_name != '' THEN customer_name ELSE NULL END) AS customer_name
         FROM stamp_events
         GROUP BY cafe, "user"`,
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

    const rawEvents = await db
      .prepare(
        'SELECT id, ts, cafe, "user" as user, customer_name, txhash, event_type, delta FROM stamp_events ORDER BY ts DESC LIMIT ?',
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
        (a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0),
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
app.get("/cafes/:cafeId/stats", requireCafeAuth, async (req, res) => {
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

    const allEvents = await db
      .prepare(
        'SELECT ts, "user" as user, status, event_type, delta FROM stamp_events WHERE LOWER(cafe) = ?',
      )
      .all(cafeAddr);

    const totalStamps = allEvents.reduce(
      (sum, e) => sum + (Number(e.delta || 0) > 0 ? Number(e.delta || 0) : 0),
      0,
    );
    const uniqueCustomers = new Set(
      allEvents.map((e) => (e.user || "").toLowerCase()),
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
        String(e.status || "") === "confirmed",
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
    await db.prepare("SELECT 1").get();
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
app.get("/events", async (req, res) => {
  const rows = await listEvents.all();
  res.json(rows);
});

// Debug: count DB events for a cafe+user pairing
app.get("/debug/db-stamp-count", async (req, res) => {
  try {
    const cafe = req.query.cafe;
    const user = req.query.user;
    if (!cafe || !/^0x[0-9a-fA-F]{40}$/.test(cafe)) {
      return res.status(400).json({ error: "invalid cafe" });
    }
    if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
      return res.status(400).json({ error: "invalid user" });
    }
    const dbCount = await getCurrentCardStampsByCafeUser(cafe, user);
    res.json({ ok: true, cafe, user, dbCount });
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
      (await db.prepare("SELECT COUNT(1) AS n FROM stamp_events").get())?.n ??
        0,
    );
    const totalCafes = Number(
      (await db.prepare("SELECT COUNT(1) AS n FROM cafes").get())?.n ?? 0,
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
      const normalized = await getCurrentCardStampsByCafeUser(cafeAddr, user);
      return res.json({ ok: true, cafe: cafeAddr, user, normalized });
    }

    const rowAll = await countEventsByUser.get(user);
    const normalizedRaw =
      rowAll && rowAll.total != null ? Number(rowAll.total) : 0;
    const normalized = Number.isFinite(normalizedRaw) ? normalizedRaw : 0;
    res.json({
      ok: true,
      normalized,
      cafe: cafeAddr,
    });
  } catch (err) {
    console.error(
      "Error in /debug/getStamps",
      err && err.stack ? err.stack : err,
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

    const dbConfirmed = await getCurrentCardStampsByCafeUser(cafe, user);
    const dbAll = await db
      .prepare(
        'SELECT status, COALESCE(SUM(delta),0) as total FROM stamp_events WHERE LOWER(cafe)=LOWER(?) AND LOWER("user")=LOWER(?) GROUP BY status',
      )
      .all(cafe, user);

    const chain = null;

    const recent = await db
      .prepare(
        'SELECT id, ts, cafe, "user" as user, txhash, status, event_type, delta FROM stamp_events WHERE LOWER(cafe)=LOWER(?) AND LOWER("user")=LOWER(?) ORDER BY id DESC LIMIT 20',
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
        req.rawBody ? req.rawBody.slice(0, 2000) : "<no rawBody>",
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

    const cafe = await getCafeAuthByEmail.get(email);
    if (!cafe || !cafe.password_hash) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    if (!cafe.email_verified_at) {
      return res.status(403).json({ ok: false, error: "email_not_verified" });
    }

    const passwordValid = await bcrypt.compare(password, cafe.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 60 * 24 * 30; // 30 days
    await insertCafeSession.run(cafe.id, tokenHash, now, expiresAt);

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

app.post("/cafes/verify-email", async (req, res) => {
  try {
    const token = req.body?.token != null ? String(req.body.token).trim() : "";
    if (!token) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const row = await getCafeEmailVerificationByHash.get(tokenHash);
    const now = Date.now();
    if (!row || row.used_at || !row.expires_at || now > Number(row.expires_at)) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    await setCafeEmailVerifiedAtById.run(now, row.cafe_id);
    await markCafeEmailVerificationUsedById.run(now, row.id);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/cafes/logout", requireCafeAuth, async (req, res) => {
  try {
    const tokenHash = req.cafeSession?.token_hash;
    if (tokenHash) {
      try {
        await deleteCafeSessionByHash.run(tokenHash);
      } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

app.post("/cafes/forgot-password", async (req, res) => {
  try {
    const { email, cafeId, cafeAddress } = req.body || {};
    const em = email != null ? String(email).trim() : "";

    // Neutral response to avoid email enumeration
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      return res.json({ ok: true });
    }

    let cafes = await listCafeAuthByEmail.all(em);

    // Optional disambiguation when multiple cafés share the same email.
    // This is useful when the scanner was opened via a QR link that already contains the café address.
    const wantedId =
      cafeId != null && String(cafeId).trim() ? String(cafeId).trim() : "";
    const wantedAddr =
      cafeAddress != null && String(cafeAddress).trim()
        ? String(cafeAddress).trim().toLowerCase()
        : "";
    if (cafes && cafes.length > 1 && (wantedId || wantedAddr)) {
      cafes = cafes.filter((c) => {
        if (!c) return false;
        if (wantedId && String(c.id) === wantedId) return true;
        if (wantedAddr) {
          const addr =
            c.address != null ? String(c.address).trim().toLowerCase() : "";
          if (addr && addr === wantedAddr) return true;
        }
        return false;
      });
    }
    let devResetLinks = null;

    if (cafes && cafes.length) {
      const now = Date.now();
      const expiresAt = now + 60 * 60 * 1000; // 1 hour
      const appsBaseUrl = getAppsBaseUrlFromRequest(req);

      const resetLinks = [];
      for (const cafe of cafes) {
        if (!cafe || !cafe.id) continue;
        const token = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");

        try {
          await deleteUnusedCafePasswordResetsByCafeId.run(cafe.id);
        } catch (e) {}

        await insertCafePasswordReset.run(cafe.id, tokenHash, now, expiresAt);

        const resetUrl = `${appsBaseUrl}/cafe-onboarding?resetToken=${encodeURIComponent(
          token,
        )}`;
        const labelParts = [];
        if (cafe.name) labelParts.push(String(cafe.name));
        if (cafe.location_address)
          labelParts.push(String(cafe.location_address));
        const label = labelParts.length
          ? labelParts.join(" · ")
          : `Café #${cafe.id}`;
        resetLinks.push({
          cafeId: cafe.id,
          name: cafe.name || null,
          locationAddress: cafe.location_address || null,
          url: resetUrl,
          label,
        });
      }

      try {
        await sendCafePasswordResetEmail({
          email: em,
          resetLinks: resetLinks.map((l) => ({ label: l.label, url: l.url })),
        });
      } catch (e) {
        console.warn(
          "Failed to send cafe reset email:",
          e && e.message ? e.message : e,
        );
      }

      const revealDev =
        !process.env.EMAIL_USER ||
        !process.env.EMAIL_PASS ||
        String(process.env.NODE_ENV || "").toLowerCase() !== "production";
      if (revealDev) devResetLinks = resetLinks;
    }

    if (devResetLinks && devResetLinks.length) {
      // Backwards compatible: include devResetUrl for old clients
      const devResetUrl = String(devResetLinks[0].url);
      return res.json({ ok: true, devResetUrl, devResetLinks });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: true });
  }
});

app.post("/cafes/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    const tok = token != null ? String(token).trim() : "";
    const pw = newPassword != null ? String(newPassword) : "";
    if (!tok)
      return res.status(400).json({ ok: false, error: "invalid_token" });
    if (!pw || pw.length < 8)
      return res.status(400).json({ ok: false, error: "weak_password" });

    const tokenHash = crypto.createHash("sha256").update(tok).digest("hex");
    const resetRow = await getCafePasswordResetByHash.get(tokenHash);
    const now = Date.now();

    if (!resetRow)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (resetRow.used_at)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (!resetRow.expires_at || now > Number(resetRow.expires_at)) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    const newHash = await bcrypt.hash(pw, 10);
    await setCafePasswordHashById.run(newHash, resetRow.cafe_id);
    await markCafePasswordResetUsedById.run(now, resetRow.id);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/cafes/reset-password/preview", async (req, res) => {
  try {
    const { token } = req.body || {};
    const tok = token != null ? String(token).trim() : "";
    if (!tok)
      return res.status(400).json({ ok: false, error: "invalid_token" });

    const tokenHash = crypto.createHash("sha256").update(tok).digest("hex");
    const resetRow = await getCafePasswordResetByHash.get(tokenHash);
    const now = Date.now();
    if (!resetRow)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (resetRow.used_at)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (!resetRow.expires_at || now > Number(resetRow.expires_at)) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    const cafe = await getCafeById.get(resetRow.cafe_id);
    return res.json({
      ok: true,
      cafe: cafe
        ? {
            id: cafe.id,
            name: cafe.name || null,
            locationAddress: cafe.location_address || null,
            address: cafe.address || null,
          }
        : null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/cafes/register-with-email", async (req, res) => {
  try {
    const LEGAL_VERSION = "2026-06-mvp";
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
      acceptPrivacy,
      acceptTerms,
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
    if (!acceptPrivacy) {
      return res.status(400).json({ ok: false, error: "privacy_consent_required" });
    }
    if (!acceptTerms) {
      return res.status(400).json({ ok: false, error: "terms_consent_required" });
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

    const existing = await getCafeAuthByEmail.get(normalizedEmail);
    if (existing) {
      if (!existing.email_verified_at) {
        const now = Date.now();
        const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
        const token = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const appsBaseUrl = getAppsBaseUrlFromRequest(req);
        const verifyUrl = `${appsBaseUrl}/cafe-onboarding?verifyToken=${encodeURIComponent(token)}`;
        try {
          await insertCafeEmailVerification.run(existing.id, tokenHash, now, expiresAt);
          await sendCafeVerificationEmail({
            email: normalizedEmail,
            cafeName: existing.name || String(name).trim(),
            verifyUrl,
          });
        } catch (verifyErr) {
          console.warn(
            "Failed to resend cafe verification email:",
            verifyErr && verifyErr.message ? verifyErr.message : verifyErr,
          );
          return res
            .status(502)
            .json({ ok: false, error: "verification_email_failed" });
        }
        return res
          .status(409)
          .json({ ok: false, error: "email_verification_pending" });
      }
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
      website_url: null,
      instagram_url: null,
      password_hash,
      about_text: null,
      redeem_message: null,
      logo_mime: null,
      logo_data: null,
      stamp_style: "bean",
      stamps_for_reward: config.stampsForReward,
      reward_description: config.rewardDescription,
      popup_inactive_enabled: config.popupInactiveEnabled,
      popup_inactive_days: config.popupInactiveDays,
      popup_inactive_message: config.popupInactiveMessage,
      popup_almost_reward_enabled: config.popupAlmostRewardEnabled,
      popup_almost_reward_remaining: config.popupAlmostRewardRemaining,
      popup_almost_reward_message: config.popupAlmostRewardMessage,
      accepted_privacy_at: Date.now(),
      accepted_terms_at: Date.now(),
      privacy_version: LEGAL_VERSION,
      terms_version: LEGAL_VERSION,
      email_verified_at: null,
      updated_at: Date.now(),
      created_at: Date.now(),
    };

    const r = await insertCafe.run(info);
    const id = r.lastInsertRowid || null;
    if (!id) {
      return res.status(500).json({ ok: false, error: "cafe_insert_failed" });
    }

    console.log(`\n🎉 New Café Registered: ${name}`);
    console.log(`📧 Email: ${normalizedEmail}`);
    console.log(`📍 Cafe Identifier: ${address}`);
    if (info.location_address) {
      console.log(`🗺️ Location: ${info.location_address}`);
    }

    const now = Date.now();
    const verificationToken = crypto.randomBytes(24).toString("hex");
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    const verificationExpiresAt = now + EMAIL_VERIFICATION_TTL_MS;
    await insertCafeEmailVerification.run(
      id,
      verificationTokenHash,
      now,
      verificationExpiresAt,
    );

    const appsBaseUrl = getAppsBaseUrlFromRequest(req);
    const verifyUrl = `${appsBaseUrl}/cafe-onboarding?verifyToken=${encodeURIComponent(
      verificationToken,
    )}`;

    try {
      const mailInfo = await sendCafeVerificationEmail({
        email: normalizedEmail,
        cafeName: name,
        verifyUrl,
      });
      console.log(
        "Cafe verification email accepted by transporter:",
        JSON.stringify({
          email: normalizedEmail,
          messageId: mailInfo && mailInfo.messageId ? mailInfo.messageId : null,
          response: mailInfo && mailInfo.response ? mailInfo.response : null,
        }),
      );
    } catch (emailErr) {
      console.error(
        `Failed to send verification email to ${normalizedEmail}:`,
        emailErr && emailErr.stack ? emailErr.stack : emailErr,
      );
      return res
        .status(502)
        .json({ ok: false, error: "verification_email_failed" });
    }

    res.json({
      ok: true,
      verificationRequired: true,
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
app.get("/cafes", async (req, res) => {
  try {
    const rows = await db
      .prepare(
        "SELECT id, name, email, address, location_address, lat, lng, created_at FROM cafes ORDER BY id DESC",
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
app.get("/cafes/public", async (req, res) => {
  try {
    const rows = await db
      .prepare(
        "SELECT id, name, address, location_address, lat, lng, website_url, instagram_url, about_text, logo_mime, logo_data, card_bg_mime, card_bg_data, card_back_text, card_theme, stamps_for_reward, reward_description, created_at, updated_at FROM cafes ORDER BY id DESC",
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
          websiteUrl: row.website_url || null,
          instagramUrl: row.instagram_url || null,
          about: row.about_text ? String(row.about_text).slice(0, 280) : null,
          logoDataUrl:
            row.logo_data && row.logo_mime
              ? `data:${row.logo_mime};base64,${row.logo_data}`
              : null,
          cardTheme: row.card_theme || "paper",
          cardBackText: row.card_back_text || null,
          program: {
            stampsForReward:
              row.stamps_for_reward != null ? Number(row.stamps_for_reward) : 10,
            rewardDescription: row.reward_description || null,
          },
          cardBackgroundDataUrl:
            row.card_bg_data && row.card_bg_mime
              ? `data:${row.card_bg_mime};base64,${row.card_bg_data}`
              : null,
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
app.get("/cafes/public/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "invalid_cafe_id" });
    }

    const row = await db
      .prepare(
        "SELECT id, name, address, location_address, lat, lng, website_url, instagram_url, about_text, redeem_message, logo_mime, logo_data, card_bg_mime, card_bg_data, card_back_text, card_theme, stamps_for_reward, reward_description, created_at, updated_at FROM cafes WHERE id = ?",
      )
      .get(id);

    if (!row) {
      return res.status(404).json({ ok: false, error: "cafe_not_found" });
    }

    const imageRows = await listCafeImagesByCafeId.all(row.id);
    const images = imageRows
      .map((r) => {
        const mime = r.mime ? String(r.mime) : "";
        const data = r.data_b64 ? String(r.data_b64) : "";
        if (!mime || !data) return null;
        return `data:${mime};base64,${data}`;
      })
      .filter(Boolean)
      .slice(0, 6);

    res.json({
      ok: true,
      cafe: {
        id: row.id,
        name: row.name || null,
        cafeAddress: row.address || null,
        address: row.location_address || null,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
        websiteUrl: row.website_url || null,
        instagramUrl: row.instagram_url || null,
        about: row.about_text ? String(row.about_text).slice(0, 1200) : null,
        redeemMessage: row.redeem_message || null,
        cardTheme: row.card_theme || "paper",
        cardBackText: row.card_back_text || null,
        program: {
          stampsForReward:
            row.stamps_for_reward != null ? Number(row.stamps_for_reward) : 10,
          rewardDescription: row.reward_description || null,
        },
        logoDataUrl:
          row.logo_data && row.logo_mime
            ? `data:${row.logo_mime};base64,${row.logo_data}`
            : null,
        cardBackgroundDataUrl:
          row.card_bg_data && row.card_bg_mime
            ? `data:${row.card_bg_mime};base64,${row.card_bg_data}`
            : null,
        images,
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
app.get("/customers/:customerAddress/cards", async (req, res) => {
  try {
    const rawAddress = req.params?.customerAddress || "";
    const address = rawAddress.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) {
      return res.status(400).json({ error: "invalid_customer_address" });
    }

    const eventsPerCafe = Math.min(
      Math.max(Number(req.query?.eventsPerCafe) || 5, 1),
      20,
    );

    const aggregates = await db
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
         WHERE LOWER("user") = ?
         GROUP BY cafe`,
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
      const cafeRows = await db
        .prepare(
          "SELECT id, name, address, stamp_style, stamps_for_reward, reward_description, popup_inactive_enabled, popup_inactive_days, popup_inactive_message, popup_almost_reward_enabled, popup_almost_reward_remaining, popup_almost_reward_message FROM cafes WHERE address IS NOT NULL",
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
    const rawEvents = await db
      .prepare(
        'SELECT id, ts, cafe, "user" as user, customer_name, txhash, event_type, delta FROM stamp_events WHERE LOWER("user") = ? ORDER BY ts DESC LIMIT ?',
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
        program: getCafeProgramSettings(cafeInfo),
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
    const LEGAL_VERSION = "2026-06-mvp";
    const { username, email, password, acceptPrivacy, acceptTerms } = req.body || {};
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
    if (!acceptPrivacy) {
      return res.status(400).json({ error: "privacy_consent_required" });
    }
    if (!acceptTerms) {
      return res.status(400).json({ error: "terms_consent_required" });
    }

    const existing = await getCustomerAuthByEmail.get(em);
    if (existing && existing.address) {
      if (!existing.email_verified_at) {
        const now = Date.now();
        const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
        const token = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const appsBaseUrl = getAppsBaseUrlFromRequest(req);
        const verifyUrl = `${appsBaseUrl}/wallet?verifyToken=${encodeURIComponent(token)}`;
        try {
          await insertCustomerEmailVerification.run(existing.id, tokenHash, now, expiresAt);
          await sendCustomerVerificationEmail({
            email: em,
            username: existing.username || uname,
            verifyUrl,
          });
        } catch (verifyErr) {
          console.warn(
            "Failed to resend customer verification email:",
            verifyErr && verifyErr.message ? verifyErr.message : verifyErr,
          );
          return res.status(502).json({ error: "verification_email_failed" });
        }
        return res.status(409).json({ error: "email_verification_pending" });
      }
      return res.status(409).json({ error: "email_already_registered" });
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
      accepted_privacy_at: Date.now(),
      accepted_terms_at: Date.now(),
      privacy_version: LEGAL_VERSION,
      terms_version: LEGAL_VERSION,
      email_verified_at: null,
      created_at: Date.now(),
    };
    await insertCustomer.run(info);

    const appsBaseUrl = getAppsBaseUrlFromRequest(req);
    const now = Date.now();
    const verificationToken = crypto.randomBytes(24).toString("hex");
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    const verificationExpiresAt = now + EMAIL_VERIFICATION_TTL_MS;
    const insertedCustomer = await getCustomerAuthByEmail.get(em);
    if (insertedCustomer && insertedCustomer.id) {
      await insertCustomerEmailVerification.run(
        insertedCustomer.id,
        verificationTokenHash,
        now,
        verificationExpiresAt,
      );
    }

    const verifyUrl = `${appsBaseUrl}/wallet?verifyToken=${encodeURIComponent(
      verificationToken,
    )}`;

    try {
      const mailInfo = await sendCustomerVerificationEmail({
        email: em,
        username: uname,
        verifyUrl,
      });
      console.log(
        "Customer verification email accepted by transporter:",
        JSON.stringify({
          email: em,
          messageId: mailInfo && mailInfo.messageId ? mailInfo.messageId : null,
          response: mailInfo && mailInfo.response ? mailInfo.response : null,
        }),
      );
    } catch (emailErr) {
      console.warn(
        "Failed to send customer verification email:",
        emailErr && emailErr.stack ? emailErr.stack : emailErr,
      );
      return res.status(502).json({ error: "verification_email_failed" });
    }

    res.json({
      ok: true,
      verificationRequired: true,
      customer_id,
      address,
      username: uname,
      email: em,
      createdAt: info.created_at,
    });
  } catch (err) {
    console.error(
      "Error in /customers/register:",
      err && err.stack ? err.stack : err,
    );
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.post("/customers/login", async (req, res) => {
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

    const row = await getCustomerAuthByEmail.get(em);
    if (!row) return res.status(404).json({ error: "not_found" });

    if (!row.password_hash) {
      return res.status(401).json({ error: "password_not_set" });
    }
    if (!row.email_verified_at) {
      return res.status(403).json({ error: "email_not_verified" });
    }

    const okPw = await bcrypt.compare(pw, row.password_hash);
    if (!okPw) return res.status(401).json({ error: "wrong_password" });

    return res.json({
      ok: true,
      customer_id: row.customer_id,
      username: row.username || null,
      email: row.email || em,
      address: row.address,
      createdAt: row.created_at || null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/verify-email", async (req, res) => {
  try {
    const token = req.body?.token != null ? String(req.body.token).trim() : "";
    if (!token) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const row = await getCustomerEmailVerificationByHash.get(tokenHash);
    const now = Date.now();
    if (!row || row.used_at || !row.expires_at || now > Number(row.expires_at)) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    await setCustomerEmailVerifiedAtById.run(now, row.customer_id);
    await markCustomerEmailVerificationUsedById.run(now, row.id);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/change-password", async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    const em = email != null ? String(email).trim() : "";
    const cur = currentPassword != null ? String(currentPassword) : "";
    const next = newPassword != null ? String(newPassword) : "";

    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!cur) {
      return res.status(400).json({ error: "invalid_current_password" });
    }
    if (!next || next.length < 6) {
      return res.status(400).json({ error: "invalid_new_password" });
    }

    const row = await getCustomerAuthByEmail.get(em);
    if (!row || !row.password_hash) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const okPw = await bcrypt.compare(cur, row.password_hash);
    if (!okPw) return res.status(401).json({ error: "wrong_password" });

    const newHash = await bcrypt.hash(next, 10);
    await setCustomerPasswordHashById.run(newHash, row.id);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    const em = email != null ? String(email).trim() : "";
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      // Return neutral response
      return res.json({ ok: true });
    }

    const row = await getCustomerAuthByEmail.get(em);
    let devResetUrl = null;

    if (row && row.id) {
      const token = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const now = Date.now();
      const expiresAt = now + 60 * 60 * 1000; // 1 hour

      try {
        await deleteUnusedCustomerPasswordResetsByCustomerId.run(row.id);
      } catch (e) {}
      await insertCustomerPasswordReset.run(row.id, tokenHash, now, expiresAt);

      const appsBaseUrl = getAppsBaseUrlFromRequest(req);

      const resetUrl = `${appsBaseUrl}/customer-profile?resetToken=${encodeURIComponent(
        token,
      )}`;

      try {
        await sendCustomerPasswordResetEmail({ email: em, resetUrl });
      } catch (e) {
        console.warn(
          "Failed to send reset email:",
          e && e.message ? e.message : e,
        );
      }

      const revealDev =
        !process.env.EMAIL_USER ||
        !process.env.EMAIL_PASS ||
        String(process.env.NODE_ENV || "").toLowerCase() !== "production";

      if (revealDev) devResetUrl = resetUrl;
    }

    // Always neutral response to avoid email enumeration
    return devResetUrl
      ? res.json({ ok: true, devResetUrl })
      : res.json({ ok: true });
  } catch (e) {
    // Neutral response even on error
    return res.json({ ok: true });
  }
});

app.post("/customers/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    const tok = token != null ? String(token).trim() : "";
    const pw = newPassword != null ? String(newPassword) : "";
    if (!tok) return res.status(400).json({ error: "invalid_token" });
    if (!pw || pw.length < 6)
      return res.status(400).json({ error: "invalid_password" });

    const tokenHash = crypto.createHash("sha256").update(tok).digest("hex");

    const resetRow = await getCustomerPasswordResetByHash.get(tokenHash);
    const now = Date.now();

    if (!resetRow) return res.status(400).json({ error: "invalid_or_expired" });
    if (resetRow.used_at)
      return res.status(400).json({ error: "invalid_or_expired" });
    if (!resetRow.expires_at || now > Number(resetRow.expires_at)) {
      return res.status(400).json({ error: "invalid_or_expired" });
    }

    const newHash = await bcrypt.hash(pw, 10);
    await setCustomerPasswordHashById.run(newHash, resetRow.customer_id);
    await markCustomerPasswordResetUsedById.run(now, resetRow.id);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/reset-password/preview", async (req, res) => {
  try {
    const { token } = req.body || {};
    const tok = token != null ? String(token).trim() : "";
    if (!tok) return res.status(400).json({ ok: false, error: "invalid_token" });

    const tokenHash = crypto.createHash("sha256").update(tok).digest("hex");
    const resetRow = await getCustomerPasswordResetByHash.get(tokenHash);
    const now = Date.now();

    if (!resetRow)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (resetRow.used_at)
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    if (!resetRow.expires_at || now > Number(resetRow.expires_at)) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    const row = await db
      .prepare(
        "SELECT email, username FROM customers WHERE id = ? LIMIT 1",
      )
      .get(resetRow.customer_id);

    return res.json({
      ok: true,
      email: row && row.email ? row.email : null,
      username: row && row.username ? row.username : null,
      expiresAt: Number(resetRow.expires_at) || null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// Get customer by customer_id (dev/debug)
app.get("/customers/:cid", async (req, res) => {
  try {
    const cid = req.params && req.params.cid;
    if (!cid) return res.status(400).json({ error: "missing customer id" });
    const sql =
      db.client === "postgres"
        ? "SELECT id, customer_id, username, email, address, SUBSTRING(encrypted_key FROM 1 FOR 48) as encrypted_preview, created_at FROM customers WHERE customer_id = ?"
        : "SELECT id, customer_id, username, email, address, substr(encrypted_key,1,48) as encrypted_preview, created_at FROM customers WHERE customer_id = ?";
    const row = await db.prepare(sql).get(cid);
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

// Final error handler (after all routes)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err && err.status ? Number(err.status) : 500;
  const msg = err && err.message ? String(err.message) : "Server error";
  if (res.headersSent) return;
  res
    .status(status)
    .json({ error: "server_error", message: msg, requestId: req.requestId });
});

const PORT = Number(process.env.PORT || 3000);

// Wichtig: 0.0.0.0 bindet sowohl localhost als auch andere Adapter
const http = require("http");
const httpServer = http.createServer(app);

httpServer.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Error: Port ${PORT} already in use. The API is likely already running.`,
    );
    console.error(
      `Tip: If you started \"pnpm run dev\" already, you don't need \"node api/server.cjs\" as well.`,
    );
    console.error(
      `To free the port: netstat -ano | findstr ":${PORT}"  then  taskkill /PID <PID> /F`,
    );
    // Treat this as a non-fatal "already running" situation.
    process.exit(0);
    return;
  }
  console.error("API server error:", err && err.stack ? err.stack : err);
  process.exit(1);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API listening on http://127.0.0.1:${PORT}`);

  // Print registered routes for easy debugging at startup
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
    console.log("Registered routes:", JSON.stringify(routes, null, 2));
  } catch (e) {
    console.warn(
      "Could not enumerate routes at startup:",
      e && e.message ? e.message : e,
    );
  }
});

function shutdown(signal) {
  try {
    console.log(`\n🧹 Graceful shutdown (${signal})...`);
  } catch {}

  try {
    httpServer.close(() => {
      try {
        db && typeof db.close === "function" && db.close();
      } catch {}
      process.exit(0);
    });
    // Force-exit if connections hang
    setTimeout(() => process.exit(1), 10_000).unref();
  } catch {
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

