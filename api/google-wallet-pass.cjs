// Google Wallet loyalty pass generation - the Android equivalent of
// wallet-pass.cjs. Architecturally different from Apple's PassKit, though:
// there's no downloadable signed file. Instead we sign a JWT that embeds the
// class/object definitions, and Google creates them from that JWT the first
// time the customer taps "Add to Google Wallet". After that, updates go
// through the plain REST API (PATCH), which Google syncs to the device on
// its own - no device push-token registry to maintain like Apple's.

const jwt = require("jsonwebtoken");
const walletPass = require("./wallet-pass.cjs");

const WALLET_API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

// BOM/whitespace-stripped read, same as server.cjs's sanitizeEnv - GitHub
// secrets pasted with a trailing newline is a common source of "valid
// locally, breaks in CI" auth failures.
function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  return v.replace(/^﻿/, "").trim();
}

function isGoogleWalletConfigured() {
  return !!(
    sanitizeEnv("GOOGLE_WALLET_ISSUER_ID") &&
    sanitizeEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64")
  );
}

let cachedServiceAccount = null;
function loadServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = sanitizeEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64");
  if (!raw) throw new Error("google_wallet_not_configured");
  const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  if (!json.client_email || !json.private_key) {
    throw new Error("google_wallet_service_account_missing_fields");
  }
  cachedServiceAccount = json;
  return cachedServiceAccount;
}

// Simple in-memory cache - access tokens are valid ~1h, we just re-mint a
// few minutes before expiry rather than tracking exact server-issued TTLs.
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
  const account = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: OAUTH_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
    { algorithm: "RS256" },
  );

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `google_wallet_oauth_failed: ${res.status} ${JSON.stringify(data)}`,
    );
  }
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

// PATCH-only helper: cafe/customer records that were never actually saved
// to a Google Wallet (no class/object ever created on Google's side) 404 -
// that's an expected, silent no-op here, not an error worth logging.
async function patchWalletResource(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${WALLET_API_BASE}/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return { ok: false, status: 404 };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `google_wallet_patch_failed: ${path} ${res.status} ${JSON.stringify(data)}`,
    );
  }
  return { ok: true, status: res.status, data };
}

// IDs are deterministic (issuerId + cafe/customer), not DB-generated - the
// same (customer, cafe) pair always maps to the same class/object id, so we
// never need to look one up before patching it.
function sanitizeIdPart(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function loyaltyClassId(cafeId) {
  const issuerId = sanitizeEnv("GOOGLE_WALLET_ISSUER_ID");
  return `${issuerId}.cafe_${sanitizeIdPart(cafeId)}`;
}

function loyaltyObjectId(cafeId, customerAddress) {
  const issuerId = sanitizeEnv("GOOGLE_WALLET_ISSUER_ID");
  return `${issuerId}.cafe_${sanitizeIdPart(cafeId)}_${sanitizeIdPart(customerAddress)}`;
}

function buildLoyaltyClassPayload(cafeRow, appsBaseUrl) {
  const cafeId = cafeRow.id;
  const cafeName = cafeRow.name || "Kaffeekarte";
  const cardTheme = cafeRow.card_theme || "paper";
  const colors = walletPass.resolveThemeColors(
    cardTheme,
    cafeRow.card_bg_color,
    cafeRow.card_fg_color,
  );
  const base = String(appsBaseUrl || "").replace(/\/$/, "");
  const logoUri =
    cafeRow.logo_data && cafeRow.logo_mime
      ? `${base}/api/cafes/${cafeId}/logo.png`
      : `${base}/assets/app-icon-mark.png`;

  return {
    id: loyaltyClassId(cafeId),
    issuerName: "Kaffeekarte",
    programName: cafeName,
    programLogo: { sourceUri: { uri: logoUri } },
    hexBackgroundColor: colors.bg,
    reviewStatus: "UNDER_REVIEW",
  };
}

function buildLoyaltyObjectPayload({
  cafeRow,
  customerAddress,
  customerName,
  stampCount,
  threshold,
  barcodeMessage,
}) {
  const clampedStamps = Math.max(0, Math.min(stampCount, threshold));
  const remaining = Math.max(threshold - clampedStamps, 0);
  const remainingLine =
    remaining <= 0 ? "Prämie verfügbar!" : `noch ${remaining}`;

  return {
    id: loyaltyObjectId(cafeRow.id, customerAddress),
    classId: loyaltyClassId(cafeRow.id),
    state: "ACTIVE",
    accountId: customerAddress,
    accountName: customerName || undefined,
    loyaltyPoints: {
      label: "Stempel",
      balance: { int: clampedStamps },
    },
    textModulesData: [
      { id: "remaining", header: "Bis zum Gratis-Kaffee", body: remainingLine },
    ],
    barcode: {
      type: "QR_CODE",
      value: barcodeMessage,
    },
  };
}

// Called when the customer taps "Add to Google Wallet". Google creates the
// class/object from what's embedded in the JWT the first time it sees these
// ids - no separate insert() call needed before this.
function buildSaveLink({ cafeRow, program, stampCount, customerAddress, customerName, barcodeMessage, appsBaseUrl }) {
  const account = loadServiceAccount();
  const loyaltyClass = buildLoyaltyClassPayload(cafeRow, appsBaseUrl);
  const loyaltyObject = buildLoyaltyObjectPayload({
    cafeRow,
    customerAddress,
    customerName,
    stampCount,
    threshold: program.stampsForReward,
    barcodeMessage,
  });

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: account.client_email,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      origins: [],
      payload: {
        loyaltyClasses: [loyaltyClass],
        loyaltyObjects: [loyaltyObject],
      },
    },
    account.private_key,
    { algorithm: "RS256" },
  );

  return {
    saveUrl: `https://pay.google.com/gp/v/save/${token}`,
    objectId: loyaltyObject.id,
  };
}

// Cafe profile edits (color, logo, name) live on the class, which every
// customer's object references - one patch updates it for everyone at once,
// unlike Apple where each device needs its own push.
async function patchLoyaltyClassForCafe(cafeRow, appsBaseUrl) {
  if (!isGoogleWalletConfigured()) return;
  try {
    const payload = buildLoyaltyClassPayload(cafeRow, appsBaseUrl);
    await patchWalletResource(`loyaltyClass/${payload.id}`, payload);
  } catch (err) {
    console.warn("Failed to patch Google Wallet loyalty class:", err.message || err);
  }
}

// Stamp/redeem events change loyaltyPoints, which lives on the object, so
// this needs one patch per (customer, cafe) pair.
async function patchLoyaltyObjectStamps({
  cafeRow,
  program,
  stampCount,
  customerAddress,
  customerName,
  barcodeMessage,
}) {
  if (!isGoogleWalletConfigured()) return;
  try {
    const payload = buildLoyaltyObjectPayload({
      cafeRow,
      customerAddress,
      customerName,
      stampCount,
      threshold: program.stampsForReward,
      barcodeMessage,
    });
    await patchWalletResource(`loyaltyObject/${payload.id}`, payload);
  } catch (err) {
    console.warn("Failed to patch Google Wallet loyalty object:", err.message || err);
  }
}

module.exports = {
  isGoogleWalletConfigured,
  buildSaveLink,
  patchLoyaltyClassForCafe,
  patchLoyaltyObjectStamps,
};
