// Shared browser helper: removes a logo's own background so it sits directly
// on the café color. Server-side twin: api/logo-background.cjs (same
// algorithm, used for the Wallet passes) - keep both in sync. Used by
// guest-qr-standee.html and cafe-join.html.
(function () {
  // Logos bringen oft ihre eigene Hintergrundflaeche mit - entweder fast
  // unsichtbar halbtransparent oder deckend in einem Ton, der nur beinahe der
  // Cafe-Farbe entspricht (JPEG-Kompression, Farbprofil). Auf der
  // vollflaechigen Cafe-Farbe zeichnet sich das als sichtbares Rechteck ab.
  // Deshalb: Fast-transparente Pixel ganz durchsichtig machen und eine
  // einfarbige Randflaeche per Flood-Fill vom Bildrand aus entfernen. Bei
  // Logos ohne einheitlichen Rand (z. B. Fotos) bleibt das Bild unveraendert.
  //
  // Mehrere Schichten (chat 2026-10-09): Steckt ein farbiges Quadrat in einem
  // weissen oder transparenten Rand, entfernt ein weiterer Durchgang auch das
  // Quadrat - aber nur, wenn es nah an der Cafe-Farbe (cardColor) liegt. Ein
  // bewusst andersfarbiges Logo-Schild bleibt erhalten.
  var ALPHA_CUTOFF = 24;
  var COLOR_TOLERANCE = 28; // Summe |dR|+|dG|+|dB|
  var BORDER_SHARE = 0.9;
  var MAX_PASSES = 3;
  var INNER_MATCH_TOLERANCE = 48;

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function opaqueBounds(px, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function stripPass(px, w, h, box, matchRgb) {
    var border = [];
    var x, y;
    for (x = box.x0; x <= box.x1; x++) border.push(box.y0 * w + x, box.y1 * w + x);
    for (y = box.y0; y <= box.y1; y++) border.push(y * w + box.x0, y * w + box.x1);

    var sum = [0, 0, 0];
    var opaque = 0;
    border.forEach(function (p) {
      if (px[p * 4 + 3] > 200) {
        sum[0] += px[p * 4];
        sum[1] += px[p * 4 + 1];
        sum[2] += px[p * 4 + 2];
        opaque++;
      }
    });
    if (opaque <= border.length * BORDER_SHARE) return false;

    var bg = sum.map(function (v) {
      return v / opaque;
    });
    if (
      matchRgb &&
      Math.abs(bg[0] - matchRgb[0]) +
        Math.abs(bg[1] - matchRgb[1]) +
        Math.abs(bg[2] - matchRgb[2]) >
        INNER_MATCH_TOLERANCE
    ) {
      return false;
    }
    function near(p) {
      return (
        px[p * 4 + 3] > 0 &&
        Math.abs(px[p * 4] - bg[0]) +
          Math.abs(px[p * 4 + 1] - bg[1]) +
          Math.abs(px[p * 4 + 2] - bg[2]) <=
          COLOR_TOLERANCE
      );
    }
    var stack = border.filter(near);
    if (stack.length <= border.length * BORDER_SHARE) return false;

    var seen = new Uint8Array(w * h);
    while (stack.length) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      if (!near(p)) continue;
      px[p * 4 + 3] = 0;
      var px0 = p % w;
      if (px0 > 0) stack.push(p - 1);
      if (px0 < w - 1) stack.push(p + 1);
      if (p >= w) stack.push(p - w);
      if (p < w * (h - 1)) stack.push(p + w);
    }
    return true;
  }

  // cardColor ("#rrggbb", optional): die Farbe, auf der das Logo sitzt.
  // Ohne sie wird nur die aeusserste Schicht entfernt.
  function stripLogoBackground(url, cardColor) {
    var matchRgb = hexToRgb(cardColor);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (!w || !h) return resolve(url);
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var imageData = ctx.getImageData(0, 0, w, h);
          var px = imageData.data;

          for (var i = 3; i < px.length; i += 4) {
            if (px[i] < ALPHA_CUTOFF) px[i] = 0;
          }

          for (var pass = 0; pass < MAX_PASSES; pass++) {
            var box = opaqueBounds(px, w, h);
            if (!box) break;
            var isOuter = box.x0 === 0 && box.y0 === 0 && box.x1 === w - 1 && box.y1 === h - 1;
            if (!isOuter && !matchRgb) break;
            if (!stripPass(px, w, h, box, isOuter ? null : matchRgb)) break;
          }

          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          resolve(url);
        }
      };
      img.onerror = function () {
        resolve(url);
      };
      img.src = url;
    });
  }

  window.stripLogoBackground = stripLogoBackground;
})();
