const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");
const { pipeline } = require("stream");

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

  const incomingHost = req && req.headers ? String(req.headers.host || "") : "";
  const forwardedProtoHeader =
    req && req.headers ? String(req.headers["x-forwarded-proto"] || "") : "";
  const forwardedProto = forwardedProtoHeader
    .split(",")[0]
    .trim()
    .toLowerCase();

  // Handle OPTIONS quickly
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        req.headers["access-control-request-headers"] ||
        "Content-Type, Authorization",
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
        "x-forwarded-host": incomingHost,
        "x-forwarded-proto": forwardedProto === "https" ? "https" : "http",
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

      // If upstream emits an error (common with SSE disconnects), don't crash the process.
      upstreamRes.on("error", (err) => {
        try {
          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(502, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              Pragma: "no-cache",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(
              JSON.stringify({
                error: "api_upstream_error",
                message: String(err && err.message ? err.message : err),
              }),
            );
          }
        } catch {}
      });

      // Client disconnected mid-stream: make sure we stop reading from upstream.
      res.on("close", () => {
        try {
          upstreamRes.destroy();
        } catch {}
      });

      try {
        res.writeHead(upstreamRes.statusCode || 502, headers);
      } catch {
        // If headers were already sent, just pipe what we can.
      }

      pipeline(upstreamRes, res, () => {
        // Intentionally ignore pipeline errors here.
        // Typical causes: client disconnects (ECONNRESET) or upstream closes SSE.
      });
    },
  );

  // If the client goes away, stop the upstream request.
  res.on("close", () => {
    try {
      upstreamReq.destroy();
    } catch {}
  });
  req.on("aborted", () => {
    try {
      upstreamReq.destroy();
    } catch {}
  });
  req.on("error", () => {
    try {
      upstreamReq.destroy();
    } catch {}
  });

  upstreamReq.on("error", (err) => {
    try {
      if (res.headersSent || res.writableEnded) return;
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
        }),
      );
    } catch {}
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
  // Basic request log (helps diagnose LAN/phone reachability).
  try {
    const remoteAddr =
      (req && req.socket && req.socket.remoteAddress) || "(unknown)";
    const remotePort =
      (req && req.socket && req.socket.remotePort) || "(unknown)";
    console.log(`[REQ] ${remoteAddr}:${remotePort} ${req.method} ${req.url}`);
  } catch (e) {}

  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Human-friendly diagnostics page (useful on iPhone without devtools)
  if (pathname === "/__diag") {
    try {
      const ip = pickLanIpv4();
      const remoteAddr =
        (req && req.socket && req.socket.remoteAddress) || "(unknown)";
      const ua =
        req && req.headers ? String(req.headers["user-agent"] || "") : "";

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Stamp Diagnostics</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; margin: 18px; line-height: 1.4; }
      .box { border: 1px solid #ddd; border-radius: 12px; padding: 14px; margin: 12px 0; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      a { color: #175cd3; }
    </style>
  </head>
  <body>
    <h2>Diagnostics</h2>
    <div class="box">
      <div><b>Server</b>: ${ip || "(unknown)"}:${PORT}</div>
      <div><b>Remote</b>: ${remoteAddr}</div>
      <div><b>User-Agent</b>: <small>${ua.replace(/</g, "&lt;")}</small></div>
    </div>
    <div class="box">
      <div><a href="/__ping">Open /__ping</a></div>
      <div><a href="/customer-wallet">Open /customer-wallet</a></div>
      <div><a href="/lan-setup.html">Open /lan-setup.html</a></div>
    </div>
    <div class="box">
      <div>If you see this page on iPhone, LAN reachability is OK.</div>
    </div>
  </body>
</html>`;

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("diag_error");
    }
    return;
  }

  // Diagnostic endpoint: helps verify phone->PC reachability and shows remote address.
  if (pathname === "/__ping") {
    try {
      const remoteAddr =
        (req && req.socket && req.socket.remoteAddress) || "(unknown)";
      const remotePort =
        (req && req.socket && req.socket.remotePort) || "(unknown)";
      const ua =
        req && req.headers ? String(req.headers["user-agent"] || "") : "";
      const body = JSON.stringify(
        {
          ok: true,
          now: new Date().toISOString(),
          remoteAddress: remoteAddr,
          remotePort,
          method: req.method,
          url: req.url,
          userAgent: ua,
        },
        null,
        2,
      );

      console.log(
        `[PING] ${remoteAddr}:${remotePort} ${req.method} ${req.url} UA=${ua.slice(0, 80)}`,
      );

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ping_error");
    }
    return;
  }

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
    pathname = pathname === "/" ? "/index.html" : pathname + "index.html";
  }

  // Allow trailing slash access for single-page routes
  if (pathname === "/customer-profile/index.html")
    pathname = "/customer-profile.html";
  if (pathname === "/cafe/index.html") pathname = "/cafe-scanner-new.html";
  if (pathname === "/wallet/index.html") pathname = "/customer-qr-modern.html";
  if (pathname === "/impressum/index.html") pathname = "/impressum.html";
  if (pathname === "/datenschutz/index.html") pathname = "/datenschutz.html";
  if (pathname === "/agb/index.html") pathname = "/agb.html";
  if (pathname === "/fuer-cafes/index.html") pathname = "/fuer-cafes.html";

  // Aliase ohne .html Endung für wichtige Seiten
  if (pathname === "/customer-register") pathname = "/customer-qr-modern.html";
  if (pathname === "/customer-profile") pathname = "/customer-profile.html";
  if (pathname === "/customer-home" || pathname === "/customer-home.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/customer-start" || pathname === "/customer-start.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/customer-map" || pathname === "/customer-map.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/customer-wallet" || pathname === "/customer-wallet.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/wallet" || pathname === "/wallet.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/impressum") pathname = "/impressum.html";
  if (pathname === "/datenschutz") pathname = "/datenschutz.html";
  if (pathname === "/agb") pathname = "/agb.html";
  if (pathname === "/fuer-cafes") pathname = "/fuer-cafes.html";
  if (pathname === "/aufsteller") pathname = "/guest-qr-standee.html";
  if (pathname === "/customer-history" || pathname === "/customer-history.html")
    pathname = "/customer-qr-modern.html";
  if (pathname === "/cafe-public" || pathname === "/cafe-public.html")
    pathname = "/cafe-public.html";
  if (pathname === "/cafe" || pathname === "/cafe.html")
    pathname = "/cafe-scanner-new.html";
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
    if (pathname === "/.well-known/apple-app-site-association")
      contentType = "application/json; charset=utf-8";
    else if (ext === ".html") contentType = "text/html; charset=utf-8";
    else if (ext === ".js")
      contentType = "application/javascript; charset=utf-8";
    else if (ext === ".json") contentType = "application/json; charset=utf-8";
    else if (ext === ".webmanifest")
      contentType = "application/manifest+json; charset=utf-8";
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
      `Error: Port ${PORT} already in use. The Apps Server is likely already running.`,
    );
    console.error(
      `Tip: netstat -ano | findstr ":${PORT}"  then  taskkill /PID <PID> /F`,
    );
  } else {
    console.error("Apps server error:", err && err.stack ? err.stack : err);
  }
  if (err && err.code === "EADDRINUSE") process.exit(0);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  const lanIp = pickLanIpv4();
  console.log(`Apps Server running on http://localhost:${PORT}`);
  if (lanIp) {
    console.log(`From Smartphone (same WiFi): http://${lanIp}:${PORT}`);
  } else {
    console.log(`From Smartphone (same WiFi): http://<YOUR_LAN_IP>:${PORT}`);
    console.log(`Example: http://192.168.1.100:${PORT}`);
  }
  console.log(`\nAvailable apps (recommended):`);
  console.log(
    `  Café Issuer (Enhanced): http://localhost:${PORT}/cafe-issuer-web.html`,
  );
  console.log(
    `  Customer App (Wallet/QR): http://localhost:${PORT}/customer-wallet`,
  );
  console.log(`  Customer Profile: http://localhost:${PORT}/customer-profile`);
  console.log(`  Café Scanner: http://localhost:${PORT}/cafe-scanner`);
  console.log(`  LAN Setup Helper: http://localhost:${PORT}/lan-setup.html`);
  console.log(
    `\nRecommended: Use Customer Wallet + Café Scanner for stamping/redeeming.`,
  );
  console.log(`\nMake sure your API is also running: pnpm run dev`);
});
