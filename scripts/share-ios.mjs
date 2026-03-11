import process from "node:process";
import localtunnel from "localtunnel";
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";

const base = process.env.STAMP_BASE_URL || "http://127.0.0.1:8080";

async function tryGetLanUrl() {
  try {
    const res = await fetch(`${base}/__lanip`, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    const ip = data && data.ip ? String(data.ip) : "";
    const port = data && data.port ? Number(data.port) : 8080;
    if (!ip) return null;
    return {
      ip,
      port,
      appUrl: `http://${ip}:${port}/customer-wallet`,
      pingUrl: `http://${ip}:${port}/__ping`,
    };
  } catch {
    return null;
  }
}

async function main() {
  const wantTunnel = !process.argv.includes("--no-tunnel");
  const wantOpen = process.argv.includes("--open");
  const wantCopy = process.argv.includes("--copy") || wantOpen;
  const tunnelMode = (() => {
    const idx = process.argv.indexOf("--tunnel");
    if (idx !== -1) return String(process.argv[idx + 1] || "").trim();
    const arg = process.argv.find((x) =>
      String(x || "").startsWith("--tunnel="),
    );
    if (!arg) return "auto";
    return String(arg).split("=")[1] || "auto";
  })();

  const lan = await tryGetLanUrl();
  if (lan) {
    console.log(`LAN (iPhone im selben WLAN): ${lan.appUrl}`);
    console.log(`LAN Ping (soll JSON zeigen): ${lan.pingUrl}`);
    console.log(
      "Wenn /__ping am iPhone NICHT lädt: Router/WLAN blockt Client-to-Client (Guest/AP-Isolation) oder Firewall. Dann ist der Tunnel die nachhaltige Lösung.",
    );
  } else {
    console.log(
      "LAN URL konnte nicht ermittelt werden (läuft apps/server.cjs auf 8080?)",
    );
  }

  if (!wantTunnel) return;

  const runPwsh = (args) =>
    new Promise((resolve) => {
      try {
        const child = spawn(
          "powershell",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ...args],
          { stdio: "ignore" },
        );
        child.on("exit", () => resolve());
        child.on("error", () => resolve());
      } catch {
        resolve();
      }
    });

  const postUrl = async (publicUrl) => {
    if (!publicUrl) return;
    if (wantCopy) {
      await runPwsh([
        `Set-Clipboard -Value '${String(publicUrl).replace(/'/g, "''")}'`,
      ]);
      console.log("(Public URL in Zwischenablage kopiert)");
    }
    if (wantOpen) {
      await runPwsh([
        `Start-Process '${String(publicUrl).replace(/'/g, "''")}'`,
      ]);
      console.log("(Public URL im Browser geöffnet)");
    }
  };

  async function startLocaltunnel() {
    console.log(
      "\nStarte Tunnel via localtunnel (funktioniert ohne Admin, braucht Internet)…",
    );
    const timeoutMs = 15_000;
    const tunnel = await Promise.race([
      localtunnel({ port: 8080, local_host: "127.0.0.1" }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`localtunnel timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    const publicUrl = `${tunnel.url}/customer-wallet`;
    console.log(`Public (iPhone überall): ${publicUrl}`);
    await postUrl(publicUrl);
    console.log("Tunnel läuft. Zum Beenden: Strg+C");
    tunnel.on("close", () => console.log("Tunnel geschlossen"));
    return { kind: "localtunnel", publicUrl };
  }

  async function ensureCloudflaredExe() {
    const binDir = path.join(process.cwd(), "scripts", ".bin");
    const exePath = path.join(binDir, "cloudflared.exe");
    try {
      const s = await stat(exePath);
      if (s && s.size > 200_000) return exePath;
    } catch {}

    await mkdir(binDir, { recursive: true });
    const downloadUrl =
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    console.log(`\nLade cloudflared (einmalig) herunter: ${downloadUrl}`);
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`cloudflared download failed (HTTP ${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(exePath, buf);
    return exePath;
  }

  async function startCloudflared() {
    console.log(
      "\nStarte Tunnel via Cloudflare Quick Tunnel (sehr zuverlässig, braucht Internet)…",
    );
    const exe = await ensureCloudflaredExe();
    const child = spawn(
      exe,
      ["tunnel", "--url", "http://127.0.0.1:8080", "--no-autoupdate"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let publicUrl = "";
    const seen = new Set();
    const onLine = async (line) => {
      const s = String(line || "").trim();
      if (!s) return;
      if (!seen.has(s)) {
        seen.add(s);
        console.log(s);
      }
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !publicUrl) {
        publicUrl = `${m[0]}/customer-wallet`;
        console.log(`Public (iPhone überall): ${publicUrl}`);
        await postUrl(publicUrl);
        console.log("Tunnel läuft. Zum Beenden: Strg+C");
      }
    };

    child.stdout.on("data", (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) onLine(line);
    });
    child.stderr.on("data", (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) onLine(line);
    });
    child.on("exit", (code) => {
      if (!publicUrl) {
        console.error(`cloudflared exited (code ${code ?? "?"}) before URL`);
        process.exitCode = code || 1;
      }
    });
    return { kind: "cloudflared", publicUrl };
  }

  const mode = tunnelMode || "auto";
  try {
    if (mode === "localtunnel") {
      await startLocaltunnel();
      return;
    }
    if (mode === "cloudflared") {
      await startCloudflared();
      return;
    }

    // auto
    try {
      await startLocaltunnel();
      return;
    } catch (e) {
      console.error(
        `localtunnel fehlgeschlagen: ${String(e && e.message ? e.message : e)}`,
      );
      console.error("Wechsle zu Cloudflare Quick Tunnel…");
      await startCloudflared();
      return;
    }
  } catch (e) {
    console.error(
      `Tunnel konnte nicht gestartet werden: ${String(e && e.message ? e.message : e)}`,
    );
    console.error(
      "Hinweis: Das benötigt Internet. Falls das dauerhaft fehlschlägt, prüfe Proxy/VPN/Firewall oder versuche es später erneut.",
    );
    process.exitCode = 1;
    return;
  }
}

await main();
