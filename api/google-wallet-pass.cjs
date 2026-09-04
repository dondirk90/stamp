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
//
// Keyed by the cafe's address, not its numeric DB id - staging and
// production are separate databases that each auto-increment their own
// cafes.id from 1, so "cafe 2" is a different real cafe in each one. Since
// staging and prod share the same GOOGLE_WALLET_ISSUER_ID (one Google
// issuer account, not one per environment), an id built from the bare
// integer collided across environments: confirmed live, a customer
// registering at a brand-new production cafe (also happened to be
// "cafe 2" there) was handed a Google Wallet class Google already had on
// file under that same id - from staging's own "cafe 2" - so they saw that
// cafe's name/logo instead of the one they'd actually just joined. The
// address is a random per-cafe value, so this can't recur.
function sanitizeIdPart(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function loyaltyClassId(cafeAddress) {
  const issuerId = sanitizeEnv("GOOGLE_WALLET_ISSUER_ID");
  return `${issuerId}.cafe_${sanitizeIdPart(cafeAddress)}`;
}

// cardId omitted (legacy/pre-multi-card customers, still the common case)
// keeps producing the exact same id as before - the object a customer
// already saved keeps matching, it doesn't need re-issuing just because
// this feature shipped. Only a customer who's actually overflowed past a
// full card gets a second, distinctly-suffixed object id.
function loyaltyObjectId(cafeAddress, customerAddress, cardId) {
  const issuerId = sanitizeEnv("GOOGLE_WALLET_ISSUER_ID");
  const suffix = cardId ? `_${sanitizeIdPart(cardId)}` : "";
  return `${issuerId}.cafe_${sanitizeIdPart(cafeAddress)}_${sanitizeIdPart(customerAddress)}${suffix}`;
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
    id: loyaltyClassId(cafeRow.address),
    // "Kaffeekarte" here added no value and just took up the prominent
    // header slot - the cafe's own name reads better there, even though
    // programName repeats it below (Google's header layout is fixed, no
    // override field exists to show something else instead - confirmed
    // via the ClassTemplateInfo reference).
    issuerName: cafeName,
    programName: cafeName,
    programLogo: { sourceUri: { uri: logoUri } },
    hexBackgroundColor: colors.bg,
    reviewStatus: "UNDER_REVIEW",
    classTemplateInfo: {
      // Explicit null, not just omitted - PATCH on this API merges fields
      // that are present rather than replacing the whole resource, so
      // simply removing this key from the payload leaves an already-created
      // class's old value in place forever. This used to show the
      // customer's name below the barcode, which read like an exposed
      // "customer ID" line on the card face - confirmed via a live PATCH
      // that only an explicit null actually clears it. The name is still
      // available elsewhere (the object's own accountName), just not
      // pinned under the QR code.
      cardBarcodeSectionDetails: null,
      // Reuses the same "remaining" text module already sent for the
      // detail view - the class only defines *where* this shows (a row on
      // the front card, above the barcode), each object's own value (either
      // "noch X" or "Prämie verfügbar!") decides *what* it says, since
      // that's naturally different per customer.
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            oneItem: {
              item: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['remaining']" }],
                },
              },
            },
          },
        ],
      },
    },
    // Surfaces the pass automatically when the customer is nearby - Google
    // decides the exact proximity/dwell threshold itself, no maxDistance
    // param like Apple's. Only when the cafe has actually set a map
    // location (many haven't - null lat/lng must NOT become 0,0, a real
    // point in the Gulf of Guinea), no fallback/default coordinates.
    ...(cafeRow.lat != null &&
    cafeRow.lng != null &&
    Number.isFinite(Number(cafeRow.lat)) &&
    Number.isFinite(Number(cafeRow.lng))
      ? {
          merchantLocations: [
            { latitude: Number(cafeRow.lat), longitude: Number(cafeRow.lng) },
          ],
        }
      : {}),
  };
}

function buildLoyaltyObjectPayload({
  cafeRow,
  customerAddress,
  customerName,
  cardId,
  stampCount,
  threshold,
  rewardDescription,
  barcodeMessage,
  appsBaseUrl,
  notify,
  isRedeemed,
  customerEmail,
  customerId,
  cardNumber,
  // Overrides the freshly-computed loyaltyObjectId() below - needed when
  // patching an object that already exists (see patchLoyaltyObjectStamps):
  // the id formula changed once already (cafe.id -> cafe.address, to fix a
  // staging/prod collision), and objects created under the old formula
  // still only exist on Google's side under their *original* id. Always
  // recomputing fresh here would silently patch a different, phantom
  // object the customer never actually saved to their wallet - confirmed
  // live: a real customer's stamp count stopped updating entirely the
  // moment that formula changed, with no error anywhere (Google 200s a
  // patch to an id nobody saved just fine, it just creates an orphan).
  objectId,
}) {
  const clampedStamps = Math.max(0, Math.min(stampCount, threshold));
  const remaining = Math.max(threshold - clampedStamps, 0);
  // A redeemed card stays visibly at its final stamp count (a closed,
  // historical record - see /redeem-reward) rather than resetting, so this
  // has to say so explicitly - "Prämie verfügbar!" would otherwise keep
  // claiming a reward is still waiting on a card that's already been
  // claimed.
  const remainingLine = isRedeemed
    ? "Eingelöst ✓"
    : remaining <= 0
      ? "Prämie verfügbar!"
      : `noch ${remaining}`;
  const base = String(appsBaseUrl || "").replace(/\/$/, "");
  const colors = walletPass.resolveThemeColors(
    cafeRow.card_theme || "paper",
    cafeRow.card_bg_color,
    cafeRow.card_fg_color,
  );
  // no-store on the server side, and a cache-busting query param here too -
  // Google caches this image by URL, so the version tag must change
  // whenever anything the image actually renders changes (stamp count,
  // color, *or* the redeemed ribbon), not just the stamp count - otherwise
  // a stale cached image (without the ribbon) could keep showing after
  // redemption until some other field happens to change the version too.
  const version = `${clampedStamps}-${colors.bg.replace("#", "")}-${colors.fg.replace("#", "")}-${isRedeemed ? "r" : "o"}`;
  const stampStripUri =
    `${base}/api/customers/${customerAddress}/google-wallet-stamp-strip.png` +
    `?cafe=${encodeURIComponent(cafeRow.address)}&v=${version}` +
    (cardId ? `&cardId=${encodeURIComponent(cardId)}` : "");

  return {
    id: objectId || loyaltyObjectId(cafeRow.address, customerAddress, cardId),
    classId: loyaltyClassId(cafeRow.address),
    state: "ACTIVE",
    accountId: customerAddress,
    accountName: customerName || undefined,
    loyaltyPoints: {
      label: "Stempel",
      balance: { int: clampedStamps },
    },
    // heroImage renders on the compact/collapsed front card itself;
    // imageModulesData only shows after the customer opens the pass's
    // detail view - the stamp progress should be visible at a glance, same
    // as Apple's strip image, not buried behind a tap.
    heroImage: { sourceUri: { uri: stampStripUri } },
    // Cafe-specific info first (only when set), the always-present
    // boilerplate (counts already visible on the card front anyway, terms)
    // last - same ordering rationale as the Apple pass's backFields.
    textModulesData: [
      ...(cafeRow.card_back_text
        ? [{ id: "info", header: "Info", body: cafeRow.card_back_text }]
        : []),
      ...(cafeRow.website_url
        ? [{ id: "cafeWebsite", header: "Website", body: cafeRow.website_url }]
        : []),
      ...(cafeRow.instagram_url
        ? [{ id: "cafeInstagram", header: "Instagram", body: cafeRow.instagram_url }]
        : []),
      { id: "remaining", header: "Bis zum Gratis-Kaffee", body: remainingLine },
      // Account info - see the matching comment in wallet-pass.cjs's
      // buildPassJson for why these three exist.
      ...(customerId
        ? [{ id: "customerId", header: "Kunden-ID", body: String(customerId) }]
        : []),
      ...(cardNumber
        ? [{ id: "cardNumber", header: "Karten-Nr.", body: `#${cardNumber}` }]
        : []),
      { id: "cardId", header: "Karten-ID", body: cardId || "Standard" },
      ...(customerEmail
        ? [{ id: "email", header: "E-Mail", body: customerEmail }]
        : []),
      {
        id: "terms",
        header: "Nutzungsbedingungen",
        body: walletPass.buildTermsText(threshold, rewardDescription),
      },
      { id: "validity", header: "Kartengültigkeit", body: "Unbegrenzt" },
    ],
    linksModuleData: {
      uris: [
        { uri: "https://kaffeekarte.app/agb", description: "AGB" },
        {
          uri: "https://kaffeekarte.app/datenschutz",
          description: "Datenschutzerklärung",
        },
      ],
    },
    // Without alternateText, Google Wallet falls back to showing the raw
    // barcode value (a full URL containing the customer's address) as the
    // caption under the QR code - reads like an exposed ID. Same fix as the
    // Apple side's barcodes[0].altText, just a differently-named field here.
    barcode: {
      type: "QR_CODE",
      value: barcodeMessage,
      ...(customerName ? { alternateText: customerName } : {}),
    },
    // Transient - only lives on this one request, has to be resent every
    // time to trigger again. Google only supports this for loyaltyPoints.
    // balance changes, capped at 3 notified updates per pass per 24h, so
    // this is only set for genuine stamp/redeem events (see the `notify`
    // param), never for a profile-driven resync (color, logo, ...) where
    // the stamp count itself hasn't actually changed.
    ...(notify ? { notifyPreference: "notifyOnUpdate" } : {}),
  };
}

// Called when the customer taps "Add to Google Wallet". Google creates the
// class/object from what's embedded in the JWT the first time it sees these
// ids - no separate insert() call needed before this.
function buildSaveLink({ cafeRow, program, stampCount, customerAddress, customerName, cardId, barcodeMessage, appsBaseUrl, isRedeemed, customerEmail, customerId, cardNumber }) {
  const account = loadServiceAccount();
  const loyaltyClass = buildLoyaltyClassPayload(cafeRow, appsBaseUrl);
  const loyaltyObject = buildLoyaltyObjectPayload({
    cafeRow,
    customerAddress,
    customerName,
    cardId,
    stampCount,
    threshold: program.stampsForReward,
    rewardDescription: program.rewardDescription,
    barcodeMessage,
    appsBaseUrl,
    isRedeemed,
    customerEmail,
    customerId,
    cardNumber,
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
  cardId,
  barcodeMessage,
  appsBaseUrl,
  notify,
  isRedeemed,
  customerEmail,
  customerId,
  cardNumber,
  // The object's actual, already-saved id (google_wallet_objects.object_id)
  // - see the comment on buildLoyaltyObjectPayload's objectId param. Falls
  // back to the freshly-computed id only when the caller doesn't have an
  // existing row yet (e.g. a brand-new save link).
  objectId,
}) {
  if (!isGoogleWalletConfigured()) return;
  try {
    const payload = buildLoyaltyObjectPayload({
      cafeRow,
      customerAddress,
      customerName,
      cardId,
      stampCount,
      threshold: program.stampsForReward,
      rewardDescription: program.rewardDescription,
      barcodeMessage,
      appsBaseUrl,
      notify,
      isRedeemed,
      customerEmail,
      customerId,
      cardNumber,
      objectId,
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
  // Needed by server.cjs to get-or-create the tracking row *before* calling
  // buildSaveLink, so the redeem-token resolver has something to read/write.
  loyaltyObjectId,
};
