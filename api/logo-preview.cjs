// Sales-demo tool: given only an uploaded café logo (no café row exists yet),
// auto-detect a brand color from it and render mockup images of the three
// things a café would actually see - the counter standee, the registration
// screen, and the Wallet pass - so we can show a prospect "this is what it'd
// look like for you" before they sign up. Everything here is a pure
// buffer-in/buffer-out renderer; nothing touches the database.

const sharp = require("sharp");
const QRCode = require("qrcode");
const walletPass = require("./wallet-pass.cjs");

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
  const [r, g, b] = bestKey.split(",").map(Number);
  return { bg: rgbToHex(r, g, b), fg: pickReadableForeground(r, g, b) };
}

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

const STANDEE_W = 600;
const STANDEE_H = 850; // A5 ratio (148:210mm), matches guest-qr-standee.html

// Mirrors guest-qr-standee.html's single colored .face block: logo/name top
// left, claim + reward + QR centered, small wordmark at the foot.
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
        `<text x="300" y="${claimStartY + i * lineHeight}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="28" fill="${fg}">${escapeXml(line)}</text>`,
    )
    .join("");

  const rewardSvg = rewardText
    ? `<text x="300" y="472" text-anchor="middle" font-family="Georgia, serif" font-size="19" fill="${fg}">${escapeXml(rewardText)}</text>`
    : "";

  const cafeNameSvg =
    !logoBuffer && cafeName
      ? `<text x="60" y="92" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="${fg}">${escapeXml(cafeName.toUpperCase())}</text>`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STANDEE_W}" height="${STANDEE_H}">
    <rect width="${STANDEE_W}" height="${STANDEE_H}" fill="${bg}" />
    ${cafeNameSvg}
    <rect x="270" y="18" width="60" height="3" rx="1.5" fill="#b96b52" />
    ${claimSvg}
    <text x="300" y="428" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="800" letter-spacing="3" fill="${fg}" opacity="0.82">SCANNEN &amp; STEMPELN</text>
    ${rewardSvg}
    <rect x="200" y="512" width="200" height="200" rx="20" fill="#ffffff" />
    <text x="300" y="744" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="${fg}" opacity="0.72">Direkt in Apple &amp; Google Wallet</text>
    <text x="300" y="812" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="800" letter-spacing="4" fill="${fg}" opacity="0.78">KAFFEEKARTE</text>
  </svg>`;

  const composites = [{ input: qrResized, left: 215, top: 527 }];
  if (logoBuffer) {
    const logo = await sharp(logoBuffer)
      .resize(220, 80, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    composites.push({ input: logo, left: 60, top: 60 });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

const REG_W = 420;
const REG_H = 760;

// Mirrors cafe-join.html: full-bleed café-colored screen, rounded logo
// badge, café name, headline, and the two OAuth buttons underneath.
async function renderRegistrationMockup({ logoBuffer, cafeName, bg, fg }) {
  const badgeSize = 150;
  const badgeX = (REG_W - badgeSize) / 2;
  const badgeY = 110;

  const nameLines = wrapText(cafeName || "Kaffeekarte", 20);
  const nameStartY = badgeY + badgeSize + 46;
  const nameSvg = nameLines
    .map(
      (line, i) =>
        `<text x="${REG_W / 2}" y="${nameStartY + i * 32}" text-anchor="middle" font-family="Georgia, serif" font-size="27" fill="${fg}">${escapeXml(line)}</text>`,
    )
    .join("");

  const headlineLines = wrapText("Deine Stempelkarte, direkt in der Wallet", 24);
  const headlineStartY = nameStartY + nameLines.length * 32 + 46;
  const headlineSvg = headlineLines
    .map(
      (line, i) =>
        `<text x="${REG_W / 2}" y="${headlineStartY + i * 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${fg}">${escapeXml(line)}</text>`,
    )
    .join("");

  const subY = headlineStartY + headlineLines.length * 28 + 30;
  const subSvg = `<text x="${REG_W / 2}" y="${subY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="${fg}" opacity="0.75">Kurz anmelden – keine App nötig.</text>`;

  const btnY = subY + 50;
  const buttonsSvg = `
    <rect x="40" y="${btnY}" width="${REG_W - 80}" height="52" rx="26" fill="#ffffff" />
    <text x="${REG_W / 2}" y="${btnY + 33}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#232323">Mit Google fortfahren</text>
    <rect x="40" y="${btnY + 66}" width="${REG_W - 80}" height="52" rx="26" fill="#ffffff" />
    <text x="${REG_W / 2}" y="${btnY + 99}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#232323">Mit Apple fortfahren</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REG_W}" height="${REG_H}">
    <rect width="${REG_W}" height="${REG_H}" fill="${bg}" />
    <rect x="${badgeX}" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" rx="34" fill="rgba(255,255,255,0.94)" />
    ${nameSvg}
    ${headlineSvg}
    ${subSvg}
    ${buttonsSvg}
  </svg>`;

  const composites = [];
  if (logoBuffer) {
    const pad = 20;
    const logo = await sharp(logoBuffer)
      .resize(badgeSize - pad * 2, badgeSize - pad * 2, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    composites.push({
      input: logo,
      left: Math.round(badgeX + pad),
      top: Math.round(badgeY + pad),
    });
  }

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

const PASS_W = 640;
const PASS_H = 400;

// Uses the real production stamp-strip renderer (same code the actual
// Wallet pass uses) so this one piece of the mockup is pixel-real, not
// approximated - only the surrounding card shape is a stand-in.
async function renderWalletPassMockup({ logoBuffer, cafeName, bg, fg }) {
  const colors = walletPass.resolveThemeColors(null, bg, fg);
  const stripBuffer = await walletPass.buildStampStripPngBuffer(
    6,
    10,
    colors.bg,
    colors.fg,
    "bean",
    false,
  );
  const stripMeta = await sharp(stripBuffer).metadata();

  const textTopY = logoBuffer ? 130 : 70;
  const cardNameSvg = `<text x="40" y="${textTopY}" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${colors.fg}">${escapeXml(cafeName || "Café")}</text>`;
  const rewardLabelSvg = `<text x="40" y="${textTopY + 26}" font-family="Arial, sans-serif" font-size="13" fill="${colors.fg}" opacity="0.75">6 von 10 Stempeln</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PASS_W}" height="${PASS_H}">
    <rect x="0" y="0" width="${PASS_W}" height="${PASS_H}" rx="28" fill="${colors.bg}" />
    ${cardNameSvg}
    ${rewardLabelSvg}
  </svg>`;

  const composites = [];
  if (logoBuffer) {
    const logo = await sharp(logoBuffer)
      .resize(160, 50, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    composites.push({ input: logo, left: 40, top: 40 });
  }

  const stripTargetW = PASS_W - 80;
  const stripResized = await sharp(stripBuffer)
    .resize(stripTargetW, Math.round((stripMeta.height / stripMeta.width) * stripTargetW))
    .png()
    .toBuffer();
  const stripResizedMeta = await sharp(stripResized).metadata();
  composites.push({
    input: stripResized,
    left: 40,
    top: PASS_H - stripResizedMeta.height - 40,
  });

  return sharp(Buffer.from(svg)).composite(composites).png().toBuffer();
}

async function renderPreviewImages({ logoBuffer, cafeName, rewardText, bg, fg }) {
  const [standee, registration, walletPassImg] = await Promise.all([
    renderStandeeMockup({ logoBuffer, cafeName, rewardText, bg, fg }),
    renderRegistrationMockup({ logoBuffer, cafeName, bg, fg }),
    renderWalletPassMockup({ logoBuffer, cafeName, bg, fg }),
  ]);
  return { standee, registration, walletPass: walletPassImg };
}

module.exports = {
  extractColorsFromLogo,
  renderPreviewImages,
};
