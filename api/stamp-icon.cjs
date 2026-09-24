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
const INK_RGB = { r: 0, g: 0, b: 0 }; // Black ink (chat 2026-09-24: brown read as "colored logo", not "stamped").
const LUMINANCE_THRESHOLD = 200; // 0-255; pixels darker than this become "ink".
const ALPHA_CUTOFF = 40; // Source pixels more transparent than this are always background.
const EDGE_SOFTEN_SIGMA = 1.1; // px - blurs the crisp cutout edge into a soft ink-bleed falloff.
const ERASE_BELOW = 70; // 0-255 blob-noise value below which ink is fully missing (dry-stamp gaps).

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Background pixels are set to alpha 0 up front and this function only ever
// *reduces* alpha (multiplies or zeroes it) - it structurally cannot turn a
// transparent pixel opaque, so "background always stays transparent" holds
// regardless of what the noise looks like.
function applyInkDistortion(buffer, noise) {
  for (let i = 0, n = 0; i < buffer.length; i += 4, n += 1) {
    const a = buffer[i + 3];
    if (a === 0) continue;
    const v = noise[n]; // 0..255, blurred gaussian - blob-shaped, not salt-and-pepper.
    if (v < ERASE_BELOW) {
      buffer[i + 3] = 0; // patch where the ink didn't transfer at all.
      continue;
    }
    const density = 0.55 + (v / 255) * 0.45; // 0.55..1.0 - uneven ink coverage.
    buffer[i + 3] = Math.round(a * density);
  }
  return buffer;
}

/**
 * @param {Buffer} logoBuffer - the café's uploaded logo (any raster format sharp reads).
 * @returns {Promise<Buffer>} a 300x300 PNG, transparent background, black ink silhouette
 *   with an ink-stamp-like distressed/uneven texture.
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

  // Pass 1: crisp black/transparent cutout from the source logo.
  const cutout = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const isBackground = a < ALPHA_CUTOFF || luminance(r, g, b) >= LUMINANCE_THRESHOLD;
    if (isBackground) {
      cutout[i + 3] = 0;
      continue;
    }

    cutout[i] = INK_RGB.r;
    cutout[i + 1] = INK_RGB.g;
    cutout[i + 2] = INK_RGB.b;
    cutout[i + 3] = a;
  }

  // Pass 2: soften the razor-crisp cutout edge into a slight ink-bleed
  // falloff. Safe to blur all channels here - the ink is a single flat
  // color, so blending it against transparent at the border can't smear in
  // any stray colors, only a soft alpha gradient.
  const { data: softened } = await sharp(cutout, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .blur(EDGE_SOFTEN_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Pass 3: a blurred noise field (blob-shaped patches, not per-pixel
  // grain) modulates ink density and occasionally erases it outright -
  // mimics how a real rubber stamp never lays down perfectly even ink.
  // sharp's noise synthesis ignores the requested `channels: 1` and always
  // produces 3 (confirmed live - .raw() came back at width*height*3, not
  // *1), so .toColourspace("b-w") forces it down to one byte per pixel
  // before reading raw - skipping that step silently misaligns every
  // applyInkDistortion() lookup by a growing offset and shows up as
  // diagonal banding instead of blob-shaped noise.
  const noise = await sharp({
    create: {
      width: info.width,
      height: info.height,
      channels: 3,
      noise: { type: "gaussian", mean: 165, sigma: 70 },
    },
  })
    .blur(2.6)
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  applyInkDistortion(softened, noise);

  return sharp(softened, { raw: { width: info.width, height: info.height, channels: 4 } })
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
