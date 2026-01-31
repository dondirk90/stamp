const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const APPS_DIR = __dirname;
const API_TARGET_HOST = process.env.API_HOST || "127.0.0.1";
const API_TARGET_PORT = process.env.API_PORT
  ? Number(process.env.API_PORT)
  : 3000;

function setNoCache(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function proxyApi(req, res, parsedUrl) {
  // Proxy /api/* -> http://API_TARGET_HOST:API_TARGET_PORT/*
  const incomingPath = parsedUrl.pathname || "/";
  const upstreamPath = incomingPath.replace(/^\/api\b/, "") || "/";
  const upstreamUrl = upstreamPath + (parsedUrl.search || "");

  // Handle OPTIONS quickly
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        req.headers["access-control-request-headers"] ||
        "Content-Type, Authorization, x-api-key",
    });
    res.end();
    return;
  }

  const upstreamReq = http.request(
    {
      host: API_TARGET_HOST,
      port: API_TARGET_PORT,
      method: req.method,
      path: upstreamUrl,
      headers: {
        ...req.headers,
        host: `${API_TARGET_HOST}:${API_TARGET_PORT}`,
      },
    },
    (upstreamRes) => {
      // Mirror status + headers (but avoid caching)
      const headers = {
        ...upstreamRes.headers,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Access-Control-Allow-Origin": "*",
      };
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (err) => {
    res.writeHead(502, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        error: "api_proxy_error",
        message: String(err && err.message ? err.message : err),
      })
    );
  });

  req.pipe(upstreamReq);
}

function pickLanIpv4() {
  try {
    const nets = os.networkInterfaces();
    let best = null;
    let bestScore = -999;
    for (const name of Object.keys(nets || {})) {
      for (const net of nets[name] || []) {
        if (!net || net.family !== "IPv4" || net.internal) continue;
        const ip = String(net.address || "").trim();
        if (!ip) continue;

        const is192 = ip.startsWith("192.168.");
        const is10 = ip.startsWith("10.");
        const is172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);

        // Score network candidates: prefer typical WiFi/Ethernet LANs.
        let score = 0;
        if (is192) score += 30;
        else if (is10) score += 20;
        else if (is172) score += 10;

        const lname = String(name || "").toLowerCase();
        if (lname.includes("wi-fi") || lname.includes("wifi")) score += 6;
        if (lname.includes("ethernet")) score += 5;
        if (lname.includes("vethernet") || lname.includes("hyper-v"))
          score -= 25;
        if (lname.includes("wsl")) score -= 25;
        if (lname.includes("virtual")) score -= 10;

        if (score > bestScore) {
          bestScore = score;
          best = ip;
        }
      }
    }
    return best || null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Helper endpoint: return LAN IP for QR generation
  if (pathname === "/__lanip") {
    const ip = pickLanIpv4();
    const body = JSON.stringify({ ok: true, ip: ip || null, port: PORT });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
    return;
  }

  // Same-origin API proxy for LAN/mobile reliability
  if (pathname === "/api" || (pathname && pathname.startsWith("/api/"))) {
    proxyApi(req, res, parsedUrl);
    return;
  }

  // Allow requests that include the '/apps/' prefix (common when linking from other pages)
  if (pathname && pathname.startsWith("/apps/")) {
    pathname = pathname.replace(/^\/apps/, "");
  }

  // Default: index.html wenn Ordner angefordert
  if (pathname === "/" || pathname.endsWith("/")) {
    pathname = pathname === "/" ? "/lan-setup.html" : pathname + "index.html";
  }

  // Aliase ohne .html Endung für wichtige Seiten
  if (pathname === "/customer-register") pathname = "/customer-register.html";
  if (pathname === "/customer-home" || pathname === "/")
    pathname = "/customer-home.html";
  // Cafe scanner page: always serve the themed, maintained version
  if (pathname === "/cafe-scanner" || pathname === "/cafe-scanner.html")
    pathname = "/cafe-scanner-new.html";
  if (pathname === "/cafe-dashboard") pathname = "/cafe-dashboard.html";
  if (pathname === "/cafe-profile") pathname = "/cafe-profile.html";
  if (pathname === "/cafe-onboarding") pathname = "/cafe-onboarding.html";

  // Route legacy customer QR page to the modern UI
  if (pathname === "/customer-qr" || pathname === "/customer-qr.html") {
    pathname = "/customer-qr-modern.html";
  }

  // Security: Verhindere Directory Traversal
  const normalizedPath = path.normalize(pathname);
  if (normalizedPath.startsWith("..")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  const filePath = path.join(APPS_DIR, normalizedPath);

  // Prüfe ob Datei existiert und im APPS_DIR liegt
  if (!filePath.startsWith(APPS_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  // Versuche Datei zu lesen
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found: " + pathname);
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("500 Server Error");
      }
      return;
    }

    // Bestimme Content-Type
    const ext = path.extname(filePath).toLowerCase();
    let contentType = "text/plain";
    if (ext === ".html") contentType = "text/html; charset=utf-8";
    else if (ext === ".js")
      contentType = "application/javascript; charset=utf-8";
    else if (ext === ".json") contentType = "application/json; charset=utf-8";
    else if (ext === ".css") contentType = "text/css; charset=utf-8";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".svg") contentType = "image/svg+xml";

    // CORS Headers für Smartphone
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(content);
  });
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Error: Port ${PORT} already in use. Set PORT environment variable to a free port and restart.`
    );
  } else {
    console.error("Apps server error:", err && err.stack ? err.stack : err);
  }
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`📱 Apps Server running on http://localhost:${PORT}`);
  console.log(`📱 From Smartphone (same WiFi): http://<YOUR_LAN_IP>:${PORT}`);
  console.log(`📱 Example: http://192.168.1.100:${PORT}`);
  console.log(`\n📁 Available apps (recommended):`);
  console.log(
    `  🏪 Café Issuer (Enhanced): http://localhost:${PORT}/cafe-issuer-web.html`
  );
  console.log(
    `  🧾 Customer — Create QR: http://localhost:${PORT}/customer-qr.html`
  );
  console.log(
    `  🧾 Customer Register: http://localhost:${PORT}/customer-register.html`
  );
  console.log(`  📷 Café Scanner: http://localhost:${PORT}/cafe-scanner.html`);
  console.log(`  🔧 LAN Setup Helper: http://localhost:${PORT}/lan-setup.html`);
  console.log(
    `\n✨ Recommended: Use the Café Issuer and Customer QR apps. The dedicated scanner app is no longer required.`
  );
  console.log(`\n🔗 Make sure your API is also running: pnpm run dev`);
});
