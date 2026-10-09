// Removes a logo's own background so it sits directly on the café color
// (Apple/Google Wallet card, standee) instead of showing up as a slightly
// different colored rectangle (chat 2026-10-07, African Roasters: logo box
// rgb(69,123,77) on card color rgb(71,126,77) - JPEG/color-profile drift or
// a near-invisible translucent layer baked into the upload).
// Same algorithm as stripLogoBackground() in apps/guest-qr-standee.html:
//  1. near-transparent pixels (alpha < 24) become fully transparent
//  2. if almost the whole image border is one opaque color, flood-fill that
//     color away starting from the border. Same-colored areas *inside* the
//     logo that don't touch the border stay. Logos without a uniform border
//     (photos etc.) are left untouched.

const sharp = require("sharp");

const ALPHA_CUTOFF = 24;
const COLOR_TOLERANCE = 28; // sum of |dR|+|dG|+|dB|
const BORDER_SHARE = 0.9;

// Up to this many layers get peeled off: a logo is often a colored square
// inside a white or transparent margin (chat 2026-10-09: pink square on
// transparent canvas stayed visible as a box on the pink standee). The first
// pass only sees the outer margin; the next pass starts at the edge of what
// is left and removes the square - but only if that square is close to the
// card color it'll sit on. A deliberately different-colored badge (black
// plate with white lettering on a pink card) stays, otherwise the lettering
// would end up on a background it was never designed for.
const MAX_PASSES = 3;
const INNER_MATCH_TOLERANCE = 48; // sum of |dR|+|dG|+|dB| vs. card color

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Bounding box of all not-fully-transparent pixels, or null if none.
function opaqueBounds(px, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// One flood-fill pass seeded from the border of `box`. Returns true if it
// removed anything. With `matchRgb`, only strips a border color close to it.
function stripPass(px, w, h, box, matchRgb) {
  const border = [];
  for (let x = box.x0; x <= box.x1; x++) {
    border.push(box.y0 * w + x, box.y1 * w + x);
  }
  for (let y = box.y0; y <= box.y1; y++) {
    border.push(y * w + box.x0, y * w + box.x1);
  }

  const sum = [0, 0, 0];
  let opaque = 0;
  for (const p of border) {
    if (px[p * 4 + 3] > 200) {
      sum[0] += px[p * 4];
      sum[1] += px[p * 4 + 1];
      sum[2] += px[p * 4 + 2];
      opaque++;
    }
  }
  if (opaque <= border.length * BORDER_SHARE) return false;

  const bg = sum.map((v) => v / opaque);
  if (
    matchRgb &&
    Math.abs(bg[0] - matchRgb[0]) +
      Math.abs(bg[1] - matchRgb[1]) +
      Math.abs(bg[2] - matchRgb[2]) >
      INNER_MATCH_TOLERANCE
  ) {
    return false;
  }
  const near = (p) =>
    px[p * 4 + 3] > 0 &&
    Math.abs(px[p * 4] - bg[0]) +
      Math.abs(px[p * 4 + 1] - bg[1]) +
      Math.abs(px[p * 4 + 2] - bg[2]) <=
      COLOR_TOLERANCE;
  const stack = border.filter(near);
  if (stack.length <= border.length * BORDER_SHARE) return false;

  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p)) continue;
    px[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  return true;
}

// cardColor ("#rrggbb", optional): the color the logo will sit on. Without
// it only the outermost layer is removed (the original single-pass behavior).
async function stripLogoBackground(buffer, { cardColor } = {}) {
  const matchRgb = hexToRgb(cardColor);
  try {
    const { data: px, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;

    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < ALPHA_CUTOFF) px[i] = 0;
    }

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const box = opaqueBounds(px, w, h);
      if (!box) break;
      // Only a layer touching the real image edge is removed unconditionally
      // (the original behavior). Anything further in - including a square
      // inside a transparent margin - has to match the card color.
      const isOuter = box.x0 === 0 && box.y0 === 0 && box.x1 === w - 1 && box.y1 === h - 1;
      if (!isOuter && !matchRgb) break;
      if (!stripPass(px, w, h, box, isOuter ? null : matchRgb)) break;
    }

    return await sharp(px, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();
  } catch (err) {
    console.error("stripLogoBackground failed, using original logo:", err);
    return buffer;
  }
}

module.exports = { stripLogoBackground };
