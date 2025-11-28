const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const APPS_DIR = __dirname;

const server = http.createServer((req, res) => {
  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

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
  if (pathname === "/cafe-scanner") pathname = "/cafe-scanner-new.html";
  if (pathname === "/cafe-onboarding") pathname = "/cafe-onboarding.html";

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
  console.log(
    `  📷 Café Scanner: http://localhost:${PORT}/cafe-scanner-new.html`
  );
  console.log(`  🔧 LAN Setup Helper: http://localhost:${PORT}/lan-setup.html`);
  console.log(
    `\n✨ Recommended: Use the Café Issuer and Customer QR apps. The dedicated scanner app is no longer required.`
  );
  console.log(`\n🔗 Make sure your API is also running: pnpm run dev`);
});
