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
const BACKDROP_RGB = { r: 120, g: 120, b: 120 }; // Muted gray for large "backdrop" shapes (see classifyBackdrop).
const BACKDROP_ALPHA_SCALE = 0.5; // Large shapes recede instead of competing with text for attention.
// 0-255; pixels darker than this become "ink". 175 rather than a rounder
// 200 (chat 2026-09-24): light pastel fills (e.g. a window pane at ~187)
// need to fall on the background side, or the backdrop-classification pass
// below has no transparent space around text sitting on top of them to
// tell the letters apart from the fill in the first place.
const LUMINANCE_THRESHOLD = 175;
const ALPHA_CUTOFF = 40; // Source pixels more transparent than this are always background.
const EDGE_SOFTEN_SIGMA = 1.1; // px - blurs the crisp cutout edge into a soft ink-bleed falloff.
const ERASE_BELOW = 70; // 0-255 blob-noise value below which ink is fully missing (dry-stamp gaps).
// Half-width (px, at the 300x300 working size) of the square structuring
// element used to tell "thick fill" backdrop shapes from "thin stroke"
// text/detail - see classifyBackdrop(). ~19px window: survives on a house
// roof/window pane, erodes away on a single letter stroke.
const BACKDROP_ERODE_RADIUS = 9;
// Small pre-cleanup radius (dilate then erode back = "closing") that fills
// tiny background specks *inside* an otherwise solid shape before the much
// larger BACKDROP_ERODE_RADIUS pass runs - without this, ordinary shading
// highlights baked into a source logo (confirmed live on the existing bean
// icon, which has some) read as "background gaps" to the big erosion pass
// and fracture one solid shape into an inconsistent patchwork of
// black/gray fragments instead of classifying it as one piece.
const HOLE_CLOSE_RADIUS = 2;

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Tightly crop to the logo's actual content (plus a little padding) before
// fitting it into the working square - ported from a reference Python
// script the café shared (chat 2026-09-24): without this, a source file
// with a lot of built-in margin renders its logo small and centered in a
// sea of empty stamp, instead of actually filling the stamp.
const CROP_ANALYZE_MAX = 800; // analysis resolution cap, only need a bounding box
const CROP_PADDING_FRACTION = 0.08;

async function cropToContent(logoBuffer) {
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
      const isBackground =
        data[i + 3] < ALPHA_CUTOFF || luminance(data[i], data[i + 1], data[i + 2]) >= LUMINANCE_THRESHOLD;
      if (isBackground) continue;
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

// Separable box erosion: out[p] = 1 only if every mask pixel within
// `radius` (both axes) of p is also 1. Out-of-bounds counts as 0, so
// shapes touching the canvas edge erode there too.
function erodeMask(mask, width, height, radius) {
  const horiz = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let allOnes = true;
      for (let dx = -radius; dx <= radius && allOnes; dx++) {
        const xi = x + dx;
        if (xi < 0 || xi >= width || !mask[row + xi]) allOnes = false;
      }
      horiz[row + x] = allOnes ? 1 : 0;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let allOnes = true;
      for (let dy = -radius; dy <= radius && allOnes; dy++) {
        const yi = y + dy;
        if (yi < 0 || yi >= height || !horiz[yi * width + x]) allOnes = false;
      }
      out[y * width + x] = allOnes ? 1 : 0;
    }
  }
  return out;
}

// Separable box dilation: out[p] = 1 if any mask pixel within `radius` is 1.
function dilateMask(mask, width, height, radius) {
  const horiz = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let anyOne = false;
      for (let dx = -radius; dx <= radius && !anyOne; dx++) {
        const xi = x + dx;
        if (xi >= 0 && xi < width && mask[row + xi]) anyOne = true;
      }
      horiz[row + x] = anyOne ? 1 : 0;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let anyOne = false;
      for (let dy = -radius; dy <= radius && !anyOne; dy++) {
        const yi = y + dy;
        if (yi >= 0 && yi < height && horiz[yi * width + x]) anyOne = true;
      }
      out[y * width + x] = anyOne ? 1 : 0;
    }
  }
  return out;
}

// Morphological "opening" (erode then dilate back to size): the result
// keeps the full extent of shapes wide enough to survive erosion (a house
// roof, a filled window pane) and drops anything narrower than
// 2*BACKDROP_ERODE_RADIUS entirely (letter strokes) - crucially, this is a
// *local* thickness test, not connectivity, so a thin letter stroke that
// visually crosses or touches a big shape still erodes away and stays
// classified as text/detail (chat 2026-09-24: a connected-component-by-area
// version of this tried first failed exactly here - text overlapping the
// backdrop shape merged into one region and got swallowed by it).
function classifyBackdrop(mask, width, height) {
  const closed = erodeMask(
    dilateMask(mask, width, height, HOLE_CLOSE_RADIUS),
    width,
    height,
    HOLE_CLOSE_RADIUS,
  );
  const eroded = erodeMask(closed, width, height, BACKDROP_ERODE_RADIUS);
  return dilateMask(eroded, width, height, BACKDROP_ERODE_RADIUS);
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
  const cropped = await cropToContent(logoBuffer);
  const { data, info } = await sharp(cropped)
    .resize(ICON_SIZE, ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Pass 1a: binary ink/background mask (same test as before), kept
  // separate from colour assignment so component classification below can
  // work on plain connectivity, not colour.
  const pixelCount = info.width * info.height;
  const mask = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const isBackground = a < ALPHA_CUTOFF || luminance(r, g, b) >= LUMINANCE_THRESHOLD;
    mask[p] = isBackground ? 0 : 1;
  }

  // Pass 1b: tell text/detail strokes apart from large filled shapes (a
  // house icon, a badge outline) purely by local thickness - a wordmark
  // stamped over a background graphic (chat 2026-09-24: café logo with
  // "Stube" lettering over a house icon) needs the text to stay legible
  // and visually distinct, not merge into one solid silhouette.
  let backdropMask = classifyBackdrop(mask, info.width, info.height);

  // A logo that's essentially *just* one shape (the default bean, a simple
  // wordmark-free mark) ends up almost entirely classified as "backdrop"
  // here, since there's no text to contrast it against - two-toning that
  // would just make an otherwise-fine silhouette look like a patchy,
  // half-erased mistake. Only apply the two-tone treatment when there's a
  // real mix of both: a decent chunk of actual detail ink alongside the
  // large shape, not that shape alone.
  let inkCount = 0;
  let detailCount = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    inkCount += 1;
    if (!backdropMask[p]) detailCount += 1;
  }
  if (inkCount === 0 || detailCount / inkCount < 0.08) {
    backdropMask = new Uint8Array(mask.length); // all-zero: everything renders as plain ink.
  }

  // Pass 1c: crisp cutout - black ink for text/detail, muted receding gray
  // for backdrop shapes, transparent everywhere else.
  const cutout = Buffer.alloc(data.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    if (!mask[p]) {
      cutout[i + 3] = 0;
      continue;
    }
    const a = data[i + 3];
    if (backdropMask[p]) {
      cutout[i] = BACKDROP_RGB.r;
      cutout[i + 1] = BACKDROP_RGB.g;
      cutout[i + 2] = BACKDROP_RGB.b;
      cutout[i + 3] = Math.round(a * BACKDROP_ALPHA_SCALE);
    } else {
      cutout[i] = INK_RGB.r;
      cutout[i + 1] = INK_RGB.g;
      cutout[i + 2] = INK_RGB.b;
      cutout[i + 3] = a;
    }
  }

  // Pass 1d: ragged ink/background boundary before anything gets blurred,
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
