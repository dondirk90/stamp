// Sales-demo tool: given only an uploaded café logo (no café row exists yet),
// auto-detect a brand color from it and render mockup images of the three
// things a café would actually see - the counter standee, the registration
// screen, and the Wallet pass - so we can show a prospect "this is what it'd
// look like for you" before they sign up. Everything here is a pure
// buffer-in/buffer-out renderer; nothing touches the database.

const sharp = require("sharp");
const QRCode = require("qrcode");
const walletPass = require("./wallet-pass.cjs");
const { generateStampIcon } = require("./stamp-icon.cjs");
const { stripLogoBackground } = require("./logo-background.cjs");

// Same paper/ink pair guest-qr-standee.html and the wallet card theme
// presets use, so a detected-color card still looks native to the brand.
const PAPER = "#f7f4ef";
const INK = "#232323";
const DEFAULT_BG = "#4a3728";
const DEFAULT_FG = PAPER;

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")
  );
}

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function pickReadableForeground(r, g, b) {
  return relativeLuminance(r, g, b) > 0.45 ? INK : PAPER;
}

// Logos are almost always flat-color or transparent right up to the edge, so
// sampling just the border pixels (not the whole image) and taking the most
// common opaque color is a cheap, dependency-free stand-in for real
// dominant/background-color extraction.
async function extractColorsFromLogo(buffer) {
  const size = 48;
  let raw, info;
  try {
    ({ data: raw, info } = await sharp(buffer)
      .ensureAlpha()
      .resize(size, size, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    return { bg: DEFAULT_BG, fg: DEFAULT_FG };
  }

  const { width: w, height: h, channels } = info;
  const counts = new Map();
  const sums = new Map();
  const QUANT = 8;

  function sample(x, y) {
    const idx = (y * w + x) * channels;
    const a = channels >= 4 ? raw[idx + 3] : 255;
    if (a < 200) return;
    const r = raw[idx];
    const g = raw[idx + 1];
    const b = raw[idx + 2];
    const key = [
      Math.round(r / QUANT) * QUANT,
      Math.round(g / QUANT) * QUANT,
      Math.round(b / QUANT) * QUANT,
    ].join(",");
    counts.set(key, (counts.get(key) || 0) + 1);
    const sum = sums.get(key) || [0, 0, 0];
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    sums.set(key, sum);
  }

  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    sample(0, y);
    sample(w - 1, y);
  }

  // Border is fully transparent (logo doesn't reach the edges) - fall back
  // to sampling the whole image instead of giving up.
  if (!counts.size) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) sample(x, y);
    }
  }
  if (!counts.size) {
    return { bg: DEFAULT_BG, fg: DEFAULT_FG };
  }

  let bestKey = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  // Mean of the real pixels in the winning bucket, not the bucket's rounded
  // key - the rounding alone made the card color visibly differ from the
  // logo's own background (chat 2026-10-07).
  const [r, g, b] = sums.get(bestKey).map((v) => v / bestCount);
  return { bg: rgbToHex(r, g, b), fg: pickReadableForeground(r, g, b) };
}

// The Debian-slim container image ships no fonts by default (see the
// Dockerfile comment) - DejaVu is what actually gets installed there and
// has to come first. Georgia/Arial stay as the fallback so local dev on a
// desktop OS (which does have them) renders identically without needing
// DejaVu installed too.
const FONT_SERIF = "'DejaVu Serif', Georgia, 'Times New Roman', serif";
const FONT_SANS = "'DejaVu Sans', Arial, sans-serif";

function escapeXml(str) {
  return String(str || "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );
}

function wrapText(text, maxCharsPerLine) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Same treatment the real surfaces give a logo: own background removed
// (logo-background.cjs, also used by the Wallet pass and the standee page),
// then transparent margins trimmed so the visible logo fills its slot.
async function prepareLogo(logoBuffer, cardColor) {
  if (!logoBuffer) return null;
  const stripped = await stripLogoBackground(logoBuffer, { cardColor });
  try {
    return await sharp(stripped).trim().png().toBuffer();
  } catch {
    return stripped;
  }
}

// Scales a logo to fit inside maxW x maxH (enlarging small uploads too) and
// returns its final size so callers can center it.
async function fitLogo(logoBuffer, maxW, maxH) {
  const { data, info } = await sharp(logoBuffer)
    .resize(maxW, maxH, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

const STANDEE_W = 600;
const STANDEE_H = 850; // A5 ratio (148:210mm), matches guest-qr-standee.html

// Mirrors guest-qr-standee.html's single colored .face block: logo/name
// centered at the top (36mm tall slot, max 110mm wide - scaled to this
// 600px-wide A5), claim + reward + QR centered, small wordmark at the foot.
async function renderStandeeMockup({ logoBuffer, cafeName, rewardText, bg, fg }) {
  const qrDataUrl = await QRCode.toDataURL("https://kaffeekarte.app/get-app", {
    width: 400,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#2c1e15", light: "#ffffff" },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const qrResized = await sharp(qrBuffer).resize(170, 170).toBuffer();

  const claimLines = wrapText("Good coffee deserves better loyalty.", 22);
  const lineHeight = 34;
  const claimCenterY = 350;
  const claimStartY = claimCenterY - ((claimLines.length - 1) * lineHeight) / 2;
  const claimSvg = claimLines
    .map(
      (line, i) =>
        `<text x="300" y="${claimStartY + i * lineHeight}" text-anchor="middle" font-family="${FONT_SERIF}" font-size="28" fill="${fg}">${escapeXml(line)}</text>`,
    )
    .join("");

  const rewardSvg = rewardText
    ? `<text x="300" y="472" text-anchor="middle" font-family="${FONT_SERIF}" font-size="19" fill="${fg}">${escapeXml(rewardText)}</text>`
    : "";

  const cafeNameSvg =
    !logoBuffer && cafeName
      ? `<text x="300" y="150" text-anchor="middle" font-family="${FONT_SANS}" font-size="15" font-weight="700" letter-spacing="2" fill="${fg}">${escapeXml(cafeName.toUpperCase())}</text>`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STANDEE_W}" height="${STANDEE_H}">
    <rect width="${STANDEE_W}" height="${STANDEE_H}" fill="${bg}" />
    ${cafeNameSvg}
    <rect x="270" y="18" width="60" height="3" rx="1.5" fill="#b96b52" />
    ${claimSvg}
    <text x="300" y="428" text-anchor="middle" font-family="${FONT_SANS}" font-size="13" font-weight="800" letter-spacing="3" fill="${fg}" opacity="0.82">SCANNEN &amp; STEMPELN</text>
    ${rewardSvg}
    <rect x="200" y="512" width="200" height="200" rx="20" fill="#ffffff" />
    <text x="300" y="744" text-anchor="middle" font-family="${FONT_SANS}" font-size="12" font-weight="600" fill="${fg}" opacity="0.72">Direkt in Apple &amp; Google Wallet</text>
    <text x="300" y="812" text-anchor="middle" font-family="${FONT_SANS}" font-size="13" font-weight="800" letter-spacing="4" fill="${fg}" opacity="0.78">KAFFEEKARTE</text>
  </svg>`;

  const composites = [{ input: qrResized, left: 215, top: 527 }];
  if (logoBuffer) {
    const slotW = 446; // 110mm
    const slotH = 146; // 36mm
    const slotTop = 70;
    const logo = await fitLogo(logoBuffer, slotW, slotH);
    composites.push({
      input: logo.input,
      left: Math.round(300 - logo.width / 2),
      top: Math.round(slotTop + (slotH - logo.height) / 2),
    });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

const REG_W = 460;

// Same 4-path mark as cafe-join.html's inline Google icon (lines 406-423
// there) - kept identical (colors, geometry) so the button reads as
// obviously "Google", not an invented substitute.
function googleIconSvg(x, y, size) {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.2-1.8 2.9l3 2.4c1.8-1.6 2.8-4 2.8-6.9 0-.7-.1-1.5-.2-2.2H12z" />
    <path fill="#34A853" d="M12 21c2.6 0 4.9-.9 6.5-2.4l-3-2.4c-.8.6-1.9 1-3.5 1-2.7 0-4.9-1.8-5.7-4.3l-3.1 2.4C4.8 18.6 8.1 21 12 21z" />
    <path fill="#4A90E2" d="M6.3 12.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9L3.2 6.7C2.4 8.2 2 9.5 2 11s.4 2.8 1.2 4.3l3.1-2.4z" />
    <path fill="#FBBC05" d="M12 4.8c1.4 0 2.7.5 3.7 1.5l2.7-2.7C16.9 2.1 14.7 1 12 1 8.1 1 4.8 3.4 3.2 6.7l3.1 2.4c.8-2.5 3-4.3 5.7-4.3z" />
  </g>`;
}

// Same path as cafe-join.html's inline Apple icon (viewBox 384x512).
function appleIconSvg(x, y, size) {
  const s = size / 512;
  return `<g transform="translate(${x},${y}) scale(${s})">
    <path fill="#fff" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5c0 25.9 4.7 52.7 14.2 80.3 12.6 36.7 58.2 126.7 105.7 125.2 24.9-.6 42.5-17.7 74.9-17.7 31.5 0 47.8 17.7 75.6 17.7 47.9-.7 89.2-82.7 101.2-119.5-64.4-30.3-56.9-88.7-56.9-90.8zM256.8 88.1c26.9-32 24.5-61.2 23.7-71.7-23.8 1.4-51.3 16.4-67 34.9-17.3 19.8-27.5 44.4-25.3 71.9 25.8 2 49.4-11.2 68.6-35.1z" />
  </g>`;
}

// Mirrors cafe-join.html section by section, top to bottom, tracking a
// running y-cursor instead of hand-picked offsets - the real page has a lot
// of stacked, variable-height sections (checkboxes, two brand-colored OAuth
// buttons, a divider, four form fields) and hardcoded y-values drifted out
// of sync the moment any block above them changed height.
async function renderRegistrationMockup({ logoBuffer, cafeName, bg, fg }) {
  const cx = REG_W / 2;
  const contentX = 40;
  const contentW = REG_W - 80;
  const parts = [];
  let y = 40;

  // Same as cafe-join.html's img.cafeLogo: 120px tall, width follows the
  // logo, no box - the (background-stripped) logo sits directly on the
  // café color. Only the no-logo case keeps the white placeholder square.
  const badgeH = 120;
  const logo = logoBuffer ? await fitLogo(logoBuffer, contentW, badgeH) : null;
  const badgeY = y;
  if (!logo) {
    parts.push(
      `<rect x="${cx - badgeH / 2}" y="${badgeY}" width="${badgeH}" height="${badgeH}" rx="16" fill="rgba(255,255,255,0.94)" />`,
    );
  }
  y += badgeH + 24;

  for (const line of wrapText(cafeName || "Kaffeekarte", 22)) {
    y += 26;
    parts.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT_SERIF}" font-size="24" fill="${fg}">${escapeXml(line)}</text>`,
    );
  }
  y += 34;

  for (const line of wrapText("Deine Stempelkarte, direkt in der Wallet", 26)) {
    y += 26;
    parts.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT_SANS}" font-size="21" font-weight="700" fill="${fg}">${escapeXml(line)}</text>`,
    );
  }
  y += 14;

  for (const line of wrapText(
    "Kurz anmelden – keine App nötig, die Karte landet danach direkt in deiner Wallet.",
    46,
  )) {
    y += 19;
    parts.push(
      `<text x="${contentX}" y="${y}" font-family="${FONT_SANS}" font-size="13" fill="${fg}" opacity="0.85">${escapeXml(line)}</text>`,
    );
  }
  y += 24;

  const checkboxLines = [
    "Ich habe die Datenschutzerklärung gelesen.",
    "Ich akzeptiere die AGB von Kaffeekarte.",
  ];
  for (const line of checkboxLines) {
    parts.push(
      `<rect x="${contentX}" y="${y - 11}" width="14" height="14" rx="3" fill="none" stroke="${fg}" stroke-width="1.4" opacity="0.7" />`,
      `<text x="${contentX + 22}" y="${y}" font-family="${FONT_SANS}" font-size="12" fill="${fg}" opacity="0.85">${escapeXml(line)}</text>`,
    );
    y += 22;
  }
  y += 14;

  const btnH = 50;
  parts.push(
    `<rect x="${contentX}" y="${y}" width="${contentW}" height="${btnH}" rx="12" fill="#ffffff" />`,
    googleIconSvg(contentX + 20, y + 15, 20),
    `<text x="${cx + 12}" y="${y + 31}" text-anchor="middle" font-family="${FONT_SANS}" font-size="15" font-weight="600" fill="#171513">Mit Google fortfahren</text>`,
  );
  y += btnH + 12;

  parts.push(
    `<rect x="${contentX}" y="${y}" width="${contentW}" height="${btnH}" rx="12" fill="#000000" />`,
    appleIconSvg(contentX + 22, y + 15, 18),
    `<text x="${cx + 12}" y="${y + 31}" text-anchor="middle" font-family="${FONT_SANS}" font-size="15" font-weight="600" fill="#ffffff">Mit Apple fortfahren</text>`,
  );
  y += btnH + 26;

  parts.push(
    `<line x1="${contentX}" y1="${y - 4}" x2="${cx - 26}" y2="${y - 4}" stroke="${fg}" stroke-opacity="0.35" />`,
    `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT_SANS}" font-size="11" font-weight="700" letter-spacing="1" fill="${fg}" opacity="0.6">ODER</text>`,
    `<line x1="${cx + 26}" y1="${y - 4}" x2="${REG_W - contentX}" y2="${y - 4}" stroke="${fg}" stroke-opacity="0.35" />`,
  );
  y += 26;

  const fieldH = 44;
  for (const label of ["Name", "E-Mail", "Passwort", "Passwort bestätigen"]) {
    parts.push(
      `<text x="${contentX}" y="${y}" font-family="${FONT_SANS}" font-size="12" font-weight="600" fill="${fg}" opacity="0.85">${escapeXml(label)}</text>`,
    );
    y += 10;
    parts.push(
      `<rect x="${contentX}" y="${y}" width="${contentW}" height="${fieldH}" rx="10" fill="#ffffff" />`,
    );
    y += fieldH + 14;
  }
  y += 4;

  parts.push(
    `<rect x="${contentX}" y="${y}" width="${contentW}" height="52" rx="12" fill="#000000" />`,
    `<text x="${cx}" y="${y + 33}" text-anchor="middle" font-family="${FONT_SANS}" font-size="15" font-weight="700" fill="#ffffff">Stempelkarte holen</text>`,
  );
  y += 52 + 40;

  const regH = Math.round(y);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REG_W}" height="${regH}">
    <rect width="${REG_W}" height="${regH}" fill="${bg}" />
    ${parts.join("\n")}
  </svg>`;

  const composites = [];
  if (logo) {
    composites.push({
      input: logo.input,
      left: Math.round(cx - logo.width / 2),
      top: Math.round(badgeY + (badgeH - logo.height) / 2),
    });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

const PASS_W = 640;

async function buildPreviewQr(size) {
  const dataUrl = await QRCode.toDataURL("https://kaffeekarte.app/wallet", {
    width: size * 3,
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });
  return sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
    .resize(size, size)
    .png()
    .toBuffer();
}

// Small self-identifying badge baked into the corner of each mockup - these
// images get downloaded and shared individually, so "which wallet is this"
// has to survive outside the admin tool's own labeled UI.
function platformBadgeSvg(x, y, label, fg) {
  const w = label.length * 6.4 + 34;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${fg}" opacity="0.14" />
    <text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" font-family="${FONT_SANS}" font-size="11" font-weight="700" letter-spacing="0.04em" fill="${fg}">${escapeXml(label)}</text>
  </g>`;
}

// Derives a stamp silhouette from the prospect's own logo, same generator
// the real "Stempel-Vorlage" feature uses (see admin-cafe-design.html /
// POST /admin/cafes/:cafeId/stamp-icon/generate) - so the wallet-pass
// mockups below show the actual stamp a café would get, not the generic
// bean (chat 2026-10-05). Packaged as a cafeRow-shaped object purely
// because that's what getStampIconBuffer() in wallet-pass.cjs expects;
// nothing here touches a real café. Falls back to undefined (-> default
// bean) if generation fails for this particular logo, same "always returns
// a valid image" resilience as the real feature.
async function buildPreviewStampCafeRow(logoBuffer) {
  if (!logoBuffer) return undefined;
  try {
    const iconBuffer = await generateStampIcon(logoBuffer);
    return {
      stamp_icon_data: iconBuffer.toString("base64"),
      stamp_icon_mime: "image/png",
    };
  } catch (err) {
    console.warn("Logo-preview: stamp icon generation failed:", err.message || err);
    return undefined;
  }
}

// Apple Wallet Store Card, laid out exactly like the real pass this app
// issues (see buildPassJson in wallet-pass.cjs): logo top-left in the full
// 160x50pt slot (2x here: this mockup is ~320pt wide), "Stempel 6/10" header
// field top-right, the same stamp-strip image as the strip image,
// "cafeName" as the secondary field centered under it, "Bis zur Prämie" /
// "Prämie" as the auxiliary pair under that, then the QR barcode - no
// invented layout, just that structure with placeholder data.
async function renderAppleWalletMockup({ logoBuffer, cafeName, rewardText, bg, fg, stampCafeRow }) {
  const colors = walletPass.resolveThemeColors(null, bg, fg);
  const stripBuffer = await walletPass.buildStampStripPngBuffer(
    6,
    10,
    colors.bg,
    colors.fg,
    "bean",
    false,
    stampCafeRow,
    "preview",
  );
  const stripMeta = await sharp(stripBuffer).metadata();
  const stripTargetW = PASS_W - 80;
  const stripH = Math.round((stripMeta.height / stripMeta.width) * stripTargetW);
  const qrSize = 108;

  const logoSlotW = 320;
  const logoSlotH = 100;
  let y = 28;
  const logoTop = y;
  y += logoSlotH + 18;
  const stripTop = y;
  y += stripH + 34;
  const secondaryY = y;
  y += 30;
  const auxLabelY = y;
  y += 22;
  const auxValueY = y;
  y += 26;
  const qrBoxTop = y;
  y += qrSize + 28 + 28; // box padding + bottom margin
  const badgeY = y;
  y += 22 + 20;
  const passH = y;

  const reward = walletPass.rewardTextFor(rewardText);
  const label = (x, yy, text, anchor) =>
    `<text x="${x}" y="${yy}" text-anchor="${anchor}" font-family="${FONT_SANS}" font-size="11" font-weight="700" letter-spacing="1" fill="${colors.fg}" opacity="0.75">${escapeXml(text.toUpperCase())}</text>`;
  const value = (x, yy, text, anchor, size) =>
    `<text x="${x}" y="${yy}" text-anchor="${anchor}" font-family="${FONT_SANS}" font-size="${size}" font-weight="600" fill="${colors.fg}">${escapeXml(text)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PASS_W}" height="${passH}">
    <rect x="0" y="0" width="${PASS_W}" height="${passH}" rx="24" fill="${colors.bg}" />
    ${label(PASS_W - 40, logoTop + 40, "Stempel", "end")}
    ${value(PASS_W - 40, logoTop + 72, "6/10", "end", 28)}
    <text x="${PASS_W / 2}" y="${secondaryY}" text-anchor="middle" font-family="${FONT_SANS}" font-size="19" font-weight="700" fill="${colors.fg}">${escapeXml(cafeName || "Café")}</text>
    ${label(40, auxLabelY, "Bis zur Prämie", "start")}
    ${value(40, auxValueY, "noch 4", "start", 17)}
    ${label(PASS_W - 40, auxLabelY, "Prämie", "end")}
    ${value(PASS_W - 40, auxValueY, reward, "end", 17)}
    <rect x="${PASS_W / 2 - qrSize / 2 - 14}" y="${qrBoxTop}" width="${qrSize + 28}" height="${qrSize + 28}" rx="16" fill="#ffffff" />
    ${platformBadgeSvg(40, badgeY, "APPLE WALLET", colors.fg)}
  </svg>`;

  const composites = [];
  if (logoBuffer) {
    const logo = await fitLogo(logoBuffer, logoSlotW, logoSlotH);
    composites.push({
      input: logo.input,
      left: 40,
      top: Math.round(logoTop + (logoSlotH - logo.height) / 2),
    });
  }

  const stripResized = await sharp(stripBuffer)
    .resize(stripTargetW, stripH)
    .png()
    .toBuffer();
  composites.push({ input: stripResized, left: 40, top: stripTop });

  const qr = await buildPreviewQr(qrSize);
  composites.push({
    input: qr,
    left: Math.round(PASS_W / 2 - qrSize / 2),
    top: qrBoxTop + 14,
  });

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

// Google Wallet loyalty card: logo + issuerName/programName inline in the
// header (Google's fixed header layout - no centered-title override exists,
// see the comment in google-wallet-pass.cjs's buildLoyaltyClassPayload),
// the "remaining" text as the front-card row Google's cardTemplateOverride
// defines, then the hero/strip image (shown once the pass is opened) and
// the barcode.
async function renderGoogleWalletMockup({ logoBuffer, cafeName, rewardText, bg, fg, stampCafeRow }) {
  const colors = walletPass.resolveThemeColors(null, bg, fg);
  const stripBuffer = await walletPass.buildStampStripPngBuffer(
    6,
    10,
    colors.bg,
    colors.fg,
    "bean",
    false,
    stampCafeRow,
    "preview",
  );
  const stripMeta = await sharp(stripBuffer).metadata();
  const stripTargetW = PASS_W - 80;
  const stripH = Math.round((stripMeta.height / stripMeta.width) * stripTargetW);
  const qrSize = 108;
  const headerTextX = logoBuffer ? 100 : 40;

  let y = 46;
  const logoTop = y - 14;
  const nameY = y;
  y += 34;
  const remainingY = y;
  y += 34;
  const stripTop = y;
  y += stripH + 34;
  const qrBoxTop = y;
  y += qrSize + 28 + 28;
  const passH = y;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PASS_W}" height="${passH}">
    <rect x="0" y="0" width="${PASS_W}" height="${passH}" rx="16" fill="${colors.bg}" />
    ${platformBadgeSvg(PASS_W - 140, 24, "GOOGLE WALLET", colors.fg)}
    <text x="${headerTextX}" y="${nameY}" font-family="${FONT_SANS}" font-size="21" font-weight="700" fill="${colors.fg}">${escapeXml(cafeName || "Café")}</text>
    <text x="${headerTextX}" y="${remainingY}" font-family="${FONT_SANS}" font-size="14" fill="${colors.fg}" opacity="0.8">noch 4</text>
    <text x="${PASS_W - 40}" y="${remainingY}" text-anchor="end" font-family="${FONT_SANS}" font-size="14" font-weight="600" fill="${colors.fg}">${escapeXml(walletPass.rewardTextFor(rewardText))}</text>
    <rect x="${PASS_W / 2 - qrSize / 2 - 14}" y="${qrBoxTop}" width="${qrSize + 28}" height="${qrSize + 28}" rx="16" fill="#ffffff" />
  </svg>`;

  const composites = [];
  if (logoBuffer) {
    const logo = await sharp(logoBuffer)
      .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input: logo, left: 40, top: logoTop });
  }

  const stripResized = await sharp(stripBuffer)
    .resize(stripTargetW, stripH)
    .png()
    .toBuffer();
  composites.push({ input: stripResized, left: 40, top: stripTop });

  const qr = await buildPreviewQr(qrSize);
  composites.push({
    input: qr,
    left: Math.round(PASS_W / 2 - qrSize / 2),
    top: qrBoxTop + 14,
  });

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

async function renderPreviewImages({ logoBuffer, cafeName, rewardText, bg, fg }) {
  // Stamp silhouette from the original upload (that generator does its own
  // background handling); every visible logo uses the prepared version.
  const [stampCafeRow, logo] = await Promise.all([
    buildPreviewStampCafeRow(logoBuffer),
    prepareLogo(logoBuffer, walletPass.resolveThemeColors(null, bg, fg).bg),
  ]);
  const [standee, registration, walletPassApple, walletPassGoogle] = await Promise.all([
    renderStandeeMockup({ logoBuffer: logo, cafeName, rewardText, bg, fg }),
    renderRegistrationMockup({ logoBuffer: logo, cafeName, bg, fg }),
    renderAppleWalletMockup({ logoBuffer: logo, cafeName, rewardText, bg, fg, stampCafeRow }),
    renderGoogleWalletMockup({ logoBuffer: logo, cafeName, rewardText, bg, fg, stampCafeRow }),
  ]);
  return { standee, registration, walletPassApple, walletPassGoogle };
}

module.exports = {
  extractColorsFromLogo,
  renderPreviewImages,
};
