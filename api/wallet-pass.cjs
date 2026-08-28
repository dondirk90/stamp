// Apple Wallet pass generation for the customer stamp card.
//
// Card visuals (logo, background color, stamp count, back-of-card text) are
// pulled straight from the same cafe profile fields cafe-scanner-new.html
// already collects (logo_data/mime, card_theme, stamps_for_reward,
// card_back_text) - there is no separate "wallet wizard", by design.

const fs = require("fs");
const path = require("path");
const http2 = require("http2");
const sharp = require("sharp");
const { PKPass } = require("passkit-generator");

const PASS_TYPE_IDENTIFIER = "pass.app.kaffeekarte.customer.stampcard";

// Same hex values as the six `data-pass-theme` presets in
// apps/customer-qr-modern.html (the in-app card), so a cafe's chosen
// "Kartendesign" looks the same in Wallet as it does in the app.
const CARD_THEME_COLORS = {
  paper: { bg: "#f7efe1", fg: "#171412" },
  clean: { bg: "#ffffff", fg: "#131313" },
  ink: { bg: "#201811", fg: "#f4e9da" },
  brand: { bg: "#6b452c", fg: "#ffffff" },
  latte: { bg: "#ecd7b4", fg: "#211a15" },
  mono: { bg: "#eef0ee", fg: "#111111" },
};

const ASSETS_DIR = path.join(__dirname, "assets", "wallet-pass");
const STATIC_ICON_BUFFERS = {
  "icon.png": fs.readFileSync(path.join(ASSETS_DIR, "icon.png")),
  "icon@2x.png": fs.readFileSync(path.join(ASSETS_DIR, "icon@2x.png")),
  "icon@3x.png": fs.readFileSync(path.join(ASSETS_DIR, "icon@3x.png")),
};

// Pre-shrunk once at boot so per-request strip rendering doesn't decode a
// multi-MB source PNG on every card view.
let cachedBeanBufferPromise = null;
function getBeanBuffer() {
  if (!cachedBeanBufferPromise) {
    cachedBeanBufferPromise = sharp(path.join(ASSETS_DIR, "stamp-bean.png"))
      .resize(300, 300, { fit: "contain" })
      .png()
      .toBuffer();
  }
  return cachedBeanBufferPromise;
}

function hexToRgbString(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "rgb(0,0,0)";
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

// Custom hex colors (set via cafe-scanner-new.html or the admin design
// editor) override the card_theme preset when present.
function resolveThemeColors(cardTheme, customBg, customFg) {
  const preset = CARD_THEME_COLORS[cardTheme] || CARD_THEME_COLORS.paper;
  return {
    bg: HEX_RE.test(customBg || "") ? customBg : preset.bg,
    fg: HEX_RE.test(customFg || "") ? customFg : preset.fg,
  };
}

// BOM/whitespace-stripped read, same as server.cjs's sanitizeEnv - GitHub
// secrets pasted with a trailing newline is a common source of "valid
// locally, breaks in CI" cert failures.
function sanitizeEnv(key) {
  const v = process.env[key];
  if (!v) return v;
  return v.replace(/^﻿/, "").trim();
}

function isWalletConfigured() {
  return !!(
    sanitizeEnv("APPLE_PASS_CERT_BASE64") &&
    sanitizeEnv("APPLE_PASS_KEY_BASE64") &&
    sanitizeEnv("APPLE_WWDR_CERT_BASE64") &&
    sanitizeEnv("APPLE_TEAM_ID")
  );
}

let cachedCertificates = null;
function loadCertificates() {
  if (cachedCertificates) return cachedCertificates;
  if (!isWalletConfigured()) {
    throw new Error("wallet_not_configured");
  }
  cachedCertificates = {
    wwdr: Buffer.from(sanitizeEnv("APPLE_WWDR_CERT_BASE64"), "base64"),
    signerCert: Buffer.from(sanitizeEnv("APPLE_PASS_CERT_BASE64"), "base64"),
    signerKey: Buffer.from(sanitizeEnv("APPLE_PASS_KEY_BASE64"), "base64"),
    signerKeyPassphrase: sanitizeEnv("APPLE_PASS_KEY_PASSPHRASE") || undefined,
  };
  return cachedCertificates;
}

// Fits an arbitrary-aspect-ratio logo into Apple's 160x50pt logo.png slot,
// transparent-padded, left-aligned. Source is whatever a cafe already
// uploaded via cafe-scanner-new.html's logo picker.
async function buildLogoBuffers(logoBuffer) {
  const out = {};
  for (const scale of [1, 2, 3]) {
    const w = 160 * scale;
    const h = 50 * scale;
    const icon = await sharp(logoBuffer)
      .resize(h, h, { fit: "contain" })
      .toBuffer();
    const name = scale === 1 ? "logo.png" : `logo@${scale}x.png`;
    out[name] = await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: icon, left: 0, top: 0 }])
      .png()
      .toBuffer();
  }
  return out;
}

// Same 100x100-viewBox star path as buildStampSvg() in
// apps/customer-qr-modern.js, so the wallet card's filled symbol matches
// whatever the cafe picked in cafe-scanner-new.html's "Stempel-Symbol"
// selector, not just a hardcoded bean.
const STAR_PATH_100 =
  "M50 13 L60 37 L86 39 L66 56 L72 82 L50 68 L28 82 L34 56 L14 39 L40 37 Z";

function renderFilledIcon(stampStyle, beanDataUrl, cx, cy, d, fgHex) {
  if (stampStyle === "star") {
    const scale = d / 100;
    return `<g transform="translate(${cx - d / 2}, ${cy - d / 2}) scale(${scale})"><path d="${STAR_PATH_100}" fill="${fgHex}" opacity="0.92" /></g>`;
  }
  if (stampStyle === "circle") {
    return `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${fgHex}" opacity="0.92" />`;
  }
  // "bean" and "cup" (cup is a legacy alias, same as the in-app card).
  return `<image href="${beanDataUrl}" x="${cx - d / 2}" y="${cy - d / 2}" width="${d}" height="${d}" />`;
}

const STRIP_W = 375;
const STRIP_H = 123;

// Shared by buildStripBuffers (Apple, one SVG per @1x/2x/3x asset) and
// buildStampStripPngBuffer (Google, a single standalone image) so both
// wallets render the same stamp-progress grid from one source of truth.
function renderStripSvg(scale, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl) {
  const w = STRIP_W * scale;
  const h = STRIP_H * scale;
  const rows = threshold <= 5 ? 1 : 2;
  const cols = Math.ceil(threshold / rows);
  const padX = 20 * scale;
  const padY = rows === 1 ? 0 : 12 * scale;
  const cellW = (w - padX * 2) / cols;
  const cellH = (h - padY * 2) / rows;
  const r = Math.min(cellW, cellH) * 0.32;

  let circles = "";
  let icons = "";
  for (let i = 0; i < threshold; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = padX + cellW * col + cellW / 2;
    const cy = padY + cellH * row + cellH / 2;
    if (i < stampCount) {
      const d = r * 2.1;
      icons += renderFilledIcon(stampStyle, beanDataUrl, cx, cy, d, fgHex);
    } else {
      circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${fgHex}" stroke-opacity="0.45" stroke-width="${Math.max(1, scale)}" />`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bgHex}" />${circles}${icons}</svg>`;
}

// Renders the stamp-progress strip using the cafe's chosen stamp symbol
// (bean/cup/star/circle) for filled stamps, empty ones are always an
// outline circle - same visual language as the in-app card.
async function buildStripBuffers(stampCount, threshold, bgHex, fgHex, stampStyle) {
  const beanBuffer = await getBeanBuffer();
  const beanDataUrl = "data:image/png;base64," + beanBuffer.toString("base64");
  const out = {};

  for (const scale of [1, 2, 3]) {
    const svg = renderStripSvg(scale, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl);
    const name = scale === 1 ? "strip.png" : `strip@${scale}x.png`;
    out[name] = await sharp(Buffer.from(svg)).png().toBuffer();
  }

  return out;
}

// Same stamp-progress grid as a single standalone PNG, for Google Wallet's
// imageModulesData (which references one hosted image, not an @1x/2x/3x
// asset bundle like Apple's).
async function buildStampStripPngBuffer(stampCount, threshold, bgHex, fgHex, stampStyle) {
  const beanBuffer = await getBeanBuffer();
  const beanDataUrl = "data:image/png;base64," + beanBuffer.toString("base64");
  const svg = renderStripSvg(3, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Shared with google-wallet-pass.cjs so both cards state the same terms in
// the same words. Deliberately limited to things that are actually true of
// how the product works (no expiry logic, no cash payout, no transfer
// feature) rather than inventing policy we haven't actually decided on.
function buildTermsText(threshold, rewardDescription) {
  const reward = rewardDescription || "eine Prämie";
  return [
    "1. Bei jedem Besuch einen Stempel erhalten.",
    `2. Nach ${threshold} Stempeln: ${reward}.`,
    "3. Karte und Stempel sind zeitlich unbegrenzt gültig.",
    "4. Stempel und Prämien sind nicht übertragbar und nicht gegen Bargeld einlösbar.",
  ].join("\n");
}

function buildPassJson({
  serialNumber,
  authenticationToken,
  webServiceURL,
  cafeName,
  customerName,
  cardTheme,
  cardBgColor,
  cardFgColor,
  stampCount,
  threshold,
  rewardDescription,
  cardBackText,
  cafeWebsiteUrl,
  cafeInstagramUrl,
  barcodeMessage,
}) {
  const colors = resolveThemeColors(cardTheme, cardBgColor, cardFgColor);
  const clampedStamps = Math.max(0, Math.min(stampCount, threshold));
  const remaining = Math.max(threshold - clampedStamps, 0);
  const remainingLine =
    remaining <= 0 ? "Prämie verfügbar!" : `noch ${remaining}`;

  const backFields = [
    {
      key: "earned",
      label: "Gesammelte Stempel",
      value: String(clampedStamps),
    },
    {
      key: "untilReward",
      label: "Bis zur nächsten Prämie",
      value: remainingLine,
    },
    {
      key: "terms",
      label: "Nutzungsbedingungen",
      value: buildTermsText(threshold, rewardDescription),
    },
    {
      key: "validity",
      label: "Kartengültigkeit",
      value: "Unbegrenzt",
    },
    {
      key: "agb",
      label: "AGB",
      value: "https://kaffeekarte.app/agb",
    },
    {
      key: "privacy",
      label: "Datenschutzerklärung",
      value: "https://kaffeekarte.app/datenschutz",
    },
  ];

  if (cardBackText) {
    backFields.push({ key: "info", label: "Info", value: cardBackText });
  }

  if (cafeWebsiteUrl) {
    backFields.push({
      key: "cafeWebsite",
      label: "Website",
      value: cafeWebsiteUrl,
    });
  }

  if (cafeInstagramUrl) {
    backFields.push({
      key: "cafeInstagram",
      label: "Instagram",
      value: cafeInstagramUrl,
    });
  }

  backFields.push(
    {
      key: "poweredBy",
      label: "Anbieter",
      value: "Kaffeekarte (https://kaffeekarte.app)",
    },
    { key: "contact", label: "Kontakt", value: "hallo@kaffeekarte.app" },
  );

  const trimmedCustomerName = String(customerName || "").trim();

  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    serialNumber,
    teamIdentifier: sanitizeEnv("APPLE_TEAM_ID"),
    organizationName: "Kaffeekarte",
    description: `${cafeName} Stempelkarte`,
    logoText: cafeName,
    webServiceURL,
    authenticationToken,
    backgroundColor: hexToRgbString(colors.bg),
    foregroundColor: hexToRgbString(colors.fg),
    labelColor: hexToRgbString(colors.fg),
    storeCard: {
      ...(trimmedCustomerName
        ? {
            headerFields: [
              { key: "customer", label: "Kunde", value: trimmedCustomerName },
            ],
          }
        : {}),
      secondaryFields: [
        { key: "remaining", label: "Bis zum Gratis-Kaffee", value: remainingLine },
      ],
      backFields,
    },
    barcodes: [
      {
        message: barcodeMessage,
        format: "PKBarcodeFormatQR",
        messageEncoding: "iso-8859-1",
      },
    ],
  };
}

// cafeRow: a row from the `cafes` table (needs name, logo_mime/logo_data,
// card_theme, card_back_text). program: getCafeProgramSettings(cafeRow).
async function generateSignedPass({
  cafeRow,
  program,
  stampCount,
  serialNumber,
  authenticationToken,
  webServiceURL,
  barcodeMessage,
  customerName,
}) {
  const certificates = loadCertificates();
  const cafeName = (cafeRow && cafeRow.name) || "Kaffeekarte";
  const cardTheme = (cafeRow && cafeRow.card_theme) || "paper";
  const cardBgColor = cafeRow && cafeRow.card_bg_color;
  const cardFgColor = cafeRow && cafeRow.card_fg_color;
  const threshold = program.stampsForReward;
  const colors = resolveThemeColors(cardTheme, cardBgColor, cardFgColor);

  const passJson = buildPassJson({
    serialNumber,
    authenticationToken,
    webServiceURL,
    cafeName,
    customerName,
    cardTheme,
    cardBgColor,
    cardFgColor,
    stampCount,
    threshold,
    rewardDescription: program.rewardDescription,
    cardBackText: cafeRow && cafeRow.card_back_text,
    cafeWebsiteUrl: cafeRow && cafeRow.website_url,
    cafeInstagramUrl: cafeRow && cafeRow.instagram_url,
    barcodeMessage,
  });

  const buffers = {
    "pass.json": Buffer.from(JSON.stringify(passJson)),
    ...STATIC_ICON_BUFFERS,
    ...(await buildStripBuffers(
      stampCount,
      threshold,
      colors.bg,
      colors.fg,
      program.stampStyle,
    )),
  };

  if (cafeRow && cafeRow.logo_data && cafeRow.logo_mime) {
    const logoBuffer = Buffer.from(cafeRow.logo_data, "base64");
    Object.assign(buffers, await buildLogoBuffers(logoBuffer));
  }

  const pass = new PKPass(buffers, certificates);
  return pass.getAsBuffer();
}

// Wallet pass updates use the Pass Type ID certificate itself as the APNs
// mTLS client identity (there's no separate .p8 auth key, unlike app push).
// The push is an empty "wake up and re-fetch" signal, always sent against
// the production APNs host - Wallet.app isn't a sandboxed/TestFlight target.
function sendSinglePush(client, pushToken) {
  return new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": PASS_TYPE_IDENTIFIER,
      "apns-push-type": "background",
      "apns-priority": "5",
    });
    let status = null;
    req.on("response", (headers) => {
      status = headers[":status"];
    });
    req.on("data", () => {});
    req.on("end", () => resolve({ pushToken, status }));
    req.on("error", (err) => resolve({ pushToken, status: null, error: err }));
    req.end(JSON.stringify({}));
  });
}

async function sendPassUpdatePush(pushTokens) {
  const tokens = Array.isArray(pushTokens) ? pushTokens.filter(Boolean) : [];
  if (!tokens.length || !isWalletConfigured()) return [];

  const certificates = loadCertificates();
  const client = http2.connect("https://api.push.apple.com", {
    cert: certificates.signerCert,
    key: certificates.signerKey,
    passphrase: certificates.signerKeyPassphrase,
  });
  // Without a listener, a connection-level error (e.g. APNs unreachable)
  // would be an uncaught 'error' event and crash the whole API process.
  client.on("error", (err) => {
    console.warn("APNs connection error:", err.message || err);
  });

  let results;
  try {
    results = await Promise.all(
      tokens.map((token) => sendSinglePush(client, token)),
    );
  } finally {
    client.close();
  }
  return results;
}

module.exports = {
  PASS_TYPE_IDENTIFIER,
  isWalletConfigured,
  generateSignedPass,
  sendPassUpdatePush,
  // Reused by google-wallet-pass.cjs so both wallets resolve a cafe's card
  // color - and render the same stamp-progress grid - the same way instead
  // of duplicating the logic.
  CARD_THEME_COLORS,
  resolveThemeColors,
  buildStampStripPngBuffer,
  buildTermsText,
};
