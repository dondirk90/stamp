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
// 0-255; pixels darker than this become "ink". 175 rather than a rounder
// 200 (chat 2026-09-24): light pastel fills (e.g. a window pane at ~187)
// need to fall on the background side - a real stamp is one uniform ink
// tone throughout (chat 2026-09-24: an earlier version rendered large
// filled shapes in a second, muted gray tone specifically to keep text
// legible over them, but a real ink stamp can't do that - one ink pad, one
// color - so legibility has to come from getting the background-vs-ink
// call right in the first place, not from a second color).
const LUMINANCE_THRESHOLD = 175;
const ALPHA_CUTOFF = 40; // Source pixels more transparent than this are always background.
const EDGE_SOFTEN_SIGMA = 1.1; // px - blurs the crisp cutout edge into a soft ink-bleed falloff.
const ERASE_BELOW = 70; // 0-255 blob-noise value below which ink is fully missing (dry-stamp gaps).

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Whether a pixel counts as "ink" - the one test every other pass in this
// file builds on. `invert` flips which tone (light or dark) counts as
// background, for a logo built the opposite way round (light mark on a
// dark background) - see detectBackgroundIsDark().
function isInkPixel(r, g, b, a, invert) {
  if (a < ALPHA_CUTOFF) return false;
  const lum = luminance(r, g, b);
  return invert ? lum > 255 - LUMINANCE_THRESHOLD : lum < LUMINANCE_THRESHOLD;
}

// Samples a ring around the image's outer edge (not the exact corner
// pixels alone - a full-bleed circular badge logo could legitimately touch
// those) to guess whether the source logo is drawn light-on-dark rather
// than the assumed dark-on-light (chat 2026-09-24: cafés with a dark-brand
// logo - e.g. cream mark on an espresso-brown background - need the
// opposite of the normal light-background assumption, or the whole
// background becomes the "stamp" and the actual mark disappears). Runs on
// the *original* image, before cropToContent would trim this exact border
// away. A manual override in the UI still exists for whatever this guesses
// wrong on.
const INVERT_SAMPLE_SIZE = 120;
const INVERT_BORDER_FRACTION = 0.06;
const INVERT_DARK_MAJORITY = 0.6;

async function detectBackgroundIsDark(logoBuffer) {
  const { data } = await sharp(logoBuffer)
    .resize(INVERT_SAMPLE_SIZE, INVERT_SAMPLE_SIZE, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const margin = Math.round(INVERT_SAMPLE_SIZE * INVERT_BORDER_FRACTION);
  let darkCount = 0;
  let sampled = 0;
  for (let y = 0; y < INVERT_SAMPLE_SIZE; y++) {
    const onBorderRow = y < margin || y >= INVERT_SAMPLE_SIZE - margin;
    for (let x = 0; x < INVERT_SAMPLE_SIZE; x++) {
      if (!onBorderRow && x >= margin && x < INVERT_SAMPLE_SIZE - margin) continue;
      const i = (y * INVERT_SAMPLE_SIZE + x) * 4;
      if (data[i + 3] < ALPHA_CUTOFF) continue; // transparent border pixels don't tell us light vs dark
      sampled += 1;
      if (luminance(data[i], data[i + 1], data[i + 2]) < 128) darkCount += 1;
    }
  }
  if (sampled === 0) return false; // fully transparent source - default to the normal assumption
  return darkCount / sampled > INVERT_DARK_MAJORITY;
}

// Tightly crop to the logo's actual content (plus a little padding) before
// fitting it into the working square - ported from a reference Python
// script the café shared (chat 2026-09-24): without this, a source file
// with a lot of built-in margin renders its logo small and centered in a
// sea of empty stamp, instead of actually filling the stamp.
const CROP_ANALYZE_MAX = 800; // analysis resolution cap, only need a bounding box
const CROP_PADDING_FRACTION = 0.08;

async function cropToContent(logoBuffer, invert) {
  const { data, info } = await sharp(logoBuffer)
    .resize(CROP_ANALYZE_MAX, CROP_ANALYZE_MAX, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (!isInkPixel(data[i], data[i + 1], data[i + 2], data[i + 3], invert)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return logoBuffer; // nothing found - leave the source untouched.

  const meta = await sharp(logoBuffer).metadata();
  const scaleX = (meta.width || info.width) / info.width;
  const scaleY = (meta.height || info.height) / info.height;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const padX = Math.round(bboxW * CROP_PADDING_FRACTION);
  const padY = Math.round(bboxH * CROP_PADDING_FRACTION);

  const left = Math.max(0, Math.round((minX - padX) * scaleX));
  const top = Math.max(0, Math.round((minY - padY) * scaleY));
  const right = Math.min(meta.width || info.width, Math.round((maxX + 1 + padX) * scaleX));
  const bottom = Math.min(meta.height || info.height, Math.round((maxY + 1 + padY) * scaleY));
  if (right <= left || bottom <= top) return logoBuffer;

  return sharp(logoBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .toBuffer();
}

// Multi-octave blurred noise (fine + medium + coarse, weighted and summed)
// reads as organic ink variation rather than the slightly uniform "blob"
// texture a single noise/blur pass produces - also ported from the same
// reference script. Returns a normalized 0..255 single-channel buffer.
const NOISE_OCTAVES = [
  { blur: 1.4, weight: 0.5 },
  { blur: 4, weight: 0.3 },
  { blur: 9, weight: 0.2 },
];

async function generateOctaveNoise(width, height) {
  const combined = new Float32Array(width * height);
  for (const { blur, weight } of NOISE_OCTAVES) {
    // sharp's noise synthesis ignores `channels: 1` and always produces 3
    // (see the note this cost us further down) - .toColourspace("b-w")
    // forces it back to one byte per pixel before reading raw.
    const layer = await sharp({
      create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } },
    })
      .blur(blur)
      .toColourspace("b-w")
      .raw()
      .toBuffer();
    for (let i = 0; i < combined.length; i++) combined[i] += layer[i] * weight;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] < min) min = combined[i];
    if (combined[i] > max) max = combined[i];
  }
  const range = Math.max(1e-6, max - min);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < combined.length; i++) {
    out[i] = Math.round(((combined[i] - min) / range) * 255);
  }
  return out;
}

// Randomly erases a fraction of pixels right on the ink/background boundary
// (not the interior) for a ragged, hand-inked edge instead of a clean
// vector outline - a smaller, targeted cousin of the interior wear in
// applyInkDistortion. Applied before the edge-soften blur so the blur
// smooths the newly-ragged edge instead of leaving it razor-cut.
const EDGE_IRREGULARITY_AMOUNT = 0.16;

function applyEdgeIrregularity(buffer, mask, width, height, amount) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      const isEdge =
        (x > 0 && !mask[p - 1]) ||
        (x < width - 1 && !mask[p + 1]) ||
        (y > 0 && !mask[p - width]) ||
        (y < height - 1 && !mask[p + width]);
      if (isEdge && Math.random() < amount) {
        buffer[p * 4 + 3] = 0;
      }
    }
  }
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
 * @param {object} [options]
 * @param {boolean} [options.invert] - true forces "light mark on dark
 *   background" handling, false forces the normal "dark mark on light
 *   background" assumption. Omit to auto-detect (see
 *   detectBackgroundIsDark) - the Design-tab UI exposes this as a manual
 *   override for whatever the auto-detection guesses wrong.
 * @returns {Promise<Buffer>} a 300x300 PNG, transparent background, black ink silhouette
 *   with an ink-stamp-like distressed/uneven texture.
 */
async function generateStampIcon(logoBuffer, options = {}) {
  const invert =
    typeof options.invert === "boolean"
      ? options.invert
      : await detectBackgroundIsDark(logoBuffer);

  const cropped = await cropToContent(logoBuffer, invert);
  const { data, info } = await sharp(cropped)
    .resize(ICON_SIZE, ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Pass 1a: binary ink/background mask.
  const pixelCount = info.width * info.height;
  const mask = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    mask[p] = isInkPixel(data[i], data[i + 1], data[i + 2], data[i + 3], invert) ? 1 : 0;
  }

  // Pass 1b: crisp cutout - one uniform ink color for every foreground
  // pixel (text, outline, filled shapes alike - a real stamp pad only has
  // one color), transparent everywhere else. Legibility of a wordmark over
  // a background graphic relies entirely on LUMINANCE_THRESHOLD correctly
  // sorting the graphic's fills to the background side, not on a second
  // ink tone.
  const cutout = Buffer.alloc(data.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    if (!mask[p]) {
      cutout[i + 3] = 0;
      continue;
    }
    cutout[i] = INK_RGB.r;
    cutout[i + 1] = INK_RGB.g;
    cutout[i + 2] = INK_RGB.b;
    cutout[i + 3] = data[i + 3];
  }

  // Pass 1c: ragged ink/background boundary before anything gets blurred,
  // so the softening pass below smooths the new raggedness instead of a
  // razor-crisp vector edge.
  applyEdgeIrregularity(cutout, mask, info.width, info.height, EDGE_IRREGULARITY_AMOUNT);

  // Pass 2: soften the (now ragged) cutout edge into a slight ink-bleed
  // falloff. Safe to blur all channels here - the ink is a single flat
  // color, so blending it against transparent at the border can't smear in
  // any stray colors, only a soft alpha gradient.
  const { data: softened } = await sharp(cutout, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .blur(EDGE_SOFTEN_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Pass 3: multi-octave blurred noise modulates ink density and
  // occasionally erases it outright - mimics how a real rubber stamp never
  // lays down perfectly even ink.
  const noise = await generateOctaveNoise(info.width, info.height);

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
