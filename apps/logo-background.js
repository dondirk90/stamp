// Shared browser helper: removes a logo's own background so it sits directly
// on the café color. Server-side twin: api/logo-background.cjs (same
// algorithm, used for the Wallet passes). Used by guest-qr-standee.html and
// cafe-join.html.
(function () {
  // Logos bringen oft ihre eigene Hintergrundflaeche mit - entweder
  // fast unsichtbar halbtransparent oder deckend in einem Ton, der nur
  // beinahe der Cafe-Farbe entspricht (JPEG-Kompression, Farbprofil).
  // Auf der vollflaechigen Cafe-Farbe des Aufstellers zeichnet sich
  // das als sichtbares Rechteck ab. Deshalb: Fast-transparente Pixel
  // ganz durchsichtig machen und eine einfarbige Randflaeche per
  // Flood-Fill vom Bildrand aus entfernen. Bei Logos ohne einheitlichen
  // Rand (z. B. Fotos) bleibt das Bild unveraendert.
  function stripLogoBackground(url) {
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
          var i;

          for (i = 3; i < px.length; i += 4) {
            if (px[i] < 24) px[i] = 0;
          }

          // Randfarbe: Mittelwert aller deckenden Randpixel. Nur wenn
          // fast der ganze Rand nah an dieser Farbe liegt, gilt sie als
          // Hintergrund.
          var border = [];
          var x, y;
          for (x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
          for (y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
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
          var TOL = 28;
          function near(p, c) {
            return (
              Math.abs(px[p * 4] - c[0]) +
                Math.abs(px[p * 4 + 1] - c[1]) +
                Math.abs(px[p * 4 + 2] - c[2]) <=
              TOL
            );
          }
          if (opaque > border.length * 0.9) {
            var bg = sum.map(function (v) {
              return v / opaque;
            });
            var matching = border.filter(function (p) {
              return near(p, bg);
            }).length;
            if (matching > border.length * 0.9) {
              var seen = new Uint8Array(w * h);
              var stack = border.filter(function (p) {
                return near(p, bg);
              });
              while (stack.length) {
                var p = stack.pop();
                if (seen[p]) continue;
                seen[p] = 1;
                if (!near(p, bg)) continue;
                px[p * 4 + 3] = 0;
                var px0 = p % w;
                if (px0 > 0) stack.push(p - 1);
                if (px0 < w - 1) stack.push(p + 1);
                if (p >= w) stack.push(p - w);
                if (p < w * (h - 1)) stack.push(p + w);
              }
            }
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
