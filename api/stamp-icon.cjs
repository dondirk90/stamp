// Converts an arbitrary café-uploaded logo into a single-color "rubber
// stamp" silhouette, used in place of the default coffee bean wherever
// stamps are rendered (customer wallet card, café Design-tab preview, the
// real Apple/Google Wallet pass strip). See ueber-uns.html-adjacent chat
// (2026-09-23) for the feature ask: café uploads a logo, gets a stamp
// template generated from it, with a live preview and per-stamp random
// rotation applied at render time (not baked in here - see the rotation
// helpers in wallet-pass.cjs and customer-qr-modern.js).
//
// Deliberately a simple luminance threshold, not a "smart" background
// remover - reliable/predictable beats occasionally-clever, and this is a
// preview-first feature by design: the café sees the result immediately
// (Design tab) and can pick a different, simpler source logo if a busy one
// doesn't silhouette well, rather than us promising perfect auto-conversion
// for any possible image.

const sharp = require("sharp");
const path = require("path");

const ICON_SIZE = 300; // Same working size as the existing bean asset.
const INK_RGB = { r: 74, g: 55, b: 40 }; // Espresso (#4A3728, BRAND.md primary accent).
const LUMINANCE_THRESHOLD = 200; // 0-255; pixels darker than this become "ink".
const ALPHA_CUTOFF = 40; // Source pixels more transparent than this are always background.

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Light per-pixel grain on the ink itself (not the edges) - cheap way to
// avoid a perfectly flat vector-look fill without needing real edge-fraying
// image compositing. Deterministic-ish (Math.random is fine here, this
// runs once at generation time, not per render).
function applyInkGrain(buffer, width, height) {
  for (let i = 0; i < buffer.length; i += 4) {
    if (buffer[i + 3] === 0) continue; // skip fully transparent pixels
    const grain = 1 - Math.random() * 0.22; // 0.78..1.0
    buffer[i + 3] = Math.round(buffer[i + 3] * grain);
  }
  return buffer;
}

/**
 * @param {Buffer} logoBuffer - the café's uploaded logo (any raster format sharp reads).
 * @returns {Promise<Buffer>} a 300x300 PNG, transparent background, Espresso-colored ink silhouette.
 */
async function generateStampIcon(logoBuffer) {
  const { data, info } = await sharp(logoBuffer)
    .resize(ICON_SIZE, ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const isBackground = a < ALPHA_CUTOFF || luminance(r, g, b) >= LUMINANCE_THRESHOLD;
    if (isBackground) {
      out[i + 3] = 0;
      continue;
    }

    out[i] = INK_RGB.r;
    out[i + 1] = INK_RGB.g;
    out[i + 2] = INK_RGB.b;
    out[i + 3] = a;
  }

  applyInkGrain(out, info.width, info.height);

  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

// Cached: GET /cafes/:cafeId/stamp-icon.png falls back to this for every
// café that hasn't generated a custom one, so it's on the hot path.
let cachedDefaultBufferPromise = null;
function getDefaultStampIconBuffer() {
  if (!cachedDefaultBufferPromise) {
    cachedDefaultBufferPromise = sharp(
      path.join(__dirname, "assets", "wallet-pass", "stamp-bean.png"),
    )
      .resize(ICON_SIZE, ICON_SIZE, { fit: "contain" })
      .png()
      .toBuffer();
  }
  return cachedDefaultBufferPromise;
}

module.exports = {
  generateStampIcon,
  getDefaultStampIconBuffer,
  ICON_SIZE,
  INK_RGB,
};
