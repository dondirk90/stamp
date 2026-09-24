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
const { getDefaultStampIconBuffer } = require("./stamp-icon.cjs");

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

// A café's generated stamp silhouette (see api/stamp-icon.cjs) if they have
// one, otherwise the same default bean every café used before that feature
// existed - getDefaultStampIconBuffer() caches the decoded default once at
// boot so per-request strip rendering doesn't decode it on every card view.
async function getStampIconBuffer(cafeRow) {
  if (cafeRow && cafeRow.stamp_icon_data && cafeRow.stamp_icon_mime) {
    return Buffer.from(cafeRow.stamp_icon_data, "base64");
  }
  return getDefaultStampIconBuffer();
}

// Deterministic per-slot rotation so a card's stamps look individually
// hand-stamped rather than a printed grid, but don't "jump" between
// re-renders of the same slot - same idea (and same 0-360deg full range) as
// the seeded jitter in apps/customer-qr-modern.js's renderStampGrid, just a
// standalone FNV-1a-ish hash here since this runs in Node, not a browser.
//
// Plain FNV-1a alone isn't enough, though (chat 2026-09-24 - confirmed
// live): every call here uses a seed of the shape `${cardSeed}|${i}` for
// consecutive i, which differs only in one ASCII digit at the very end.
// FNV-1a's single multiply per character doesn't avalanche that small a
// change well, and taking %360 of the result exposed it directly as
// stamps alternating between just two rotation values ~180° apart instead
// of looking random. The MurmurHash3 finalizer below (xor/multiply/xor
// twice) re-mixes the bits enough to break that up.
function seededRotationDeg(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % 360;
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

// Fits a cafe's logo into Apple's square icon.png slot (29x29pt @1x).
// icon.png - not logo.png, the wider in-pass header image built above - is
// what Wallet actually shows in the lock-screen "you're near this cafe"
// relevance notification (locations/maxDistance below), on Apple Watch, and
// in the pass list, so leaving it as the generic bean meant every cafe's
// proximity alert looked the same regardless of which cafe it was for.
// Falls back to STATIC_ICON_BUFFERS (the bean) for cafes with no logo yet.
async function buildIconBuffers(logoBuffer) {
  const out = {};
  for (const scale of [1, 2, 3]) {
    const size = 29 * scale;
    const name = scale === 1 ? "icon.png" : `icon@${scale}x.png`;
    out[name] = await sharp(logoBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
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

function renderFilledIcon(stampStyle, beanDataUrl, cx, cy, d, fgHex, rotationDeg) {
  if (stampStyle === "star") {
    const scale = d / 100;
    return `<g transform="translate(${cx - d / 2}, ${cy - d / 2}) scale(${scale})"><path d="${STAR_PATH_100}" fill="${fgHex}" opacity="0.92" /></g>`;
  }
  if (stampStyle === "circle") {
    return `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${fgHex}" opacity="0.92" />`;
  }
  // "bean" and "cup" (cup is a legacy alias, same as the in-app card) - also
  // the slot a café's custom logo-derived stamp icon renders through (see
  // getStampIconBuffer). Randomly (but deterministically, see
  // seededRotationDeg) rotated per slot so a full card reads as individually
  // hand-stamped rather than a printed grid of identical icons.
  const rotate = rotationDeg
    ? `<g transform="rotate(${rotationDeg} ${cx} ${cy})">`
    : "<g>";
  return `${rotate}<image href="${beanDataUrl}" x="${cx - d / 2}" y="${cy - d / 2}" width="${d}" height="${d}" /></g>`;
}

const STRIP_W = 375;
const STRIP_H = 123;

// A diagonal ribbon with a checkmark over the (still fully-filled) stamp
// grid - the visible signal that this specific card is closed/historical,
// not a fresh empty one, without needing to hide how full it actually was.
// A vector checkmark rather than rendered text on purpose: this SVG gets
// rasterized by sharp/librsvg server-side with no guaranteed system font
// available in that environment (confirmed live - text here rendered as
// tofu boxes), unlike the "Eingelöst ✓" wording on the pass's own
// auxiliaryFields text, which iOS/Google render natively and isn't
// affected by this at all.
function renderRedeemedRibbon(w, h, scale) {
  const bandHeight = 34 * scale;
  const angle = -8;
  const cx = w / 2;
  const cy = h / 2;
  const s = 11 * scale;
  const x1 = cx - s * 1.1;
  const y1 = cy;
  const x2 = cx - s * 0.25;
  const y2 = cy + s * 0.75;
  const x3 = cx + s * 1.3;
  const y3 = cy - s * 0.85;
  return `
    <g transform="rotate(${angle} ${cx} ${cy})">
      <rect x="${-w * 0.15}" y="${cy - bandHeight / 2}" width="${w * 1.3}" height="${bandHeight}" fill="#171412" opacity="0.9" />
      <path d="M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}" stroke="#ffffff" stroke-width="${3.2 * scale}" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </g>
  `;
}

// Shared by buildStripBuffers (Apple, one SVG per @1x/2x/3x asset) and
// buildStampStripPngBuffer (Google, a single standalone image) so both
// wallets render the same stamp-progress grid from one source of truth.
function renderStripSvg(scale, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl, isRedeemed, seed) {
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
    // A white backing disc under every slot, filled or not - keeps the
    // (always-black, see stamp-icon.cjs) ink legible on darker card themes
    // instead of nearly disappearing against them (chat 2026-09-24).
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" stroke="${fgHex}" stroke-opacity="0.45" stroke-width="${Math.max(1, scale)}" />`;
    if (i < stampCount) {
      // 2.5x the empty-slot radius (was 2.1x) - a real stamp isn't neatly
      // inscribed inside its own outline (chat 2026-09-24).
      const d = r * 2.5;
      const rotationDeg = seed ? seededRotationDeg(`${seed}|${i}`) : 0;
      icons += renderFilledIcon(stampStyle, beanDataUrl, cx, cy, d, fgHex, rotationDeg);
    }
  }

  const ribbon = isRedeemed ? renderRedeemedRibbon(w, h, scale) : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bgHex}" />${circles}${icons}${ribbon}</svg>`;
}

// Renders the stamp-progress strip using the cafe's chosen stamp symbol
// (bean/cup/star/circle) for filled stamps, empty ones are always an
// outline circle - same visual language as the in-app card. `cafeRow` picks
// the bean vs. a café's custom logo-derived icon (see getStampIconBuffer);
// `seed` (typically the pass's serialNumber - unique and stable per card)
// drives the per-slot rotation so it doesn't change between re-renders of
// the same card.
async function buildStripBuffers(stampCount, threshold, bgHex, fgHex, stampStyle, isRedeemed, cafeRow, seed) {
  const beanBuffer = await getStampIconBuffer(cafeRow);
  const beanDataUrl = "data:image/png;base64," + beanBuffer.toString("base64");
  const out = {};

  for (const scale of [1, 2, 3]) {
    const svg = renderStripSvg(scale, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl, isRedeemed, seed);
    const name = scale === 1 ? "strip.png" : `strip@${scale}x.png`;
    out[name] = await sharp(Buffer.from(svg)).png().toBuffer();
  }

  return out;
}

// Same stamp-progress grid as a single standalone PNG, for Google Wallet's
// imageModulesData (which references one hosted image, not an @1x/2x/3x
// asset bundle like Apple's). See buildStripBuffers above for cafeRow/seed.
async function buildStampStripPngBuffer(stampCount, threshold, bgHex, fgHex, stampStyle, isRedeemed, cafeRow, seed) {
  const beanBuffer = await getStampIconBuffer(cafeRow);
  const beanDataUrl = "data:image/png;base64," + beanBuffer.toString("base64");
  const svg = renderStripSvg(3, stampCount, threshold, bgHex, fgHex, stampStyle, beanDataUrl, isRedeemed, seed);
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
  lat,
  lng,
  isRedeemed,
  customerEmail,
  customerId,
  cardNumber,
  cardId,
  // { value, changeMessage } | null - the café's push reminder (see
  // server.cjs's reminder_notifications/findReminderCandidates). value is
  // the reminder's send timestamp, changeMessage the already-composed text
  // (days-inactive/stamps-remaining already substituted in, not a %@
  // template - the whole message differs per café/customer). PassKit only
  // fires the lock-screen notification when a field's *value* differs from
  // what the device has cached, so this naturally shows once per reminder
  // (same value on every later re-fetch, e.g. triggered by an unrelated
  // stamp event, doesn't re-fire) without server-side "already delivered"
  // bookkeeping beyond what reminder_notifications already tracks for dedup.
  reminderBackfield,
}) {
  const colors = resolveThemeColors(cardTheme, cardBgColor, cardFgColor);
  const clampedStamps = Math.max(0, Math.min(stampCount, threshold));
  const remaining = Math.max(threshold - clampedStamps, 0);
  // A redeemed card stays visibly at its final stamp count (a closed,
  // historical record - see /redeem-reward) rather than resetting, so this
  // text has to say so explicitly - otherwise "Prämie verfügbar!" would
  // keep claiming a reward is still waiting on a card that's already been
  // claimed, indistinguishable from one that's genuinely still full.
  const remainingLine = isRedeemed
    ? "Eingelöst ✓"
    : remaining <= 0
      ? "Prämie verfügbar!"
      : `noch ${remaining}`;

  // Layout (chat 2026-09-21, following a reference loyalty-card app's back-
  // of-pass ordering): the dynamic, "what's happening with my card right
  // now" fields lead (message, then progress), the café's own static
  // content comes next, and the always-present account/legal boilerplate
  // (IDs, terms, AGB/privacy links, "powered by") reads like small print,
  // so it's pushed all the way to the bottom instead of sitting up top.
  const backFields = [];

  // Most customers only ever look at the Wallet app, never the companion
  // web app - so a Wallet lock-screen notification on the pass they already
  // have is often the only channel that can reach them at all. Apple only
  // shows one for a field whose value actually changed, and only one field
  // per update may carry a changeMessage (more than one collapses into a
  // generic "Pass was changed" instead of custom text) - so which field
  // carries it has to switch depending on state: "earned" while still
  // filling (routine "you got a stamp"), "untilReward" on the update that
  // completes the card (its value changes from "noch X" to "Prämie
  // verfügbar!") nudging them to open the app for a new card, and again on
  // the update that redeems it (its value changes a second time, to
  // "Eingelöst ✓") confirming the redemption actually went through on the
  // exact pass they're looking at.
  const isFull = remaining <= 0;
  // "reminder" below is now a *structurally permanent* field (always in
  // backFields, value "–" and no changeMessage when nothing's active - see
  // getReminderBackfieldFor in server.cjs) rather than one that appears and
  // disappears. That's a deliberate trade for reliability: Apple's
  // changeMessage notification appears to require an *existing* field's
  // value to change between pass versions - a field appearing/disappearing
  // between versions silently never notified across three live tests, only
  // switched to working once the field's presence became stable and just
  // its value toggled. While a reminder is actually active (reminderBackfield
  // .changeMessage truthy), the routine "earned"/"untilReward" messages
  // below step aside so Apple's "only one field per update may carry a
  // changeMessage" rule doesn't collide the two - then behave exactly as
  // before once the reminder is inactive again.
  const reminderBF = reminderBackfield || { value: "–", changeMessage: null };
  const reminderActive = !!reminderBF.changeMessage;
  backFields.push(
    {
      key: "reminder",
      label: "Erinnerung",
      value: String(reminderBF.value),
      ...(reminderBF.changeMessage
        ? { changeMessage: reminderBF.changeMessage }
        : {}),
    },
    {
      key: "earned",
      label: "Gesammelte Stempel",
      value: String(clampedStamps),
      // Neutral on purpose (chat 2026-09-21) - this field's value also
      // changes when a café corrects a mistaken stamp (POST
      // /remove-stamp, a negative delta), where "Frischer Stempel!"
      // would be actively wrong. %@ still required for the banner to
      // render at all (see getReminderBackfieldFor's own comment).
      ...(!reminderActive && !isFull
        ? { changeMessage: "Dein neuer Stempelstand: %@ Stempel." }
        : {}),
    },
    {
      key: "untilReward",
      label: "Bis zur nächsten Prämie",
      value: remainingLine,
      ...(reminderActive
        ? {}
        : isRedeemed
          ? {
              changeMessage:
                "✓ Eingelöst! Öffne die Kaffeekarte-App für deine nächste Stempelkarte.",
            }
          : isFull
            ? {
                changeMessage:
                  "🎉 Karte voll! Öffne die Kaffeekarte-App für eine neue Stempelkarte.",
              }
            : {}),
    },
  );

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
    // Account info - lets a customer confirm which email/card a support
    // conversation is about, and lets them self-check the recovery email on
    // file (see /customers/register's verification flow) without having to
    // dig through the app. cardNumber comes from getCardOrdinal() and is
    // only null before this card's very first stamp, which can't happen
    // here since a pass always renders an already-existing card.
    ...(customerId
      ? [{ key: "customerId", label: "Kunden-ID", value: String(customerId) }]
      : []),
    ...(cardNumber
      ? [{ key: "cardNumber", label: "Karten-Nr.", value: `#${cardNumber}` }]
      : []),
    // Raw card_id, distinct from the human-friendly ordinal above - null for
    // a customer's first/default card (see splitStampAward in server.cjs),
    // so that state gets its own label rather than printing "null".
    { key: "cardId", label: "Karten-ID", value: cardId || "Standard" },
    ...(customerEmail
      ? [{ key: "email", label: "E-Mail", value: customerEmail }]
      : []),
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
    // Shows as the sender label above the notification text on the lock
    // screen - was hardcoded to "Kaffeekarte" for every café, so a push
    // from any café looked identically generic there (unlike Google
    // Wallet's issuerName/programName, which already used cafeName).
    // Falls back the same way cafeName itself does (see generateSignedPass)
    // when a café somehow has no name set.
    organizationName: cafeName,
    description: `${cafeName} Stempelkarte`,
    webServiceURL,
    authenticationToken,
    backgroundColor: hexToRgbString(colors.bg),
    foregroundColor: hexToRgbString(colors.fg),
    labelColor: hexToRgbString(colors.fg),
    storeCard: {
      // primaryFields render huge and overlap the strip image instead of
      // stacking below it - secondaryFields is the smaller, normal-sized
      // field row that actually sits between the strip and the barcode
      // without covering the stamp circles.
      secondaryFields: [
        {
          key: "cafeName",
          value: cafeName,
          textAlignment: "PKTextAlignmentCenter",
        },
      ],
      // Same "noch X" / "Prämie verfügbar!" text as the Google side's
      // front-card row - the stamp circles already hint at it visually,
      // but it should also be readable as text, not just inferred from
      // counting filled circles.
      auxiliaryFields: [
        {
          key: "remaining",
          value: remainingLine,
          textAlignment: "PKTextAlignmentCenter",
        },
      ],
      backFields,
    },
    barcodes: [
      {
        message: barcodeMessage,
        format: "PKBarcodeFormatQR",
        messageEncoding: "iso-8859-1",
        // Below the barcode, not a top-right headerField - keeps the header
        // free for logo + cafe name, and reads more like "this is your
        // card" right where you'd hold it up to scan.
        ...(trimmedCustomerName ? { altText: trimmedCustomerName } : {}),
      },
    ],
    // Surfaces the pass on the lock screen automatically when the customer
    // is physically near the cafe - only when the cafe has actually set a
    // map location (many haven't), no fallback/default coordinates.
    ...(typeof lat === "number" && typeof lng === "number"
      ? {
          locations: [
            {
              latitude: lat,
              longitude: lng,
              relevantText: `${cafeName} ist in der Nähe – Zeit für einen Kaffee?`,
            },
          ],
          maxDistance: 150,
        }
      : {}),
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
  isRedeemed,
  customerEmail,
  customerId,
  cardNumber,
  cardId,
  reminderBackfield,
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
    lat: cafeRow && cafeRow.lat != null ? Number(cafeRow.lat) : null,
    lng: cafeRow && cafeRow.lng != null ? Number(cafeRow.lng) : null,
    isRedeemed,
    customerEmail,
    customerId,
    cardNumber,
    cardId,
    reminderBackfield,
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
      isRedeemed,
      cafeRow,
      serialNumber,
    )),
  };

  if (cafeRow && cafeRow.logo_data && cafeRow.logo_mime) {
    const logoBuffer = Buffer.from(cafeRow.logo_data, "base64");
    Object.assign(buffers, await buildLogoBuffers(logoBuffer));
    Object.assign(buffers, await buildIconBuffers(logoBuffer));
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
