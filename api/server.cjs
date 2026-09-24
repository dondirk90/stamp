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
const jwt = require("jsonwebtoken");
const jwksRsa = require("jwks-rsa");
const walletPass = require("./wallet-pass.cjs");
const {
  generateStampIcon,
  getDefaultStampIconBuffer,
} = require("./stamp-icon.cjs");
const googleWalletPass = require("./google-wallet-pass.cjs");
const logoPreview = require("./logo-preview.cjs");

const { z } = require("zod");

const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Fixed cutoff, not "now" computed at request time: anything created before
// this rolls out grandfathered-out permanently, without needing a backfill
// UPDATE (which migrate.cjs's every-deploy re-apply would make unsafe - see
// migrations/016_add_customer_onboarding_reminder.sql). Bump this only if
// you intentionally want to widen who's eligible; never make it dynamic.
//
// Note: picking "today" exactly makes same-day testing of this feature
// structurally impossible (created_at >= cutoff and created_at <= now-24h
// can't both hold until a full 24h have passed since the cutoff itself -
// confirmed live while staging-testing this). Not a concern for the real
// prod rollout, only for same-day verification right after moving this.
const ONBOARDING_REMINDER_ROLLOUT_AT_MS = Date.parse("2026-09-18T00:00:00Z");

// Registering from a specific cafe's table-QR flow (cafe-join.html) needs
// the verification link to route back there (not the generic /wallet app),
// otherwise there's no way to resume straight into "add this card to
// Wallet" once the customer actually clicks the link - the wallet pass now
// only gets created after verification, not immediately at registration.
function buildCustomerVerifyUrl(appsBaseUrl, token, cafeAddress) {
  const qs = new URLSearchParams({ verifyToken: token });
  if (cafeAddress) {
    qs.set("cafe", cafeAddress);
    return `${appsBaseUrl}/cafe-join?${qs.toString()}`;
  }
  return `${appsBaseUrl}/wallet?${qs.toString()}`;
}

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

function getApiBaseUrlFromRequest(req) {
  const appsBase = getAppsBaseUrlFromRequest(req);
  return `${appsBase.replace(/\/$/, "")}/api`;
}

function base64UrlEncodeUtf8(input) {
  return Buffer.from(String(input), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeBuffer(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeUtf8(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signOauthState(payload) {
  if (!OAUTH_STATE_SECRET) {
    throw new Error("oauth_state_secret_missing");
  }
  const body = base64UrlEncodeUtf8(JSON.stringify(payload));
  const sig = base64UrlEncodeBuffer(
    crypto.createHmac("sha256", OAUTH_STATE_SECRET).update(body).digest(),
  );
  return `${body}.${sig}`;
}

function verifyOauthState(raw) {
  const token = String(raw || "").trim();
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("invalid_oauth_state");
  const [body, sig] = parts;
  const expected = base64UrlEncodeBuffer(
    crypto.createHmac("sha256", OAUTH_STATE_SECRET).update(body).digest(),
  );
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) throw new Error("invalid_oauth_state");
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("invalid_oauth_state");
  }
  const payload = JSON.parse(base64UrlDecodeUtf8(body));
  return payload && typeof payload === "object" ? payload : null;
}

// iOS Universal Links aren't guaranteed to fire across a redirect chain
// through a third-party domain (Google/Apple's own auth servers) before
// landing back on ours - when they don't, the login finishes fine inside
// Safari but the native app (a separate WKWebView/storage context) never
// finds out. A custom URL scheme is deterministic: iOS always routes it to
// the owning app. The "native" flag is threaded through the signed OAuth
// state so we know, once the provider redirects back, whether to send the
// browser to the app via that scheme instead of the normal wallet URL.
const NATIVE_OAUTH_RETURN_URL = "kaffeekarte-customer://oauth-callback";

function resolveOauthRedirectBase(appsBaseUrl, stateRaw) {
  try {
    const state = verifyOauthState(stateRaw);
    if (state && state.native) return NATIVE_OAUTH_RETURN_URL;
    if (
      state &&
      state.returnTo === "cafe-join" &&
      /^0x[0-9a-f]{40}$/i.test(String(state.cafe || ""))
    ) {
      return `${appsBaseUrl}/cafe-join?cafe=${encodeURIComponent(state.cafe)}`;
    }
  } catch (e) {}
  return `${appsBaseUrl}/wallet`;
}

// redirectBase can already carry its own query string (the cafe-join
// return path does), so appending "?foo=bar" blindly would produce a
// broken double-"?" URL - this picks the right separator.
function appendQueryParams(baseUrl, params) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${params}`;
}

// Only /cafe-join is a supported OAuth return target today - "returnTo" is
// a closed enum, not an arbitrary path, so a tampered/forged value can't
// turn this into an open redirect.
function readOauthReturnFields(req) {
  const cafe = String(req.query?.cafe || "").trim();
  const returnTo = String(req.query?.returnTo || "").trim();
  return {
    cafe: /^0x[0-9a-f]{40}$/i.test(cafe) ? cafe : null,
    returnTo: returnTo === "cafe-join" ? "cafe-join" : null,
  };
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
const GOOGLE_CLIENT_ID = sanitizeEnv("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = sanitizeEnv("GOOGLE_CLIENT_SECRET");
const OAUTH_STATE_SECRET =
  sanitizeEnv("OAUTH_STATE_SECRET") || GOOGLE_CLIENT_SECRET || ADMIN_TOKEN;
const CUSTOMER_AUTH_GRANT_TTL_MS = 1000 * 60 * 10;
const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// Sign in with Apple - scaffold (see native-apps plan). Will not work until:
//   1. The App ID (app.kaffeekarte.customer) has the "Sign In with Apple"
//      capability enabled (developer.apple.com -> Identifiers).
//   2. A Services ID exists (a *separate* identifier, e.g.
//      app.kaffeekarte.customer.web) with a Return URL of
//      {API_BASE_URL}/auth/apple/callback and a verified domain.
//   3. A "Sign In with Apple" key is created (Keys -> "+"), giving a Key ID
//      and a .p8 private key.
//   4. APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID and
//      APPLE_PRIVATE_KEY_BASE64 are set as real env vars. The key travels as
//      base64 (same convention as ANDROID_KEYSTORE_BASE64 in the Fastfile)
//      because a raw multi-line/quoted PEM value doesn't survive the
//      GitHub-secret -> heredoc -> docker-compose env-file chain intact -
//      confirmed in production by a `secretOrPrivateKey must be an
//      asymmetric key` signing failure after the value got mangled in transit.
const APPLE_TEAM_ID = sanitizeEnv("APPLE_TEAM_ID");
const APPLE_SERVICES_ID = sanitizeEnv("APPLE_SERVICES_ID");
const APPLE_KEY_ID = sanitizeEnv("APPLE_KEY_ID");
const APPLE_PRIVATE_KEY_BASE64 = sanitizeEnv("APPLE_PRIVATE_KEY_BASE64");
const APPLE_PRIVATE_KEY_RAW = APPLE_PRIVATE_KEY_BASE64
  ? Buffer.from(APPLE_PRIVATE_KEY_BASE64, "base64").toString("utf8")
  : "";
const APPLE_AUTH_BASE = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const appleJwksClient = jwksRsa({
  jwksUri: APPLE_KEYS_URL,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
});

function appleAuthConfigured() {
  return !!(
    APPLE_TEAM_ID &&
    APPLE_SERVICES_ID &&
    APPLE_KEY_ID &&
    APPLE_PRIVATE_KEY_RAW
  );
}

function buildAppleClientSecret() {
  if (!appleAuthConfigured()) throw new Error("apple_auth_not_configured");
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 30,
      aud: "https://appleid.apple.com",
      sub: APPLE_SERVICES_ID,
    },
    APPLE_PRIVATE_KEY_RAW,
    { algorithm: "ES256", keyid: APPLE_KEY_ID },
  );
}

function verifyAppleIdToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      (header, callback) => {
        appleJwksClient.getSigningKey(header.kid, (err, key) => {
          if (err) return callback(err);
          callback(null, key.getPublicKey());
        });
      },
      {
        algorithms: ["RS256"],
        audience: APPLE_SERVICES_ID,
        issuer: "https://appleid.apple.com",
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded)),
    );
  });
}

function randomHex(bytes) {
  return "0x" + crypto.randomBytes(bytes).toString("hex");
}

function randomAddress() {
  // Generates an Ethereum-looking address used purely as an identifier.
  // No private keys are stored; the system runs fully off-chain.
  return "0x" + crypto.randomBytes(20).toString("hex");
}

function pickCustomerUsername(preferredUsername, email, profileName) {
  const preferred = String(preferredUsername || "").trim().slice(0, 64);
  if (preferred) return preferred;
  const fromProfile = String(profileName || "").trim().slice(0, 64);
  if (fromProfile) return fromProfile;
  const em = String(email || "").trim();
  // Apple's "Hide My Email" relay addresses (random-id@privaterelay.appleid.com)
  // make an ugly, meaningless username - fall back to the generic default instead.
  if (/@privaterelay\.appleid\.com$/i.test(em)) return "Kaffee-Connaisseur";
  const local = em.includes("@") ? em.split("@")[0] : em;
  return (
    String(local || "Kaffee-Connaisseur").trim().slice(0, 64) ||
    "Kaffee-Connaisseur"
  );
}

// OAuth providers only hand us a real display name in specific moments
// (Google: every time profile scope is granted; Apple: only on the very
// first-ever authorization for this Services ID). If that moment lands on
// an *existing* customer (matched by prior identity or by email) rather
// than a brand-new signup, the name would otherwise be silently discarded -
// this adopts it, but only if the account doesn't already have a username.
async function maybeAdoptRealNameForExistingCustomer(customer, realName) {
  const trimmed = String(realName || "").trim().slice(0, 64);
  if (!trimmed || !customer || !customer.id) return customer;
  if (String(customer.username || "").trim()) return customer;
  await setCustomerUsernameById.run(trimmed, customer.id);
  return { ...customer, username: trimmed };
}

function customerAvatarDataUrlFromRow(row) {
  if (!row || !row.avatar_data || !row.avatar_mime) return null;
  return `data:${row.avatar_mime};base64,${row.avatar_data}`;
}

function parseCustomerAvatarDataUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { mime: null, data: null };
  const match =
    /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i.exec(
      value,
    );
  if (!match) throw new Error("invalid_avatar_format");
  const mime =
    String(match[1] || "").toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : String(match[1] || "").toLowerCase();
  const data = String(match[3] || "").replace(/\s+/g, "");
  if (data.length > 420_000) throw new Error("avatar_too_large");
  return { mime, data };
}

const LEGAL_VERSION = "2026-06-mvp";

async function upsertCustomerOauthIdentity({
  customerId,
  provider,
  providerSubject,
  email,
  now,
}) {
  const existing = await getCustomerOauthIdentity.get(provider, providerSubject);
  if (existing && existing.id) {
    await updateCustomerOauthIdentityLastUsed.run(
      customerId,
      email || null,
      now,
      provider,
      providerSubject,
    );
    return existing.id;
  }
  const inserted = await insertCustomerOauthIdentity.run(
    customerId,
    provider,
    providerSubject,
    email || null,
    now,
    now,
  );
  return inserted && inserted.id ? inserted.id : null;
}

async function issueCustomerAuthGrant(customerId, provider) {
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = Date.now();
  await insertCustomerAuthGrant.run(
    customerId,
    tokenHash,
    provider || null,
    now,
    now + CUSTOMER_AUTH_GRANT_TTL_MS,
  );
  return rawToken;
}

async function exchangeGoogleCodeForTokens({ code, redirectUri }) {
  const params = new URLSearchParams();
  params.set("code", code);
  params.set("client_id", GOOGLE_CLIENT_ID);
  params.set("client_secret", GOOGLE_CLIENT_SECRET);
  params.set("redirect_uri", redirectUri);
  params.set("grant_type", "authorization_code");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.access_token) {
    const reason = data
      ? [data.error, data.error_description].filter(Boolean).join(": ")
      : "";
    throw new Error(
      `google_token_exchange_failed:${reason || `http_${response.status}`}`,
    );
  }
  return data;
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.sub || !data.email) {
    const reason = data
      ? [data.error, data.error_description || data.message]
          .filter(Boolean)
          .join(": ")
      : "";
    throw new Error(
      `google_userinfo_failed:${reason || `http_${response.status}`}`,
    );
  }
  return data;
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

// Most customers only ever look at their Wallet app, never the companion
// web app - so once a card overflows into a new one, there's no reliable
// way to reach an Android customer at all (Apple at least gets a
// lock-screen notification on the pass it's already showing, see
// buildPassJson's isFull branch; Google's notifyOnUpdate can't carry custom
// text). Email is the one channel that doesn't depend on the customer
// being in the app, at the counter, or on a specific platform - one tap on
// either button below goes straight to that platform's native "Add to
// Wallet" flow, no Kaffeekarte page in between.
async function sendNewCardReadyEmail({
  email,
  customerName,
  cafeName,
  cardNumber,
  applePassUrl,
  googleSaveUrl,
  profileUrl,
}) {
  const displayName = String(customerName || "").trim() || "Kaffeekarte Gast";
  const cafeLabel = String(cafeName || "").trim() || "deinem Café";
  const cardLabel = cardNumber ? `Stempelkarte #${cardNumber}` : "deine neue Stempelkarte";

  const buttonsHtml = [
    applePassUrl
      ? `<a href="${applePassUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700; margin: 0 8px 8px 0;">Zu Apple Wallet hinzufügen</a>`
      : "",
    googleSaveUrl
      ? `<a href="${googleSaveUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700; margin: 0 0 8px 0;">Zu Google Wallet hinzufügen</a>`
      : "",
  ].join("");

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `Neue Stempelkarte bereit – ${cafeLabel}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 26px; line-height: 1.15; color: #181311;">🎉 Deine Karte bei ${cafeLabel} ist voll!</h1>
              <p style="margin: 0; color: #5f544a;">Hallo ${displayName}, deine Stempel gehen nicht verloren - wir haben schon <strong>${cardLabel}</strong> für dich bereitgestellt. Füge sie mit einem Klick zu deinem Wallet hinzu:</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              <div style="margin-top: 8px;">${buttonsHtml}</div>
              <p style="margin: 24px 0 0; color: #8a7d70; font-size: 12px;">Falls du gerade keine neue Karte brauchst, kannst du diese E-Mail ignorieren - deine Stempel bleiben so lange gespeichert, bis du sie einlöst.</p>
              ${
                profileUrl
                  ? `<p style="margin: 18px 0 0; color: #6b625a; font-size: 13px;">Alle deine Stempelkarten, dein Profil und mehr findest du in der Kaffeekarte-App: <a href="${profileUrl}" style="color: #1c1917;">${profileUrl}</a></p>`
                  : ""
              }
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Deine Karte bei ${cafeLabel} ist voll!

Hallo ${displayName}, deine Stempel gehen nicht verloren - wir haben schon ${cardLabel} für dich bereitgestellt.

${applePassUrl ? `Apple Wallet: ${applePassUrl}\n` : ""}${googleSaveUrl ? `Google Wallet: ${googleSaveUrl}\n` : ""}
Falls du gerade keine neue Karte brauchst, kannst du diese E-Mail ignorieren - deine Stempel bleiben so lange gespeichert, bis du sie einlöst.
${profileUrl ? `\nAlle deine Stempelkarten, dein Profil und mehr: ${profileUrl}` : ""}
    `.trim(),
  };

  ensureEmailConfigured();

  return emailTransporter.sendMail(mailOptions);
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
    subject: `Bitte bestaetige deine E-Mail fuer Kaffeekarte`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
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

// Combined "finish onboarding" nudge - covers two independent drop-off
// points (unconfirmed email, Apple Wallet pass downloaded but never
// confirmed active) in one email whose content adapts to whichever apply.
// In practice a customer can only be in the wallet-pending bucket after
// already confirming their email (see buildCustomerVerifyUrl's comment
// above), so both flags true at once is rare, but the caller still checks
// them independently rather than assuming that.
async function sendOnboardingReminderEmail({
  email,
  username,
  needsVerification,
  verifyUrl,
  needsWalletConfirm,
  applePassUrl,
  profileUrl,
  cafeName,
  cafeLogoUrl,
  logMeta,
}) {
  const displayName = String(username || "").trim() || "Kaffeekarte Gast";

  const headline =
    needsVerification && needsWalletConfirm
      ? `Fast fertig, ${displayName}.`
      : needsWalletConfirm
        ? `Nur noch ein Schritt, ${displayName}.`
        : `Fast geschafft, ${displayName}.`;

  const intro =
    needsVerification && needsWalletConfirm
      ? "Dein Konto ist fast startklar - zwei kurze Schritte fehlen noch."
      : needsWalletConfirm
        ? "Deine Stempelkarte wartet nur noch darauf, wirklich in deinem Wallet zu landen."
        : "Ein kurzer Klick noch, dann ist dein Konto bereit.";

  const cafeBlockHtml = cafeName
    ? `<div style="display: flex; align-items: center; gap: 10px; margin: 0 0 18px;">
        ${
          cafeLogoUrl
            ? `<img src="${cafeLogoUrl}" alt="${cafeName}" width="36" height="36" style="width: 36px; height: 36px; border-radius: 8px; object-fit: cover; display: block;" />`
            : ""
        }
        <span style="color: #5f544a; font-size: 13px;">Dein Café: <strong style="color: #181311;">${cafeName}</strong></span>
      </div>`
    : "";

  const verifyButtonHtml = needsVerification
    ? `<div style="margin: 0 0 14px;">
        <a href="${verifyUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">E-Mail bestaetigen</a>
      </div>`
    : "";

  const walletButtonHtml = needsWalletConfirm
    ? applePassUrl
      ? `<div style="margin: 0 0 14px;">
          <a href="${applePassUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">Zu Apple Wallet hinzufügen</a>
        </div>`
      : `<p style="margin: 0 0 14px; color: #6b625a; font-size: 13px;">Deine Karte findest du in deinem Profil: <a href="${profileUrl}" style="color: #1c1917;">${profileUrl}</a></p>`
    : "";

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `Fast fertig, ${displayName} – dein Kaffeekarte-Konto wartet`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 28px; line-height: 1.1; color: #181311;">${headline}</h1>
              <p style="margin: 0; color: #5f544a;">${intro}</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              ${cafeBlockHtml}
              ${verifyButtonHtml}
              ${walletButtonHtml}
              <p style="margin: 18px 0 0; color: #8a7d70; font-size: 12px;">Falls das schon erledigt ist oder du dich nicht registriert hast, kannst du diese E-Mail einfach ignorieren.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: [
      headline,
      "",
      intro,
      "",
      cafeName ? `Dein Café: ${cafeName}` : "",
      needsVerification ? `E-Mail bestaetigen: ${verifyUrl}` : "",
      needsWalletConfirm
        ? applePassUrl
          ? `Zu Apple Wallet hinzufuegen: ${applePassUrl}`
          : `Deine Karte: ${profileUrl}`
        : "",
      "",
      "Falls das schon erledigt ist oder du dich nicht registriert hast, kannst du diese E-Mail einfach ignorieren.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
  if (logMeta) mailOptions.__logMeta = logMeta;

  ensureEmailConfigured();

  return emailTransporter.sendMail(mailOptions);
}

// Nudge for "downloaded a wallet pass, never actually confirmed it" (see
// migrations/024_add_customer_wallet_activation_reminder.sql for why this
// can happen and why it's a separate flag from the generic onboarding
// reminder above). Primary CTA is the café's own registration/join page,
// not a raw re-download link - going through the normal add-flow again is
// the more reliable path (chat 2026-09-22). Stamp count is mentioned only
// as a bonus detail when there's something to mention, not the headline -
// this reminder fires for anyone with an unconfirmed pass, stamps or not.
async function sendWalletActivationReminderEmail({
  email,
  username,
  stampCount,
  cafeName,
  cafeLogoUrl,
  cafeJoinUrl,
  applePassUrl,
  profileUrl,
  logMeta,
}) {
  const displayName = String(username || "").trim() || "Kaffeekarte Gast";
  const stamps = Number(stampCount) || 0;
  const cafeLabel = cafeName || "deinem Café";

  const cafeBlockHtml = cafeName
    ? `<div style="display: flex; align-items: center; gap: 10px; margin: 0 0 18px;">
        ${
          cafeLogoUrl
            ? `<img src="${cafeLogoUrl}" alt="${cafeName}" width="36" height="36" style="width: 36px; height: 36px; border-radius: 8px; object-fit: cover; display: block;" />`
            : ""
        }
        <span style="color: #5f544a; font-size: 13px;">Dein Café: <strong style="color: #181311;">${cafeName}</strong></span>
      </div>`
    : "";

  const stampsLineHtml =
    stamps > 0
      ? `<p style="margin: 0 0 14px; color: #5f544a; font-size: 13px;">Übrigens: ${stamps} Stempel warten dort schon auf dich - die werden sichtbar, sobald die Karte aktiv ist.</p>`
      : "";

  const joinButtonHtml = cafeJoinUrl
    ? `<div style="margin: 0 0 14px;">
        <a href="${cafeJoinUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">Karte jetzt aktivieren</a>
      </div>`
    : applePassUrl
      ? `<div style="margin: 0 0 14px;">
          <a href="${applePassUrl}" style="display: inline-block; background: #1c1917; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 10px; font-weight: 700;">Jetzt zu Apple Wallet hinzufügen</a>
        </div>`
      : `<p style="margin: 0 0 14px; color: #6b625a; font-size: 13px;">Deine Karte findest du in deinem Profil: <a href="${profileUrl}" style="color: #1c1917;">${profileUrl}</a></p>`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: `${displayName}, deine Wallet-Karte von ${cafeLabel} ist noch nicht aktiv`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; background: #f6f1ea; margin: 0; padding: 24px;">
          <div style="max-width: 620px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(34, 24, 18, 0.1); border-radius: 16px; overflow: hidden;">
            <div style="padding: 28px 28px 20px; background: linear-gradient(180deg, #fffdf9, #f6efe5);">
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
              <h1 style="margin: 10px 0 8px; font-size: 28px; line-height: 1.1; color: #181311;">Fast geschafft, ${displayName}.</h1>
              <p style="margin: 0; color: #5f544a;">Du hast dir den Wallet-Pass von ${cafeLabel} geholt, aber nie aktiviert - deshalb bleibt er in Apple Wallet auf dem Stand von damals.</p>
            </div>
            <div style="padding: 24px 28px 30px;">
              ${cafeBlockHtml}
              ${stampsLineHtml}
              ${joinButtonHtml}
              <p style="margin: 18px 0 0; color: #8a7d70; font-size: 12px;">Falls das schon erledigt ist oder du dich nicht registriert hast, kannst du diese E-Mail einfach ignorieren.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: [
      `Fast geschafft, ${displayName}.`,
      "",
      `Du hast dir den Wallet-Pass von ${cafeLabel} geholt, aber nie aktiviert - deshalb bleibt er in Apple Wallet auf dem Stand von damals.`,
      "",
      cafeName ? `Dein Café: ${cafeName}` : "",
      stamps > 0
        ? `Uebrigens: ${stamps} Stempel warten dort schon auf dich.`
        : "",
      cafeJoinUrl
        ? `Karte jetzt aktivieren: ${cafeJoinUrl}`
        : applePassUrl
          ? `Zu Apple Wallet hinzufuegen: ${applePassUrl}`
          : `Deine Karte: ${profileUrl}`,
      "",
      "Falls das schon erledigt ist oder du dich nicht registriert hast, kannst du diese E-Mail einfach ignorieren.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
  if (logMeta) mailOptions.__logMeta = logMeta;

  ensureEmailConfigured();

  return emailTransporter.sendMail(mailOptions);
}

function adminNotifyAddress() {
  // Kein eigenes Secret noetig: APPS_BASE_URL ist pro Umgebung schon gesetzt
  // (docker-compose.{prod,staging}.yml), staging enthaelt "staging" in der
  // Domain, prod nicht.
  const base = String(process.env.APPS_BASE_URL || "").toLowerCase();
  return base.includes("staging") ? "info@staging.kaffeekarte.app" : "info@kaffeekarte.app";
}

async function sendAdminCustomerVerifiedEmail({ email, username, customerId }) {
  const to = adminNotifyAddress();

  const displayName = String(username || "").trim() || "(kein Name)";
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject: `Neuer bestaetigter Gast: ${displayName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #222; padding: 16px;">
          <p>Ein neuer Gast hat seine E-Mail bestaetigt:</p>
          <ul>
            <li><strong>Name:</strong> ${displayName}</li>
            <li><strong>E-Mail:</strong> ${email || "(unbekannt)"}</li>
            <li><strong>Kunden-ID:</strong> ${customerId || "(unbekannt)"}</li>
          </ul>
        </body>
      </html>
    `,
    text: `Neuer bestaetigter Gast\n\nName: ${displayName}\nE-Mail: ${email || "(unbekannt)"}\nKunden-ID: ${customerId || "(unbekannt)"}`,
  };

  ensureEmailConfigured();
  return emailTransporter.sendMail(mailOptions);
}

// Bewusst "fire and forget": ein Fehler oder eine fehlende Konfiguration
// hier darf niemals die eigentliche Registrierung/Verifizierung des Gasts
// zum Scheitern bringen, deshalb kein await/throw am Aufrufort.
function notifyAdminCustomerVerified(customer) {
  if (!customer) return;
  Promise.resolve(
    sendAdminCustomerVerifiedEmail({
      email: customer.email,
      username: customer.username,
      customerId: customer.customer_id,
    }),
  ).catch((err) => {
    console.warn(
      "Failed to send admin customer-verified notification:",
      err && err.message ? err.message : err,
    );
  });
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
              <div style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b625a; font-weight: 700;">Kaffeekarte</div>
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
  reminder_push_enabled INTEGER DEFAULT 0,
  reminder_min_stamps INTEGER DEFAULT 7,
  reminder_inactive_days INTEGER DEFAULT 14,
  reminder_message TEXT,
  reminder_full_message TEXT,
  reminder_new_customer_days INTEGER DEFAULT 21,
  reminder_new_customer_message TEXT,
  last_broadcast_at INTEGER,
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
  avatar_mime TEXT,
  avatar_data TEXT,
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

CREATE TABLE IF NOT EXISTS customer_oauth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS customer_auth_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  provider TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS customer_saved_cafes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  cafe_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(customer_id, cafe_address)
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

CREATE INDEX IF NOT EXISTS idx_customer_oauth_identities_customer ON customer_oauth_identities(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_auth_grants_hash ON customer_auth_grants(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_auth_grants_customer ON customer_auth_grants(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_saved_cafes_customer ON customer_saved_cafes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_saved_cafes_cafe ON customer_saved_cafes(cafe_address);

CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_hash ON cafe_email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_cafe ON cafe_email_verifications(cafe_id);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS wallet_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_number TEXT UNIQUE NOT NULL,
  customer_address TEXT NOT NULL,
  cafe_id INTEGER NOT NULL,
  authentication_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallet_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_library_identifier TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  push_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (serial_number) REFERENCES wallet_passes(serial_number) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_registrations_device_serial ON wallet_registrations(device_library_identifier, serial_number);
CREATE INDEX IF NOT EXISTS idx_wallet_registrations_serial ON wallet_registrations(serial_number);

-- Google Wallet is much simpler than Apple's setup: no device push-token
-- registry needed, Google syncs REST-API patches to the device on its own.
-- This just tracks which (customer, cafe) pairs actually have a card, so we
-- know who to patch on stamp events / cafe profile changes.
CREATE TABLE IF NOT EXISTS google_wallet_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT UNIQUE NOT NULL,
  customer_address TEXT NOT NULL,
  cafe_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);

-- One row per (café, customer) tracking the last push reminder sent and the
-- customer's stamp state (lastStampTs) at that moment - lets the matching
-- logic give "one push per state": skip while the state is unchanged, only
-- reconsider once they've stamped again and gone inactive a second time.
CREATE TABLE IF NOT EXISTS reminder_notifications (
  cafe_id INTEGER NOT NULL,
  customer_address TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  stamp_state_ts INTEGER NOT NULL,
  message TEXT,
  PRIMARY KEY (cafe_id, customer_address)
);

-- Append-only send history (reminder_notifications above only ever holds
-- the latest send per customer, for dedup) - one row per attempt, see
-- insertReminderLog.
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  customer_address TEXT NOT NULL,
  kind TEXT,
  message TEXT,
  stamp_state_ts INTEGER,
  apple_touched INTEGER,
  apple_pushed INTEGER,
  google_sent INTEGER,
  sent_at INTEGER NOT NULL
);

-- See migrations/025_add_email_log.sql - the mail counterpart to
-- reminder_log above, filled by a single sendMail wrapper.
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER,
  customer_address TEXT,
  kind TEXT,
  recipient TEXT NOT NULL,
  subject TEXT,
  success INTEGER NOT NULL,
  error TEXT,
  sent_at INTEGER NOT NULL
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
  "ALTER TABLE cafes ADD COLUMN short_description TEXT",
  "Failed to add cafes.short_description column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN logo_mime TEXT",
  "Failed to add cafes.logo_mime column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN logo_data TEXT",
  "Failed to add cafes.logo_data column:",
);
// See migrations/026_add_cafe_stamp_icon.sql - NULL means "use the default bean".
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN stamp_icon_mime TEXT",
  "Failed to add cafes.stamp_icon_mime column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN stamp_icon_data TEXT",
  "Failed to add cafes.stamp_icon_data column:",
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
  "ALTER TABLE cafes ADD COLUMN card_bg_color TEXT",
  "Failed to add cafes.card_bg_color column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN card_fg_color TEXT",
  "Failed to add cafes.card_fg_color column:",
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
  "ALTER TABLE cafes ADD COLUMN reminder_push_enabled INTEGER DEFAULT 0",
  "Failed to add cafes.reminder_push_enabled column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_min_stamps INTEGER DEFAULT 7",
  "Failed to add cafes.reminder_min_stamps column:",
);
// SQLite has no ALTER COLUMN ... SET DEFAULT, and ADD COLUMN above is a
// no-op once the column already exists (from when it defaulted to 3) - so
// a plain default-text change doesn't reach any SQLite database that's
// already run migration 017 (every local dev DB, plus staging, which is
// SQLite-backed; see docker-compose.staging.yml's "SQLite mode: omit
// DATABASE_URL"). This backfills any row still sitting at the old default.
// Idempotent (matches nothing once every row's been bumped) and safe to
// re-run every boot - reminder_push_enabled defaults to 0 and nothing has
// used this feature yet, so there's no café-chosen "3" to accidentally
// overwrite. Postgres (production) gets the equivalent fix via migration
// 021 instead.
runSqliteOnlyAlter(
  "UPDATE cafes SET reminder_min_stamps = 7 WHERE reminder_min_stamps = 3",
  "Failed to backfill cafes.reminder_min_stamps default:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_inactive_days INTEGER DEFAULT 14",
  "Failed to add cafes.reminder_inactive_days column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_message TEXT",
  "Failed to add cafes.reminder_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_full_message TEXT",
  "Failed to add cafes.reminder_full_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_new_customer_days INTEGER DEFAULT 21",
  "Failed to add cafes.reminder_new_customer_days column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN reminder_new_customer_message TEXT",
  "Failed to add cafes.reminder_new_customer_message column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE cafes ADD COLUMN last_broadcast_at INTEGER",
  "Failed to add cafes.last_broadcast_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE reminder_notifications ADD COLUMN message TEXT",
  "Failed to add reminder_notifications.message column:",
);
// Cleans up the per-platform tracking columns an earlier version of this
// migration added, superseded by the platform-agnostic reminder_notifications
// table above - harmless no-op (just a log line) on a database that never
// had them.
runSqliteOnlyAlter(
  "ALTER TABLE wallet_passes DROP COLUMN last_reminder_sent_at",
  "Failed to drop wallet_passes.last_reminder_sent_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE google_wallet_objects DROP COLUMN last_reminder_sent_at",
  "Failed to drop google_wallet_objects.last_reminder_sent_at column:",
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
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN avatar_mime TEXT",
  "Failed to add customers.avatar_mime column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN avatar_data TEXT",
  "Failed to add customers.avatar_data column:",
);

// One-shot "finish onboarding" reminder tracking + the café whose QR was
// scanned at registration (needed so the reminder email can name/show it).
// See migrations/016_add_customer_onboarding_reminder.sql for the Postgres
// side of this.
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN onboarding_reminder_sent_at INTEGER",
  "Failed to add customers.onboarding_reminder_sent_at column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN registered_via_cafe_address TEXT",
  "Failed to add customers.registered_via_cafe_address column:",
);
// See migrations/024_add_customer_wallet_activation_reminder.sql for why
// this is a separate flag from onboarding_reminder_sent_at above.
runSqliteOnlyAlter(
  "ALTER TABLE customers ADD COLUMN wallet_activation_reminder_sent_at INTEGER",
  "Failed to add customers.wallet_activation_reminder_sent_at column:",
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

// Favorite/pinned saved cafes (star toggle)
runSqliteOnlyAlter(
  "ALTER TABLE customer_saved_cafes ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
  "Failed to add customer_saved_cafes.is_favorite column:",
);

// Persists the single-use redeem-QR token while a wallet card is full, so
// repeated pass regenerations (e.g. a cafe profile save) reuse the same
// token/QR image instead of minting a new one every time. Cleared once the
// card drops back below the reward threshold (redeemed).
runSqliteOnlyAlter(
  "ALTER TABLE wallet_passes ADD COLUMN active_redeem_token TEXT",
  "Failed to add wallet_passes.active_redeem_token column:",
);
runSqliteOnlyAlter(
  "ALTER TABLE google_wallet_objects ADD COLUMN active_redeem_token TEXT",
  "Failed to add google_wallet_objects.active_redeem_token column:",
);

// Multi-card wallet support: a customer can have more than one wallet pass
// per cafe (one per card_id) once a full card overflows into a new one, so
// the old (customer, cafe) unique index - one row per customer+cafe, full
// stop - has to widen to (customer, cafe, card_id). NULL card_id (every
// pass issued before this feature existed) is still unique-safe under the
// new index: SQL treats each NULL as distinct, same as Postgres.
runSqliteOnlyAlter(
  "ALTER TABLE wallet_passes ADD COLUMN card_id TEXT",
  "Failed to add wallet_passes.card_id column:",
);
runSqliteOnlyAlter(
  "DROP INDEX IF EXISTS idx_wallet_passes_customer_cafe",
  "Failed to drop old wallet_passes unique index:",
);
runSqliteOnlyAlter(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_passes_customer_cafe_card ON wallet_passes(customer_address, cafe_id, card_id)",
  "Failed to create wallet_passes card-aware unique index:",
);
runSqliteOnlyAlter(
  "ALTER TABLE google_wallet_objects ADD COLUMN card_id TEXT",
  "Failed to add google_wallet_objects.card_id column:",
);
runSqliteOnlyAlter(
  "DROP INDEX IF EXISTS idx_google_wallet_objects_customer_cafe",
  "Failed to drop old google_wallet_objects unique index:",
);
runSqliteOnlyAlter(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_google_wallet_objects_customer_cafe_card ON google_wallet_objects(customer_address, cafe_id, card_id)",
  "Failed to create google_wallet_objects card-aware unique index:",
);

// Per-cafe, time-windowed dashboard charts filter on cafe_id + created_at,
// which the customer-address-first unique index above can't serve as an
// index seek. See migrations/015_add_wallet_cafe_time_indexes.sql for the
// Postgres side of this.
runSqliteOnlyAlter(
  "CREATE INDEX IF NOT EXISTS idx_wallet_passes_cafe_created ON wallet_passes(cafe_id, created_at)",
  "Failed to create wallet_passes cafe/created_at index:",
);
runSqliteOnlyAlter(
  "CREATE INDEX IF NOT EXISTS idx_google_wallet_objects_cafe_created ON google_wallet_objects(cafe_id, created_at)",
  "Failed to create google_wallet_objects cafe/created_at index:",
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
// COALESCE-on-both-sides because card_id can legitimately be NULL (a
// customer's original, pre-multi-card card) - a plain `card_id = ?` never
// matches a NULL column value via `=`, even when both sides are NULL.
//
// Requires the redeem event to be the *most recent* event on this card_id,
// not just "a redeem event exists somewhere in its history" - card_id = NULL
// is the shared default for every legacy/brand-new customer and can
// legitimately be redeemed and then start collecting fresh stamps again
// (every hex-minted card_id, by contrast, is one-shot: splitStampAward never
// assigns new stamps to one that's already full/redeemed, so for those the
// two phrasings agree). Confirmed live: a card_id = NULL redeemed back in
// July under the old decrement-based redeem model, then given a brand new
// stamp today, was still reported as permanently redeemed - the pass showed
// "already redeemed" the instant a single fresh stamp landed on it.
const hasCardBeenRedeemed = db.prepare(
  `SELECT 1 as ok FROM stamp_events se
   WHERE LOWER(se.cafe) = LOWER(?) AND LOWER(se."user") = LOWER(?)
     AND COALESCE(se.card_id, '') = COALESCE(?, '')
     AND se.event_type = 'redeem'
     AND (se.status IS NULL OR se.status = 'confirmed')
     AND NOT EXISTS (
       SELECT 1 FROM stamp_events se2
       WHERE LOWER(se2.cafe) = LOWER(se.cafe) AND LOWER(se2."user") = LOWER(se."user")
         AND COALESCE(se2.card_id, '') = COALESCE(se.card_id, '')
         AND se2.id > se.id
         AND (se2.status IS NULL OR se2.status = 'confirmed')
     )
   LIMIT 1`,
);
// Every distinct card_id this customer has ever had at this cafe, with its
// own isolated total - used to find every still-open (not yet redeemed)
// card, not just "the latest one". A customer can genuinely have more than
// one open card at once (a full one nobody has redeemed yet, plus a newer
// one collecting overflow) - both are real, both deserve their own wallet
// pass, restoring "the latest" alone would silently drop the first.
const getCardGroupsByCafeUser = db.prepare(
  "SELECT card_id, COALESCE(SUM(delta), 0) as total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') GROUP BY card_id",
);
// Every card_id this customer has ever had at this cafe, oldest first (by
// its first-ever event) - used to give a customer-facing "Stempelkarte #N"
// label instead of the raw hex card_id, which means nothing to them.
const getCardFirstSeenByCafeUser = db.prepare(
  "SELECT card_id, MIN(id) as first_id FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') GROUP BY card_id ORDER BY first_id ASC",
);
async function getCardOrdinal(cafeAddress, customerAddress, cardId) {
  const rows = await getCardFirstSeenByCafeUser.all(cafeAddress, customerAddress);
  const key = String(cardId || "");
  const index = (Array.isArray(rows) ? rows : []).findIndex(
    (r) => String(r.card_id || "") === key,
  );
  return index >= 0 ? index + 1 : null;
}
// "Current balance" for a customer at a cafe, meant to answer what staff
// actually need at the counter ("does this customer have enough to redeem
// right now") - sums only still-open cards, excluding any already-redeemed
// (permanently frozen) ones. Reused wherever a customer-facing or
// staff-facing total is shown, so it can't silently drift back to the old
// "sum every card_id ever" behavior in just one of the several places that
// show it.
async function getOpenStampTotal(cafeAddress, customerAddress) {
  const groups = await getCardGroupsByCafeUser.all(cafeAddress, customerAddress);
  let total = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    const redeemedRow = await hasCardBeenRedeemed.get(
      cafeAddress,
      customerAddress,
      g.card_id || null,
    );
    if (redeemedRow) continue;
    total += Number(g.total || 0);
  }
  return total;
}

// Whether a customer has a *confirmed* wallet channel at this café - used
// by /stamp-by-cafe to warn the barista live (see that route's own
// comment for the real support case this traced back to). Apple "active"
// means a wallet_registrations row exists for one of their passes here -
// Apple's own confirmation the pass truly made it into Wallet, not just
// that we served the file. Google has no such confirmation callback at
// all (same caveat as admin-dashboard.html's renderWalletPassBadge) - a
// saved object is the best signal available, so it counts as "active" on
// its own.
async function checkWalletActive(cafeId, customerAddress) {
  let walletActive = false;
  let hasWalletPass = false;
  try {
    if (cafeId != null) {
      const customerLower = String(customerAddress || "").toLowerCase();
      const applePassRows = await db
        .prepare(
          "SELECT serial_number FROM wallet_passes WHERE customer_address = ? AND cafe_id = ?",
        )
        .all(customerLower, cafeId);
      if (applePassRows.length) {
        hasWalletPass = true;
        const serials = applePassRows.map((r) => r.serial_number);
        const regRows = await db
          .prepare(
            `SELECT 1 FROM wallet_registrations WHERE serial_number IN (${serials.map(() => "?").join(",")}) LIMIT 1`,
          )
          .all(...serials);
        if (regRows.length) walletActive = true;
      }
      const googleRows = await db
        .prepare(
          "SELECT 1 FROM google_wallet_objects WHERE customer_address = ? AND cafe_id = ? LIMIT 1",
        )
        .all(customerLower, cafeId);
      if (googleRows.length) {
        hasWalletPass = true;
        walletActive = true;
      }
    }
  } catch (err) {
    console.warn("Wallet-active check failed:", err && err.message ? err.message : err);
  }
  return { walletActive, hasWalletPass };
}

// Redeeming a full card used to always mint a brand new card_id for
// whatever comes next - but if the customer already has a different, still-
// open, not-yet-full card (e.g. from an earlier overflow split that hasn't
// been redeemed yet), minting yet another one just piles up more cards
// nobody asked for, each needing its own separate "add to wallet" action.
// This looks for an existing reusable one first - excludes the card
// actually being redeemed and any already-closed ones, picks whichever
// still-open card is furthest along (so a customer collecting toward two
// different partial cards doesn't have progress arbitrarily reshuffled).
async function findReusableOpenCard(cafeAddress, customerAddress, excludeCardIds, threshold) {
  const groups = await getCardGroupsByCafeUser.all(cafeAddress, customerAddress);
  // Accepts either a single card_id (the common case) or an array - a
  // multi-segment overflow award needs to exclude every card it has already
  // assigned a segment to in this same call, not just the one it just filled.
  const excludeSet = new Set(
    (Array.isArray(excludeCardIds) ? excludeCardIds : [excludeCardIds]).map((c) =>
      String(c || ""),
    ),
  );
  let best = null;
  for (const g of Array.isArray(groups) ? groups : []) {
    const cid = g.card_id || null;
    if (excludeSet.has(String(cid || ""))) continue;
    const total = Number(g.total || 0);
    if (total >= threshold) continue;
    const redeemedRow = await hasCardBeenRedeemed.get(cafeAddress, customerAddress, cid);
    if (redeemedRow) continue;
    if (!best || total > best.total) {
      best = { cardId: cid, total };
    }
  }
  return best; // null if nothing reusable found
}

// Card boundaries: starting a new card should not delete old stamps.
// We treat both legacy `reset` and future `card_start` as boundaries.
// card_id IS NULL for the same reason as countEventsByCafeUserSinceTs below:
// redeeming now inserts a card_start event for the newly-opened (real,
// non-null) card_id - without this filter, that card_start "reset the
// clock" on the unrelated legacy null-card total too, wiping its own
// history out of its own isolated sum the moment any other card opened.
const getLastCardBoundaryTsByCafeUser = db.prepare(
  "SELECT COALESCE(MAX(ts), 0) AS ts FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') AND card_id IS NULL AND LOWER(COALESCE(event_type,'')) IN ('reset','card_start')",
);
// card_id IS NULL matters here, not just the boundary ts: once a customer's
// original (legacy, card_id-less) card overflows, a real card_id gets minted
// for the new one - without this filter, this "legacy card" total kept
// summing every later card's stamps too (they all pass the same ts/cafe/user
// match), permanently inflating an already-installed pass that can never be
// repointed at a different object id.
const countEventsByCafeUserSinceTs = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) AS total FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER(\"user\") = LOWER(?) AND (status IS NULL OR status = 'confirmed') AND ts >= ? AND card_id IS NULL AND LOWER(COALESCE(event_type,'')) NOT IN ('reset','card_start')",
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

// Ordered by id (strictly increasing insert order), not ts - a single
// overflow-splitting award can insert two segments within the same
// millisecond, and `ORDER BY ts DESC` alone doesn't reliably break that tie
// in insertion order (confirmed live: it returned the older segment).
const getLatestCardIdForCustomerCafe = db.prepare(
  'SELECT card_id FROM stamp_events WHERE LOWER(cafe) = LOWER(?) AND LOWER("user") = LOWER(?) ' +
    "AND (status IS NULL OR status = 'confirmed') ORDER BY id DESC LIMIT 1",
);

// A stamp award (usually 1, but cafes can grant up to 20 at once via
// /stamp-by-cafe's `count`) can push a customer past the reward threshold
// in a single request. Rather than let the running total drift past
// threshold on one card (ambiguous - is it "full" or "full plus 3 toward
// the next one"?), this splits the award across cards: fills whichever
// card is currently active up to exactly threshold, then keeps spilling
// any remainder into freshly-minted card_id(s), each capped at threshold
// in turn (so a large enough bulk grant can span more than 2 cards).
// Existing (pre-this-feature) history has card_id = NULL throughout - that
// stays the "active" card and behaves exactly as before, right up until it
// first actually fills up, which is the only moment new real card_ids
// start getting minted.
// `explicitCardId`, when given, targets that specific card instead of
// auto-resolving the customer's latest one - but still goes through the
// exact same threshold/split logic below, never a raw unsplit dump. A
// caller that already knows which card it means (e.g. a QR scanned once,
// reused across several stamp taps on the same still-open scanner page)
// should have its stamps land there *as long as it's still open*, not get
// silently redirected to a different card - but if that target is already
// full or redeemed, it still needs to open a fresh one and split overflow
// exactly like the auto-resolve path would. Confirmed live: without this,
// an explicit cardId let a card accumulate to 12/10 across three separate
// stamp calls with no split ever firing, and the 2 overflow stamps were
// gone the moment that card got redeemed (frozen at 12, new card opened at
// 0, not 2).
//
// An explicit target is trusted directly whenever it's a genuinely open
// card - exists in this customer's real history and isn't at/over threshold
// yet. That single count check also rules out already-redeemed cards for
// free: redemption is only ever reachable once a card is full (see
// /redeem-reward's redeemToken gating), so a redeemed card's frozen total is
// always >= threshold too. Deliberately NOT gated on "matches the latest
// card" - a customer can legitimately have more than one open card at once
// (see findReusableOpenCard below), and whichever one was actually scanned
// should get the stamps, not whichever happens to be most recent by
// insertion order. Confirmed live: a customer's older still-open card (1
// stamp, genuinely the one saved to their phone's Wallet) got skipped in
// favor of an unrelated "latest" card purely because that one had been
// touched more recently by earlier testing.
//
// Still gated on `latestRow` existing at all, though - trusting an explicit
// target for a customer with *no* real history is a different, already-
// fixed bug: it created two unrelated "first cards" where only one had a
// wallet pass actually pointing at it. Confirmed live on a customer wiped
// clean for a fresh test: registered a pass (card_id = null), then their
// very first stamps went to a brand new random card instead - the pass
// never showed anything, no notification ever fired, because nothing about
// that pass's own card had actually changed.
async function splitStampAward({
  cafeAddress,
  customerAddress,
  totalCount,
  threshold,
  explicitCardId,
}) {
  const latestRow = await getLatestCardIdForCustomerCafe.get(cafeAddress, customerAddress);
  const latestCardId = latestRow ? latestRow.card_id || null : null;

  let activeCardId;
  let activeCount;
  if (explicitCardId && latestRow) {
    const explicitCount = await getStampsByCafeUserCardId(
      cafeAddress,
      customerAddress,
      explicitCardId,
    );
    if (explicitCount < threshold) {
      activeCardId = explicitCardId;
      activeCount = explicitCount;
    }
  }

  if (activeCardId === undefined) {
    const latestCount = latestRow
      ? await getStampsByCafeUserCardId(cafeAddress, customerAddress, latestCardId)
      : 0;
    if (latestRow && latestCount < threshold) {
      activeCardId = latestCardId;
      activeCount = latestCount;
    } else if (latestRow) {
      // The latest card (and any stale/full explicit target above) can't
      // take more stamps - before minting yet another brand new card,
      // consolidate onto any other still-open card this customer already
      // has (see findReusableOpenCard), so a customer never ends up with
      // more simultaneously open cards than the ones that are genuinely
      // full and awaiting redemption.
      const reusable = await findReusableOpenCard(
        cafeAddress,
        customerAddress,
        latestCardId,
        threshold,
      );
      activeCardId = reusable ? reusable.cardId : crypto.randomBytes(8).toString("hex");
      activeCount = reusable ? reusable.total : 0;
    } else {
      // card_id = null for a customer with zero prior events is
      // intentional, not a fallback - see the doc comment above.
      activeCardId = null;
      activeCount = 0;
    }
  }

  const usedCardIds = [activeCardId];
  const segments = [];
  let remaining = Math.max(0, Math.floor(totalCount));
  while (remaining > 0) {
    const available = Math.max(0, threshold - activeCount);
    const take = Math.min(remaining, available);
    segments.push({ cardId: activeCardId, delta: take });
    remaining -= take;
    activeCount += take;
    if (remaining > 0) {
      // This card is now full and there's still more to award - consolidate
      // onto another already-open card first, same reasoning as above.
      // usedCardIds (not just this one card) so a large bulk grant spanning
      // 3+ cards can't loop back onto one it already filled earlier in this
      // same call, before that fill is reflected in the DB.
      const reusable = await findReusableOpenCard(
        cafeAddress,
        customerAddress,
        usedCardIds,
        threshold,
      );
      activeCardId = reusable ? reusable.cardId : crypto.randomBytes(8).toString("hex");
      activeCount = reusable ? reusable.total : 0;
      usedCardIds.push(activeCardId);
    }
  }

  const overflowed = segments.length > 1;
  return {
    segments,
    overflowed,
    newCardId: overflowed ? segments[segments.length - 1].cardId : null,
    newCardStamps: overflowed ? segments[segments.length - 1].delta : 0,
  };
}

// --- Apple Wallet pass registrations ---
// A customer can hold more than one pass per cafe now (one per card_id,
// once a full card overflows into a new one) - getWalletPassesByCustomerCafe
// lists all of them, getWalletPassByCustomerCafeCard targets one specific
// card. COALESCE(...,'') on both sides is needed because SQL NULL never
// equals NULL via plain `=` - card_id is NULL for every pass issued before
// this feature existed, and that has to keep matching itself.
const getWalletPassesByCustomerCafe = db.prepare(
  "SELECT * FROM wallet_passes WHERE customer_address = ? AND cafe_id = ?",
);
const getWalletPassByCustomerCafeCard = db.prepare(
  "SELECT * FROM wallet_passes WHERE customer_address = ? AND cafe_id = ? AND COALESCE(card_id, '') = COALESCE(?, '')",
);
const getWalletPassBySerial = db.prepare(
  "SELECT * FROM wallet_passes WHERE serial_number = ?",
);
const insertWalletPass = db.prepare(
  "INSERT INTO wallet_passes (serial_number, customer_address, cafe_id, card_id, authentication_token, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const touchWalletPassUpdatedAt = db.prepare(
  "UPDATE wallet_passes SET updated_at = ? WHERE serial_number = ?",
);
const setWalletPassRedeemToken = db.prepare(
  "UPDATE wallet_passes SET active_redeem_token = ? WHERE serial_number = ?",
);
const upsertWalletRegistration = db.prepare(
  "INSERT INTO wallet_registrations (device_library_identifier, serial_number, push_token, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (device_library_identifier, serial_number) DO UPDATE SET push_token = excluded.push_token",
);
const getWalletRegistration = db.prepare(
  "SELECT 1 AS ok FROM wallet_registrations WHERE device_library_identifier = ? AND serial_number = ?",
);
const deleteWalletRegistration = db.prepare(
  "DELETE FROM wallet_registrations WHERE device_library_identifier = ? AND serial_number = ?",
);
const listWalletPushTokensBySerial = db.prepare(
  "SELECT push_token FROM wallet_registrations WHERE serial_number = ?",
);
const listWalletPassesByCafe = db.prepare(
  "SELECT serial_number FROM wallet_passes WHERE cafe_id = ?",
);
const listWalletPushTokensByCafe = db.prepare(
  "SELECT wr.push_token AS push_token FROM wallet_registrations wr " +
    "JOIN wallet_passes wp ON wp.serial_number = wr.serial_number " +
    "WHERE wp.cafe_id = ?",
);
const listWalletSerialsByDeviceSince = db.prepare(
  "SELECT wp.serial_number AS serial_number, wp.updated_at AS updated_at FROM wallet_registrations wr " +
    "JOIN wallet_passes wp ON wp.serial_number = wr.serial_number " +
    "WHERE wr.device_library_identifier = ? AND wp.updated_at > ?",
);

async function getOrCreateWalletPass(customerAddress, cafeId, cardId) {
  const cid = cardId || null;
  const existing = await getWalletPassByCustomerCafeCard.get(
    customerAddress,
    cafeId,
    cid,
  );
  if (existing) return existing;

  const now = Date.now();
  const serialNumber = crypto.randomUUID();
  const authenticationToken = crypto.randomBytes(24).toString("hex");
  try {
    await insertWalletPass.run(
      serialNumber,
      customerAddress,
      cafeId,
      cid,
      authenticationToken,
      now,
      now,
    );
  } catch (err) {
    // Concurrent first-issue race: someone else just created the same
    // (customer, cafe, card) pass. Fall back to reading it instead of failing.
    const raceWinner = await getWalletPassByCustomerCafeCard.get(
      customerAddress,
      cafeId,
      cid,
    );
    if (raceWinner) return raceWinner;
    throw err;
  }
  return { serial_number: serialNumber, customer_address: customerAddress, cafe_id: cafeId, card_id: cid, authentication_token: authenticationToken, updated_at: now, created_at: now };
}

async function notifyWalletPassUpdated(customerAddress, cafeAddress) {
  try {
    const cafeRow = await db
      .prepare("SELECT id FROM cafes WHERE LOWER(address) = LOWER(?)")
      .get(cafeAddress);
    if (!cafeRow) return;
    // A customer can have more than one pass for this cafe now (one per
    // card_id) - touch+push all of them. The actual stampCount per pass is
    // recomputed fresh (for that pass's own card_id) when the device
    // re-fetches via the webservice route below, not here.
    const passRows = await getWalletPassesByCustomerCafe.all(
      customerAddress,
      cafeRow.id,
    );
    if (!passRows.length) return; // Customer never added a card to Wallet.
    if (!walletPass.isWalletConfigured()) return;
    const now = Date.now();
    const tokens = [];
    for (const passRow of passRows) {
      await touchWalletPassUpdatedAt.run(now, passRow.serial_number);
      const tokenRows = await listWalletPushTokensBySerial.all(passRow.serial_number);
      for (const r of Array.isArray(tokenRows) ? tokenRows : []) {
        if (r.push_token) tokens.push(r.push_token);
      }
    }
    if (tokens.length) {
      await walletPass.sendPassUpdatePush(tokens);
    }
  } catch (err) {
    console.warn("Failed to notify wallet pass update:", err.message || err);
  }
}

// Cafe profile edits (color, logo, website/instagram, reward text, ...)
// change what generateSignedPass() renders, but unlike stamp events there's
// no natural "moment" that already pushes to every affected device - without
// this, an already-issued card would keep showing the old profile until its
// next stamp/redeem, which can be days away. Pushes to *every* card for this
// cafe, not just one customer's.
async function notifyWalletPassesForCafe(cafeId) {
  try {
    if (!walletPass.isWalletConfigured()) return;
    const passRows = await listWalletPassesByCafe.all(cafeId);
    if (!passRows.length) return;
    const now = Date.now();
    for (const row of passRows) {
      await touchWalletPassUpdatedAt.run(now, row.serial_number);
    }
    const tokenRows = await listWalletPushTokensByCafe.all(cafeId);
    const tokens = (Array.isArray(tokenRows) ? tokenRows : [])
      .map((r) => r.push_token)
      .filter(Boolean);
    if (tokens.length) {
      await walletPass.sendPassUpdatePush(tokens);
    }
  } catch (err) {
    console.warn("Failed to notify wallet passes for cafe:", err.message || err);
  }
}

// --- Google Wallet loyalty objects (Android) ---
// No device push-token registry needed here, unlike Apple - this table just
// tracks which (customer, cafe[, card]) triples actually have a card, so
// stamp events know who's worth patching instead of firing a REST call on
// every event. A customer can have more than one object per cafe now (one
// per card_id), same reasoning as the Apple side.
const getGoogleWalletObjectsByCustomerCafe = db.prepare(
  "SELECT * FROM google_wallet_objects WHERE customer_address = ? AND cafe_id = ?",
);
const getGoogleWalletObjectByCustomerCafeCard = db.prepare(
  "SELECT * FROM google_wallet_objects WHERE customer_address = ? AND cafe_id = ? AND COALESCE(card_id, '') = COALESCE(?, '')",
);
const insertGoogleWalletObject = db.prepare(
  "INSERT INTO google_wallet_objects (object_id, customer_address, cafe_id, card_id, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const touchGoogleWalletObjectUpdatedAt = db.prepare(
  "UPDATE google_wallet_objects SET updated_at = ? WHERE object_id = ?",
);
const setGoogleWalletObjectRedeemToken = db.prepare(
  "UPDATE google_wallet_objects SET active_redeem_token = ? WHERE object_id = ?",
);
const listGoogleWalletObjectsByCafe = db.prepare(
  "SELECT customer_address, object_id, card_id, active_redeem_token FROM google_wallet_objects WHERE cafe_id = ?",
);

async function getOrCreateGoogleWalletObject(customerAddress, cafeId, cardId, objectId) {
  const cid = cardId || null;
  const existing = await getGoogleWalletObjectByCustomerCafeCard.get(
    customerAddress,
    cafeId,
    cid,
  );
  if (existing) return existing;

  const now = Date.now();
  try {
    await insertGoogleWalletObject.run(objectId, customerAddress, cafeId, cid, now, now);
  } catch (err) {
    // Concurrent first-issue race: someone else just created the same
    // (customer, cafe, card) object row. Fall back to reading it instead of failing.
    const raceWinner = await getGoogleWalletObjectByCustomerCafeCard.get(
      customerAddress,
      cafeId,
      cid,
    );
    if (raceWinner) return raceWinner;
    throw err;
  }
  return { object_id: objectId, customer_address: customerAddress, cafe_id: cafeId, card_id: cid, updated_at: now, created_at: now };
}

async function notifyGoogleWalletPassUpdated(customerAddress, cafeAddress) {
  try {
    if (!googleWalletPass.isGoogleWalletConfigured()) return;
    const cafeRow = await db
      .prepare("SELECT * FROM cafes WHERE LOWER(address) = LOWER(?)")
      .get(cafeAddress);
    if (!cafeRow) return;
    const objectRows = await getGoogleWalletObjectsByCustomerCafe.all(
      customerAddress,
      cafeRow.id,
    );
    if (!objectRows.length) return; // Customer never added a card to Google Wallet.
    const customerRow = await getCustomerByAddress.get(customerAddress);
    const program = getCafeProgramSettings(cafeRow);
    for (const objectRow of objectRows) {
      const stampCount = await getStampsByCafeUserCardId(
        cafeAddress,
        customerAddress,
        objectRow.card_id,
      );
      const isRedeemed = !!(await hasCardBeenRedeemed.get(
        cafeAddress,
        customerAddress,
        objectRow.card_id,
      ));
      const cardNumber = await getCardOrdinal(cafeAddress, customerAddress, objectRow.card_id);
      await touchGoogleWalletObjectUpdatedAt.run(Date.now(), objectRow.object_id);
      const barcodeMessage = await resolveWalletBarcode({
        customerAddress,
        customerName: customerRow ? customerRow.username : null,
        cafeAddress,
        cardId: objectRow.card_id,
        stampCount,
        threshold: program.stampsForReward,
        currentToken: objectRow.active_redeem_token || null,
        persistToken: (token) =>
          setGoogleWalletObjectRedeemToken.run(token, objectRow.object_id),
        isRedeemed,
      });
      await googleWalletPass.patchLoyaltyObjectStamps({
        cafeRow,
        program,
        stampCount,
        isRedeemed,
        customerAddress,
        customerName: customerRow ? customerRow.username : null,
        cardId: objectRow.card_id,
        barcodeMessage,
        appsBaseUrl: process.env.APPS_BASE_URL || "",
        // Real stamp/redeem event - worth the lock-screen notification
        // (capped at 3/24h by Google, so only fire it where it's genuinely
        // earned, not on the profile-resync path below).
        notify: true,
        customerEmail: customerRow ? customerRow.email : null,
        customerId: customerRow ? customerRow.customer_id : null,
        cardNumber,
        objectId: objectRow.object_id,
      });
    }
  } catch (err) {
    console.warn("Failed to notify Google Wallet pass update:", err.message || err);
  }
}

// Cafe profile edits live mostly on the loyalty class (color, logo, name) -
// one patch covers everyone there, no per-customer loop needed. But some
// cafe-derived fields (info text, website/Instagram, terms, and the stamp
// image's own color) are baked into each *object* instead, so they also
// need a per-customer repatch - otherwise a color change only reaches the
// visible card (class-level), while the stamp-progress image and back-page
// text stay stale until that customer's next stamp event.
async function notifyGoogleWalletClassForCafe(cafeRow) {
  if (!googleWalletPass.isGoogleWalletConfigured()) return;
  const appsBaseUrl = process.env.APPS_BASE_URL || "";

  try {
    const objectRows = await listGoogleWalletObjectsByCafe.all(cafeRow.id);
    const program = getCafeProgramSettings(cafeRow);

    // Patch every distinct class this cafe's *existing* objects actually
    // reference - not just the one freshly computed from the cafe's current
    // address. A cafe whose objects predate the cafe.id -> cafe.address
    // migration has its real, customer-visible class under the old id;
    // patching only the fresh one left it frozen at whatever it was first
    // created with (confirmed live: a stale test name/color kept showing
    // despite repeated dashboard edits). Always includes the current/fresh
    // id too, so the class is ready for the next customer who saves new.
    const classIds = new Set([googleWalletPass.resolveClassIdForObject(cafeRow, "", null, null)]);
    for (const row of objectRows) {
      classIds.add(
        googleWalletPass.resolveClassIdForObject(cafeRow, row.customer_address, row.card_id, row.object_id),
      );
    }
    for (const classId of classIds) {
      await googleWalletPass.patchLoyaltyClassForCafe(cafeRow, appsBaseUrl, classId);
    }

    for (const row of objectRows) {
      const customerRow = await getCustomerByAddress.get(row.customer_address);
      const stampCount = await getStampsByCafeUserCardId(
        cafeRow.address,
        row.customer_address,
        row.card_id,
      );
      const isRedeemed = !!(await hasCardBeenRedeemed.get(
        cafeRow.address,
        row.customer_address,
        row.card_id,
      ));
      const cardNumber = await getCardOrdinal(cafeRow.address, row.customer_address, row.card_id);
      const barcodeMessage = await resolveWalletBarcode({
        customerAddress: row.customer_address,
        customerName: customerRow ? customerRow.username : null,
        cafeAddress: cafeRow.address,
        cardId: row.card_id,
        stampCount,
        threshold: program.stampsForReward,
        currentToken: row.active_redeem_token || null,
        persistToken: (token) =>
          setGoogleWalletObjectRedeemToken.run(token, row.object_id),
        isRedeemed,
      });
      await googleWalletPass.patchLoyaltyObjectStamps({
        cafeRow,
        program,
        stampCount,
        isRedeemed,
        customerAddress: row.customer_address,
        customerName: customerRow ? customerRow.username : null,
        cardId: row.card_id,
        barcodeMessage,
        appsBaseUrl,
        customerEmail: customerRow ? customerRow.email : null,
        customerId: customerRow ? customerRow.customer_id : null,
        cardNumber,
        objectId: row.object_id,
      });
    }
  } catch (err) {
    console.warn("Failed to resync Google Wallet objects for cafe:", err.message || err);
  }
}

function buildCafeScannerLink(customerAddress, customerName, cafeAddress, cardId) {
  const base = String(process.env.APPS_BASE_URL || "").replace(/\/$/, "");
  const u = new URL(`${base}/cafe-scanner-new.html`);
  u.searchParams.set("customer", customerAddress);
  u.searchParams.set("customerName", customerName || "");
  if (cafeAddress) u.searchParams.set("cafe", cafeAddress);
  // Omitted for legacy (pre-multi-card) passes - keeps their URL byte-for-
  // byte identical to before, no behavior change for existing customers.
  if (cardId) u.searchParams.set("cardId", cardId);
  return u.toString();
}

// Same shape as the in-app card's buildRedeemLink() (customer-qr-modern.js)
// - a single-use "rt" token the cafe scanner's redeem endpoint consumes
// atomically. The in-app card mints a fresh client-side token every few
// minutes since it's regenerated live in the browser; a wallet pass's
// barcode is static between regenerations, so instead this persists ONE
// token per wallet row for as long as the card stays full, reusing it
// across regenerations (e.g. an unrelated cafe profile save) instead of
// invalidating the QR the customer might already be looking at, and only
// clears it once the card drops back below threshold (i.e. redeemed).
async function resolveWalletBarcode({
  customerAddress,
  customerName,
  cafeAddress,
  cardId,
  stampCount,
  threshold,
  currentToken,
  persistToken,
  isRedeemed,
}) {
  // A redeemed card stays visibly full (see buildPassJson/
  // buildLoyaltyObjectPayload's isRedeemed badge) rather than resetting -
  // but it must stop offering a redeem QR the instant it's closed, or it'd
  // keep re-showing the same (already consumed) link forever, indistinguish-
  // able from a genuinely new "ready to redeem" card.
  const isFull = !isRedeemed && stampCount >= threshold;
  if (!isFull) {
    if (currentToken) {
      try {
        await persistToken(null);
      } catch (err) {}
    }
    return buildCafeScannerLink(customerAddress, customerName, cafeAddress, cardId);
  }

  let token = currentToken;
  if (!token) {
    token = crypto.randomBytes(16).toString("hex");
    await persistToken(token);
  }

  const base = String(process.env.APPS_BASE_URL || "").replace(/\/$/, "");
  const u = new URL(`${base}/cafe-scanner-new.html`);
  u.searchParams.set("customer", customerAddress);
  u.searchParams.set("customerName", customerName || "");
  if (cafeAddress) u.searchParams.set("cafe", cafeAddress);
  if (cardId) u.searchParams.set("cardId", cardId);
  u.searchParams.set("action", "redeem");
  u.searchParams.set("rt", token);
  return u.toString();
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
const setCafeStampIconById = db.prepare(
  "UPDATE cafes SET stamp_icon_mime = ?, stamp_icon_data = ? WHERE id = ?",
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
const deleteCafeSessionsByCafeId = db.prepare(
  "DELETE FROM cafe_sessions WHERE cafe_id = ?",
);
const deleteCafeEmailVerificationsByCafeId = db.prepare(
  "DELETE FROM cafe_email_verifications WHERE cafe_id = ?",
);
const deleteCafePasswordResetsByCafeId = db.prepare(
  "DELETE FROM cafe_password_resets WHERE cafe_id = ?",
);
const deleteQrNoncesByCafeId = db.prepare(
  "DELETE FROM qr_nonces WHERE cafe_id = ?",
);
const deleteRedeemTokensByCafeAddress = db.prepare(
  'DELETE FROM redeem_tokens WHERE LOWER(COALESCE(cafe, \'\')) = LOWER(?) OR LOWER(COALESCE(used_by_cafe, \'\')) = LOWER(?)',
);
const deleteStampEventsByCafeAddress = db.prepare(
  "DELETE FROM stamp_events WHERE LOWER(cafe) = LOWER(?)",
);
const deleteCafeById = db.prepare("DELETE FROM cafes WHERE id = ?");
const getCafePasswordResetByHash = db.prepare(
  "SELECT * FROM cafe_password_resets WHERE token_hash = ? LIMIT 1",
);
const markCafePasswordResetUsedById = db.prepare(
  "UPDATE cafe_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL",
);

const updateCafeProfileById = db.prepare(
  "UPDATE cafes SET about_text = ?, short_description = ?, redeem_message = ?, logo_mime = ?, logo_data = ?, card_bg_mime = ?, card_bg_data = ?, card_back_text = ?, location_address = ?, lat = ?, lng = ?, website_url = ?, instagram_url = ?, card_theme = ?, card_bg_color = ?, card_fg_color = ?, stamp_style = ?, stamps_for_reward = ?, reward_description = ?, popup_inactive_enabled = ?, popup_inactive_days = ?, popup_inactive_message = ?, popup_almost_reward_enabled = ?, popup_almost_reward_remaining = ?, popup_almost_reward_message = ?, reminder_push_enabled = ?, reminder_min_stamps = ?, reminder_inactive_days = ?, reminder_message = ?, reminder_full_message = ?, reminder_new_customer_days = ?, reminder_new_customer_message = ?, updated_at = ? WHERE id = ?",
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
  "INSERT INTO customers (customer_id, username, email, address, encrypted_key, password_hash, accepted_privacy_at, accepted_terms_at, privacy_version, terms_version, email_verified_at, created_at, registered_via_cafe_address) VALUES (@customer_id, @username, @email, @address, @encrypted_key, @password_hash, @accepted_privacy_at, @accepted_terms_at, @privacy_version, @terms_version, @email_verified_at, @created_at, @registered_via_cafe_address)",
);
const listCustomers = db.prepare("SELECT * FROM customers ORDER BY id DESC");
const getCustomerByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, avatar_mime, avatar_data, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1",
);
const getCustomerAuthByEmail = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, password_hash, email_verified_at, avatar_mime, avatar_data, created_at FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1",
);
const getCustomerById = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, password_hash, email_verified_at, avatar_mime, avatar_data, created_at FROM customers WHERE id = ? LIMIT 1",
);
const getCustomerByAddress = db.prepare(
  "SELECT id, customer_id, username, email, address, encrypted_key, password_hash, email_verified_at, avatar_mime, avatar_data, created_at FROM customers WHERE LOWER(address) = LOWER(?) LIMIT 1",
);
const setCustomerPasswordHashById = db.prepare(
  "UPDATE customers SET password_hash = ? WHERE id = ?",
);
const setCustomerUsernameById = db.prepare(
  "UPDATE customers SET username = ? WHERE id = ?",
);
const setCustomerEmailVerifiedAtById = db.prepare(
  "UPDATE customers SET email_verified_at = ? WHERE id = ?",
);
const markCustomerOnboardingReminderSentById = db.prepare(
  "UPDATE customers SET onboarding_reminder_sent_at = ? WHERE id = ? AND onboarding_reminder_sent_at IS NULL",
);
const markCustomerWalletActivationReminderSentById = db.prepare(
  "UPDATE customers SET wallet_activation_reminder_sent_at = ? WHERE id = ? AND wallet_activation_reminder_sent_at IS NULL",
);
const setCustomerAvatarById = db.prepare(
  "UPDATE customers SET avatar_mime = ?, avatar_data = ? WHERE id = ?",
);
const getCustomerOauthIdentity = db.prepare(
  "SELECT * FROM customer_oauth_identities WHERE provider = ? AND provider_subject = ? LIMIT 1",
);
const insertCustomerOauthIdentity = db.prepare(
  "INSERT INTO customer_oauth_identities (customer_id, provider, provider_subject, email, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const updateCustomerOauthIdentityLastUsed = db.prepare(
  "UPDATE customer_oauth_identities SET customer_id = ?, email = ?, last_used_at = ? WHERE provider = ? AND provider_subject = ?",
);
const insertCustomerAuthGrant = db.prepare(
  "INSERT INTO customer_auth_grants (customer_id, token_hash, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
);
const getCustomerAuthGrantByHash = db.prepare(
  "SELECT * FROM customer_auth_grants WHERE token_hash = ? LIMIT 1",
);
const markCustomerAuthGrantUsedById = db.prepare(
  "UPDATE customer_auth_grants SET used_at = ? WHERE id = ? AND used_at IS NULL",
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
const deleteCustomerEmailVerificationsByCustomerId = db.prepare(
  "DELETE FROM customer_email_verifications WHERE customer_id = ?",
);
const deleteCustomerPasswordResetsByCustomerId = db.prepare(
  "DELETE FROM customer_password_resets WHERE customer_id = ?",
);
const deleteCustomerOauthIdentitiesByCustomerId = db.prepare(
  "DELETE FROM customer_oauth_identities WHERE customer_id = ?",
);
const deleteCustomerAuthGrantsByCustomerId = db.prepare(
  "DELETE FROM customer_auth_grants WHERE customer_id = ?",
);
const listCustomerSavedCafeAddressesByCustomerId = db.prepare(
  "SELECT cafe_address, created_at, is_favorite FROM customer_saved_cafes WHERE customer_id = ? ORDER BY created_at ASC, id ASC",
);
const deleteCustomerSavedCafesByCustomerId = db.prepare(
  "DELETE FROM customer_saved_cafes WHERE customer_id = ?",
);
const insertCustomerSavedCafe = db.prepare(
  db.client === "postgres"
    ? "INSERT INTO customer_saved_cafes (customer_id, cafe_address, created_at) VALUES (?, ?, ?) ON CONFLICT (customer_id, cafe_address) DO NOTHING"
    : "INSERT OR IGNORE INTO customer_saved_cafes (customer_id, cafe_address, created_at) VALUES (?, ?, ?)",
);
const setCustomerSavedCafeFavorite = db.prepare(
  "INSERT INTO customer_saved_cafes (customer_id, cafe_address, created_at, is_favorite) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (customer_id, cafe_address) DO UPDATE SET is_favorite = excluded.is_favorite",
);
const deleteRedeemTokensByCustomerAddress = db.prepare(
  'DELETE FROM redeem_tokens WHERE LOWER(COALESCE("user", \'\')) = LOWER(?)',
);
const deleteStampEventsByCustomerAddress = db.prepare(
  'DELETE FROM stamp_events WHERE LOWER("user") = LOWER(?)',
);
const deleteCustomerById = db.prepare("DELETE FROM customers WHERE id = ?");
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
    reminderPushEnabled: toBoundBoolInt(src.reminder_push_enabled, 0),
    reminderMinStamps: toBoundInt(src.reminder_min_stamps, 7, 3, 9),
    reminderInactiveDays: toBoundInt(src.reminder_inactive_days, 14, 1, 365),
    reminderMessage: toOptionalTrimmedText(src.reminder_message, 280),
    reminderFullMessage: toOptionalTrimmedText(src.reminder_full_message, 280),
    reminderNewCustomerDays: toBoundInt(src.reminder_new_customer_days, 21, 7, 90),
    reminderNewCustomerMessage: toOptionalTrimmedText(
      src.reminder_new_customer_message,
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

    const cafeAddress = String(cafeId);
    const cafeRowForProgram = await getCafeRowByAddress.get(cafeAddress);
    const program = getCafeProgramSettings(cafeRowForProgram);
    const { segments, overflowed, newCardId, newCardStamps } =
      await splitStampAward({
        cafeAddress,
        customerAddress: customer,
        totalCount: 1,
        threshold: program.stampsForReward,
      });

    // One row per segment - almost always just one (a single stamp landing
    // on the already-active card), only splits if that card was already
    // exactly full when this stamp arrived.
    let lastTx = null;
    for (const seg of segments) {
      const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
      lastTx = localTx;
      const ev = {
        ts: Date.now(),
        cafe: cafeAddress,
        customer_name: null,
        user: customer,
        txhash: localTx,
        status: "confirmed",
        event_type: "stamp",
        delta: seg.delta,
        card_id: seg.cardId,
      };
      await insertEvent.run(ev);
      try {
        broadcastEvent(ev);
      } catch (e) {}
    }
    if (overflowed) {
      try {
        broadcastEvent({
          cafe: cafeAddress,
          user: customer,
          event_type: "card_overflow",
          newCardId,
          newCardStamps,
        });
      } catch (e) {}
      notifyNewCardByEmail(customer, cafeAddress, newCardId);
    }
    notifyWalletPassUpdated(customer, cafeAddress);
    notifyGoogleWalletPassUpdated(customer, cafeAddress);

    res.json({ success: true, status: "confirmed", txHash: lastTx });
  } catch (err) {
    console.error("Error in /stamp:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Fired only on a genuine overflow (a bulk award crossing the threshold
// mid-request) - not on every redemption, since a redemption happens with
// the customer standing right there, already looking at their phone. An
// overflow can happen with the customer nowhere near their phone (a cafe
// granting a bulk bonus), so email is the one channel guaranteed to reach
// them regardless of platform or whether they ever open the app.
async function notifyNewCardByEmail(customerAddress, cafeAddress, newCardId) {
  try {
    const customerRow = await getCustomerByAddress.get(customerAddress);
    if (!customerRow || !customerRow.email || !customerRow.email_verified_at) return;
    const cafeRow = await getCafeRowByAddress.get(cafeAddress);
    if (!cafeRow) return;
    const program = getCafeProgramSettings(cafeRow);
    const appsBaseUrl = process.env.APPS_BASE_URL || "";
    const cardNumber = await getCardOrdinal(cafeAddress, customerAddress, newCardId);
    // Not always 0 - a reused still-open card (see findReusableOpenCard in
    // /redeem-reward) can already have real progress the moment this email
    // goes out. Confirmed live: an email sent for a card at 2 stamps but
    // opened later, after more had landed, created the Google object frozen
    // at 2 forever (see the getOrCreateGoogleWalletObject comment below).
    const stampCount = await getStampsByCafeUserCardId(cafeAddress, customerAddress, newCardId);

    const barcodeMessage = await resolveWalletBarcode({
      customerAddress,
      customerName: customerRow.username,
      cafeAddress,
      cardId: newCardId,
      stampCount,
      threshold: program.stampsForReward,
      currentToken: null,
      persistToken: () => {},
    });

    const applePassUrl = walletPass.isWalletConfigured()
      ? `${appsBaseUrl}/api/customers/${encodeURIComponent(customerAddress)}/wallet-pass?cafe=${encodeURIComponent(cafeAddress)}&cardId=${encodeURIComponent(newCardId)}`
      : null;

    let googleSaveUrl = null;
    if (googleWalletPass.isGoogleWalletConfigured()) {
      // Unlike the Apple link above (a direct fetch of our own always-live
      // route), tapping this save link hands the customer straight to
      // Google's servers with a JWT snapshot baked in - our own server
      // never hears about it. Without registering the object here the same
      // way the HTTP save-link route does, every later stamp on this card
      // has nothing to re-patch (notifyGoogleWalletPassUpdated only walks
      // objects it already knows about), leaving the card frozen at
      // whatever this one snapshot said forever. Confirmed live.
      const objectId = googleWalletPass.loyaltyObjectId(cafeRow.address, customerAddress, newCardId);
      const objectRow = await getOrCreateGoogleWalletObject(customerAddress, cafeRow.id, newCardId, objectId);
      const { saveUrl } = googleWalletPass.buildSaveLink({
        cafeRow,
        program,
        stampCount,
        customerAddress,
        customerName: customerRow.username,
        cardId: newCardId,
        barcodeMessage,
        appsBaseUrl,
        customerEmail: customerRow.email || null,
        customerId: customerRow.customer_id || null,
        cardNumber,
        objectId: objectRow.object_id,
      });
      googleSaveUrl = saveUrl;
    }

    if (!applePassUrl && !googleSaveUrl) return;

    const profileUrl = `${appsBaseUrl}/customer-profile`;

    await sendNewCardReadyEmail({
      email: customerRow.email,
      customerName: customerRow.username,
      cafeName: cafeRow.name,
      cardNumber,
      applePassUrl,
      googleSaveUrl,
      profileUrl,
    });
  } catch (err) {
    console.warn("Failed to send new-card-ready email:", err.message || err);
  }
}

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

    // Always goes through splitStampAward, explicit cardId or not - it
    // still targets that specific card when given, but never lets it
    // accept more than `threshold` before opening a fresh one and
    // splitting the remainder, exactly like the auto-resolve path.
    const cafeRowForProgram = await getCafeRowByAddress.get(cafeAddress);
    const program = getCafeProgramSettings(cafeRowForProgram);
    const split = await splitStampAward({
      cafeAddress,
      customerAddress: customer,
      totalCount: cnt,
      threshold: program.stampsForReward,
      explicitCardId: normalizedCardId,
    });
    const segments = split.segments;
    const overflowed = split.overflowed;
    const newCardId = split.newCardId;
    const newCardStamps = split.newCardStamps;

    let lastTx = null;
    for (const seg of segments) {
      const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
      lastTx = localTx;
      const ev = {
        ts: Date.now(),
        cafe: cafeAddress,
        customer_name: customerName || null,
        user: customer,
        txhash: localTx,
        status: "confirmed",
        event_type: "stamp",
        delta: seg.delta,
        card_id: seg.cardId,
      };
      await insertEvent.run(ev);
      try {
        broadcastEvent(ev);
      } catch (e) {}
    }
    if (overflowed) {
      try {
        broadcastEvent({
          cafe: cafeAddress,
          user: customer,
          event_type: "card_overflow",
          newCardId,
          newCardStamps,
        });
      } catch (e) {}
      notifyNewCardByEmail(customer, cafeAddress, newCardId);
    }
    notifyWalletPassUpdated(customer, cafeAddress);
    notifyGoogleWalletPassUpdated(customer, cafeAddress);

    // Lets the scanner UI warn the barista right when it matters, instead
    // of a customer finding out days later that their card never actually
    // updated (chat 2026-09-21 - traced a real support case to exactly
    // this: stamps recorded correctly, but the customer's Apple Wallet
    // pass was never registered for updates, so nothing ever appeared).
    const walletStatus = await checkWalletActive(
      cafeRowForProgram && cafeRowForProgram.id,
      customer,
    );

    res.json({
      success: true,
      status: "confirmed",
      count: cnt,
      txHash: lastTx,
      overflowed,
      newCardId,
      newCardStamps,
      walletActive: walletStatus.walletActive,
      hasWalletPass: walletStatus.hasWalletPass,
    });
  } catch (err) {
    console.error("Error in /stamp-by-cafe:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Corrects a mistaken stamp award - inserts a negative-delta event on the
// customer's currently open card instead of mutating/deleting past events
// (same "history is append-only" convention as redemption/reset already
// use). Clamped so a card can never go below 0, and rejected outright on
// an already-redeemed card - that's a closed historical record, not
// something a café should be able to edit after the fact.
app.post("/remove-stamp", requireCafeAuth, async (req, res) => {
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

    let normalizedCardId = null;
    const rawCardId =
      cardId != null ? cardId : cid != null ? cid : card != null ? card : null;
    const s = rawCardId != null ? String(rawCardId).trim() : "";
    if (s && s !== "__legacy__") {
      if (s.length > 128) {
        return res.status(400).json({ error: "card_id_invalid" });
      }
      normalizedCardId = s;
    }

    // Same target-resolution as splitStampAward's explicit-cardId path
    // (see its own comment): trust an explicit target only if it's a real,
    // still-open card in this customer's history; otherwise fall back to
    // whichever card their latest event actually belongs to.
    let targetCardId = normalizedCardId;
    if (targetCardId != null) {
      const targetTotal = await getStampsByCafeUserCardId(
        cafeAddress,
        customer,
        targetCardId,
      );
      const targetRedeemed = await hasCardBeenRedeemed.get(
        cafeAddress,
        customer,
        targetCardId,
      );
      if (targetRedeemed || targetTotal <= 0) {
        const latestRow = await getLatestCardIdForCustomerCafe.get(
          cafeAddress,
          customer,
        );
        targetCardId = latestRow ? latestRow.card_id : null;
      }
    } else {
      const latestRow = await getLatestCardIdForCustomerCafe.get(
        cafeAddress,
        customer,
      );
      targetCardId = latestRow ? latestRow.card_id : null;
    }

    const isRedeemed = !!(await hasCardBeenRedeemed.get(
      cafeAddress,
      customer,
      targetCardId,
    ));
    if (isRedeemed) {
      return res.status(409).json({ error: "card_already_redeemed" });
    }

    const currentTotal = Math.max(
      0,
      await getStampsByCafeUserCardId(cafeAddress, customer, targetCardId),
    );
    const removed = Math.min(cnt, currentTotal);

    if (removed > 0) {
      const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
      const ev = {
        ts: Date.now(),
        cafe: cafeAddress,
        customer_name: customerName || null,
        user: customer,
        txhash: localTx,
        status: "confirmed",
        event_type: "stamp_removed",
        delta: -removed,
        card_id: targetCardId,
      };
      await insertEvent.run(ev);
      try {
        broadcastEvent(ev);
      } catch (e) {}
      notifyWalletPassUpdated(customer, cafeAddress);
      notifyGoogleWalletPassUpdated(customer, cafeAddress);
    }

    const newTotal = Math.max(0, currentTotal - removed);
    res.json({
      success: true,
      removed,
      newTotal,
      cardId: targetCardId,
    });
  } catch (err) {
    console.error("Error in /remove-stamp:", err);
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

    // The redeemed card is left at its final count as a closed, historical
    // record (delta: 0, purely an audit entry) rather than reset in place -
    // "each full card gets its own id" (the same rule overflow-splitting
    // follows) means redemption shouldn't quietly repurpose that same
    // card_id as the next one to fill.
    const ev = {
      ts: now,
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: localTx,
      status: "confirmed",
      event_type: "redeem",
      delta: 0,
      card_id: normalizedCardId,
    };
    await insertEvent.run(ev);

    // Reuse an existing still-open, not-yet-full card if the customer has
    // one (see findReusableOpenCard) instead of always minting a new one -
    // otherwise a customer who already had a partial card from an earlier
    // overflow ends up with yet another separate card to add to Wallet,
    // for no real reason.
    const reusable = await findReusableOpenCard(
      cafeAddress,
      customer,
      normalizedCardId,
      rewardThreshold,
    );
    const newCardId = reusable ? reusable.cardId : crypto.randomBytes(8).toString("hex");
    const newCardEv = {
      ts: now,
      cafe: cafeAddress,
      customer_name: customerName || null,
      user: customer,
      txhash: `local_${crypto.randomBytes(16).toString("hex")}`,
      status: "confirmed",
      event_type: "card_start",
      delta: 0,
      card_id: newCardId,
    };
    await insertEvent.run(newCardEv);

    notifyWalletPassUpdated(ev.user, ev.cafe);
    notifyGoogleWalletPassUpdated(ev.user, ev.cafe);
    // Same reasoning as the overflow-during-stamping notification in
    // /stamp-by-cafe: a freshly minted card_id may not be in the customer's
    // Wallet yet - the only card that definitely still is is the one that
    // just got redeemed and is now frozen. Only for a genuinely new mint,
    // though (!reusable) - a reused still-open card already got its own
    // email the moment it was created (by the overflow that opened it, or
    // an earlier redemption's mint), so sending another one here would just
    // be a second email about a card the customer already knows about.
    if (!reusable) {
      notifyNewCardByEmail(ev.user, ev.cafe, newCardId);
    }

    try {
      broadcastEvent({ ...ev, newCardId });
    } catch (e) {}

    res.json({
      success: true,
      status: "confirmed",
      redeemed: true,
      previousStamps: Number(currentStamps),
      txHash: localTx,
      newCardId,
      reusedExistingCard: !!reusable,
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
    notifyWalletPassUpdated(ev.user, ev.cafe);
    notifyGoogleWalletPassUpdated(ev.user, ev.cafe);
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

// Per-café chart data for a café's own dashboard - same day/time bucketing
// idea as /admin/cafes/activity's charts, but scoped to a single café's own
// rows via a couple of cheap, filtered queries instead of the admin route's
// all-cafés-at-once accumulator pass (that one has to look at everything
// anyway to build every café's card; a single café's dashboard doesn't).
const CAFE_CHART_DAYS = 30;
const CAFE_CHART_BIN_MINUTES = 15;
const CAFE_CHART_BINS_PER_DAY = (24 * 60) / CAFE_CHART_BIN_MINUTES;
const cafeChartDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const cafeChartTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function cafeChartDayKey(ts) {
  return cafeChartDayFormatter.format(new Date(ts));
}
function cafeChartTimeBin(ts) {
  let hour = 0;
  let minute = 0;
  for (const part of cafeChartTimeFormatter.formatToParts(new Date(ts))) {
    if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  const minutesSinceMidnight = hour * 60 + minute;
  return Math.min(
    CAFE_CHART_BINS_PER_DAY - 1,
    Math.floor(minutesSinceMidnight / CAFE_CHART_BIN_MINUTES),
  );
}

async function computeCafeCharts(cafeAddressLower, cafeNumericId) {
  const windowStart = Date.now() - CAFE_CHART_DAYS * 86400000;
  const dayList = [];
  for (let i = CAFE_CHART_DAYS - 1; i >= 0; i--) {
    dayList.push(cafeChartDayKey(Date.now() - i * 86400000));
  }
  const byDay = new Map(dayList.map((d) => [d, 0]));
  const byTimeOfDay = new Array(CAFE_CHART_BINS_PER_DAY).fill(0);
  const walletByDay = new Map(dayList.map((d) => [d, { apple: 0, google: 0 }]));

  const stampRows = await db
    .prepare(
      `SELECT ts FROM stamp_events WHERE delta > 0 AND LOWER(cafe) = ? AND ts >= ?`,
    )
    .all(cafeAddressLower, windowStart);
  for (const row of stampRows) {
    const ts = Number(row.ts);
    if (!ts) continue;
    const d = cafeChartDayKey(ts);
    if (byDay.has(d)) byDay.set(d, byDay.get(d) + 1);
    byTimeOfDay[cafeChartTimeBin(ts)] += 1;
  }

  if (cafeNumericId != null) {
    const appleRows = await db
      .prepare(
        `SELECT created_at AS ts FROM wallet_passes WHERE cafe_id = ? AND created_at >= ?`,
      )
      .all(cafeNumericId, windowStart);
    for (const row of appleRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = cafeChartDayKey(ts);
      if (walletByDay.has(d)) walletByDay.get(d).apple += 1;
    }
    const googleRows = await db
      .prepare(
        `SELECT created_at AS ts FROM google_wallet_objects WHERE cafe_id = ? AND created_at >= ?`,
      )
      .all(cafeNumericId, windowStart);
    for (const row of googleRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = cafeChartDayKey(ts);
      if (walletByDay.has(d)) walletByDay.get(d).google += 1;
    }
  }

  return {
    days: CAFE_CHART_DAYS,
    timezone: "Europe/Berlin",
    binMinutes: CAFE_CHART_BIN_MINUTES,
    dailyStamps: dayList.map((d) => ({ date: d, count: byDay.get(d) || 0 })),
    dailyWalletDownloads: dayList.map((d) => {
      const v = walletByDay.get(d) || { apple: 0, google: 0 };
      return {
        date: d,
        apple: v.apple,
        google: v.google,
        total: v.apple + v.google,
      };
    }),
    stampsByTimeOfDay: byTimeOfDay.map((count, bin) => ({
      bin,
      minute: bin * CAFE_CHART_BIN_MINUTES,
      count,
    })),
  };
}

// Richer per-café analytics for the admin café-detail view: splits stamps
// from unique customers per day (30 stamps could be 30 one-off visitors or
// 10 regulars stopping by three times - very different pictures for a
// café), a Monday-first weekday x time-of-day heatmap instead of the
// dot-plot's raw time-of-day distribution, new-vs-returning customer counts
// for the selected window, and a wallet-cards total/growth KPI. Kept
// separate from computeCafeCharts() above (café's own dashboard) rather
// than replacing it, so that route's already-shipped 30-day-fixed shape
// doesn't shift under it.
const CAFE_HEATMAP_BUCKET_HOURS = 2;
const CAFE_HEATMAP_BUCKETS_PER_DAY = 24 / CAFE_HEATMAP_BUCKET_HOURS;
const cafeWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  weekday: "short",
});
const CAFE_WEEKDAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function cafeWeekdayIndex(ts) {
  const label = cafeWeekdayFormatter.format(new Date(ts));
  return CAFE_WEEKDAY_ORDER[label] ?? 0;
}
function cafeHeatmapBucket(ts) {
  let hour = 0;
  for (const part of cafeChartTimeFormatter.formatToParts(new Date(ts))) {
    if (part.type === "hour") hour = Number(part.value) % 24;
  }
  return Math.min(
    CAFE_HEATMAP_BUCKETS_PER_DAY - 1,
    Math.floor(hour / CAFE_HEATMAP_BUCKET_HOURS),
  );
}

async function computeCafeAnalytics(cafeAddressLower, cafeNumericId, days) {
  const windowDays = Math.max(1, Math.min(90, Number(days) || 30));
  const windowStart = Date.now() - windowDays * 86400000;
  const dayList = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    dayList.push(cafeChartDayKey(Date.now() - i * 86400000));
  }

  const byDayStamps = new Map(dayList.map((d) => [d, 0]));
  const byDayCustomers = new Map(dayList.map((d) => [d, new Set()]));
  const byDayRedemptions = new Map(dayList.map((d) => [d, 0]));
  const walletByDay = new Map(dayList.map((d) => [d, { apple: 0, google: 0 }]));
  const heatmapGrid = Array.from({ length: 7 }, () =>
    new Array(CAFE_HEATMAP_BUCKETS_PER_DAY).fill(0),
  );

  // cafeAddressLower === null means "across all cafés" (the admin
  // overview's "Gesamt" analytics) - same queries, just without the
  // per-café WHERE filter.
  const isGlobal = cafeAddressLower == null;

  // Every event in the window (not just delta>0 stamps) so redemptions and
  // "did this customer show up at all today" are both derivable from one
  // pass instead of three separate queries.
  const windowRows = isGlobal
    ? await db
        .prepare(
          `SELECT ts, "user" AS user, event_type, delta FROM stamp_events WHERE ts >= ?`,
        )
        .all(windowStart)
    : await db
        .prepare(
          `SELECT ts, "user" AS user, event_type, delta FROM stamp_events WHERE LOWER(cafe) = ? AND ts >= ?`,
        )
        .all(cafeAddressLower, windowStart);

  for (const row of windowRows) {
    const ts = Number(row.ts);
    if (!ts) continue;
    const d = cafeChartDayKey(ts);
    const isRedeem = String(row.event_type || "").toLowerCase() === "redeem";
    if (Number(row.delta) > 0) {
      if (byDayStamps.has(d)) byDayStamps.set(d, byDayStamps.get(d) + 1);
      heatmapGrid[cafeWeekdayIndex(ts)][cafeHeatmapBucket(ts)] += 1;
    }
    if (isRedeem && byDayRedemptions.has(d)) {
      byDayRedemptions.set(d, byDayRedemptions.get(d) + 1);
    }
    if (byDayCustomers.has(d) && row.user) {
      byDayCustomers.get(d).add(String(row.user).toLowerCase());
    }
  }

  // All-time (not window-limited) first/last activity per customer - the
  // only way to tell "brand new this window" apart from "already a
  // customer, just came back", since both look identical if you only look
  // inside the window itself. Globally this is per customer across every
  // café instead of just this one.
  const firstSeenRows = isGlobal
    ? await db
        .prepare(
          `SELECT "user" AS user, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM stamp_events GROUP BY "user"`,
        )
        .all()
    : await db
        .prepare(
          `SELECT "user" AS user, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM stamp_events WHERE LOWER(cafe) = ? GROUP BY "user"`,
        )
        .all(cafeAddressLower);

  let newCustomers = 0;
  let returningCustomers = 0;
  for (const row of firstSeenRows) {
    const lastTs = Number(row.last_ts);
    if (!lastTs || lastTs < windowStart) continue;
    const firstTs = Number(row.first_ts);
    if (firstTs >= windowStart) newCustomers += 1;
    else returningCustomers += 1;
  }

  // Runs for both scopes - global just drops the cafe_id filter. A café
  // that has never issued a single wallet card (cafeNumericId null in the
  // per-café case only) skips this entirely, since there's nothing to
  // count.
  let cardsTotal = 0;
  let cardsNewInWindow = 0;
  if (isGlobal || cafeNumericId != null) {
    const appleRows = isGlobal
      ? await db
          .prepare(`SELECT created_at AS ts FROM wallet_passes WHERE created_at >= ?`)
          .all(windowStart)
      : await db
          .prepare(
            `SELECT created_at AS ts FROM wallet_passes WHERE cafe_id = ? AND created_at >= ?`,
          )
          .all(cafeNumericId, windowStart);
    for (const row of appleRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = cafeChartDayKey(ts);
      if (walletByDay.has(d)) walletByDay.get(d).apple += 1;
    }
    const googleRows = isGlobal
      ? await db
          .prepare(
            `SELECT created_at AS ts FROM google_wallet_objects WHERE created_at >= ?`,
          )
          .all(windowStart)
      : await db
          .prepare(
            `SELECT created_at AS ts FROM google_wallet_objects WHERE cafe_id = ? AND created_at >= ?`,
          )
          .all(cafeNumericId, windowStart);
    for (const row of googleRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = cafeChartDayKey(ts);
      if (walletByDay.has(d)) walletByDay.get(d).google += 1;
    }

    // Distinct customers with any wallet card, deduped across Apple/Google
    // (a customer with both shouldn't count as two cards) - drives the
    // "Karten insgesamt" KPI and its "+N in the last <days> days" delta.
    const cardRows = isGlobal
      ? await db
          .prepare(
            `SELECT customer_address, MIN(created_at) AS first_ts FROM (
               SELECT customer_address, created_at FROM wallet_passes
               UNION ALL
               SELECT customer_address, created_at FROM google_wallet_objects
             ) AS t
             GROUP BY customer_address`,
          )
          .all()
      : await db
          .prepare(
            `SELECT customer_address, MIN(created_at) AS first_ts FROM (
               SELECT customer_address, created_at FROM wallet_passes WHERE cafe_id = ?
               UNION ALL
               SELECT customer_address, created_at FROM google_wallet_objects WHERE cafe_id = ?
             ) AS t
             GROUP BY customer_address`,
          )
          .all(cafeNumericId, cafeNumericId);
    cardsTotal = cardRows.length;
    cardsNewInWindow = cardRows.filter(
      (r) => Number(r.first_ts) >= windowStart,
    ).length;
  }

  return {
    days: windowDays,
    timezone: "Europe/Berlin",
    dailyStamps: dayList.map((d) => ({
      date: d,
      count: byDayStamps.get(d) || 0,
      uniqueCustomers: byDayCustomers.get(d) ? byDayCustomers.get(d).size : 0,
      redemptions: byDayRedemptions.get(d) || 0,
      isWeekend: cafeWeekdayIndex(new Date(`${d}T12:00:00Z`).getTime()) >= 5,
    })),
    dailyWalletDownloads: dayList.map((d) => {
      const v = walletByDay.get(d) || { apple: 0, google: 0 };
      return {
        date: d,
        apple: v.apple,
        google: v.google,
        total: v.apple + v.google,
      };
    }),
    heatmap: {
      bucketHours: CAFE_HEATMAP_BUCKET_HOURS,
      bucketsPerDay: CAFE_HEATMAP_BUCKETS_PER_DAY,
      weekdayLabels: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
      grid: heatmapGrid,
    },
    customerActivity: {
      newCustomers,
      returningCustomers,
      activeCustomers: newCustomers + returningCustomers,
    },
    cards: {
      total: cardsTotal,
      newInWindow: cardsNewInWindow,
    },
  };
}

app.get(
  "/admin/cafes/:cafeId/analytics",
  requireAdminKey,
  async (req, res) => {
    try {
      const cafeId = Number(req.params.cafeId);
      if (!Number.isFinite(cafeId)) {
        return res.status(400).json({ error: "invalid_cafe_id" });
      }
      const current = await getCafeById.get(cafeId);
      if (!current) {
        return res.status(404).json({ error: "cafe_not_found" });
      }
      const cafeAddress = ensureCafeAddress(current) || String(current.id || "");
      const days = Number(req.query?.days) || 30;
      const analytics = await computeCafeAnalytics(
        cafeAddress.toLowerCase(),
        Number(current.id),
        days,
      );
      res.json({ ok: true, cafe: { id: current.id, name: current.name || null }, analytics });
    } catch (err) {
      console.error("Error in /admin/cafes/:cafeId/analytics:", err);
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  },
);

// Same analytics shape as above, aggregated across every café - the admin
// overview's "Gesamt" view.
app.get("/admin/analytics", requireAdminKey, async (req, res) => {
  try {
    const days = Number(req.query?.days) || 30;
    const analytics = await computeCafeAnalytics(null, null, days);
    res.json({ ok: true, analytics });
  } catch (err) {
    console.error("Error in /admin/analytics:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// All-time lifecycle analytics (funnel, rewards, visit distribution, time
// between visits, weekly cohort retention) - deliberately NOT window-scoped
// like computeCafeAnalytics() above, since "where do customers fall off"
// and "how many visits until someone's a regular" are lifetime questions,
// not "last 30 days" ones. One raw per-event query drives all five
// sections in a single JS pass instead of five separate aggregate queries.
function cohortWeekStart(ts) {
  const dayKeyStr = cafeChartDayKey(ts);
  const noonUtc = new Date(`${dayKeyStr}T12:00:00Z`).getTime();
  const weekdayIdx = cafeWeekdayIndex(noonUtc); // 0=Mon..6=Sun
  return noonUtc - weekdayIdx * 86400000;
}
function cohortWeekLabel(weekStartTs) {
  const parts = cafeChartDayKey(weekStartTs).split("-");
  return parts.length === 3 ? `ab ${parts[2]}.${parts[1]}.` : "?";
}

async function computeCafeLifecycle(cafeAddressLower, singleThreshold, cafeNumericId) {
  const isGlobal = cafeAddressLower == null;

  const eventRows = isGlobal
    ? await db
        .prepare(
          `SELECT LOWER(cafe) AS cafe_addr, "user" AS user, ts, delta, event_type FROM stamp_events`,
        )
        .all()
    : await db
        .prepare(
          `SELECT LOWER(cafe) AS cafe_addr, "user" AS user, ts, delta, event_type FROM stamp_events WHERE LOWER(cafe) = ?`,
        )
        .all(cafeAddressLower);

  // One group per (café, customer) relationship - a customer's stamp
  // balance is tracked per café, so that's the natural funnel/cohort unit;
  // for a single café's own view this degenerates to one group per
  // customer, same as before.
  const groups = new Map();
  for (const row of eventRows) {
    const cafeAddr = row.cafe_addr;
    const user = String(row.user || "").toLowerCase();
    if (!user) continue;
    const key = `${cafeAddr}::${user}`;
    let g = groups.get(key);
    if (!g) {
      g = { cafeAddr, visits: [], totalStamps: 0, redemptions: 0 };
      groups.set(key, g);
    }
    const ts = Number(row.ts);
    if (Number(row.delta) > 0 && ts) {
      g.totalStamps += Number(row.delta);
      g.visits.push(ts);
    }
    if (String(row.event_type || "").toLowerCase() === "redeem") {
      g.redemptions += 1;
    }
  }
  for (const g of groups.values()) g.visits.sort((a, b) => a - b);

  let thresholdByCafe = null;
  if (isGlobal) {
    const cafeRows = await db
      .prepare(`SELECT address, COALESCE(stamps_for_reward, 10) AS threshold FROM cafes`)
      .all();
    thresholdByCafe = new Map();
    for (const r of cafeRows) {
      if (r.address) {
        thresholdByCafe.set(String(r.address).toLowerCase(), Number(r.threshold) || 10);
      }
    }
  }
  function thresholdFor(cafeAddr) {
    if (isGlobal) return thresholdByCafe.get(cafeAddr) || 10;
    return Number(singleThreshold) || 10;
  }

  // Wallet-Karten funnel stage counts (café, customer) relationships, not
  // raw customers - consistent with every later funnel stage, so a
  // customer with cards at 3 cafés contributes 3 funnel entries at stage 1,
  // not 1 (matching how they contribute 3 independent entries at every
  // later stage too).
  const walletRelRows = isGlobal
    ? await db
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT DISTINCT cafe_id, customer_address FROM (
               SELECT cafe_id, customer_address FROM wallet_passes
               UNION ALL
               SELECT cafe_id, customer_address FROM google_wallet_objects
             ) AS u
           ) AS d`,
        )
        .all()
    : await db
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT DISTINCT cafe_id, customer_address FROM (
               SELECT cafe_id, customer_address FROM wallet_passes WHERE cafe_id = ?
               UNION ALL
               SELECT cafe_id, customer_address FROM google_wallet_objects WHERE cafe_id = ?
             ) AS u
           ) AS d`,
        )
        .all(cafeNumericId, cafeNumericId);

  let funnel = {
    wallet: (walletRelRows && walletRelRows[0] && Number(walletRelRows[0].n)) || 0,
    firstStamp: 0,
    twoPlus: 0,
    fivePlus: 0,
    rewardReached: 0,
    rewardRedeemed: 0,
  };
  let rewardsEarnedApprox = 0;
  let rewardsRedeemed = 0;

  for (const g of groups.values()) {
    if (g.totalStamps >= 1) funnel.firstStamp += 1;
    if (g.totalStamps >= 2) funnel.twoPlus += 1;
    if (g.totalStamps >= 5) funnel.fivePlus += 1;
    const th = thresholdFor(g.cafeAddr);
    if (g.totalStamps >= th) funnel.rewardReached += 1;
    if (g.redemptions >= 1) {
      funnel.rewardRedeemed += 1;
      rewardsRedeemed += g.redemptions;
    }
    rewardsEarnedApprox += Math.floor(g.totalStamps / th);
  }

  const visitBuckets = [
    { visits: "1", customers: 0 },
    { visits: "2", customers: 0 },
    { visits: "3", customers: 0 },
    { visits: "4", customers: 0 },
    { visits: "5+", customers: 0 },
  ];
  for (const g of groups.values()) {
    const n = g.visits.length;
    if (n <= 0) continue;
    if (n >= 5) visitBuckets[4].customers += 1;
    else visitBuckets[n - 1].customers += 1;
  }

  const gapBucketDefs = [
    { label: "< 3 Tage", min: 0, max: 3 },
    { label: "3–7 Tage", min: 3, max: 7 },
    { label: "8–14 Tage", min: 8, max: 14 },
    { label: "15–30 Tage", min: 15, max: 30 },
    { label: "> 30 Tage", min: 30, max: Infinity },
  ];
  const gapBuckets = gapBucketDefs.map((b) => ({ ...b, count: 0 }));
  const allGapDays = [];
  for (const g of groups.values()) {
    for (let i = 1; i < g.visits.length; i++) {
      const gapDays = (g.visits[i] - g.visits[i - 1]) / 86400000;
      allGapDays.push(gapDays);
      const bucket =
        gapBuckets.find((b) => gapDays >= b.min && gapDays <= b.max) ||
        gapBuckets[gapBuckets.length - 1];
      bucket.count += 1;
    }
  }
  allGapDays.sort((a, b) => a - b);
  const medianDays = allGapDays.length
    ? allGapDays[Math.floor(allGapDays.length / 2)]
    : null;

  // Weekly cohorts: group (café, customer) relationships by the week of
  // their first-ever visit, then check whether each one has any visit in
  // week +1/+2/+4/+8 relative to that cohort's start - "–" (null) instead
  // of 0% when that offset hasn't happened yet for a recent cohort.
  const cohortGroups = new Map();
  const now = Date.now();
  for (const g of groups.values()) {
    if (!g.visits.length) continue;
    const weekStart = cohortWeekStart(g.visits[0]);
    if (!cohortGroups.has(weekStart)) cohortGroups.set(weekStart, []);
    cohortGroups.get(weekStart).push(g);
  }
  const cohortWeekStarts = [...cohortGroups.keys()].sort((a, b) => b - a).slice(0, 8).reverse();
  const cohortOffsets = [1, 2, 4, 8];
  const cohorts = cohortWeekStarts.map((weekStart) => {
    const members = cohortGroups.get(weekStart) || [];
    const retention = {};
    for (const offset of cohortOffsets) {
      const rangeStart = weekStart + offset * 7 * 86400000;
      const rangeEnd = rangeStart + 7 * 86400000;
      if (rangeStart > now) {
        retention[`w${offset}`] = null;
        continue;
      }
      const activeCount = members.filter((m) =>
        m.visits.some((v) => v >= rangeStart && v < rangeEnd),
      ).length;
      retention[`w${offset}`] = members.length
        ? activeCount / members.length
        : null;
    }
    return {
      label: cohortWeekLabel(weekStart),
      size: members.length,
      retention,
    };
  });

  return {
    visitDistribution: visitBuckets,
    timeBetweenVisits: {
      medianDays,
      buckets: gapBuckets.map((b) => ({ label: b.label, count: b.count })),
    },
    funnel,
    rewards: {
      earnedApprox: rewardsEarnedApprox,
      redeemed: rewardsRedeemed,
      redemptionRate: rewardsEarnedApprox
        ? Math.min(1, rewardsRedeemed / rewardsEarnedApprox)
        : null,
      threshold: isGlobal ? null : Number(singleThreshold) || 10,
    },
    cohorts: {
      offsets: cohortOffsets,
      rows: cohorts,
    },
  };
}

app.get(
  "/admin/cafes/:cafeId/lifecycle",
  requireAdminKey,
  async (req, res) => {
    try {
      const cafeId = Number(req.params.cafeId);
      if (!Number.isFinite(cafeId)) {
        return res.status(400).json({ error: "invalid_cafe_id" });
      }
      const current = await getCafeById.get(cafeId);
      if (!current) {
        return res.status(404).json({ error: "cafe_not_found" });
      }
      const cafeAddress = ensureCafeAddress(current) || String(current.id || "");
      const program = getCafeProgramSettings(current);
      const lifecycle = await computeCafeLifecycle(
        cafeAddress.toLowerCase(),
        program.stampsForReward,
        Number(current.id),
      );
      res.json({ ok: true, cafe: { id: current.id, name: current.name || null }, lifecycle });
    } catch (err) {
      console.error("Error in /admin/cafes/:cafeId/lifecycle:", err);
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  },
);

app.get("/admin/lifecycle", requireAdminKey, async (req, res) => {
  try {
    const lifecycle = await computeCafeLifecycle(null, null, null);
    res.json({ ok: true, lifecycle });
  } catch (err) {
    console.error("Error in /admin/lifecycle:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

const getReminderNotificationState = db.prepare(
  "SELECT sent_at, stamp_state_ts, message FROM reminder_notifications WHERE cafe_id = ? AND customer_address = ?",
);
const upsertReminderNotification = db.prepare(
  "INSERT INTO reminder_notifications (cafe_id, customer_address, sent_at, stamp_state_ts, message) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT (cafe_id, customer_address) DO UPDATE SET sent_at = excluded.sent_at, stamp_state_ts = excluded.stamp_state_ts, message = excluded.message",
);
// Append-only history, unlike reminder_notifications above which only ever
// holds the *latest* send per (cafe, customer) for the "one push per
// state" dedup check - this is what answers "wann ging an wen welche Push
// raus" (chat 2026-09-21). Logged for every attempt, not just successful
// ones, so a delivery that silently didn't reach a device (apple_pushed:0
// despite apple_touched being true - see the freya-kohnen case earlier
// this session) is visible here instead of looking indistinguishable from
// a real send.
const insertReminderLog = db.prepare(
  "INSERT INTO reminder_log (cafe_id, customer_address, kind, message, stamp_state_ts, apple_touched, apple_pushed, google_sent, sent_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

// Mail counterpart to reminder_log above (see migrations/025_add_email_log.sql).
const insertEmailLog = db.prepare(
  "INSERT INTO email_log (cafe_id, customer_address, kind, recipient, subject, success, error, sent_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);

// Wrapping the transporter itself (once, here) instead of adding a logging
// call to every single send*Email() function - every outgoing email goes
// through emailTransporter.sendMail no matter which function built it, so
// this is the one place that's guaranteed to see all of them. A caller can
// attach mailOptions.__logMeta = {kind, cafeId, customerAddress} for
// attribution (stripped before the real send, nodemailer doesn't know the
// field); without it the email is still logged, just unattributed - e.g.
// pure account-level mail like password resets or verification links that
// have no café to point at.
{
  const rawSendMail = emailTransporter.sendMail.bind(emailTransporter);
  emailTransporter.sendMail = async function (mailOptions) {
    const meta = mailOptions && mailOptions.__logMeta;
    const toLog = { ...mailOptions };
    delete toLog.__logMeta;
    try {
      const info = await rawSendMail(toLog);
      try {
        await insertEmailLog.run(
          (meta && meta.cafeId) || null,
          (meta && meta.customerAddress) || null,
          (meta && meta.kind) || null,
          String(toLog.to || ""),
          toLog.subject || null,
          1,
          null,
          Date.now(),
        );
      } catch (logErr) {
        console.warn(
          "Failed to write email_log row:",
          logErr && logErr.message ? logErr.message : logErr,
        );
      }
      return info;
    } catch (sendErr) {
      try {
        await insertEmailLog.run(
          (meta && meta.cafeId) || null,
          (meta && meta.customerAddress) || null,
          (meta && meta.kind) || null,
          String(toLog.to || ""),
          toLog.subject || null,
          0,
          String(sendErr && sendErr.message ? sendErr.message : sendErr),
          Date.now(),
        );
      } catch (logErr) {
        console.warn(
          "Failed to write email_log row:",
          logErr && logErr.message ? logErr.message : logErr,
        );
      }
      throw sendErr;
    }
  };
}

// Apple's pass.json backfield for a café's push reminder (see
// findReminderCandidates/sendReminderPush) - ALWAYS returned (never null),
// with a neutral "–" and no changeMessage when there's nothing active. This
// looks backwards (a version of this that hid the field entirely when
// inactive seems like it should be less cluttered), but three live tests
// all silently failed to notify with that version, and the pattern that
// *did* work from day one ("earned"'s "Frischer Stempel!") is a field
// that's structurally present on every single pass, always - only its
// value changes. Apple's changeMessage appears to require an *existing*
// field's value to change, not a field appearing/disappearing between pass
// versions - so keeping this field's structure stable and only toggling
// its value is what actually makes the notification reliable, at the cost
// of a permanent (if minimal) "Erinnerung: –" line when inactive.
const REMINDER_BACKFIELD_PRIORITY_WINDOW_MS = 15 * 60 * 1000;
async function getReminderBackfieldFor(cafeId, customerAddress) {
  const row = await getReminderNotificationState.get(
    cafeId,
    String(customerAddress || "").toLowerCase(),
  );
  const sentAt = row && row.message ? Number(row.sent_at) : null;
  const active =
    sentAt != null && Date.now() - sentAt < REMINDER_BACKFIELD_PRIORITY_WINDOW_MS;
  if (!active) {
    return { value: "–", changeMessage: null };
  }
  // Apple's changeMessage is only ever rendered as a lock-screen banner if
  // it contains the literal %@ placeholder - a fully-prewritten sentence
  // with no %@ (what this used to send) is silently ignored and iOS falls
  // back to its generic "pass changed" text, confirmed after several real
  // sends all showed generic text regardless of field/uniqueness setup
  // (see https://passkit.com/blog/how-to-engage-your-customers-with-the-apple-wallet-changemsg/).
  // So the actual message now lives in the field's *value*, and
  // changeMessage is just the literal "%@" - Apple substitutes it with the
  // field's own new value, i.e. our message, verbatim.
  //
  // Deliberately just the message text now, no trailing date (chat
  // 2026-09-21 - a visible timestamp next to the message read as clutter).
  // Trade-off: a handful of the current templates are fully static once
  // formatted (e.g. "Karte voll - {reward} wartet." has no {tokens} left),
  // so if the *exact same* message fires twice for one customer (two full
  // "fill up, go inactive" cycles landing on the same template), the
  // second send's value would be byte-identical to what the device already
  // has cached and Apple's own diffing would treat it as "nothing changed"
  // - no banner that second time (though the field still updates the
  // *reminder_notifications* dedup bookkeeping correctly either way, so
  // this only affects the lock-screen banner, not whether a reminder
  // "counts" as sent).
  return {
    value: String(row.message),
    changeMessage: "%@",
  };
}

// Matching logic for the café-configurable push reminder (see cafes.
// Server-side mirror of formatCampaignText() in customer-qr-modern.js - same
// {token} convention, so a café that's seen the in-app popup message fields
// already knows how this one works too.
function formatReminderText(template, vars, fallback) {
  const text = String(template || "").trim() || String(fallback || "").trim();
  const data = vars || {};
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const value = data[key];
    return value == null ? "" : String(value);
  });
}

// Tone (chat 2026-09-21): trocken/absurdistisch statt Sales-Sprech, fürs
// 18-34-jährige Specialty-Coffee-Publikum - keine expliziten Ablauf-/
// Verfalls-Behauptungen, da Stempel/Belohnung hier nie tatsächlich
// verfallen. Bewusst knapp: nur das Token, das die Zeile tatsächlich
// braucht, statt jedes verfügbare Token reinzuzwingen (Feedback aus dem
// Chat - {stamps}/{goal}/{cafe} etc. machen eine kurze, trockene Zeile nur
// sperriger, wenn sie für die Aussage gar nicht nötig sind).
const REMINDER_DEFAULT_TEMPLATE =
  "Noch {remaining} Stempel für dein Gratisgetränk - wir würden dich gerne bald wiedersehen :)";
// Used instead of the above once a customer's open card is already at or
// past the reward threshold (remaining <= 0) - "nur noch 0 Stempel fehlen"
// reads oddly for a card that's actually full, caught live on staging with
// a real customer in exactly this state.
const REMINDER_FULL_DEFAULT_TEMPLATE = "Karte voll - {reward} wartet.";
// For a low-engagement open card - 0 stamps (never used at all) or exactly
// 1 (stamped once, then went quiet) - that's been sitting untouched past
// reminderNewCustomerDays. No token needed at all here - "wann genau" ist
// für diese Zeile nicht der Punkt.
const REMINDER_NEW_CUSTOMER_DEFAULT_TEMPLATE = "Karte geholt - Koffein vergessen?";

// reminder_push_enabled/reminder_min_stamps/reminder_inactive_days,
// migration 017): finds customers currently eligible for a nudge.
//
// Stamp count uses getOpenStampTotal() (the same "does this customer have
// enough right now" function the actual stamp-awarding UI relies on), NOT a
// raw SUM(delta) across every event ever - a redeemed card is frozen at
// delta:0 rather than decremented (see getOpenStampTotal's own comment), so
// a naive all-time SUM(delta) stays stuck at a customer's pre-redemption
// total forever and never reflects a fresh card's real progress. Caught via
// a live staging check against a customer who'd already redeemed: raw
// SUM(delta) said 10 stamps, actual open-card total was 0.
// getOpenStampTotal() is per-customer and non-trivial (walks card groups),
// so it's only called for customers who already pass the cheap
// inactive-days check below, not for every customer at the café.
//
// "One push per state" (a explicit requirement, not just a nice-to-have):
// reminder_notifications holds at most one row per (cafe, customer), tagged
// with the customer's lastStampTs at send time. A customer is skipped here
// whenever that stored stamp_state_ts still matches their current
// lastStampTs - i.e. nothing has changed since we already nudged them.
// They only become eligible again after a NEW stamp moves lastStampTs
// forward and they then go inactive a second time. This function only
// *finds* candidates - it does not send anything or write to
// reminder_notifications; actually sending (and marking sent) is separate,
// later work.
async function findReminderCandidates(cafeRow) {
  if (!cafeRow) return [];
  const program = getCafeProgramSettings(cafeRow);
  if (!program.reminderPushEnabled) return [];
  const cafeAddress = ensureCafeAddress(cafeRow);
  if (!cafeAddress) return [];
  const cafeAddressLower = cafeAddress.toLowerCase();

  const rows = await db
    .prepare(
      `SELECT "user" AS user,
              MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts
       FROM stamp_events
       WHERE LOWER(cafe) = ?
       GROUP BY "user"`,
    )
    .all(cafeAddressLower);

  const now = Date.now();
  const inactiveThresholdMs = program.reminderInactiveDays * 86400000;
  const newCustomerThresholdMs = program.reminderNewCustomerDays * 86400000;
  // Cheap pre-filter before the per-customer getOpenStampTotal() call below -
  // has to use whichever of the two day-thresholds is shorter, since a
  // low-engagement (0-1 stamp) candidate is checked against
  // reminderNewCustomerDays, not reminderInactiveDays, and a café could in
  // principle configure the "new customer" threshold shorter than the
  // regular inactivity one.
  const minThresholdMs = Math.min(inactiveThresholdMs, newCustomerThresholdMs);

  const candidates = [];
  for (const row of rows) {
    const lastStampTs = row.last_stamp_ts != null ? Number(row.last_stamp_ts) : null;
    if (!lastStampTs) continue;
    if (now - lastStampTs < minThresholdMs) continue;

    const customerAddress = String(row.user || "").toLowerCase();
    if (!customerAddress) continue;

    const openStampTotal = await getOpenStampTotal(
      cafeAddressLower,
      customerAddress,
    );

    // Two different buckets share this loop: a properly-engaged card
    // (>= reminderMinStamps) that's gone quiet for reminderInactiveDays,
    // vs. a barely-touched card (0 or 1 stamp - the "0" case with real
    // stamp history is a customer who redeemed a full card and never
    // restarted) that's been sitting for the longer reminderNewCustomerDays
    // instead. Anything in between (2 stamps up to reminderMinStamps-1)
    // intentionally gets no reminder at all - too little progress to call
    // it "almost there", too much to call it "barely started".
    const isEngaged = openStampTotal >= program.reminderMinStamps;
    const isLowEngagement = !isEngaged && openStampTotal <= 1;
    if (!isEngaged && !isLowEngagement) continue;
    if (isEngaged && now - lastStampTs < inactiveThresholdMs) continue;
    if (isLowEngagement && now - lastStampTs < newCustomerThresholdMs) continue;

    const already = await getReminderNotificationState.get(
      cafeRow.id,
      customerAddress,
    );
    if (already && Number(already.stamp_state_ts) >= lastStampTs) continue;

    const daysInactive = Math.floor((now - lastStampTs) / 86400000);
    const remaining = Math.max(0, program.stampsForReward - openStampTotal);
    const isFull = openStampTotal >= program.stampsForReward;
    const messageVars = {
      cafe: cafeRow.name || "deinem Café",
      days: daysInactive,
      remaining,
      stamps: openStampTotal,
      goal: program.stampsForReward,
      reward: program.rewardDescription || "deine Belohnung",
    };
    const message = isLowEngagement
      ? formatReminderText(
          program.reminderNewCustomerMessage,
          messageVars,
          REMINDER_NEW_CUSTOMER_DEFAULT_TEMPLATE,
        )
      : isFull
        ? formatReminderText(
            program.reminderFullMessage,
            messageVars,
            REMINDER_FULL_DEFAULT_TEMPLATE,
          )
        : formatReminderText(
            program.reminderMessage,
            messageVars,
            REMINDER_DEFAULT_TEMPLATE,
          );

    candidates.push({
      kind: isLowEngagement ? "lowEngagement" : "inactive",
      customerAddress,
      netStamps: openStampTotal,
      remaining,
      isFull,
      lastStampTs,
      daysInactive,
      message,
      previouslyNotifiedAt:
        already && already.sent_at != null ? Number(already.sent_at) : null,
    });
  }

  // Second "lowEngagement" scenario, other half: a wallet card was saved but
  // never got a single stamp - these customers never appear in the
  // stamp_events-driven loop above at all (no rows to group), so they need
  // their own source: every distinct (café, customer) wallet card, minus
  // whoever's in `rows` with any real stamp (delta>0, handled by the 0/1-
  // stamp branch up in the main loop instead). "days" is measured from when
  // the card was created, there being no stamp to measure inactivity from
  // instead. Same "one push per state" dedup via reminder_notifications,
  // keyed off the card's own creation time instead of a stamp timestamp -
  // since that never changes, a customer who's sent this once and still
  // hasn't stamped won't be re-nudged on every future run, only once, ever
  // (which is the point: repeatedly nagging someone who's shown zero
  // engagement isn't useful, unlike the "inactive" bucket above where a new
  // stamp genuinely resets the clock).
  if (cafeRow.id != null) {
    const everStamped = new Set(
      rows
        .filter((r) => r.last_stamp_ts != null)
        .map((r) => String(r.user || "").toLowerCase()),
    );
    const cardRows = await db
      .prepare(
        `SELECT customer_address, MIN(created_at) AS first_ts FROM (
           SELECT customer_address, created_at FROM wallet_passes WHERE cafe_id = ?
           UNION ALL
           SELECT customer_address, created_at FROM google_wallet_objects WHERE cafe_id = ?
         ) AS t
         GROUP BY customer_address`,
      )
      .all(cafeRow.id, cafeRow.id);

    for (const row of cardRows) {
      const customerAddress = String(row.customer_address || "").toLowerCase();
      if (!customerAddress || everStamped.has(customerAddress)) continue;
      const firstTs = row.first_ts != null ? Number(row.first_ts) : null;
      if (!firstTs) continue;
      if (now - firstTs < newCustomerThresholdMs) continue;

      const already = await getReminderNotificationState.get(
        cafeRow.id,
        customerAddress,
      );
      if (already && Number(already.stamp_state_ts) >= firstTs) continue;

      const daysSinceCreated = Math.floor((now - firstTs) / 86400000);
      const messageVars = {
        cafe: cafeRow.name || "deinem Café",
        days: daysSinceCreated,
        remaining: program.stampsForReward,
        stamps: 0,
        goal: program.stampsForReward,
        reward: program.rewardDescription || "deine Belohnung",
      };
      const message = formatReminderText(
        program.reminderNewCustomerMessage,
        messageVars,
        REMINDER_NEW_CUSTOMER_DEFAULT_TEMPLATE,
      );

      candidates.push({
        kind: "lowEngagement",
        customerAddress,
        netStamps: 0,
        remaining: program.stampsForReward,
        isFull: false,
        lastStampTs: firstTs,
        daysInactive: daysSinceCreated,
        message,
        previouslyNotifiedAt:
          already && already.sent_at != null ? Number(already.sent_at) : null,
      });
    }
  }

  return candidates;
}

// Actually sends one candidate's reminder on every wallet platform they
// have an *open* (not-yet-redeemed) card on, then records it in
// reminder_notifications so findReminderCandidates() skips them next run
// unless their state changes (see that function's own comment). Touches
// wallet_passes.updated_at + sends the silent APNs wake-up the same way an
// ordinary stamp event does (notifyWalletPassUpdated above) - the actual
// notification text only appears once the device re-fetches the pass and
// sees the "reminder" backfield's value differ from what it cached (see
// getReminderBackfieldFor / buildPassJson's reminderBackfield param).
// Google has no such two-step fetch - addMessage delivers immediately.
//
// Only marks reminder_notifications (i.e. only counts as "sent") if the
// customer actually has an open card on at least one platform - a customer
// with no wallet pass at all has no channel to reach right now, so leaving
// them unmarked means a future run reconsiders them once they do add one,
// rather than silently writing them off forever.
async function sendReminderPush(cafeRow, candidate) {
  const cafeAddress = ensureCafeAddress(cafeRow);
  const cafeAddressLower = cafeAddress.toLowerCase();
  const customerAddress = candidate.customerAddress;
  const now = Date.now();
  let appleTouched = false;
  let applePushed = 0;
  let googleSent = 0;

  if (walletPass.isWalletConfigured()) {
    try {
      const passRows = await getWalletPassesByCustomerCafe.all(
        customerAddress,
        cafeRow.id,
      );
      const tokens = [];
      for (const passRow of Array.isArray(passRows) ? passRows : []) {
        const isRedeemed = !!(await hasCardBeenRedeemed.get(
          cafeAddressLower,
          customerAddress,
          passRow.card_id,
        ));
        if (isRedeemed) continue;
        appleTouched = true;
        await touchWalletPassUpdatedAt.run(now, passRow.serial_number);
        const tokenRows = await listWalletPushTokensBySerial.all(
          passRow.serial_number,
        );
        for (const r of Array.isArray(tokenRows) ? tokenRows : []) {
          if (r.push_token) tokens.push(r.push_token);
        }
      }
      if (tokens.length) {
        const results = await walletPass.sendPassUpdatePush(tokens);
        // APNs status comes back as a string off the HTTP/2 headers (e.g.
        // "200"), not a number - matching loosely here so this stays
        // correct either way.
        applePushed = Array.isArray(results)
          ? results.filter((r) => r && !r.error && String(r.status) === "200").length
          : 0;
      }
    } catch (err) {
      console.warn(
        "Reminder: Apple push failed:",
        err && err.message ? err.message : err,
      );
    }
  }

  if (googleWalletPass.isGoogleWalletConfigured()) {
    try {
      const objectRows = await getGoogleWalletObjectsByCustomerCafe.all(
        customerAddress,
        cafeRow.id,
      );
      for (const objRow of Array.isArray(objectRows) ? objectRows : []) {
        const isRedeemed = !!(await hasCardBeenRedeemed.get(
          cafeAddressLower,
          customerAddress,
          objRow.card_id,
        ));
        if (isRedeemed) continue;
        const result = await googleWalletPass.addLoyaltyObjectMessage(
          objRow.object_id,
          cafeRow.name || "Kaffeekarte",
          candidate.message,
        );
        if (result && result.ok) googleSent += 1;
      }
    } catch (err) {
      console.warn(
        "Reminder: Google addMessage failed:",
        err && err.message ? err.message : err,
      );
    }
  }

  const hasChannel = appleTouched || googleSent > 0;
  if (hasChannel) {
    await upsertReminderNotification.run(
      cafeRow.id,
      customerAddress,
      now,
      candidate.lastStampTs,
      candidate.message,
    );
  }

  await insertReminderLog.run(
    cafeRow.id,
    customerAddress,
    candidate.kind,
    candidate.message,
    candidate.lastStampTs,
    appleTouched ? 1 : 0,
    applePushed,
    googleSent,
    now,
  );

  return {
    customerAddress,
    hasChannel,
    appleTouched,
    applePushed,
    googleSent,
  };
}

app.get(
  "/admin/cafes/:cafeId/reminder-candidates",
  requireAdminKey,
  async (req, res) => {
    try {
      const cafeId = Number(req.params.cafeId);
      if (!Number.isFinite(cafeId)) {
        return res.status(400).json({ error: "invalid_cafe_id" });
      }
      const current = await getCafeById.get(cafeId);
      if (!current) {
        return res.status(404).json({ error: "cafe_not_found" });
      }
      const candidates = await findReminderCandidates(current);
      res.json({
        ok: true,
        cafe: { id: current.id, name: current.name || null },
        program: getCafeProgramSettings(current),
        candidates,
      });
    } catch (err) {
      console.error("Error in /admin/cafes/:cafeId/reminder-candidates:", err);
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  },
);

// Send history for one café - every reminder_log row, newest first (see
// insertReminderLog's own comment for why this exists alongside
// reminder_notifications). ?limit caps how many rows come back, default
// 100, capped at 500 so an unbounded query param can't return the whole
// table.
app.get(
  "/admin/cafes/:cafeId/reminder-log",
  requireAdminKey,
  async (req, res) => {
    try {
      const cafeId = Number(req.params.cafeId);
      if (!Number.isFinite(cafeId)) {
        return res.status(400).json({ error: "invalid_cafe_id" });
      }
      const current = await getCafeById.get(cafeId);
      if (!current) {
        return res.status(404).json({ error: "cafe_not_found" });
      }
      const limit = Math.min(
        500,
        Math.max(1, Number(req.query.limit) || 100),
      );
      const rows = await db
        .prepare(
          "SELECT id, customer_address, kind, message, stamp_state_ts, apple_touched, apple_pushed, google_sent, sent_at " +
            "FROM reminder_log WHERE cafe_id = ? ORDER BY sent_at DESC LIMIT ?",
        )
        .all(cafeId, limit);
      res.json({
        ok: true,
        cafe: { id: current.id, name: current.name || null },
        log: rows,
      });
    } catch (err) {
      console.error("Error in /admin/cafes/:cafeId/reminder-log:", err);
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  },
);

// Mail counterpart to /admin/cafes/:cafeId/reminder-log above - every
// email_log row attributed to this café, newest first.
app.get(
  "/admin/cafes/:cafeId/email-log",
  requireAdminKey,
  async (req, res) => {
    try {
      const cafeId = Number(req.params.cafeId);
      if (!Number.isFinite(cafeId)) {
        return res.status(400).json({ error: "invalid_cafe_id" });
      }
      const current = await getCafeById.get(cafeId);
      if (!current) {
        return res.status(404).json({ error: "cafe_not_found" });
      }
      const limit = Math.min(
        500,
        Math.max(1, Number(req.query.limit) || 100),
      );
      const rows = await db
        .prepare(
          "SELECT id, customer_address, kind, recipient, subject, success, error, sent_at " +
            "FROM email_log WHERE cafe_id = ? ORDER BY sent_at DESC LIMIT ?",
        )
        .all(cafeId, limit);
      res.json({
        ok: true,
        cafe: { id: current.id, name: current.name || null },
        log: rows,
      });
    } catch (err) {
      console.error("Error in /admin/cafes/:cafeId/email-log:", err);
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  },
);

// All cafés with the reminder enabled, each with their own candidate list -
// the shape a future cron job would iterate over to actually send.
app.get("/admin/reminder-candidates", requireAdminKey, async (req, res) => {
  try {
    const cafeRows = await db
      .prepare("SELECT * FROM cafes WHERE reminder_push_enabled = 1")
      .all();
    const results = [];
    for (const cafeRow of cafeRows) {
      const candidates = await findReminderCandidates(cafeRow);
      if (candidates.length) {
        results.push({
          cafeId: cafeRow.id,
          cafeName: cafeRow.name || null,
          candidates,
        });
      }
    }
    res.json({ ok: true, cafes: results });
  } catch (err) {
    console.error("Error in /admin/reminder-candidates:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// Actually sends the push reminder to every current candidate across every
// café with reminder_push_enabled=1. Meant to be called once a day by a
// scheduled external caller (see .github/workflows/reminders.yml), same
// dryRun/response-shape convention as
// /admin/customers/onboarding-reminders - dryRun computes and returns the
// candidate list without sending anything or writing to
// reminder_notifications.
app.post("/admin/reminders/run", requireAdminKey, async (req, res) => {
  try {
    const dryRun = ["1", "true"].includes(
      String(req.query?.dryRun || "").toLowerCase(),
    );
    const cafeRows = await db
      .prepare("SELECT * FROM cafes WHERE reminder_push_enabled = 1")
      .all();

    let candidateCount = 0;
    let sent = 0;
    const failures = [];
    const perCafe = [];

    for (const cafeRow of cafeRows) {
      const candidates = await findReminderCandidates(cafeRow);
      candidateCount += candidates.length;
      let cafeSent = 0;
      for (const candidate of candidates) {
        try {
          if (!dryRun) {
            const result = await sendReminderPush(cafeRow, candidate);
            if (result.hasChannel) {
              sent += 1;
              cafeSent += 1;
            }
          }
        } catch (sendErr) {
          console.warn(
            "Failed to send reminder push:",
            cafeRow.id,
            candidate.customerAddress,
            sendErr && sendErr.message ? sendErr.message : sendErr,
          );
          failures.push({
            cafeId: cafeRow.id,
            customerAddress: candidate.customerAddress,
            error: String(sendErr && sendErr.message ? sendErr.message : sendErr),
          });
        }
      }
      if (candidates.length) {
        perCafe.push({
          cafeId: cafeRow.id,
          cafeName: cafeRow.name || null,
          candidates: candidates.length,
          sent: cafeSent,
        });
      }
    }

    res.json({
      ok: true,
      dryRun,
      cafesChecked: cafeRows.length,
      candidates: candidateCount,
      sent,
      failed: failures.length,
      failures,
      perCafe,
    });
  } catch (err) {
    console.error("Error in /admin/reminders/run:", err);
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Same richer analytics/lifecycle shape the admin café-detail view uses
// (computeCafeAnalytics / computeCafeLifecycle above), just café-authenticated
// instead of admin-key-gated, and hard-scoped to the calling café's own
// address - the "me"-vs-numeric-id ownership check mirrors /overview below.
app.get("/cafes/:cafeId/analytics", requireCafeAuth, async (req, res) => {
  try {
    const { cafeId } = req.params;
    const cafeRow = req.cafe;
    if (!cafeRow) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }
    if (cafeId && cafeId !== "me" && String(cafeRow.id) !== String(cafeId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const cafeAddress = ensureCafeAddress(cafeRow) || String(cafeRow?.id || "");
    if (!cafeAddress) {
      return res.status(404).json({ error: "cafe_address_missing" });
    }
    const days = Number(req.query?.days) || 30;
    const analytics = await computeCafeAnalytics(
      cafeAddress.toLowerCase(),
      Number(cafeRow.id),
      days,
    );
    res.json({ ok: true, analytics });
  } catch (err) {
    console.error("Error in /cafes/:cafeId/analytics:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/cafes/:cafeId/lifecycle", requireCafeAuth, async (req, res) => {
  try {
    const { cafeId } = req.params;
    const cafeRow = req.cafe;
    if (!cafeRow) {
      return res.status(500).json({ error: "missing_cafe_context" });
    }
    if (cafeId && cafeId !== "me" && String(cafeRow.id) !== String(cafeId)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const cafeAddress = ensureCafeAddress(cafeRow) || String(cafeRow?.id || "");
    if (!cafeAddress) {
      return res.status(404).json({ error: "cafe_address_missing" });
    }
    const program = getCafeProgramSettings(cafeRow);
    const lifecycle = await computeCafeLifecycle(
      cafeAddress.toLowerCase(),
      program.stampsForReward,
      Number(cafeRow.id),
    );
    res.json({ ok: true, lifecycle });
  } catch (err) {
    console.error("Error in /cafes/:cafeId/lifecycle:", err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
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

    // Redemptions are identified by event_type = 'redeem', not delta < 0 -
    // a redeemed card is frozen (delta: 0, see /redeem-reward) rather than
    // decremented, so it stays open as a historical record instead of
    // resetting in place. stamps_redeemed sums each redeemed card's own
    // frozen total via a correlated subquery (not just the cafe's reward
    // threshold) since a card can be redeemed above threshold too (e.g. an
    // overflow that landed on an already-full card before it split).
    const statsRow = await db
      .prepare(
        `SELECT
           COUNT(*) AS total_events,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN (
             SELECT COALESCE(SUM(se2.delta), 0) FROM stamp_events se2
             WHERE LOWER(se2.cafe) = LOWER(stamp_events.cafe)
               AND LOWER(se2."user") = LOWER(stamp_events."user")
               AND COALESCE(se2.card_id, '') = COALESCE(stamp_events.card_id, '')
               AND (se2.status IS NULL OR se2.status = 'confirmed')
           ) ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN 1 ELSE 0 END) AS redemption_count,
           COUNT(DISTINCT "user") AS unique_customers,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN ts ELSE NULL END) AS last_redeem_ts
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
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN (
             SELECT COALESCE(SUM(se2.delta), 0) FROM stamp_events se2
             WHERE LOWER(se2.cafe) = LOWER(stamp_events.cafe)
               AND LOWER(se2."user") = LOWER(stamp_events."user")
               AND COALESCE(se2.card_id, '') = COALESCE(stamp_events.card_id, '')
               AND (se2.status IS NULL OR se2.status = 'confirmed')
           ) ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN 1 ELSE 0 END) AS redemptions,
           MAX(ts) AS last_activity_ts
         FROM stamp_events
         WHERE LOWER(cafe) = ?
         GROUP BY "user"
         ORDER BY last_activity_ts DESC
         LIMIT ?`,
      )
      .all(cafeAddressLower, customerLimit);

    const customers = [];
    for (const row of customersRows) {
      customers.push({
        address: row.user,
        customerName: row.customer_name || null,
        stampsAwarded: Number(row.stamps_awarded || 0),
        stampsRedeemed: Number(row.stamps_redeemed || 0),
        // Not row.net_stamps (a raw SUM(delta) across every card_id ever,
        // closed ones included) - staff need "does this customer have
        // enough right now", not an all-time history number.
        netStamps: await getOpenStampTotal(cafeAddressLower, row.user),
        redemptions: Number(row.redemptions || 0),
        lastActivityTs:
          row.last_activity_ts != null ? Number(row.last_activity_ts) : null,
      });
    }

    const charts = await computeCafeCharts(
      cafeAddressLower,
      cafeRow.id != null ? Number(cafeRow.id) : null,
    );

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
        shortDescription: cafeRow.short_description || null,
        redeemMessage: cafeRow.redeem_message || null,
        cardTheme: cafeRow.card_theme || "paper",
        cardBgColor: cafeRow.card_bg_color || null,
        cardFgColor: cafeRow.card_fg_color || null,
        cardBackText: cafeRow.card_back_text || null,
        program: getCafeProgramSettings(cafeRow),
        logoDataUrl:
          cafeRow.logo_data && cafeRow.logo_mime
            ? `data:${cafeRow.logo_mime};base64,${cafeRow.logo_data}`
            : null,
        hasCustomStampIcon: !!(cafeRow.stamp_icon_data && cafeRow.stamp_icon_mime),
        cardBackgroundDataUrl:
          cafeRow.card_bg_data && cafeRow.card_bg_mime
            ? `data:${cafeRow.card_bg_mime};base64,${cafeRow.card_bg_data}`
            : null,
      },
      stats,
      recentEvents: recentEvents.filter(Boolean),
      customers,
      charts,
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

// Shared by the cafe's own profile editor (PUT /cafes/me/profile) and the
// admin override (PUT /admin/cafes/:cafeId/profile) - same fields, same
// validation, only the auth/lookup around it differs.
async function applyCafeProfileUpdate(current, body) {
  try {
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

    // Kurzbeschreibung fuers Kurzprofil (hart auf 100 Zeichen begrenzt)
    let shortDescription = current.short_description || null;
    if (Object.prototype.hasOwnProperty.call(body, "shortDescription")) {
      const rawShort =
        body.shortDescription == null ? "" : String(body.shortDescription);
      const trimmedShort = rawShort.trim();
      shortDescription = trimmedShort ? trimmedShort.slice(0, 100) : null;
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
          return { ok: false, status: 400, error: "invalid_logo_format" };
        }
        const mime =
          m[1].toLowerCase() === "image/jpg"
            ? "image/jpeg"
            : m[1].toLowerCase();
        const base64 = String(m[3] || "").replace(/\s+/g, "");

        // Rough size guard: base64 chars ~ 4/3 bytes
        if (base64.length > 300_000) {
          return { ok: false, status: 413, error: "logo_too_large" };
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
          return { ok: false, status: 400, error: "invalid_card_bg_format" };
        }
        const mime =
          m[1].toLowerCase() === "image/jpg"
            ? "image/jpeg"
            : m[1].toLowerCase();
        const base64 = String(m[3] || "").replace(/\s+/g, "");

        // Rough size guard: base64 chars ~ 4/3 bytes
        if (base64.length > 650_000) {
          return { ok: false, status: 413, error: "card_bg_too_large" };
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
        return { ok: false, status: 400, error: "invalid_card_theme" };
      }
      cardTheme = trimmed || "paper";
    }

    // Custom colors override the preset when set; null/"" clears back to
    // the preset. Kept separate from cardTheme so a cafe can still pick a
    // preset as a starting point and fine-tune from there.
    const hexColorRe = /^#[0-9a-f]{6}$/i;
    let cardBgColor = current.card_bg_color || null;
    if (Object.prototype.hasOwnProperty.call(body, "cardBgColor")) {
      const raw = body.cardBgColor == null ? "" : String(body.cardBgColor).trim();
      if (!raw) {
        cardBgColor = null;
      } else if (!hexColorRe.test(raw)) {
        return { ok: false, status: 400, error: "invalid_card_bg_color" };
      } else {
        cardBgColor = raw.toLowerCase();
      }
    }

    let cardFgColor = current.card_fg_color || null;
    if (Object.prototype.hasOwnProperty.call(body, "cardFgColor")) {
      const raw = body.cardFgColor == null ? "" : String(body.cardFgColor).trim();
      if (!raw) {
        cardFgColor = null;
      } else if (!hexColorRe.test(raw)) {
        return { ok: false, status: 400, error: "invalid_card_fg_color" };
      } else {
        cardFgColor = raw.toLowerCase();
      }
    }

    const allowedStampStyles = new Set(["cup", "bean", "star", "circle"]);
    let stampStyle = current.stamp_style || "bean";
    if (Object.prototype.hasOwnProperty.call(body, "stampStyle")) {
      const raw = body.stampStyle == null ? "" : String(body.stampStyle);
      const trimmed = raw.trim().toLowerCase();
      if (trimmed && !allowedStampStyles.has(trimmed)) {
        return { ok: false, status: 400, error: "invalid_stamp_style" };
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

    let reminderPushEnabled = currentProgram.reminderPushEnabled;
    if (Object.prototype.hasOwnProperty.call(body, "reminderPushEnabled")) {
      reminderPushEnabled = toBoundBoolInt(
        body.reminderPushEnabled,
        reminderPushEnabled,
      );
    }

    let reminderMinStamps = currentProgram.reminderMinStamps;
    if (Object.prototype.hasOwnProperty.call(body, "reminderMinStamps")) {
      reminderMinStamps = toBoundInt(
        body.reminderMinStamps,
        reminderMinStamps,
        3,
        9,
      );
    }

    let reminderInactiveDays = currentProgram.reminderInactiveDays;
    if (Object.prototype.hasOwnProperty.call(body, "reminderInactiveDays")) {
      reminderInactiveDays = toBoundInt(
        body.reminderInactiveDays,
        reminderInactiveDays,
        1,
        365,
      );
    }

    let reminderMessage = currentProgram.reminderMessage;
    if (Object.prototype.hasOwnProperty.call(body, "reminderMessage")) {
      reminderMessage = toOptionalTrimmedText(body.reminderMessage, 280);
    }

    let reminderFullMessage = currentProgram.reminderFullMessage;
    if (Object.prototype.hasOwnProperty.call(body, "reminderFullMessage")) {
      reminderFullMessage = toOptionalTrimmedText(body.reminderFullMessage, 280);
    }

    let reminderNewCustomerDays = currentProgram.reminderNewCustomerDays;
    if (Object.prototype.hasOwnProperty.call(body, "reminderNewCustomerDays")) {
      reminderNewCustomerDays = toBoundInt(
        body.reminderNewCustomerDays,
        reminderNewCustomerDays,
        7,
        90,
      );
    }

    let reminderNewCustomerMessage = currentProgram.reminderNewCustomerMessage;
    if (
      Object.prototype.hasOwnProperty.call(body, "reminderNewCustomerMessage")
    ) {
      reminderNewCustomerMessage = toOptionalTrimmedText(
        body.reminderNewCustomerMessage,
        280,
      );
    }

    const now = Date.now();
    await updateCafeProfileById.run(
      aboutText,
      shortDescription,
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
      cardBgColor,
      cardFgColor,
      stampStyle,
      stampsForReward,
      rewardDescription,
      popupInactiveEnabled,
      popupInactiveDays,
      popupInactiveMessage,
      popupAlmostRewardEnabled,
      popupAlmostRewardRemaining,
      popupAlmostRewardMessage,
      reminderPushEnabled,
      reminderMinStamps,
      reminderInactiveDays,
      reminderMessage,
      reminderFullMessage,
      reminderNewCustomerDays,
      reminderNewCustomerMessage,
      now,
      current.id,
    );

    notifyWalletPassesForCafe(current.id);

    const updated = await getCafeById.get(current.id);
    notifyGoogleWalletClassForCafe(updated);
    const updatedProgram = getCafeProgramSettings(updated);
    return {
      ok: true,
      status: 200,
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
        shortDescription: updated.short_description || null,
        redeemMessage: updated.redeem_message || null,
        cardTheme: updated.card_theme || "paper",
        cardBgColor: updated.card_bg_color || null,
        cardFgColor: updated.card_fg_color || null,
        cardBackText: updated.card_back_text || null,
        program: updatedProgram,
        logoDataUrl:
          updated.logo_data && updated.logo_mime
            ? `data:${updated.logo_mime};base64,${updated.logo_data}`
            : null,
        hasCustomStampIcon: !!(updated.stamp_icon_data && updated.stamp_icon_mime),
        cardBackgroundDataUrl:
          updated.card_bg_data && updated.card_bg_mime
            ? `data:${updated.card_bg_mime};base64,${updated.card_bg_data}`
            : null,
        updatedAt:
          updated.updated_at != null ? Number(updated.updated_at) : null,
      },
    };
  } catch (err) {
    console.error("Error in applyCafeProfileUpdate:", err);
    return {
      ok: false,
      status: 500,
      error: String(err && err.message ? err.message : err),
    };
  }
}

app.put("/cafes/me/profile", requireCafeAuth, async (req, res) => {
  const cafeRow = req.cafe;
  if (!cafeRow || cafeRow.id == null) {
    return res.status(500).json({ error: "missing_cafe_context" });
  }
  const current = await getCafeById.get(cafeRow.id);
  if (!current) {
    return res.status(404).json({ error: "cafe_not_found" });
  }
  const result = await applyCafeProfileUpdate(current, req.body || {});
  return res.status(result.status).json(
    result.ok ? { ok: true, cafe: result.cafe } : { error: result.error },
  );
});

const BROADCAST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Lets a café send a one-off custom push to every customer with an open
// (not-yet-redeemed) card right now, instead of waiting for the automatic
// criteria-based reminder (chat 2026-09-21: "eine funktion damit das cafe
// selber ein push an alle herausschickt"). Reuses sendReminderPush() for
// actual delivery - same %@-based Apple mechanism, same Google addMessage
// call, same reminder_log audit trail - just with a manually-typed message
// and a candidate list built from every wallet pass/object at this café
// instead of findReminderCandidates()'s stamp/inactivity criteria.
// ?dryRun=1 (or {dryRun:true} in the body) only returns how many customers
// would be reached, without sending or touching the cooldown - the Barista
// App uses this to show a confirmation ("An 12 Kunden senden?") before the
// real call.
app.post("/cafes/me/broadcast", requireCafeAuth, async (req, res) => {
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
    const message = toOptionalTrimmedText(body.message, 280);
    if (!message) {
      return res.status(400).json({ ok: false, error: "message_required" });
    }
    const dryRun = body.dryRun === true || req.query.dryRun === "1";

    if (!dryRun) {
      const now0 = Date.now();
      if (
        current.last_broadcast_at != null &&
        now0 - Number(current.last_broadcast_at) < BROADCAST_COOLDOWN_MS
      ) {
        const retryAfterMs =
          BROADCAST_COOLDOWN_MS - (now0 - Number(current.last_broadcast_at));
        return res
          .status(429)
          .json({ ok: false, error: "cooldown_active", retryAfterMs });
      }
    }

    const cardRows = await db
      .prepare(
        `SELECT customer_address FROM (
           SELECT customer_address FROM wallet_passes WHERE cafe_id = ?
           UNION
           SELECT customer_address FROM google_wallet_objects WHERE cafe_id = ?
         ) AS t
         GROUP BY customer_address`,
      )
      .all(current.id, current.id);
    const customerCount = cardRows.length;

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, customerCount });
    }

    const now = Date.now();
    let sent = 0;
    let failed = 0;
    for (const row of cardRows) {
      const customerAddress = String(row.customer_address || "").toLowerCase();
      if (!customerAddress) continue;
      try {
        const result = await sendReminderPush(current, {
          kind: "manual",
          customerAddress,
          message,
          lastStampTs: now,
        });
        if (result.hasChannel) sent += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        console.warn(
          "Broadcast send failed for",
          customerAddress,
          err && err.message ? err.message : err,
        );
      }
    }

    await db
      .prepare("UPDATE cafes SET last_broadcast_at = ? WHERE id = ?")
      .run(now, current.id);

    return res.json({ ok: true, dryRun: false, customerCount, sent, failed });
  } catch (err) {
    console.error("Error in /cafes/me/broadcast:", err);
    return res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

// Admin override for cafes that don't want to configure their own design -
// same fields/validation as the cafe's own editor, just authenticated with
// the admin key instead of a cafe session.
app.get("/admin/cafes/:cafeId/profile", requireAdminKey, async (req, res) => {
  const cafeId = Number(req.params.cafeId);
  if (!Number.isFinite(cafeId)) {
    return res.status(400).json({ error: "invalid_cafe_id" });
  }
  const current = await getCafeById.get(cafeId);
  if (!current) {
    return res.status(404).json({ error: "cafe_not_found" });
  }
  const program = getCafeProgramSettings(current);
  return res.json({
    ok: true,
    cafe: {
      id: current.id,
      name: current.name || null,
      address: current.address || null,
      cardTheme: current.card_theme || "paper",
      cardBgColor: current.card_bg_color || null,
      cardFgColor: current.card_fg_color || null,
      cardBackText: current.card_back_text || null,
      program,
      logoDataUrl:
        current.logo_data && current.logo_mime
          ? `data:${current.logo_mime};base64,${current.logo_data}`
          : null,
    },
  });
});

app.put("/admin/cafes/:cafeId/profile", requireAdminKey, async (req, res) => {
  const cafeId = Number(req.params.cafeId);
  if (!Number.isFinite(cafeId)) {
    return res.status(400).json({ error: "invalid_cafe_id" });
  }
  const current = await getCafeById.get(cafeId);
  if (!current) {
    return res.status(404).json({ error: "cafe_not_found" });
  }
  const result = await applyCafeProfileUpdate(current, req.body || {});
  return res.status(result.status).json(
    result.ok ? { ok: true, cafe: result.cafe } : { error: result.error },
  );
});

// Permanently deletes one café and everything tied to it (sessions, stamp
// events, redeem tokens, QR nonces - wallet_passes/wallet_registrations/
// google_wallet_objects cascade via their own FK on cafe_id). Same cleanup
// sequence as the self-service /cafes/me/delete-account, just
// admin-authenticated instead of password-gated. ?confirm=DELETE is
// required so this can never fire from an accidental request.
app.delete("/admin/cafes/:cafeId", requireAdminKey, async (req, res) => {
  try {
    const cafeId = Number(req.params.cafeId);
    if (!Number.isFinite(cafeId)) {
      return res.status(400).json({ ok: false, error: "invalid_cafe_id" });
    }
    if (String(req.query?.confirm || "") !== "DELETE") {
      return res
        .status(400)
        .json({ ok: false, error: "delete_confirmation_required" });
    }
    const cafeRow = await getCafeById.get(cafeId);
    if (!cafeRow) {
      return res.status(404).json({ ok: false, error: "cafe_not_found" });
    }

    const cafeAddress =
      cafeRow.address != null ? String(cafeRow.address).trim() : "";
    const cafeIdText = String(cafeRow.id);

    await deleteCafeSessionsByCafeId.run(cafeRow.id);
    await deleteCafeEmailVerificationsByCafeId.run(cafeRow.id);
    await deleteCafePasswordResetsByCafeId.run(cafeRow.id);
    await deleteQrNoncesByCafeId.run(cafeIdText);
    if (cafeAddress) {
      await deleteRedeemTokensByCafeAddress.run(cafeAddress, cafeAddress);
      await deleteStampEventsByCafeAddress.run(cafeAddress);
    }
    await deleteCafeById.run(cafeRow.id);

    res.json({
      ok: true,
      deleted: { cafeId: cafeRow.id, name: cafeRow.name || null },
    });
  } catch (err) {
    console.error("Error in DELETE /admin/cafes/:cafeId:", err);
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Daily "finish onboarding" nudge - customers who registered but never
// confirmed their email, or confirmed but never got their Apple Wallet pass
// past "downloaded" to "actually in the wallet" (no PassKit registration
// callback). Meant to be called once a day by a scheduled external caller
// (see .github/workflows/onboarding-reminders.yml), not from the admin UI.
app.post(
  "/admin/customers/onboarding-reminders",
  requireAdminKey,
  async (req, res) => {
    try {
      const dryRun = ["1", "true"].includes(
        String(req.query?.dryRun || "").toLowerCase(),
      );
      const appsBaseUrl = getAppsBaseUrlFromRequest(req);
      const now = Date.now();

      const dueCustomers = await db
        .prepare(
          `SELECT c.id, c.customer_id, c.username, c.email, c.address, c.created_at,
                  c.registered_via_cafe_address,
                  rc.id AS registered_cafe_id, rc.name AS registered_cafe_name,
                  CASE WHEN rc.logo_mime IS NOT NULL THEN 1 ELSE 0 END AS registered_cafe_has_logo,
                  CASE WHEN c.email_verified_at IS NULL THEN 1 ELSE 0 END AS needs_verification,
                  CASE WHEN c.email_verified_at IS NOT NULL
                    AND EXISTS (SELECT 1 FROM wallet_passes wp WHERE wp.customer_address = c.address)
                    AND NOT EXISTS (
                      SELECT 1 FROM wallet_passes wp2
                      JOIN wallet_registrations wr2 ON wr2.serial_number = wp2.serial_number
                      WHERE wp2.customer_address = c.address
                    ) THEN 1 ELSE 0 END AS needs_wallet_confirm
           FROM customers c
           LEFT JOIN cafes rc ON rc.address = c.registered_via_cafe_address
           WHERE c.password_hash IS NOT NULL
             AND c.onboarding_reminder_sent_at IS NULL
             AND c.created_at <= ?
             AND c.created_at >= ?
             -- A customer with any real stamp history is clearly using the
             -- product already, just not (yet, or ever) through the wallet
             -- channel this reminder nudges toward - e.g. registered via
             -- the app and collects stamps in-app without touching Wallet
             -- at all. Awarding a stamp only needs the café's own auth
             -- (see /stamp-by-cafe), not a verified customer email, so this
             -- can genuinely happen even for c.email_verified_at IS NULL.
             -- Nagging an already-engaged customer to "finish onboarding"
             -- would be wrong regardless of which bucket below they'd
             -- otherwise match, so this excludes them from both at once.
             AND NOT EXISTS (
               SELECT 1 FROM stamp_events se WHERE LOWER(se."user") = LOWER(c.address)
             )
           ORDER BY c.created_at ASC`,
        )
        .all(now - 24 * 60 * 60 * 1000, ONBOARDING_REMINDER_ROLLOUT_AT_MS);

      const candidates = dueCustomers.filter(
        (row) => row.needs_verification || row.needs_wallet_confirm,
      );

      let sent = 0;
      const failures = [];

      for (const row of candidates) {
        try {
          const needsVerification = !!row.needs_verification;
          const needsWalletConfirm = !!row.needs_wallet_confirm;

          let pendingPass = null;
          if (needsWalletConfirm) {
            pendingPass = await db
              .prepare(
                `SELECT wp.card_id, cf.id AS cafe_id, cf.address AS cafe_address, cf.name AS cafe_name,
                        CASE WHEN cf.logo_mime IS NOT NULL THEN 1 ELSE 0 END AS cafe_has_logo
                 FROM wallet_passes wp
                 JOIN cafes cf ON cf.id = wp.cafe_id
                 WHERE wp.customer_address = ?
                 ORDER BY wp.created_at ASC
                 LIMIT 1`,
              )
              .get(row.address);
          }

          let verifyUrl = null;
          if (needsVerification) {
            const token = crypto.randomBytes(24).toString("hex");
            const tokenHash = crypto
              .createHash("sha256")
              .update(token)
              .digest("hex");
            if (!dryRun) {
              await insertCustomerEmailVerification.run(
                row.id,
                tokenHash,
                now,
                now + EMAIL_VERIFICATION_TTL_MS,
              );
            }
            verifyUrl = buildCustomerVerifyUrl(
              appsBaseUrl,
              token,
              row.registered_via_cafe_address || null,
            );
          }

          let applePassUrl = null;
          if (needsWalletConfirm && pendingPass && walletPass.isWalletConfigured()) {
            applePassUrl = `${appsBaseUrl}/api/customers/${encodeURIComponent(
              row.address,
            )}/wallet-pass?cafe=${encodeURIComponent(
              pendingPass.cafe_address,
            )}&cardId=${encodeURIComponent(pendingPass.card_id || "")}`;
          }

          // The pending-wallet café (the one the waiting card actually
          // belongs to) takes precedence over the registration-origin café.
          let cafeName = null;
          let cafeLogoUrl = null;
          let logCafeId = null;
          if (needsWalletConfirm && pendingPass) {
            cafeName = pendingPass.cafe_name || null;
            cafeLogoUrl = pendingPass.cafe_has_logo
              ? `${appsBaseUrl}/api/cafes/${pendingPass.cafe_id}/logo.png`
              : null;
            logCafeId = pendingPass.cafe_id || null;
          } else if (row.registered_cafe_id) {
            cafeName = row.registered_cafe_name || null;
            cafeLogoUrl = row.registered_cafe_has_logo
              ? `${appsBaseUrl}/api/cafes/${row.registered_cafe_id}/logo.png`
              : null;
            logCafeId = row.registered_cafe_id || null;
          }

          if (!dryRun) {
            await sendOnboardingReminderEmail({
              email: row.email,
              username: row.username,
              needsVerification,
              verifyUrl,
              needsWalletConfirm,
              applePassUrl,
              profileUrl: `${appsBaseUrl}/customer-profile`,
              cafeName,
              cafeLogoUrl,
              logMeta: {
                kind: "onboarding_reminder",
                cafeId: logCafeId,
                customerAddress: row.address,
              },
            });
            await markCustomerOnboardingReminderSentById.run(now, row.id);
            sent += 1;
          }
        } catch (sendErr) {
          console.warn(
            "Failed to send onboarding reminder to customer:",
            row.customer_id,
            sendErr && sendErr.message ? sendErr.message : sendErr,
          );
          failures.push({
            customerId: row.customer_id,
            error: String(sendErr && sendErr.message ? sendErr.message : sendErr),
          });
        }
      }

      res.json({
        ok: true,
        dryRun,
        candidates: candidates.length,
        sent,
        failed: failures.length,
        failures,
      });
    } catch (err) {
      console.error("Error in /admin/customers/onboarding-reminders:", err);
      res
        .status(500)
        .json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  },
);

// Daily-eligible nudge (see .github/workflows/wallet-activation-reminders.yml)
// for customers who have an active account (verified email) and downloaded
// a wallet pass at some café, but never actually confirmed it (see
// migrations/024_add_customer_wallet_activation_reminder.sql). Deliberately
// separate from /admin/customers/onboarding-reminders above, which
// excludes anyone with stamp_events on the (here: wrong) assumption that
// stamping means the wallet channel is fine - a café can award stamps via
// /stamp-by-cafe regardless of wallet-registration state, so this one does
// NOT require any stamps to have been awarded yet - "downloaded but never
// added" is worth a nudge on its own. Sent once per customer (see the
// sent_at gate below); the barista scanner's own live warning (see
// /stamp-by-cafe) remains the ongoing in-person safety net on top of this.
app.post(
  "/admin/customers/wallet-activation-reminders",
  requireAdminKey,
  async (req, res) => {
    try {
      const dryRun = ["1", "true"].includes(
        String(req.query?.dryRun || "").toLowerCase(),
      );
      const appsBaseUrl = getAppsBaseUrlFromRequest(req);

      // Shortlist: passes with no Apple registration and no Google object,
      // belonging to a customer with a verified email we haven't nudged yet.
      const shortlist = await db
        .prepare(
          `SELECT wp.customer_address, wp.card_id,
                  cf.id AS cafe_id, cf.address AS cafe_address, cf.name AS cafe_name,
                  CASE WHEN cf.logo_mime IS NOT NULL THEN 1 ELSE 0 END AS cafe_has_logo,
                  c.id AS customer_id, c.customer_id AS customer_public_id,
                  c.email, c.username
           FROM wallet_passes wp
           JOIN cafes cf ON cf.id = wp.cafe_id
           JOIN customers c ON LOWER(c.address) = LOWER(wp.customer_address)
           WHERE c.email IS NOT NULL
             AND c.email_verified_at IS NOT NULL
             AND c.wallet_activation_reminder_sent_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM wallet_registrations wr WHERE wr.serial_number = wp.serial_number
             )
             AND NOT EXISTS (
               SELECT 1 FROM google_wallet_objects gwo
               WHERE gwo.customer_address = wp.customer_address AND gwo.cafe_id = wp.cafe_id
             )
           ORDER BY c.id ASC`,
        )
        .all();

      // One shortlist row per (customer, café, card) - if a customer is
      // affected at more than one café, only mention whichever one has the
      // most open stamps (falls back to the first one if all are at zero)
      // rather than sending multiple emails. Stamps are a bonus detail in
      // the email, not a requirement to be a candidate at all.
      const byCustomer = new Map();
      for (const row of Array.isArray(shortlist) ? shortlist : []) {
        const stamps = await getOpenStampTotal(row.cafe_address, row.customer_address);
        const existing = byCustomer.get(row.customer_id);
        if (!existing || stamps > existing.stamps) {
          byCustomer.set(row.customer_id, { ...row, stamps });
        }
      }
      const candidates = Array.from(byCustomer.values());

      let sent = 0;
      const failures = [];

      for (const row of candidates) {
        try {
          let applePassUrl = null;
          if (walletPass.isWalletConfigured()) {
            applePassUrl = `${appsBaseUrl}/api/customers/${encodeURIComponent(
              row.customer_address,
            )}/wallet-pass?cafe=${encodeURIComponent(
              row.cafe_address,
            )}&cardId=${encodeURIComponent(row.card_id || "")}`;
          }
          const cafeLogoUrl = row.cafe_has_logo
            ? `${appsBaseUrl}/api/cafes/${row.cafe_id}/logo.png`
            : null;
          const cafeJoinUrl = `${appsBaseUrl}/cafe-join?cafe=${encodeURIComponent(
            row.cafe_address,
          )}`;

          if (!dryRun) {
            await sendWalletActivationReminderEmail({
              email: row.email,
              username: row.username,
              stampCount: row.stamps,
              cafeName: row.cafe_name || null,
              cafeLogoUrl,
              cafeJoinUrl,
              applePassUrl,
              profileUrl: `${appsBaseUrl}/customer-profile`,
              logMeta: {
                kind: "wallet_activation_reminder",
                cafeId: row.cafe_id,
                customerAddress: row.customer_address,
              },
            });
            await markCustomerWalletActivationReminderSentById.run(
              Date.now(),
              row.customer_id,
            );
            sent += 1;
          }
        } catch (sendErr) {
          console.warn(
            "Failed to send wallet-activation reminder to customer:",
            row.customer_public_id,
            sendErr && sendErr.message ? sendErr.message : sendErr,
          );
          failures.push({
            customerId: row.customer_public_id,
            error: String(sendErr && sendErr.message ? sendErr.message : sendErr),
          });
        }
      }

      res.json({
        ok: true,
        dryRun,
        candidates: candidates.length,
        sent,
        failed: failures.length,
        failures,
      });
    } catch (err) {
      console.error(
        "Error in /admin/customers/wallet-activation-reminders:",
        err,
      );
      res
        .status(500)
        .json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  },
);

// Sales-demo helper: given just a logo (no cafe row exists yet), auto-detect
// a brand color and render mockup images of the standee, registration
// screen, and wallet pass, so a prospect can be shown "this is what it'd
// look like for you" before they sign up. Nothing here touches the DB.
app.post("/admin/logo-preview", requireAdminKey, async (req, res) => {
  try {
    const body = req.body || {};
    const rawLogo = body.logoDataUrl;
    if (!rawLogo) {
      return res.status(400).json({ ok: false, error: "logo_required" });
    }
    const m =
      /^data:(image\/(png|jpeg|jpg|svg\+xml|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(
        String(rawLogo),
      );
    if (!m) {
      return res.status(400).json({ ok: false, error: "invalid_logo_format" });
    }
    const base64 = String(m[3] || "").replace(/\s+/g, "");
    if (base64.length > 1_500_000) {
      return res.status(413).json({ ok: false, error: "logo_too_large" });
    }
    const logoBuffer = Buffer.from(base64, "base64");

    const cafeName = String(body.cafeName || "").trim().slice(0, 80) || null;
    const rewardText =
      String(body.rewardText || "").trim().slice(0, 120) || null;

    const hexRe = /^#[0-9a-f]{6}$/i;
    let bg = hexRe.test(body.bgColor || "") ? body.bgColor : null;
    let fg = hexRe.test(body.fgColor || "") ? body.fgColor : null;
    if (!bg || !fg) {
      const detected = await logoPreview.extractColorsFromLogo(logoBuffer);
      bg = bg || detected.bg;
      fg = fg || detected.fg;
    }

    const images = await logoPreview.renderPreviewImages({
      logoBuffer,
      cafeName,
      rewardText,
      bg,
      fg,
    });

    res.json({
      ok: true,
      bgColor: bg,
      fgColor: fg,
      standee: `data:image/png;base64,${images.standee.toString("base64")}`,
      registration: `data:image/png;base64,${images.registration.toString("base64")}`,
      walletPassApple: `data:image/png;base64,${images.walletPassApple.toString("base64")}`,
      walletPassGoogle: `data:image/png;base64,${images.walletPassGoogle.toString("base64")}`,
    });
  } catch (err) {
    console.error("Error in /admin/logo-preview:", err);
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Manually re-patches a customer's Google Wallet object with the current
// stamp count/profile - useful for support ("card looks stale, resync it")
// and to test the PATCH path without needing to award a real stamp.
app.post("/admin/google-wallet/resync", requireAdminKey, async (req, res) => {
  const customerAddress = String(req.query?.customer || "").trim();
  const cafeAddress = String(req.query?.cafe || "").trim();
  if (!/^0x[0-9a-f]{40}$/i.test(customerAddress) || !/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  await notifyGoogleWalletPassUpdated(customerAddress, cafeAddress);
  res.json({ ok: true });
});

// Apple-side equivalent - pushes an APNs "refresh" ping for every pass this
// customer has for this cafe. The push itself carries no data (PassKit
// doesn't work that way); it just tells the device to re-pull via the
// webservice route, which recomputes with whatever the current code/data
// says - useful for getting an already-installed pass to pick up a
// server-side calculation fix without waiting for the customer's next
// real stamp/redeem event.
app.post("/admin/apple-wallet/resync", requireAdminKey, async (req, res) => {
  const customerAddress = String(req.query?.customer || "").trim();
  const cafeAddress = String(req.query?.cafe || "").trim();
  if (!/^0x[0-9a-f]{40}$/i.test(customerAddress) || !/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  await notifyWalletPassUpdated(customerAddress, cafeAddress);
  res.json({ ok: true });
});

// Manually awards stamps outside the normal cafe-login flow - same
// splitStampAward()/insertEvent path as /stamp-by-cafe, so it's a faithful
// way to test the overflow-splitting logic (or fix a support case) without
// needing real cafe credentials.
app.post("/admin/award-stamps", requireAdminKey, async (req, res) => {
  const customerAddress = String(req.body?.customer || "").trim();
  const cafeAddress = String(req.body?.cafe || "").trim();
  const count = Math.max(1, Math.min(20, Number(req.body?.count || 1)));
  if (!/^0x[0-9a-f]{40}$/i.test(customerAddress) || !/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  const cafeRow = await getCafeRowByAddress.get(cafeAddress);
  if (!cafeRow) return res.status(404).json({ error: "cafe_not_found" });

  const program = getCafeProgramSettings(cafeRow);
  const { segments, overflowed, newCardId, newCardStamps } = await splitStampAward({
    cafeAddress,
    customerAddress,
    totalCount: count,
    threshold: program.stampsForReward,
  });

  const customerRowForAward = await getCustomerByAddress.get(customerAddress);
  for (const seg of segments) {
    const localTx = `local_${crypto.randomBytes(16).toString("hex")}`;
    const ev = {
      ts: Date.now(),
      cafe: cafeAddress,
      customer_name: customerRowForAward?.username || null,
      user: customerAddress,
      txhash: localTx,
      status: "confirmed",
      event_type: "stamp",
      delta: seg.delta,
      card_id: seg.cardId,
    };
    await insertEvent.run(ev);
    try {
      broadcastEvent(ev);
    } catch (e) {}
  }
  if (overflowed) {
    try {
      broadcastEvent({
        cafe: cafeAddress,
        user: customerAddress,
        event_type: "card_overflow",
        newCardId,
        newCardStamps,
      });
    } catch (e) {}
    notifyNewCardByEmail(customerAddress, cafeAddress, newCardId);
  }
  notifyWalletPassUpdated(customerAddress, cafeAddress);
  notifyGoogleWalletPassUpdated(customerAddress, cafeAddress);

  res.json({ ok: true, segments, overflowed, newCardId, newCardStamps });
});

// Manually simulates a reward redemption outside the normal cafe-scanner
// flow - same "freeze the redeemed card, open a new one" path as
// /redeem-reward, minus the single-use QR token dance (not needed for an
// admin-authenticated test call). Lets the redeem flow be verified without
// real cafe credentials.
app.post("/admin/redeem-reward", requireAdminKey, async (req, res) => {
  const customerAddress = String(req.body?.customer || "").trim();
  const cafeAddress = String(req.body?.cafe || "").trim();
  const cardIdRaw = req.body?.cardId != null ? String(req.body.cardId).trim() : "";
  const normalizedCardId = cardIdRaw && cardIdRaw !== "__legacy__" ? cardIdRaw : null;
  if (!/^0x[0-9a-f]{40}$/i.test(customerAddress) || !/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  const cafeRow = await getCafeRowByAddress.get(cafeAddress);
  if (!cafeRow) return res.status(404).json({ error: "cafe_not_found" });

  const currentStamps = await getStampsByCafeUserCardId(
    cafeAddress,
    customerAddress,
    normalizedCardId,
  );
  const program = getCafeProgramSettings(cafeRow);
  const rewardThreshold = toBoundInt(program.stampsForReward, 10, 1, 50);
  if (currentStamps < rewardThreshold) {
    return res.status(400).json({
      error: "insufficient_stamps",
      current: currentStamps,
      required: rewardThreshold,
    });
  }

  const customerRow = await getCustomerByAddress.get(customerAddress);
  const now = Date.now();
  const ev = {
    ts: now,
    cafe: cafeAddress,
    customer_name: customerRow?.username || null,
    user: customerAddress,
    txhash: `local_${crypto.randomBytes(16).toString("hex")}`,
    status: "confirmed",
    event_type: "redeem",
    delta: 0,
    card_id: normalizedCardId,
  };
  await insertEvent.run(ev);

  const reusable = await findReusableOpenCard(
    cafeAddress,
    customerAddress,
    normalizedCardId,
    rewardThreshold,
  );
  const newCardId = reusable ? reusable.cardId : crypto.randomBytes(8).toString("hex");
  const newCardEv = {
    ts: now,
    cafe: cafeAddress,
    customer_name: customerRow?.username || null,
    user: customerAddress,
    txhash: `local_${crypto.randomBytes(16).toString("hex")}`,
    status: "confirmed",
    event_type: "card_start",
    delta: 0,
    card_id: newCardId,
  };
  await insertEvent.run(newCardEv);

  notifyWalletPassUpdated(customerAddress, cafeAddress);
  notifyGoogleWalletPassUpdated(customerAddress, cafeAddress);
  // Same reasoning as /redeem-reward - see its comment above this same call.
  if (!reusable) {
    notifyNewCardByEmail(customerAddress, cafeAddress, newCardId);
  }
  try {
    broadcastEvent({ ...ev, newCardId });
  } catch (e) {}

  res.json({
    ok: true,
    previousStamps: currentStamps,
    newCardId,
    reusedExistingCard: !!reusable,
  });
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
          "SELECT id, name, email, email_verified_at, address, location_address, created_at FROM cafes ORDER BY LOWER(name)",
        )
        .all();
    } else {
      try {
        cafeRows = db
          .prepare(
            "SELECT id, name, email, email_verified_at, address, location_address, created_at FROM cafes ORDER BY name COLLATE NOCASE",
          )
          .all();
      } catch (selectErr) {
        cafeRows = db
          .prepare(
            "SELECT id, name, email, email_verified_at, location_address, created_at FROM cafes ORDER BY name COLLATE NOCASE",
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
      walletAppleDownloaded: 0,
      walletAppleActive: 0,
      walletApplePushDevices: 0,
      walletGoogleAdded: 0,
    });

    const results = [];
    const cafeByAddress = new Map();
    const cafeById = new Map();

    for (const row of cafeRows) {
      const resolvedAddress = row.address || null;

      const entry = {
        // Postgres returns BIGINT/BIGSERIAL columns as strings by default
        // (node-postgres avoids silently losing precision beyond
        // Number.MAX_SAFE_INTEGER) - SQLite doesn't have this quirk, which
        // is why the admin dashboard's café-detail drill-down only broke in
        // prod/staging (real Postgres), never in local SQLite dev: the
        // frontend's strict `cafe.id === selectedCafeId` comparison failed
        // silently against a string id. Coercing here keeps every
        // downstream consumer of entry.id on a plain JS number.
        id: row.id != null ? Number(row.id) : null,
        email: row.email || null,
        emailVerifiedAt: row.email_verified_at || null,
        name: row.name || `Café ${row.id}`,
        address: resolvedAddress,
        locationAddress: row.location_address || null,
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
      if (row.id != null) {
        cafeById.set(Number(row.id), entry);
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
          email: null,
          emailVerifiedAt: null,
          name: "Unbekanntes Café",
          address: addr,
          locationAddress: null,
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
        email: null,
        emailVerifiedAt: null,
        name: "Unbekanntes Café",
        address: null,
        locationAddress: null,
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
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN (
             SELECT COALESCE(SUM(se2.delta), 0) FROM stamp_events se2
             WHERE LOWER(se2.cafe) = LOWER(stamp_events.cafe)
               AND LOWER(se2."user") = LOWER(stamp_events."user")
               AND COALESCE(se2.card_id, '') = COALESCE(stamp_events.card_id, '')
               AND (se2.status IS NULL OR se2.status = 'confirmed')
           ) ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN 1 ELSE 0 END) AS redemptions,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN ts ELSE NULL END) AS last_redeem_ts,
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
           MAX(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN ts ELSE NULL END) AS last_redeem_ts,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN (
             SELECT COALESCE(SUM(se2.delta), 0) FROM stamp_events se2
             WHERE LOWER(se2.cafe) = LOWER(stamp_events.cafe)
               AND LOWER(se2."user") = LOWER(stamp_events."user")
               AND COALESCE(se2.card_id, '') = COALESCE(stamp_events.card_id, '')
               AND (se2.status IS NULL OR se2.status = 'confirmed')
           ) ELSE 0 END) AS stamps_redeemed,
           SUM(delta) AS net_stamps,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN 1 ELSE 0 END) AS redemptions,
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

    // Apple: wallet_passes rows exist once a .pkpass is downloaded, but only
    // a matching wallet_registrations row (written by Apple's own PassKit
    // web service when the device actually adds/removes the pass) confirms
    // it really ended up in the customer's Wallet. Google has no such
    // confirmation callback, so google_wallet_objects only tells us the save
    // flow was started, not completed.
    const appleWalletRows = await db
      .prepare(
        `SELECT wp.cafe_id AS cafe_id,
           COUNT(DISTINCT wp.customer_address) AS downloaded,
           COUNT(DISTINCT CASE WHEN wr.serial_number IS NOT NULL THEN wp.customer_address END) AS active,
           COUNT(DISTINCT wr.device_library_identifier) AS push_devices
         FROM wallet_passes wp
         LEFT JOIN wallet_registrations wr ON wr.serial_number = wp.serial_number
         GROUP BY wp.cafe_id`,
      )
      .all();

    for (const row of appleWalletRows) {
      const entry = cafeById.get(Number(row.cafe_id));
      if (!entry) continue;
      entry.stats.walletAppleDownloaded = Number(row.downloaded || 0);
      entry.stats.walletAppleActive = Number(row.active || 0);
      entry.stats.walletApplePushDevices = Number(row.push_devices || 0);
    }

    const googleWalletRows = await db
      .prepare(
        `SELECT cafe_id AS cafe_id, COUNT(DISTINCT customer_address) AS added
         FROM google_wallet_objects
         GROUP BY cafe_id`,
      )
      .all();

    for (const row of googleWalletRows) {
      const entry = cafeById.get(Number(row.cafe_id));
      if (!entry) continue;
      entry.stats.walletGoogleAdded = Number(row.added || 0);
    }

    // Customers who have a wallet pass for a cafe but have never actually
    // been stamped there don't show up in entry.customers at all (that list
    // comes purely from stamp_events) - surface them separately so "loaded
    // the pass, never got a stamp" isn't invisible in the dashboard.
    const allCustomerRows = await listCustomers.all();
    const customerNameByAddress = new Map();
    for (const row of allCustomerRows) {
      if (row.address) {
        customerNameByAddress.set(
          String(row.address).toLowerCase(),
          row.username || null,
        );
      }
    }

    const walletOnlyByCafe = new Map();
    function addWalletOnlyCandidate(cafeId, address, createdAt, walletApple, walletGoogle) {
      const entry = cafeById.get(Number(cafeId));
      if (!entry) return;
      const key = String(address).toLowerCase();
      if (entry._stampedCustomerKeys.has(key)) return; // already has real stamp activity
      if (!walletOnlyByCafe.has(entry)) walletOnlyByCafe.set(entry, new Map());
      const byCustomer = walletOnlyByCafe.get(entry);
      const existing = byCustomer.get(key);
      if (existing) {
        existing.walletApple = existing.walletApple || walletApple;
        existing.walletGoogle = existing.walletGoogle || walletGoogle;
        existing.createdAt = Math.min(existing.createdAt, createdAt);
      } else {
        byCustomer.set(key, {
          user: address,
          customerName: customerNameByAddress.get(key) || null,
          walletApple,
          walletGoogle,
          createdAt,
        });
      }
    }

    for (const entry of results) {
      entry._stampedCustomerKeys = new Set(
        entry.customers.map((c) => String(c.user).toLowerCase()),
      );
    }

    const applyWalletRows = await db
      .prepare(
        `SELECT wp.cafe_id AS cafe_id, wp.customer_address AS customer_address,
           MIN(wp.created_at) AS created_at
         FROM wallet_passes wp
         GROUP BY wp.cafe_id, wp.customer_address`,
      )
      .all();
    for (const row of applyWalletRows) {
      addWalletOnlyCandidate(
        row.cafe_id,
        row.customer_address,
        Number(row.created_at || 0),
        true,
        false,
      );
    }

    const googleWalletCustomerRows = await db
      .prepare(
        `SELECT cafe_id AS cafe_id, customer_address AS customer_address,
           MIN(created_at) AS created_at
         FROM google_wallet_objects
         GROUP BY cafe_id, customer_address`,
      )
      .all();
    for (const row of googleWalletCustomerRows) {
      addWalletOnlyCandidate(
        row.cafe_id,
        row.customer_address,
        Number(row.created_at || 0),
        false,
        true,
      );
    }

    for (const entry of results) {
      const byCustomer = walletOnlyByCafe.get(entry);
      entry.walletOnlyCustomers = byCustomer
        ? Array.from(byCustomer.values()).sort((a, b) => b.createdAt - a.createdAt)
        : [];
      delete entry._stampedCustomerKeys;
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
      entry.emailVerifiedAt = entry.emailVerifiedAt
        ? Number(entry.emailVerifiedAt)
        : null;

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

    const appleWalletByCustomer = new Map();
    for (const row of await db
      .prepare(
        `SELECT wp.customer_address AS customer_address,
           COUNT(DISTINCT wp.cafe_id) AS downloaded_cafes,
           COUNT(DISTINCT CASE WHEN wr.serial_number IS NOT NULL THEN wp.cafe_id END) AS active_cafes
         FROM wallet_passes wp
         LEFT JOIN wallet_registrations wr ON wr.serial_number = wp.serial_number
         GROUP BY wp.customer_address`,
      )
      .all()) {
      appleWalletByCustomer.set(String(row.customer_address).toLowerCase(), {
        downloadedCafes: Number(row.downloaded_cafes || 0),
        activeCafes: Number(row.active_cafes || 0),
      });
    }

    const googleWalletByCustomer = new Map();
    for (const row of await db
      .prepare(
        `SELECT customer_address AS customer_address, COUNT(DISTINCT cafe_id) AS cafes
         FROM google_wallet_objects
         GROUP BY customer_address`,
      )
      .all()) {
      googleWalletByCustomer.set(
        String(row.customer_address).toLowerCase(),
        Number(row.cafes || 0),
      );
    }

    const registeredCustomers = allCustomerRows
      .map((row) => {
        const addrKey = row.address ? String(row.address).toLowerCase() : "";
        const apple = appleWalletByCustomer.get(addrKey) || {
          downloadedCafes: 0,
          activeCafes: 0,
        };
        return {
          id: row.id != null ? Number(row.id) : null,
          customerId: row.customer_id || null,
          username: row.username || null,
          email: row.email || null,
          address: row.address || null,
          createdAt: row.created_at != null ? Number(row.created_at) : null,
          emailVerifiedAt:
            row.email_verified_at != null
              ? Number(row.email_verified_at)
              : null,
          walletAppleActiveCafes: apple.activeCafes,
          walletAppleDownloadedCafes: apple.downloadedCafes,
          walletGoogleCafes: googleWalletByCustomer.get(addrKey) || 0,
        };
      })
      .sort((a, b) => {
        const bCreated = b.createdAt || 0;
        const aCreated = a.createdAt || 0;
        if (bCreated !== aCreated) return bCreated - aCreated;
        return String(a.username || "").localeCompare(String(b.username || ""));
      });

    // Day/time-of-day buckets use Europe/Berlin local time (not server TZ,
    // which in Docker is typically UTC) so the charts match what a café
    // owner in Cologne actually experiences as "today" / "this time".
    const berlinDayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const berlinTimeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const dayKey = (ts) => berlinDayFormatter.format(new Date(ts));

    // 15-minute bins instead of a 24-bucket hourly histogram - fine enough
    // to show real intra-hour patterns (e.g. "right after opening" vs
    // "just before closing") without pretending to per-minute precision.
    const BIN_MINUTES = 15;
    const BINS_PER_DAY = (24 * 60) / BIN_MINUTES;
    const timeOfDayBin = (ts) => {
      let hour = 0;
      let minute = 0;
      for (const part of berlinTimeFormatter.formatToParts(new Date(ts))) {
        if (part.type === "hour") hour = Number(part.value) % 24;
        else if (part.type === "minute") minute = Number(part.value);
      }
      const minutesSinceMidnight = hour * 60 + minute;
      return Math.min(
        BINS_PER_DAY - 1,
        Math.floor(minutesSinceMidnight / BIN_MINUTES),
      );
    };

    const CHART_DAYS = 30;
    const chartWindowStart = Date.now() - CHART_DAYS * 86400000;

    const chartDayList = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      chartDayList.push(dayKey(Date.now() - i * 86400000));
    }

    function makeChartAccumulator() {
      return {
        byDay: new Map(chartDayList.map((d) => [d, 0])),
        byTimeOfDay: new Array(BINS_PER_DAY).fill(0),
        walletByDay: new Map(chartDayList.map((d) => [d, { apple: 0, google: 0 }])),
      };
    }
    function finalizeChartAccumulator(acc) {
      return {
        dailyStamps: chartDayList.map((d) => ({
          date: d,
          count: acc.byDay.get(d) || 0,
        })),
        dailyWalletDownloads: chartDayList.map((d) => {
          const v = acc.walletByDay.get(d) || { apple: 0, google: 0 };
          return {
            date: d,
            apple: v.apple,
            google: v.google,
            total: v.apple + v.google,
          };
        }),
        stampsByTimeOfDay: acc.byTimeOfDay.map((count, bin) => ({
          bin,
          minute: bin * BIN_MINUTES,
          count,
        })),
      };
    }

    const globalChartAcc = makeChartAccumulator();
    const chartAccByCafeEntry = new Map();
    const chartAccByCustomerKey = new Map();

    function getCafeChartAcc(entry) {
      if (!chartAccByCafeEntry.has(entry)) {
        chartAccByCafeEntry.set(entry, makeChartAccumulator());
      }
      return chartAccByCafeEntry.get(entry);
    }
    function getCustomerChartAcc(addr) {
      const key = String(addr || "").toLowerCase();
      if (!key) return null;
      if (!chartAccByCustomerKey.has(key)) {
        chartAccByCustomerKey.set(key, makeChartAccumulator());
      }
      return chartAccByCustomerKey.get(key);
    }

    const stampChartRows = await db
      .prepare(
        `SELECT ts, cafe, "user" as user FROM stamp_events WHERE delta > 0 AND ts >= ?`,
      )
      .all(chartWindowStart);

    for (const row of stampChartRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = dayKey(ts);
      const bin = timeOfDayBin(ts);

      if (globalChartAcc.byDay.has(d)) globalChartAcc.byDay.set(d, globalChartAcc.byDay.get(d) + 1);
      globalChartAcc.byTimeOfDay[bin] += 1;

      const cafeEntry = ensureEntry(row.cafe);
      const cafeAcc = getCafeChartAcc(cafeEntry);
      if (cafeAcc.byDay.has(d)) cafeAcc.byDay.set(d, cafeAcc.byDay.get(d) + 1);
      cafeAcc.byTimeOfDay[bin] += 1;

      const customerAcc = getCustomerChartAcc(row.user);
      if (customerAcc) {
        if (customerAcc.byDay.has(d)) customerAcc.byDay.set(d, customerAcc.byDay.get(d) + 1);
        customerAcc.byTimeOfDay[bin] += 1;
      }
    }

    const appleWalletChartRows = await db
      .prepare(
        `SELECT created_at AS ts, cafe_id AS cafe_id FROM wallet_passes WHERE created_at >= ?`,
      )
      .all(chartWindowStart);
    const googleWalletChartRows = await db
      .prepare(
        `SELECT created_at AS ts, cafe_id AS cafe_id FROM google_wallet_objects WHERE created_at >= ?`,
      )
      .all(chartWindowStart);

    for (const row of appleWalletChartRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = dayKey(ts);
      if (globalChartAcc.walletByDay.has(d)) globalChartAcc.walletByDay.get(d).apple += 1;
      const cafeEntry = cafeById.get(Number(row.cafe_id));
      if (cafeEntry) {
        const cafeAcc = getCafeChartAcc(cafeEntry);
        if (cafeAcc.walletByDay.has(d)) cafeAcc.walletByDay.get(d).apple += 1;
      }
    }
    for (const row of googleWalletChartRows) {
      const ts = Number(row.ts);
      if (!ts) continue;
      const d = dayKey(ts);
      if (globalChartAcc.walletByDay.has(d)) globalChartAcc.walletByDay.get(d).google += 1;
      const cafeEntry = cafeById.get(Number(row.cafe_id));
      if (cafeEntry) {
        const cafeAcc = getCafeChartAcc(cafeEntry);
        if (cafeAcc.walletByDay.has(d)) cafeAcc.walletByDay.get(d).google += 1;
      }
    }

    const charts = Object.assign(
      { days: CHART_DAYS, timezone: "Europe/Berlin", binMinutes: BIN_MINUTES },
      finalizeChartAccumulator(globalChartAcc),
    );

    for (const entry of results) {
      const acc = chartAccByCafeEntry.get(entry);
      entry.charts = acc ? finalizeChartAccumulator(acc) : null;
    }

    res.json({
      ok: true,
      cafes: results.map((entry) => ({
        id: entry.id,
        name: entry.name,
        email: entry.email,
        emailVerifiedAt: entry.emailVerifiedAt,
        address: entry.address,
        locationAddress: entry.locationAddress,
        createdAt: entry.createdAt,
        stats: entry.stats,
        customers: entry.customers,
        walletOnlyCustomers: entry.walletOnlyCustomers || [],
        events: entry.events,
        isUnknown: entry.isUnknown || false,
        charts: entry.charts,
      })),
      customers: registeredCustomers.map((customer) => {
        const acc = customer.address
          ? chartAccByCustomerKey.get(String(customer.address).toLowerCase())
          : null;
        return Object.assign({}, customer, {
          charts: acc ? { stampsByTimeOfDay: finalizeChartAccumulator(acc).stampsByTimeOfDay } : null,
        });
      }),
      charts,
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

app.post("/cafes/resend-verification", async (req, res) => {
  try {
    const emailRaw = req.body?.email != null ? String(req.body.email) : "";
    const email = emailRaw.trim().slice(0, 254).toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }

    const cafe = await getCafeAuthByEmail.get(email);
    if (!cafe) {
      return res.json({ ok: true, sent: false });
    }
    if (cafe.email_verified_at) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const now = Date.now();
    const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const appsBaseUrl = getAppsBaseUrlFromRequest(req);
    const verifyUrl = `${appsBaseUrl}/cafe-onboarding?verifyToken=${encodeURIComponent(token)}`;

    try {
      await insertCafeEmailVerification.run(cafe.id, tokenHash, now, expiresAt);
      const mailInfo = await sendCafeVerificationEmail({
        email,
        cafeName: cafe.name || "Kaffeekarte Café",
        verifyUrl,
      });
      console.log(
        "Cafe verification resend accepted by transporter:",
        JSON.stringify({
          email,
          messageId: mailInfo && mailInfo.messageId ? mailInfo.messageId : null,
          response: mailInfo && mailInfo.response ? mailInfo.response : null,
        }),
      );
    } catch (emailErr) {
      console.error(
        `Failed to resend verification email to ${email}:`,
        emailErr && emailErr.stack ? emailErr.stack : emailErr,
      );
      return res
        .status(502)
        .json({ ok: false, error: "verification_email_failed" });
    }

    return res.json({ ok: true, sent: true });
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

app.post("/cafes/me/change-password", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }

    const currentPassword =
      req.body?.currentPassword != null ? String(req.body.currentPassword) : "";
    const newPassword =
      req.body?.newPassword != null ? String(req.body.newPassword) : "";

    if (!cafeRow.password_hash) {
      return res.status(400).json({ ok: false, error: "password_not_set" });
    }
    if (!currentPassword) {
      return res.status(400).json({ ok: false, error: "invalid_current_password" });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: "invalid_new_password" });
    }

    const okPw = await bcrypt.compare(currentPassword, cafeRow.password_hash);
    if (!okPw) {
      return res.status(401).json({ ok: false, error: "wrong_password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await setCafePasswordHashById.run(newHash, cafeRow.id);

    return res.json({ ok: true });
  } catch (e) {
    console.error(
      "Error in /cafes/me/change-password:",
      e && e.stack ? e.stack : e,
    );
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/cafes/me/delete-account", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }

    const currentPassword =
      req.body?.currentPassword != null ? String(req.body.currentPassword) : "";
    const confirmText =
      req.body?.confirmText != null ? String(req.body.confirmText).trim() : "";

    if (confirmText !== "DELETE") {
      return res.status(400).json({ ok: false, error: "delete_confirmation_required" });
    }
    if (!cafeRow.password_hash) {
      return res.status(400).json({ ok: false, error: "password_not_set" });
    }
    if (!currentPassword) {
      return res.status(400).json({ ok: false, error: "invalid_current_password" });
    }

    const okPw = await bcrypt.compare(currentPassword, cafeRow.password_hash);
    if (!okPw) {
      return res.status(401).json({ ok: false, error: "wrong_password" });
    }

    const cafeAddress = cafeRow.address != null ? String(cafeRow.address).trim() : "";
    const cafeIdText = String(cafeRow.id);

    await deleteCafeSessionsByCafeId.run(cafeRow.id);
    await deleteCafeEmailVerificationsByCafeId.run(cafeRow.id);
    await deleteCafePasswordResetsByCafeId.run(cafeRow.id);
    await deleteQrNoncesByCafeId.run(cafeIdText);
    if (cafeAddress) {
      await deleteRedeemTokensByCafeAddress.run(cafeAddress, cafeAddress);
      await deleteStampEventsByCafeAddress.run(cafeAddress);
    }
    await deleteCafeById.run(cafeRow.id);

    return res.json({ ok: true, deleted: { cafeId: cafeRow.id } });
  } catch (e) {
    console.error(
      "Error in /cafes/me/delete-account:",
      e && e.stack ? e.stack : e,
    );
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
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

// Test/internal café rows never belong in a customer-facing list - kept
// here as the single source of truth (rather than duplicated per consumer)
// so every caller of /cafes/public automatically stays clean.
function isInternalTestCafe(row) {
  const email = String(row.email || "").toLowerCase();
  if (email.includes("dirk.belger")) return true;
  const name = String(row.name || "");
  if (/test|debug|demo/i.test(name)) return true;
  return false;
}

// Public café list (safe for customer-facing apps)
app.get("/cafes/public", async (req, res) => {
  try {
    const rows = await db
      .prepare(
        "SELECT id, name, email, address, location_address, lat, lng, website_url, instagram_url, about_text, short_description, logo_mime, logo_data, card_bg_mime, card_bg_data, card_back_text, card_theme, card_bg_color, card_fg_color, stamps_for_reward, reward_description, created_at, updated_at FROM cafes ORDER BY id DESC",
      )
      .all();

    const cafes = rows
      .filter((row) => !isInternalTestCafe(row))
      .map((row) => {
        const address = row.location_address || null;
        return {
          // Postgres returns BIGINT ids as strings by default - coerce so
          // every consumer gets a plain JS number (see the admin-dashboard
          // café-detail drill-down bug this same pattern caused).
          id: row.id != null ? Number(row.id) : null,
          name: row.name || null,
          address,
          cafeAddress: row.address || null,
          lat: row.lat != null ? Number(row.lat) : null,
          lng: row.lng != null ? Number(row.lng) : null,
          websiteUrl: row.website_url || null,
          instagramUrl: row.instagram_url || null,
          about: row.about_text ? String(row.about_text).slice(0, 280) : null,
          shortDescription: row.short_description
            ? String(row.short_description).slice(0, 100)
            : null,
          logoDataUrl:
            row.logo_data && row.logo_mime
              ? `data:${row.logo_mime};base64,${row.logo_data}`
              : null,
          cardTheme: row.card_theme || "paper",
          cardBgColor: row.card_bg_color || null,
          cardFgColor: row.card_fg_color || null,
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

// Public café profile (full about + logo) for customer-facing apps. Accepts
// either the numeric id or the café's 0x wallet address - callers who
// already have a specific café's address (a printed QR code, a standee
// generator, a saved link) are doing a direct lookup, not browsing, so
// isInternalTestCafe() does NOT apply here: that filter exists to keep junk
// test/demo rows out of the *discovery list* (/cafes/public above), not to
// block a café's own real data from a link it already handed out. Applying
// it here used to 404 (or silently return nothing) for the account owner's
// own real production cafés whenever their email happened to match the
// test-café heuristic - confirmed live via the "Aufsteller" standee page.
app.get("/cafes/public/:id", async (req, res) => {
  try {
    const idParam = String(req.params.id || "").trim();
    const isAddress = /^0x[0-9a-fA-F]{40}$/.test(idParam);
    const numericId = Number(idParam);
    if (!isAddress && !Number.isFinite(numericId)) {
      return res.status(400).json({ ok: false, error: "invalid_cafe_id" });
    }

    const row = await db
      .prepare(
        `SELECT id, name, email, address, location_address, lat, lng, website_url, instagram_url, about_text, short_description, redeem_message, logo_mime, logo_data, card_bg_mime, card_bg_data, card_back_text, card_theme, card_bg_color, card_fg_color, stamps_for_reward, reward_description, created_at, updated_at FROM cafes WHERE ${isAddress ? "LOWER(address) = LOWER(?)" : "id = ?"}`,
      )
      .get(isAddress ? idParam : numericId);

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
        // See /cafes/public above - Postgres BIGINT ids come back as strings.
        id: row.id != null ? Number(row.id) : null,
        name: row.name || null,
        cafeAddress: row.address || null,
        address: row.location_address || null,
        lat: row.lat != null ? Number(row.lat) : null,
        lng: row.lng != null ? Number(row.lng) : null,
        websiteUrl: row.website_url || null,
        instagramUrl: row.instagram_url || null,
        about: row.about_text ? String(row.about_text).slice(0, 1200) : null,
        shortDescription: row.short_description
          ? String(row.short_description).slice(0, 100)
          : null,
        redeemMessage: row.redeem_message || null,
        cardTheme: row.card_theme || "paper",
        cardBgColor: row.card_bg_color || null,
        cardFgColor: row.card_fg_color || null,
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
    const customerRow = await getCustomerByAddress.get(rawAddress);
    const savedCafeRows =
      customerRow && customerRow.id != null
        ? await listCustomerSavedCafeAddressesByCustomerId.all(customerRow.id)
        : [];
    const savedCafeAddresses = [];
    const favoriteCafeAddresses = new Set();
    for (const row of Array.isArray(savedCafeRows) ? savedCafeRows : []) {
      const savedAddr = row && row.cafe_address ? String(row.cafe_address) : "";
      if (!/^0x[0-9a-f]{40}$/i.test(savedAddr)) continue;
      savedCafeAddresses.push(savedAddr);
      if (row.is_favorite) favoriteCafeAddresses.add(savedAddr.toLowerCase());
    }

    const aggregates = await db
      .prepare(
        `SELECT
           cafe,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS stamps_awarded,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN (
             SELECT COALESCE(SUM(se2.delta), 0) FROM stamp_events se2
             WHERE LOWER(se2.cafe) = LOWER(stamp_events.cafe)
               AND LOWER(se2."user") = LOWER(stamp_events."user")
               AND COALESCE(se2.card_id, '') = COALESCE(stamp_events.card_id, '')
               AND (se2.status IS NULL OR se2.status = 'confirmed')
           ) ELSE 0 END) AS stamps_redeemed,
           SUM(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN 1 ELSE 0 END) AS redemptions,
           SUM(delta) AS net_stamps,
           COUNT(*) AS total_events,
           MAX(ts) AS last_activity_ts,
           MAX(CASE WHEN delta > 0 THEN ts ELSE NULL END) AS last_stamp_ts,
           MAX(CASE WHEN LOWER(COALESCE(event_type,'')) = 'redeem' THEN ts ELSE NULL END) AS last_redeem_ts,
           MAX(CASE WHEN customer_name IS NOT NULL AND customer_name != '' THEN customer_name ELSE NULL END) AS customer_name
         FROM stamp_events
         WHERE LOWER("user") = ?
         GROUP BY cafe`,
      )
      .all(address);

    if (!aggregates.length && !savedCafeAddresses.length) {
      return res.json({
        ok: true,
        customer: {
          address: rawAddress,
          name: customerRow?.username || null,
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
        isFavorite: favoriteCafeAddresses.has(cafeAddr),
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

    for (const savedCafeAddress of savedCafeAddresses) {
      const cafeAddr = String(savedCafeAddress || "").toLowerCase();
      if (!cafeAddr || cardsByCafe.has(cafeAddr)) continue;
      const cafeInfo = cafesByAddress.get(cafeAddr) || null;
      cardsByCafe.set(cafeAddr, {
        cafeAddress: savedCafeAddress,
        cafeName: cafeInfo?.name || null,
        cafeId: cafeInfo?.id || null,
        isFavorite: favoriteCafeAddresses.has(cafeAddr),
        program: getCafeProgramSettings(cafeInfo),
        stats: {
          stampsAwarded: 0,
          stampsRedeemed: 0,
          redemptions: 0,
          netStamps: 0,
          totalEvents: 0,
          lastActivityTs: null,
          lastStampTs: null,
          lastRedeemTs: null,
        },
        recentEvents: [],
      });
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
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;

      const aRemaining = Math.max(
        (a.program?.stampsForReward || 10) - (a.stats.netStamps || 0),
        0,
      );
      const bRemaining = Math.max(
        (b.program?.stampsForReward || 10) - (b.stats.netStamps || 0),
        0,
      );
      if (aRemaining !== bRemaining) return aRemaining - bRemaining;

      const bTs = b.stats.lastActivityTs || 0;
      const aTs = a.stats.lastActivityTs || 0;
      if (bTs !== aTs) return bTs - aTs;
      return (a.cafeName || "").localeCompare(b.cafeName || "");
    });

    const primaryName =
      aggregates.find((agg) => agg.customer_name)?.customer_name ||
      customerRow?.username ||
      null;

    // Neither wallet platform lets a server push a pass onto a device the
    // customer hasn't explicitly added it on themselves - not just right
    // after a redeem/overflow on the same device, but also the moment they
    // log into a brand new device: the real balance lives here, server-side,
    // tied to the account, not to any one device's Wallet app. A customer
    // can genuinely have more than one still-open card at once too (a full
    // one nobody's redeemed yet, plus a newer one collecting overflow) -
    // every open card is surfaced here, not just "the latest", so a second
    // card never gets silently left behind on a new device. Redeemed
    // (closed) cards are excluded - re-adding one would just show 0/reset
    // (see resolveDisplayStampCount), no value in restoring it.
    for (const card of cards) {
      if (!card.cafeId || !card.cafeAddress) continue;
      try {
        const groups = await getCardGroupsByCafeUser.all(
          card.cafeAddress,
          rawAddress,
        );
        const applePasses = await getWalletPassesByCustomerCafe.all(
          rawAddress,
          card.cafeId,
        );
        const googleObjects = await getGoogleWalletObjectsByCustomerCafe.all(
          rawAddress,
          card.cafeId,
        );
        const appleCardIds = new Set(
          (applePasses || []).map((r) => String(r.card_id || "")),
        );
        const googleCardIds = new Set(
          (googleObjects || []).map((r) => String(r.card_id || "")),
        );
        const openCards = [];
        let openStampTotal = 0;
        for (const g of Array.isArray(groups) ? groups : []) {
          const cid = g.card_id || null;
          const redeemedRow = await hasCardBeenRedeemed.get(
            card.cafeAddress,
            rawAddress,
            cid,
          );
          if (redeemedRow) continue;
          const stampCount = Number(g.total || 0);
          // Counts toward the customer-facing total regardless of whether a
          // wallet pass exists for it yet - netStamps is meant to answer
          // "what's my real balance right now", not "what does my wallet
          // app currently show". The old version summed every card_id ever,
          // closed ones included, which is how a permanently-frozen 12-stamp
          // redeemed card kept inflating this number forever.
          openStampTotal += stampCount;
          const key = String(cid || "");
          const hasApplePass = appleCardIds.has(key);
          const hasGoogleObject = googleCardIds.has(key);
          if (hasApplePass && hasGoogleObject) continue;
          openCards.push({
            cardId: cid,
            stampCount,
            hasApplePass,
            hasGoogleObject,
          });
        }
        if (openCards.length) card.openCards = openCards;
        card.stats.netStamps = openStampTotal;
      } catch (err) {}
    }

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

// --- Apple Wallet ---

const getCafeRowByAddress = db.prepare(
  "SELECT * FROM cafes WHERE LOWER(address) = LOWER(?)",
);

// Issues (or re-issues, with fresh stamp count) a signed .pkpass for a
// customer's card at one cafe. First call for a given (customer, cafe) pair
// creates the wallet_passes row; later calls just re-render current state.
app.get("/customers/:customerAddress/wallet-pass", async (req, res) => {
  try {
    if (!walletPass.isWalletConfigured()) {
      return res.status(501).json({ error: "wallet_not_configured" });
    }

    const rawAddress = req.params?.customerAddress || "";
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) {
      return res.status(400).json({ error: "invalid_customer_address" });
    }
    const cafeAddress = String(req.query?.cafe || "").trim();
    if (!/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
      return res.status(400).json({ error: "invalid_cafe_address" });
    }

    const cafeRow = await getCafeRowByAddress.get(cafeAddress);
    if (!cafeRow) return res.status(404).json({ error: "cafe_not_found" });

    const customerRow = await getCustomerByAddress.get(rawAddress);
    // An explicit ?cardId targets one specific card (e.g. re-opening an
    // already-full card to redeem it); otherwise default to whichever
    // card_id this customer used most recently - null for anyone who's
    // never overflowed past a full card, matching the pre-multi-card
    // behavior exactly.
    const requestedCardId = req.query?.cardId ? String(req.query.cardId).trim() : "";
    let cardId = requestedCardId || null;
    if (!requestedCardId) {
      const latestRow = await getLatestCardIdForCustomerCafe.get(cafeAddress, rawAddress);
      cardId = latestRow ? latestRow.card_id || null : null;
    }
    const passRow = await getOrCreateWalletPass(rawAddress, cafeRow.id, cardId);
    const stampCount = await getStampsByCafeUserCardId(
      cafeAddress,
      rawAddress,
      cardId,
    );
    const program = getCafeProgramSettings(cafeRow);
    const isRedeemed = !!(await hasCardBeenRedeemed.get(cafeAddress, rawAddress, cardId));
    const cardNumber = await getCardOrdinal(cafeAddress, rawAddress, cardId);
    const barcodeMessage = await resolveWalletBarcode({
      customerAddress: rawAddress,
      customerName: customerRow?.username || null,
      cafeAddress,
      cardId,
      stampCount,
      threshold: program.stampsForReward,
      currentToken: passRow.active_redeem_token || null,
      persistToken: (token) =>
        setWalletPassRedeemToken.run(token, passRow.serial_number),
      isRedeemed,
    });

    const buffer = await walletPass.generateSignedPass({
      cafeRow,
      program,
      stampCount,
      isRedeemed,
      serialNumber: passRow.serial_number,
      authenticationToken: passRow.authentication_token,
      webServiceURL: `${String(process.env.APPS_BASE_URL || "").replace(/\/$/, "")}/api/wallet`,
      barcodeMessage,
      reminderBackfield: await getReminderBackfieldFor(cafeRow.id, rawAddress),
      customerName: customerRow?.username || null,
      customerEmail: customerRow?.email || null,
      customerId: customerRow?.customer_id || null,
      cardNumber,
      cardId,
    });

    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kaffeekarte.pkpass"',
    );
    res.send(buffer);
  } catch (err) {
    console.error("Error generating wallet pass:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Google Wallet (Android) ---
// Not a downloadable file like Apple's .pkpass - just a signed "save" link
// that Google resolves into a Wallet card the first time the customer taps
// it. Returns JSON (not a redirect) so the frontend can wire it to a button.
app.get("/customers/:customerAddress/google-wallet-save-link", async (req, res) => {
  try {
    if (!googleWalletPass.isGoogleWalletConfigured()) {
      return res.status(501).json({ error: "google_wallet_not_configured" });
    }

    const rawAddress = req.params?.customerAddress || "";
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) {
      return res.status(400).json({ error: "invalid_customer_address" });
    }
    const cafeAddress = String(req.query?.cafe || "").trim();
    if (!/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
      return res.status(400).json({ error: "invalid_cafe_address" });
    }

    const cafeRow = await getCafeRowByAddress.get(cafeAddress);
    if (!cafeRow) return res.status(404).json({ error: "cafe_not_found" });

    const customerRow = await getCustomerByAddress.get(rawAddress);
    const requestedCardId = req.query?.cardId ? String(req.query.cardId).trim() : "";
    let cardId = requestedCardId || null;
    if (!requestedCardId) {
      const latestRow = await getLatestCardIdForCustomerCafe.get(cafeAddress, rawAddress);
      cardId = latestRow ? latestRow.card_id || null : null;
    }
    const stampCount = await getStampsByCafeUserCardId(
      cafeAddress,
      rawAddress,
      cardId,
    );
    const program = getCafeProgramSettings(cafeRow);

    const objectId = googleWalletPass.loyaltyObjectId(cafeRow.address, rawAddress, cardId);
    const objectRow = await getOrCreateGoogleWalletObject(
      rawAddress,
      cafeRow.id,
      cardId,
      objectId,
    );
    const isRedeemed = !!(await hasCardBeenRedeemed.get(cafeAddress, rawAddress, cardId));
    const cardNumber = await getCardOrdinal(cafeAddress, rawAddress, cardId);
    const barcodeMessage = await resolveWalletBarcode({
      customerAddress: rawAddress,
      customerName: customerRow?.username || null,
      cafeAddress,
      cardId,
      stampCount,
      threshold: program.stampsForReward,
      currentToken: objectRow.active_redeem_token || null,
      // objectRow.object_id, not the freshly-computed objectId above - same
      // stale-id trap as everywhere else here, this row may predate the
      // cafe.id -> cafe.address id migration.
      persistToken: (token) =>
        setGoogleWalletObjectRedeemToken.run(token, objectRow.object_id),
      isRedeemed,
    });

    const { saveUrl } = googleWalletPass.buildSaveLink({
      cafeRow,
      program,
      stampCount,
      isRedeemed,
      customerAddress: rawAddress,
      customerName: customerRow?.username || null,
      cardId,
      barcodeMessage,
      appsBaseUrl: process.env.APPS_BASE_URL || "",
      customerEmail: customerRow?.email || null,
      customerId: customerRow?.customer_id || null,
      cardNumber,
      objectId: objectRow.object_id,
    });

    res.json({ ok: true, saveUrl });
  } catch (err) {
    console.error("Error building Google Wallet save link:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Public, unauthenticated - Google's servers fetch this URL directly when
// rendering a loyalty class's logo, so it can't sit behind cafe auth.
app.get("/cafes/:cafeId/logo.png", async (req, res) => {
  try {
    const cafeId = Number(req.params.cafeId);
    if (!Number.isFinite(cafeId)) return res.status(400).end();
    const cafeRow = await getCafeById.get(cafeId);
    if (!cafeRow || !cafeRow.logo_data || !cafeRow.logo_mime) {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", cafeRow.logo_mime);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(Buffer.from(cafeRow.logo_data, "base64"));
  } catch (err) {
    console.error("Error serving cafe logo:", err);
    res.status(500).end();
  }
});

// Public, unauthenticated - same reasoning as /logo.png above (loaded
// directly as an <img src> from the customer wallet card and the café's own
// Design-tab preview, no session available). Always returns a valid image:
// the café's generated silhouette if they have one, otherwise the same
// default bean every café used before this feature existed - callers never
// need to know in advance whether a café customized theirs.
app.get("/cafes/:cafeId/stamp-icon.png", async (req, res) => {
  try {
    const cafeId = Number(req.params.cafeId);
    if (!Number.isFinite(cafeId)) return res.status(400).end();
    const cafeRow = await getCafeById.get(cafeId);
    if (!cafeRow) return res.status(404).end();

    res.setHeader("Cache-Control", "public, max-age=300");
    if (cafeRow.stamp_icon_data && cafeRow.stamp_icon_mime) {
      res.setHeader("Content-Type", cafeRow.stamp_icon_mime);
      return res.send(Buffer.from(cafeRow.stamp_icon_data, "base64"));
    }
    const defaultBuffer = await getDefaultStampIconBuffer();
    res.setHeader("Content-Type", "image/png");
    res.send(defaultBuffer);
  } catch (err) {
    console.error("Error serving cafe stamp icon:", err);
    res.status(500).end();
  }
});

// Generates a stamp silhouette from a logo and stores it - "upload a logo,
// get a stamp template" per the feature ask. Takes an optional
// `logoDataUrl` in the body so a café can generate a preview from a
// just-picked file before clicking the main "Speichern" (logo upload there
// is otherwise deferred until save, see saveProfile() in
// cafe-scanner-new.html) - and by the same mechanism, from a dedicated
// "stamp symbol" upload distinct from the café's main logo, since a busy
// marketing logo doesn't always silhouette well; falls back to whatever
// logo is already saved when omitted. Optional boolean `invert` overrides
// generateStampIcon's own light-vs-dark-background auto-detection, for
// cafés whose logo is light-on-dark and got auto-detected wrong.
app.post("/cafes/me/stamp-icon/generate", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }
    const current = await getCafeById.get(cafeRow.id);
    if (!current) {
      return res.status(404).json({ ok: false, error: "cafe_not_found" });
    }

    const body = req.body || {};
    let logoBuffer;
    if (body.logoDataUrl) {
      const m =
        /^data:(image\/(png|jpeg|jpg|svg\+xml|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(
          String(body.logoDataUrl),
        );
      if (!m) {
        return res.status(400).json({ ok: false, error: "invalid_logo_format" });
      }
      logoBuffer = Buffer.from(String(m[3] || "").replace(/\s+/g, ""), "base64");
    } else if (current.logo_data && current.logo_mime) {
      logoBuffer = Buffer.from(current.logo_data, "base64");
    } else {
      return res.status(400).json({ ok: false, error: "logo_required" });
    }

    // Auto-detected (light-on-dark vs. the usual dark-on-light) unless the
    // café explicitly overrides it via the Design-tab toggle.
    const invertOption =
      typeof body.invert === "boolean" ? { invert: body.invert } : {};
    const iconBuffer = await generateStampIcon(logoBuffer, invertOption);
    const iconData = iconBuffer.toString("base64");

    await setCafeStampIconById.run("image/png", iconData, current.id);

    res.json({
      ok: true,
      stampIconUrl: `/cafes/${current.id}/stamp-icon.png?v=${Date.now()}`,
    });
  } catch (err) {
    console.error("Error in POST /cafes/me/stamp-icon/generate:", err);
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

app.delete("/cafes/me/stamp-icon", requireCafeAuth, async (req, res) => {
  try {
    const cafeRow = req.cafe;
    if (!cafeRow || cafeRow.id == null) {
      return res.status(500).json({ ok: false, error: "missing_cafe_context" });
    }
    await setCafeStampIconById.run(null, null, cafeRow.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error in DELETE /cafes/me/stamp-icon:", err);
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Public, unauthenticated - referenced from the loyalty object's
// imageModulesData, so Google's servers (and the Wallet client) fetch this
// directly. Renders the same stamp-progress grid as the Apple Wallet strip,
// live from the current stamp count - no caching, this changes per visit.
app.get("/customers/:customerAddress/google-wallet-stamp-strip.png", async (req, res) => {
  try {
    const rawAddress = req.params?.customerAddress || "";
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) return res.status(400).end();
    const cafeAddress = String(req.query?.cafe || "").trim();
    if (!/^0x[0-9a-f]{40}$/i.test(cafeAddress)) return res.status(400).end();

    const cafeRow = await getCafeRowByAddress.get(cafeAddress);
    if (!cafeRow) return res.status(404).end();

    const cardId = req.query?.cardId ? String(req.query.cardId).trim() : null;
    const stampCount = await getStampsByCafeUserCardId(cafeAddress, rawAddress, cardId);
    const program = getCafeProgramSettings(cafeRow);
    const isRedeemed = !!(await hasCardBeenRedeemed.get(cafeAddress, rawAddress, cardId));
    const colors = walletPass.resolveThemeColors(
      cafeRow.card_theme || "paper",
      cafeRow.card_bg_color,
      cafeRow.card_fg_color,
    );

    const buffer = await walletPass.buildStampStripPngBuffer(
      stampCount,
      program.stampsForReward,
      colors.bg,
      colors.fg,
      program.stampStyle,
      isRedeemed,
      cafeRow,
      `${rawAddress}|${cafeAddress}|${cardId || ""}`,
    );

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error("Error serving Google Wallet stamp strip:", err);
    res.status(500).end();
  }
});

// --- PassKit Web Service (called by Wallet itself, not by our own apps) ---
// https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
const walletApiRouter = express.Router();

function requireApplePassAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const m = /^ApplePass\s+(.+)$/.exec(header);
  if (!m) return res.status(401).end();
  req.applePassToken = m[1];
  next();
}

walletApiRouter.post(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  requireApplePassAuth,
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      if (passTypeIdentifier !== walletPass.PASS_TYPE_IDENTIFIER) {
        return res.status(404).end();
      }
      const passRow = await getWalletPassBySerial.get(serialNumber);
      if (!passRow || passRow.authentication_token !== req.applePassToken) {
        return res.status(401).end();
      }
      const pushToken = req.body && req.body.pushToken;
      if (!pushToken) return res.status(400).end();

      const alreadyRegistered = await getWalletRegistration.get(
        deviceLibraryIdentifier,
        serialNumber,
      );
      await upsertWalletRegistration.run(
        deviceLibraryIdentifier,
        serialNumber,
        String(pushToken),
        Date.now(),
      );
      res.status(alreadyRegistered ? 200 : 201).end();
    } catch (err) {
      console.error("Error registering wallet device:", err);
      res.status(500).end();
    }
  },
);

walletApiRouter.delete(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  requireApplePassAuth,
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      if (passTypeIdentifier !== walletPass.PASS_TYPE_IDENTIFIER) {
        return res.status(404).end();
      }
      const passRow = await getWalletPassBySerial.get(serialNumber);
      if (!passRow || passRow.authentication_token !== req.applePassToken) {
        return res.status(401).end();
      }
      await deleteWalletRegistration.run(deviceLibraryIdentifier, serialNumber);
      res.status(200).end();
    } catch (err) {
      console.error("Error unregistering wallet device:", err);
      res.status(500).end();
    }
  },
);

// Not authenticated with ApplePass per Apple's spec - the device queries
// across all its registered passes, before it necessarily has any one
// pass's token at hand.
walletApiRouter.get(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
      if (passTypeIdentifier !== walletPass.PASS_TYPE_IDENTIFIER) {
        return res.status(404).end();
      }
      const since = Number(req.query?.passesUpdatedSince) || 0;
      const rows = await listWalletSerialsByDeviceSince.all(
        deviceLibraryIdentifier,
        since,
      );
      if (!rows || !rows.length) return res.status(204).end();

      const lastUpdated = Math.max(...rows.map((r) => Number(r.updated_at) || 0));
      res.json({
        lastUpdated: String(lastUpdated),
        serialNumbers: rows.map((r) => r.serial_number),
      });
    } catch (err) {
      console.error("Error listing wallet registrations:", err);
      res.status(500).end();
    }
  },
);

walletApiRouter.get(
  "/v1/passes/:passTypeIdentifier/:serialNumber",
  requireApplePassAuth,
  async (req, res) => {
    try {
      if (!walletPass.isWalletConfigured()) return res.status(501).end();
      const { passTypeIdentifier, serialNumber } = req.params;
      if (passTypeIdentifier !== walletPass.PASS_TYPE_IDENTIFIER) {
        return res.status(404).end();
      }
      const passRow = await getWalletPassBySerial.get(serialNumber);
      if (!passRow || passRow.authentication_token !== req.applePassToken) {
        return res.status(401).end();
      }

      const cafeRow = await db
        .prepare("SELECT * FROM cafes WHERE id = ?")
        .get(passRow.cafe_id);
      if (!cafeRow) return res.status(404).end();

      const customerRow = await getCustomerByAddress.get(passRow.customer_address);
      const stampCount = await getStampsByCafeUserCardId(
        cafeRow.address,
        passRow.customer_address,
        passRow.card_id,
      );
      const program = getCafeProgramSettings(cafeRow);
      const isRedeemed = !!(await hasCardBeenRedeemed.get(
        cafeRow.address,
        passRow.customer_address,
        passRow.card_id,
      ));
      const cardNumber = await getCardOrdinal(
        cafeRow.address,
        passRow.customer_address,
        passRow.card_id,
      );
      const barcodeMessage = await resolveWalletBarcode({
        customerAddress: passRow.customer_address,
        customerName: customerRow?.username || null,
        cafeAddress: cafeRow.address,
        cardId: passRow.card_id,
        stampCount,
        threshold: program.stampsForReward,
        currentToken: passRow.active_redeem_token || null,
        persistToken: (token) =>
          setWalletPassRedeemToken.run(token, passRow.serial_number),
        isRedeemed,
      });

      const buffer = await walletPass.generateSignedPass({
        cafeRow,
        program,
        stampCount,
        isRedeemed,
        serialNumber: passRow.serial_number,
        authenticationToken: passRow.authentication_token,
        webServiceURL: `${String(process.env.APPS_BASE_URL || "").replace(/\/$/, "")}/api/wallet`,
        barcodeMessage,
        reminderBackfield: await getReminderBackfieldFor(
          cafeRow.id,
          passRow.customer_address,
        ),
        customerName: customerRow?.username || null,
        customerEmail: customerRow?.email || null,
        customerId: customerRow?.customer_id || null,
        cardNumber,
        cardId: passRow.card_id,
      });

      res.setHeader("Content-Type", "application/vnd.apple.pkpass");
      // passRow.updated_at is a bigint column - node-postgres returns those
      // as strings (to avoid precision loss past Number.MAX_SAFE_INTEGER),
      // while better-sqlite3 (local/staging) returns an actual number.
      // new Date(numericString) doesn't parse as epoch ms - it's not a
      // recognized date format - so this produced a literal "Invalid Date"
      // Last-Modified header on production specifically (confirmed live in
      // prod logs 2026-09-21, never caught on staging since SQLite doesn't
      // have this string/number split). Number(...) normalizes either case.
      res.setHeader(
        "Last-Modified",
        new Date(Number(passRow.updated_at)).toUTCString(),
      );
      res.send(buffer);
    } catch (err) {
      console.error("Error serving updated wallet pass:", err);
      res.status(500).end();
    }
  },
);

walletApiRouter.post("/v1/log", (req, res) => {
  const logs = (req.body && req.body.logs) || [];
  for (const line of Array.isArray(logs) ? logs : []) {
    console.warn("[wallet device log]", line);
  }
  res.status(200).end();
});

app.use("/wallet", walletApiRouter);

app.post("/customers/register", async (req, res) => {
  try {
    const { username, email, password, acceptPrivacy, acceptTerms, cafe } = req.body || {};
    const uname = username != null ? String(username).trim() : "";
    const em = email != null ? String(email).trim() : "";
    const cafeAddress =
      cafe != null && /^0x[0-9a-f]{40}$/i.test(String(cafe).trim())
        ? String(cafe).trim()
        : null;
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
        const verifyUrl = buildCustomerVerifyUrl(appsBaseUrl, token, cafeAddress);
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
      registered_via_cafe_address: cafeAddress,
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

    const verifyUrl = buildCustomerVerifyUrl(appsBaseUrl, verificationToken, cafeAddress);

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
      avatarDataUrl: customerAvatarDataUrlFromRow(row),
      createdAt: row.created_at || null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get("/auth/google/start", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_STATE_SECRET) {
      const appsBaseUrl = getAppsBaseUrlFromRequest(req);
      return res.redirect(
        `${appsBaseUrl}/wallet?oauthError=${encodeURIComponent("google_auth_not_configured")}`,
      );
    }

    const modeRaw = String(req.query?.mode || "login").trim().toLowerCase();
    const mode = modeRaw === "register" ? "register" : "login";
    const acceptedLegal =
      String(req.query?.acceptLegal || "").trim() === "1" ? 1 : 0;
    const preferredUsername = String(req.query?.username || "")
      .trim()
      .slice(0, 64);
    const native = String(req.query?.native || "").trim() === "1";
    const { cafe, returnTo } = readOauthReturnFields(req);
    const payload = {
      mode,
      acceptedLegal,
      preferredUsername,
      native,
      cafe,
      returnTo,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex"),
    };
    const redirectUri = `${getApiBaseUrlFromRequest(req)}/auth/google/callback`;
    const state = signOauthState(payload);
    const url = new URL(GOOGLE_AUTH_BASE);
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("state", state);
    return res.redirect(url.toString());
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get("/auth/google/callback", async (req, res) => {
  const appsBaseUrl = getAppsBaseUrlFromRequest(req);
  const redirectBase = resolveOauthRedirectBase(
    appsBaseUrl,
    String(req.query?.state || ""),
  );
  function redirectWithError(code, detail) {
    const qs = new URLSearchParams();
    qs.set("oauthError", code || "google_auth_failed");
    if (detail) qs.set("oauthErrorDetail", String(detail).slice(0, 200));
    return res.redirect(appendQueryParams(redirectBase, qs.toString()));
  }

  try {
    if (req.query?.error) {
      return redirectWithError(String(req.query.error || "google_auth_rejected"));
    }

    const code = String(req.query?.code || "").trim();
    const stateRaw = String(req.query?.state || "").trim();
    if (!code || !stateRaw) return redirectWithError("google_auth_invalid");

    const state = verifyOauthState(stateRaw);
    if (!state || !state.ts || Date.now() - Number(state.ts) > 10 * 60 * 1000) {
      return redirectWithError("google_auth_expired");
    }

    const redirectUri = `${getApiBaseUrlFromRequest(req)}/auth/google/callback`;
    const tokens = await exchangeGoogleCodeForTokens({ code, redirectUri });
    const profile = await fetchGoogleUserProfile(tokens.access_token);

    const email = String(profile.email || "").trim().toLowerCase();
    const provider = "google";
    const providerSubject = String(profile.sub || "").trim();
    const emailVerified = !!profile.email_verified;
    if (!email || !providerSubject || !emailVerified) {
      return redirectWithError("google_email_not_verified");
    }

    const now = Date.now();
    let customer = null;

    const identity = await getCustomerOauthIdentity.get(provider, providerSubject);
    if (identity && identity.customer_id) {
      customer = await getCustomerById.get(identity.customer_id);
    }

    if (!customer) {
      const existing = await getCustomerAuthByEmail.get(email);
      if (existing && existing.id) {
        customer = existing;
        if (!existing.email_verified_at) {
          await setCustomerEmailVerifiedAtById.run(now, existing.id);
          customer = await getCustomerById.get(existing.id);
          notifyAdminCustomerVerified(customer);
        }
      }
    }

    if (!customer) {
      if (state.mode !== "register") {
        return redirectWithError("google_no_account");
      }
      if (!state.acceptedLegal) {
        return redirectWithError("google_legal_required");
      }

      const username = pickCustomerUsername(
        state.preferredUsername,
        email,
        profile.given_name || profile.name,
      );
      const info = {
        customer_id: randomHex(8),
        username,
        email,
        address: randomAddress(),
        encrypted_key: null,
        password_hash: null,
        accepted_privacy_at: now,
        accepted_terms_at: now,
        privacy_version: LEGAL_VERSION,
        terms_version: LEGAL_VERSION,
        email_verified_at: now,
        created_at: now,
        registered_via_cafe_address:
          state.returnTo === "cafe-join" && /^0x[0-9a-f]{40}$/i.test(String(state.cafe || ""))
            ? state.cafe
            : null,
      };
      await insertCustomer.run(info);
      customer = await getCustomerAuthByEmail.get(email);
      notifyAdminCustomerVerified(customer);
    }

    if (!customer || !customer.id) {
      return redirectWithError("google_account_failed");
    }

    customer = await maybeAdoptRealNameForExistingCustomer(
      customer,
      profile.given_name || profile.name,
    );

    await upsertCustomerOauthIdentity({
      customerId: customer.id,
      provider,
      providerSubject,
      email,
      now,
    });

    const grant = await issueCustomerAuthGrant(customer.id, provider);
    return res.redirect(
      appendQueryParams(
        redirectBase,
        `oauthProvider=google&oauthToken=${encodeURIComponent(grant)}`,
      ),
    );
  } catch (e) {
    console.error(
      "Error in /auth/google/callback:",
      e && e.stack ? e.stack : e,
    );
    return redirectWithError(
      "google_auth_failed",
      e && e.message ? e.message : "",
    );
  }
});

app.get("/auth/apple/start", async (req, res) => {
  try {
    if (!appleAuthConfigured() || !OAUTH_STATE_SECRET) {
      const appsBaseUrl = getAppsBaseUrlFromRequest(req);
      return res.redirect(
        `${appsBaseUrl}/wallet?oauthError=${encodeURIComponent("apple_auth_not_configured")}`,
      );
    }

    const modeRaw = String(req.query?.mode || "login").trim().toLowerCase();
    const mode = modeRaw === "register" ? "register" : "login";
    const acceptedLegal =
      String(req.query?.acceptLegal || "").trim() === "1" ? 1 : 0;
    const preferredUsername = String(req.query?.username || "")
      .trim()
      .slice(0, 64);
    const native = String(req.query?.native || "").trim() === "1";
    const { cafe, returnTo } = readOauthReturnFields(req);
    const payload = {
      mode,
      acceptedLegal,
      preferredUsername,
      native,
      cafe,
      returnTo,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex"),
    };
    const redirectUri = `${getApiBaseUrlFromRequest(req)}/auth/apple/callback`;
    const state = signOauthState(payload);
    const url = new URL(APPLE_AUTH_BASE);
    url.searchParams.set("client_id", APPLE_SERVICES_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "form_post");
    url.searchParams.set("scope", "name email");
    url.searchParams.set("state", state);
    return res.redirect(url.toString());
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

// Apple posts the callback as application/x-www-form-urlencoded (required
// once "name email" scope is requested), not a GET redirect like Google.
const appleFormBodyParser = express.urlencoded({ extended: false });

app.post("/auth/apple/callback", appleFormBodyParser, async (req, res) => {
  const appsBaseUrl = getAppsBaseUrlFromRequest(req);
  const redirectBase = resolveOauthRedirectBase(
    appsBaseUrl,
    String(req.body?.state || ""),
  );
  function redirectWithError(code, detail) {
    const qs = new URLSearchParams();
    qs.set("oauthError", code || "apple_auth_failed");
    if (detail) qs.set("oauthErrorDetail", String(detail).slice(0, 200));
    return res.redirect(`${redirectBase}?${qs.toString()}`);
  }

  try {
    if (req.body?.error) {
      return redirectWithError(String(req.body.error || "apple_auth_rejected"));
    }

    const code = String(req.body?.code || "").trim();
    const stateRaw = String(req.body?.state || "").trim();
    if (!code || !stateRaw) return redirectWithError("apple_auth_invalid");

    const state = verifyOauthState(stateRaw);
    if (!state || !state.ts || Date.now() - Number(state.ts) > 10 * 60 * 1000) {
      return redirectWithError("apple_auth_expired");
    }

    const redirectUri = `${getApiBaseUrlFromRequest(req)}/auth/apple/callback`;
    const clientSecret = buildAppleClientSecret();
    const params = new URLSearchParams();
    params.set("code", code);
    params.set("client_id", APPLE_SERVICES_ID);
    params.set("client_secret", clientSecret);
    params.set("redirect_uri", redirectUri);
    params.set("grant_type", "authorization_code");

    const tokenResponse = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const tokens = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokens || !tokens.id_token) {
      const reason = tokens
        ? [tokens.error, tokens.error_description].filter(Boolean).join(": ")
        : "";
      throw new Error(
        `apple_token_exchange_failed:${reason || `http_${tokenResponse.status}`}`,
      );
    }

    const claims = await verifyAppleIdToken(tokens.id_token);
    const providerSubject = String(claims.sub || "").trim();
    const email = String(claims.email || "").trim().toLowerCase();
    const emailVerified =
      claims.email_verified === true || claims.email_verified === "true";
    if (!email || !providerSubject || !emailVerified) {
      return redirectWithError("apple_email_not_verified");
    }

    // Apple only sends the user's name on the very first authorization ever,
    // as a JSON string in the `user` form field - it never comes back again.
    let appleGivenName = "";
    const userRaw = String(req.body?.user || "").trim();
    if (userRaw) {
      try {
        appleGivenName = String(
          JSON.parse(userRaw)?.name?.firstName || "",
        ).trim();
      } catch {
        // Apple sent something unparsable - fall back to email-derived name.
      }
    }

    const provider = "apple";
    const now = Date.now();
    let customer = null;

    const identity = await getCustomerOauthIdentity.get(provider, providerSubject);
    if (identity && identity.customer_id) {
      customer = await getCustomerById.get(identity.customer_id);
    }

    if (!customer) {
      const existing = await getCustomerAuthByEmail.get(email);
      if (existing && existing.id) {
        customer = existing;
        if (!existing.email_verified_at) {
          await setCustomerEmailVerifiedAtById.run(now, existing.id);
          customer = await getCustomerById.get(existing.id);
          notifyAdminCustomerVerified(customer);
        }
      }
    }

    if (!customer) {
      if (state.mode !== "register") {
        return redirectWithError("apple_no_account");
      }
      if (!state.acceptedLegal) {
        return redirectWithError("apple_legal_required");
      }

      const username = pickCustomerUsername(
        state.preferredUsername,
        email,
        appleGivenName,
      );
      const info = {
        customer_id: randomHex(8),
        username,
        email,
        address: randomAddress(),
        encrypted_key: null,
        password_hash: null,
        accepted_privacy_at: now,
        accepted_terms_at: now,
        privacy_version: LEGAL_VERSION,
        terms_version: LEGAL_VERSION,
        email_verified_at: now,
        created_at: now,
        registered_via_cafe_address:
          state.returnTo === "cafe-join" && /^0x[0-9a-f]{40}$/i.test(String(state.cafe || ""))
            ? state.cafe
            : null,
      };
      await insertCustomer.run(info);
      customer = await getCustomerAuthByEmail.get(email);
      notifyAdminCustomerVerified(customer);
    }

    if (!customer || !customer.id) {
      return redirectWithError("apple_account_failed");
    }

    customer = await maybeAdoptRealNameForExistingCustomer(
      customer,
      appleGivenName,
    );

    await upsertCustomerOauthIdentity({
      customerId: customer.id,
      provider,
      providerSubject,
      email,
      now,
    });

    const grant = await issueCustomerAuthGrant(customer.id, provider);
    return res.redirect(
      appendQueryParams(
        redirectBase,
        `oauthProvider=apple&oauthToken=${encodeURIComponent(grant)}`,
      ),
    );
  } catch (e) {
    console.error(
      "Error in /auth/apple/callback:",
      e && e.stack ? e.stack : e,
    );
    return redirectWithError(
      "apple_auth_failed",
      e && e.message ? e.message : "",
    );
  }
});

app.post("/customers/oauth/consume", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "invalid_oauth_token" });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const grant = await getCustomerAuthGrantByHash.get(tokenHash);
    const now = Date.now();
    if (!grant || grant.used_at || now > Number(grant.expires_at || 0)) {
      return res.status(400).json({ error: "invalid_or_expired_oauth_token" });
    }
    const updated = await markCustomerAuthGrantUsedById.run(now, grant.id);
    if (updated && updated.changes != null && Number(updated.changes) < 1) {
      return res.status(400).json({ error: "invalid_or_expired_oauth_token" });
    }
    const customer = await getCustomerById.get(grant.customer_id);
    if (!customer || !customer.address) {
      return res.status(404).json({ error: "customer_not_found" });
    }
    return res.json({
      ok: true,
      provider: grant.provider || null,
      customer_id: customer.customer_id,
      username: customer.username || null,
      email: customer.email || null,
      address: customer.address,
      avatarDataUrl: customerAvatarDataUrlFromRow(customer),
      createdAt: customer.created_at || null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get("/customers/:customerAddress/public", async (req, res) => {
  try {
    const rawAddress = req.params?.customerAddress || "";
    if (!/^0x[0-9a-f]{40}$/i.test(rawAddress)) {
      return res.status(400).json({ ok: false, error: "invalid_customer_address" });
    }
    const customer = await getCustomerByAddress.get(rawAddress);
    if (!customer || !customer.id) {
      return res.status(404).json({ ok: false, error: "customer_not_found" });
    }
    return res.json({
      ok: true,
      customer: {
        customer_id: customer.customer_id || null,
        username: customer.username || null,
        address: customer.address || rawAddress,
        avatarDataUrl: customerAvatarDataUrlFromRow(customer),
      },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/profile-avatar", async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : "";
    const customerId =
      req.body?.customerId != null ? String(req.body.customerId).trim() : "";
    const address =
      req.body?.address != null ? String(req.body.address).trim() : "";
    if (!email || !customerId || !address) {
      return res.status(400).json({ ok: false, error: "missing_customer_identity" });
    }

    const row = await getCustomerAuthByEmail.get(email);
    if (!row || !row.id) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (
      String(row.customer_id || "").trim() !== customerId ||
      String(row.address || "").trim().toLowerCase() !== address.toLowerCase()
    ) {
      return res.status(401).json({ ok: false, error: "session_mismatch" });
    }

    const parsed = parseCustomerAvatarDataUrl(req.body?.avatarDataUrl);
    await setCustomerAvatarById.run(parsed.mime, parsed.data, row.id);
    const updated = await getCustomerById.get(row.id);
    return res.json({
      ok: true,
      customer: {
        customer_id: updated?.customer_id || customerId,
        username: updated?.username || null,
        email: updated?.email || email,
        address: updated?.address || address,
        avatarDataUrl: customerAvatarDataUrlFromRow(updated),
      },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/saved-cafes/sync", async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : "";
    const customerId =
      req.body?.customerId != null ? String(req.body.customerId).trim() : "";
    const address =
      req.body?.address != null ? String(req.body.address).trim() : "";
    const cafesRaw = Array.isArray(req.body?.cafes) ? req.body.cafes : [];
    if (!email || !customerId || !address) {
      return res.status(400).json({ ok: false, error: "missing_customer_identity" });
    }

    const row = await getCustomerAuthByEmail.get(email);
    if (!row || !row.id) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (
      String(row.customer_id || "").trim() !== customerId ||
      String(row.address || "").trim().toLowerCase() !== address.toLowerCase()
    ) {
      return res.status(401).json({ ok: false, error: "session_mismatch" });
    }

    const seen = new Set();
    const cafes = [];
    for (const raw of cafesRaw) {
      const addr = String(raw || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/i.test(addr)) continue;
      if (seen.has(addr)) continue;
      seen.add(addr);
      cafes.push(addr);
    }

    // Preserve existing favorite flags — this sync only replaces which cafes are saved.
    const existingFavorites = new Map();
    const existingRows = await listCustomerSavedCafeAddressesByCustomerId.all(row.id);
    for (const existingRow of Array.isArray(existingRows) ? existingRows : []) {
      const addr =
        existingRow && existingRow.cafe_address
          ? String(existingRow.cafe_address).toLowerCase()
          : "";
      if (addr) existingFavorites.set(addr, !!existingRow.is_favorite);
    }

    await deleteCustomerSavedCafesByCustomerId.run(row.id);
    const now = Date.now();
    for (let i = 0; i < cafes.length; i += 1) {
      const isFavorite = existingFavorites.get(cafes[i]) ? 1 : 0;
      await setCustomerSavedCafeFavorite.run(row.id, cafes[i], now + i, isFavorite);
    }

    return res.json({ ok: true, cafes });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/saved-cafes/favorite", async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : "";
    const customerId =
      req.body?.customerId != null ? String(req.body.customerId).trim() : "";
    const address =
      req.body?.address != null ? String(req.body.address).trim() : "";
    const cafeAddress =
      req.body?.cafeAddress != null ? String(req.body.cafeAddress).trim().toLowerCase() : "";
    const favorite = !!req.body?.favorite;

    if (!email || !customerId || !address) {
      return res.status(400).json({ ok: false, error: "missing_customer_identity" });
    }
    if (!/^0x[0-9a-f]{40}$/i.test(cafeAddress)) {
      return res.status(400).json({ ok: false, error: "invalid_cafe_address" });
    }

    const row = await getCustomerAuthByEmail.get(email);
    if (!row || !row.id) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (
      String(row.customer_id || "").trim() !== customerId ||
      String(row.address || "").trim().toLowerCase() !== address.toLowerCase()
    ) {
      return res.status(401).json({ ok: false, error: "session_mismatch" });
    }

    await setCustomerSavedCafeFavorite.run(
      row.id,
      cafeAddress,
      Date.now(),
      favorite ? 1 : 0,
    );

    return res.json({ ok: true, cafeAddress, favorite });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
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

    const verifiedCustomer = await getCustomerById.get(row.customer_id);
    notifyAdminCustomerVerified(verifiedCustomer);

    // The wallet pass is now only created once verification succeeds (see
    // cafe-join.html), not immediately at registration - the frontend needs
    // the address back here to proceed straight into "add to Wallet"
    // without a second lookup.
    return res.json({
      ok: true,
      address: verifiedCustomer?.address || null,
      username: verifiedCustomer?.username || null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/resend-verification", async (req, res) => {
  try {
    const emailRaw = req.body?.email != null ? String(req.body.email) : "";
    const email = emailRaw.trim().slice(0, 254).toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    const cafeRaw = req.body?.cafe;
    const cafeAddress =
      cafeRaw != null && /^0x[0-9a-f]{40}$/i.test(String(cafeRaw).trim())
        ? String(cafeRaw).trim()
        : null;

    const customer = await getCustomerAuthByEmail.get(email);
    if (!customer) {
      return res.json({ ok: true, sent: false });
    }
    if (customer.email_verified_at) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const now = Date.now();
    const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const appsBaseUrl = getAppsBaseUrlFromRequest(req);
    const verifyUrl = buildCustomerVerifyUrl(appsBaseUrl, token, cafeAddress);

    try {
      await insertCustomerEmailVerification.run(
        customer.id,
        tokenHash,
        now,
        expiresAt,
      );
      const mailInfo = await sendCustomerVerificationEmail({
        email,
        username: customer.username || "Kaffeekarte",
        verifyUrl,
      });
      console.log(
        "Customer verification resend accepted by transporter:",
        JSON.stringify({
          email,
          messageId: mailInfo && mailInfo.messageId ? mailInfo.messageId : null,
          response: mailInfo && mailInfo.response ? mailInfo.response : null,
        }),
      );
    } catch (emailErr) {
      console.error(
        `Failed to resend customer verification email to ${email}:`,
        emailErr && emailErr.stack ? emailErr.stack : emailErr,
      );
      return res.status(502).json({ ok: false, error: "verification_email_failed" });
    }

    return res.json({ ok: true, sent: true });
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

app.post("/customers/change-username", async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : "";
    const customerId =
      req.body?.customerId != null ? String(req.body.customerId).trim() : "";
    const address =
      req.body?.address != null ? String(req.body.address).trim() : "";
    const username =
      req.body?.username != null ? String(req.body.username).trim() : "";

    if (!email || !customerId || !address) {
      return res.status(400).json({ error: "missing_customer_identity" });
    }
    if (!username || username.length < 2 || username.length > 64) {
      return res.status(400).json({ error: "invalid_username" });
    }

    const row = await getCustomerAuthByEmail.get(email);
    if (!row || !row.id) {
      return res.status(404).json({ error: "not_found" });
    }
    if (
      String(row.customer_id || "").trim() !== customerId ||
      String(row.address || "").trim().toLowerCase() !== address.toLowerCase()
    ) {
      return res.status(401).json({ error: "session_mismatch" });
    }

    await setCustomerUsernameById.run(username, row.id);

    return res.json({ ok: true, username });
  } catch (e) {
    return res
      .status(500)
      .json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post("/customers/delete-account", async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : "";
    const currentPassword =
      req.body?.currentPassword != null ? String(req.body.currentPassword) : "";
    const confirmText =
      req.body?.confirmText != null ? String(req.body.confirmText).trim() : "";
    const customerId =
      req.body?.customerId != null ? String(req.body.customerId).trim() : "";
    const address =
      req.body?.address != null ? String(req.body.address).trim() : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (confirmText !== "DELETE") {
      return res.status(400).json({ ok: false, error: "delete_confirmation_required" });
    }

    const row = await getCustomerAuthByEmail.get(email);
    if (!row || !row.id) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    if (!customerId || String(row.customer_id || "").trim() !== customerId) {
      return res.status(401).json({ ok: false, error: "session_mismatch" });
    }
    if (!address || String(row.address || "").trim().toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ ok: false, error: "session_mismatch" });
    }

    if (row.password_hash) {
      if (!currentPassword) {
        return res.status(400).json({ ok: false, error: "invalid_current_password" });
      }
      const okPw = await bcrypt.compare(currentPassword, row.password_hash);
      if (!okPw) {
        return res.status(401).json({ ok: false, error: "wrong_password" });
      }
    }

    await deleteCustomerEmailVerificationsByCustomerId.run(row.id);
    await deleteCustomerPasswordResetsByCustomerId.run(row.id);
    await deleteCustomerOauthIdentitiesByCustomerId.run(row.id);
    await deleteCustomerAuthGrantsByCustomerId.run(row.id);
    await deleteCustomerSavedCafesByCustomerId.run(row.id);
    if (row.address) {
      await deleteRedeemTokensByCustomerAddress.run(row.address);
      await deleteStampEventsByCustomerAddress.run(row.address);
    }
    await deleteCustomerById.run(row.id);

    return res.json({ ok: true, deleted: { customerId } });
  } catch (e) {
    console.error(
      "Error in /customers/delete-account:",
      e && e.stack ? e.stack : e,
    );
    return res
      .status(500)
      .json({ ok: false, error: String(e && e.message ? e.message : e) });
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
