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

async function stripLogoBackground(buffer) {
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

    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);

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

    if (opaque > border.length * BORDER_SHARE) {
      const bg = sum.map((v) => v / opaque);
      const near = (p) =>
        Math.abs(px[p * 4] - bg[0]) +
          Math.abs(px[p * 4 + 1] - bg[1]) +
          Math.abs(px[p * 4 + 2] - bg[2]) <=
        COLOR_TOLERANCE;
      const stack = border.filter(near);
      if (stack.length > border.length * BORDER_SHARE) {
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
      }
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
