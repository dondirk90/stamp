import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const baseUrl = getArgValue("--base") ?? "http://127.0.0.1:8080";
const noStart = process.argv.includes("--no-start");
const strict = process.argv.includes("--strict");

const outDir = path.join(repoRoot, "artifacts", "ui-check", "latest");

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOk(url, { timeoutMs = 20_000, intervalMs = 500 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${url}`);
    }
    await sleep(intervalMs);
  }
}

function tryStartAppsServer() {
  const child = spawn(process.execPath, ["apps/server.cjs"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let combined = "";
  const onData = (buf) => {
    combined += buf.toString("utf8");
    if (combined.length > 200_000) combined = combined.slice(-200_000);
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  return { child, getOutput: () => combined };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const failures = [];
  const consoleErrors = [];
  const notes = [];

  function recordFailure(name, message, extra) {
    failures.push({ name, message, extra: extra ?? null });
  }

  function recordNote(name, message, extra) {
    notes.push({ name, message, extra: extra ?? null });
  }

  let appsServer = null;
  let startedByScript = false;

  if (!noStart) {
    appsServer = tryStartAppsServer();
    startedByScript = true;

    // If port is already in use, server may exit quickly.
    // We'll still proceed if the base URL is reachable.
    appsServer.child.once("exit", (code) => {
      if (code && code !== 0) {
        // keep going; waitForOk will decide
      }
    });
  }

  await waitForOk(`${baseUrl}/customer-wallet`, { timeoutMs: 25_000 });

  const { chromium, devices } = await import("playwright");

  const logs = [];

  async function assertNoHorizontalOverflow(page, name) {
    const info = await page.evaluate(() => {
      const de = document.documentElement;
      const vw = de?.clientWidth ?? 0;
      const b = document.body;
      const deOverflow = (de?.scrollWidth ?? 0) - (de?.clientWidth ?? 0);
      const bodyOverflow = (b?.scrollWidth ?? 0) - (b?.clientWidth ?? 0);

      const offenders = [];
      try {
        const nodes = Array.from(document.querySelectorAll("body *"));
        for (const el of nodes) {
          if (!el || !(el instanceof Element)) continue;
          const r = el.getBoundingClientRect();
          if (!r || !Number.isFinite(r.right) || !Number.isFinite(r.left))
            continue;
          if (r.width < 1) continue;
          if (r.right <= vw + 2 && r.left >= -2) continue;

          const id = el.id ? `#${el.id}` : "";
          const cls =
            el.classList && el.classList.length
              ? "." + Array.from(el.classList).slice(0, 3).join(".")
              : "";
          const label = id || cls || el.tagName.toLowerCase();
          const txt = (el.textContent || "").trim().slice(0, 80);

          offenders.push({
            label,
            tag: el.tagName.toLowerCase(),
            right: Math.round(r.right),
            left: Math.round(r.left),
            width: Math.round(r.width),
            scrollWidth: el.scrollWidth ?? null,
            clientWidth: el.clientWidth ?? null,
            text: txt || null,
          });

          if (offenders.length >= 12) break;
        }
      } catch {
        // ignore
      }
      return {
        vw,
        deClientWidth: de?.clientWidth ?? 0,
        deScrollWidth: de?.scrollWidth ?? 0,
        bodyClientWidth: b?.clientWidth ?? 0,
        bodyScrollWidth: b?.scrollWidth ?? 0,
        deOverflow,
        bodyOverflow,
        offenders,
      };
    });

    const allowedPx = 2;
    if (info.deOverflow > allowedPx || info.bodyOverflow > allowedPx) {
      recordFailure(name, "Horizontal overflow detected", info);
    }
  }

  async function assertVisible(page, name, selector, label) {
    const loc = page.locator(selector);
    const count = await loc.count();
    if (!count) {
      recordFailure(name, `Missing element: ${label}`, { selector });
      return;
    }
    try {
      await loc.first().waitFor({ state: "visible", timeout: 3000 });
    } catch {
      recordFailure(name, `Element not visible: ${label}`, { selector });
    }
  }

  async function assertExists(page, name, selector, label) {
    const loc = page.locator(selector);
    const count = await loc.count();
    if (!count) {
      recordFailure(name, `Missing element: ${label}`, { selector });
    }
  }

  async function assertAuthToggle(page, name) {
    const authPanelVisible = await page.evaluate(() => {
      const node = document.querySelector("#authPanel");
      if (!node) return false;
      const cs = window.getComputedStyle(node);
      return cs.display !== "none" && cs.visibility !== "hidden";
    });

    if (!authPanelVisible) {
      recordNote(name, "Auth checks skipped: authPanel not visible", null);
      return;
    }

    await assertVisible(page, name, "#modeRegister", "Register tab button");
    await assertVisible(page, name, "#modeLogin", "Login tab button");
    await assertVisible(page, name, "#authSubmit", "Auth submit button");
    await assertExists(page, name, "#registerFields", "Register fields");
    await assertExists(
      page,
      name,
      "#confirmPasswordWrap",
      "Confirm password wrapper",
    );

    const snap = await page.evaluate(() => {
      const byId = (id) => document.getElementById(id);
      const login = byId("modeLogin");
      const reg = byId("modeRegister");
      const rf = byId("registerFields");
      const cp = byId("confirmPasswordWrap");
      const submit = byId("authSubmit");

      const displayOf = (el) => {
        if (!el) return null;
        return window.getComputedStyle(el).display;
      };

      return {
        loginActive: !!login?.classList.contains("active"),
        regActive: !!reg?.classList.contains("active"),
        registerDisplay: displayOf(rf),
        confirmDisplay: displayOf(cp),
        submitText: (submit?.textContent || "").trim(),
      };
    });

    const tapOrClick = async (selector) => {
      const loc = page.locator(selector);
      if (!(await loc.count())) return;
      try {
        await loc.tap({ timeout: 2_000 });
      } catch {
        await loc.click({ timeout: 2_000 });
      }
    };

    // Switch to login
    await tapOrClick("#modeLogin");
    await page.waitForTimeout(100);
    const afterLogin = await page.evaluate(() => {
      const byId = (id) => document.getElementById(id);
      const login = byId("modeLogin");
      const reg = byId("modeRegister");
      const rf = byId("registerFields");
      const cp = byId("confirmPasswordWrap");
      const submit = byId("authSubmit");
      const displayOf = (el) =>
        el ? window.getComputedStyle(el).display : null;
      return {
        loginActive: !!login?.classList.contains("active"),
        regActive: !!reg?.classList.contains("active"),
        registerDisplay: displayOf(rf),
        confirmDisplay: displayOf(cp),
        submitText: (submit?.textContent || "").trim(),
      };
    });

    if (!afterLogin.loginActive || afterLogin.regActive) {
      recordFailure(name, "Auth toggle failed: login tab not active", {
        before: snap,
        afterLogin,
      });
    }
    if (afterLogin.registerDisplay !== "none") {
      recordFailure(name, "Auth toggle failed: register fields still visible", {
        before: snap,
        afterLogin,
      });
    }
    if (afterLogin.confirmDisplay !== "none") {
      recordFailure(
        name,
        "Auth toggle failed: confirm-password still visible",
        { before: snap, afterLogin },
      );
    }
    if (!/Einloggen/i.test(afterLogin.submitText)) {
      recordFailure(name, "Auth toggle failed: submit text not set to login", {
        before: snap,
        afterLogin,
      });
    }

    // Switch back to register
    await tapOrClick("#modeRegister");
    await page.waitForTimeout(100);
    const afterRegister = await page.evaluate(() => {
      const byId = (id) => document.getElementById(id);
      const login = byId("modeLogin");
      const reg = byId("modeRegister");
      const rf = byId("registerFields");
      const cp = byId("confirmPasswordWrap");
      const submit = byId("authSubmit");
      const displayOf = (el) =>
        el ? window.getComputedStyle(el).display : null;
      return {
        loginActive: !!login?.classList.contains("active"),
        regActive: !!reg?.classList.contains("active"),
        registerDisplay: displayOf(rf),
        confirmDisplay: displayOf(cp),
        submitText: (submit?.textContent || "").trim(),
      };
    });

    if (!afterRegister.regActive || afterRegister.loginActive) {
      recordFailure(name, "Auth toggle failed: register tab not active", {
        before: snap,
        afterRegister,
      });
    }
    if (afterRegister.registerDisplay === "none") {
      recordFailure(name, "Auth toggle failed: register fields hidden", {
        before: snap,
        afterRegister,
      });
    }
    if (afterRegister.confirmDisplay === "none") {
      recordFailure(name, "Auth toggle failed: confirm-password hidden", {
        before: snap,
        afterRegister,
      });
    }
    if (!/Account erstellen/i.test(afterRegister.submitText)) {
      recordFailure(
        name,
        "Auth toggle failed: submit text not set to register",
        { before: snap, afterRegister },
      );
    }
  }

  async function assertWalletCarousel(page, name) {
    const info = await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      if (!scroller) return { ok: false, reason: "missing #walletList" };
      const cs = window.getComputedStyle(scroller);
      const isStack = scroller.classList.contains("isStack");

      const cards = Array.from(scroller.querySelectorAll(".passCard"));
      const visibleCards = cards.filter((card) => {
        try {
          const r = card.getBoundingClientRect();
          if (!r || r.width < 10 || r.height < 10) return false;
          const s = window.getComputedStyle(card);
          const op = Number.parseFloat(String(s.opacity || "1"));
          if (s.display === "none" || s.visibility === "hidden") return false;
          return op > 0.5;
        } catch {
          return false;
        }
      });
      return {
        ok: true,
        isStack,
        display: cs.display,
        overflowX: cs.overflowX,
        scrollSnapType: cs.scrollSnapType,
        touchAction: cs.touchAction,
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        scrollLeft: scroller.scrollLeft,
        cardCount: cards.length,
        visibleCardCount: visibleCards.length,
      };
    });

    if (!info.ok) {
      recordFailure(name, "Wallet carousel missing", info);
      return;
    }

    if (info.isStack) {
      const overflowOk = String(info.overflowX || "") === "hidden";
      if (!overflowOk) {
        recordFailure(name, "Wallet stack should have overflow-x hidden", info);
      }
      if ((info.cardCount || 0) > 0) {
        const v = Number(info.visibleCardCount || 0);
        if (!(v === 1)) {
          recordFailure(
            name,
            "Wallet stack should show exactly 1 visible card",
            info,
          );
        }
      }
      return;
    }

    const snapOk =
      String(info.scrollSnapType || "").includes("x") &&
      String(info.scrollSnapType || "").includes("mandatory");
    if (!snapOk) {
      recordFailure(name, "Wallet carousel missing scroll snap", info);
    }

    const overflowOk =
      String(info.overflowX || "") === "auto" ||
      String(info.overflowX || "") === "scroll";
    if (!overflowOk) {
      recordFailure(name, "Wallet carousel overflow-x not scrollable", info);
    }

    if (!(info.scrollWidth > info.clientWidth + 2)) {
      // This can be OK if wallet is empty; we only warn if there's more than one card.
      // Keep as a soft check by not failing here.
    }
  }

  async function maybeScrollWallet(page, name) {
    const mode = await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      return scroller && scroller.classList.contains("isStack")
        ? "stack"
        : "carousel";
    });

    if (mode === "stack") return;

    const before = await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      return scroller ? Number(scroller.scrollLeft || 0) : 0;
    });

    await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      if (!scroller) return;
      scroller.scrollBy({ left: 220, top: 0, behavior: "instant" });
    });

    // Allow scroll handlers / rAF effects (wheel/deck transforms) to apply.
    await page.waitForTimeout(120);

    const after = await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      return scroller ? Number(scroller.scrollLeft || 0) : 0;
    });

    if (after < before) {
      recordFailure(name, "Wallet scrollLeft moved backwards unexpectedly", {
        before,
        after,
      });
    }
  }

  async function assertWalletDeckEffectApplied(page, name) {
    const info = await page.evaluate(() => {
      const scroller = document.querySelector("#walletList");
      if (!scroller) return { ok: false, reason: "missing #walletList" };

      if (scroller.classList.contains("isStack")) {
        const cards = Array.from(scroller.querySelectorAll(".passCard"));
        const visible = cards.filter((card) => {
          try {
            const r = card.getBoundingClientRect();
            if (!r || r.width < 10 || r.height < 10) return false;
            const s = window.getComputedStyle(card);
            const op = Number.parseFloat(String(s.opacity || "1"));
            if (s.display === "none" || s.visibility === "hidden") return false;
            return op > 0.5;
          } catch {
            return false;
          }
        });
        return { ok: true, stack: true, visibleCount: visible.length };
      }

      const cards = Array.from(scroller.querySelectorAll(".passCard"));
      if (cards.length < 2) {
        return { ok: true, skipped: true, reason: "<2 cards" };
      }

      const vw = document.documentElement?.clientWidth ?? 0;
      const visible = cards
        .map((card) => {
          const r = card.getBoundingClientRect();
          const inView = r.width > 10 && r.right > 0 && r.left < vw;
          return {
            inView,
            tx: String(card.style.getPropertyValue("--wheel-tx") || "").trim(),
            rz: String(card.style.getPropertyValue("--wheel-rz") || "").trim(),
          };
        })
        .filter((x) => x.inView);

      if (!visible.length) {
        return { ok: true, skipped: true, reason: "no visible cards" };
      }

      function num(v) {
        const n = Number.parseFloat(String(v || "0"));
        return Number.isFinite(n) ? n : 0;
      }

      const anyApplied = visible.some(
        (v) => Math.abs(num(v.tx)) > 0.5 || Math.abs(num(v.rz)) > 0.05,
      );
      return { ok: true, anyApplied, sample: visible.slice(0, 6) };
    });

    if (!info.ok) {
      recordFailure(name, "Wallet deck effect check failed", info);
      return;
    }
    if (info.stack) {
      const v = Number(info.visibleCount || 0);
      if (!(v === 1)) {
        recordFailure(
          name,
          "Wallet stack should show exactly 1 visible card",
          info,
        );
      }
      return;
    }

    if (info.skipped) {
      recordNote(
        name,
        `Wallet deck effect check skipped: ${info.reason}`,
        info,
      );
      return;
    }
    if (!info.anyApplied) {
      recordFailure(
        name,
        "Wallet deck effect not applied (expected non-zero --wheel-tx/--wheel-rz)",
        info,
      );
    }
  }

  async function capture(name, contextOptions, interactions, checks) {
    const browser = await chromium.launch();
    const context = await browser.newContext(contextOptions);

    if (checks && checks.seedSession) {
      const seed = checks.seedSession;
      await context.addInitScript((seedData) => {
        try {
          if (seedData.sessionKey && seedData.session) {
            localStorage.setItem(
              seedData.sessionKey,
              JSON.stringify(seedData.session),
            );
          }
          if (seedData.favoritesKey && Array.isArray(seedData.favorites)) {
            localStorage.setItem(
              seedData.favoritesKey,
              JSON.stringify(seedData.favorites),
            );
          }
        } catch {
          // ignore
        }
      }, seed);
    }
    const page = await context.newPage();

    let hadConsoleError = false;

    page.on("console", (msg) => {
      logs.push(`[${name}] console.${msg.type()}: ${msg.text()}`);
      if (msg.type() === "error") {
        hadConsoleError = true;
        consoleErrors.push({ name, text: msg.text() });
      }
    });
    page.on("pageerror", (err) => {
      logs.push(`[${name}] pageerror: ${err?.message ?? String(err)}`);
      hadConsoleError = true;
      consoleErrors.push({ name, text: err?.message ?? String(err) });
    });

    const startPath = (checks && checks.startPath) || "/customer-wallet";
    await page.goto(`${baseUrl}${startPath}`, {
      waitUntil: "domcontentloaded",
    });

    if (interactions) {
      await interactions(page);
    }

    await assertNoHorizontalOverflow(page, name);
    await assertVisible(page, name, ".topMenu", "Top menu");
    await assertVisible(page, name, "#mainModeWallet", "Wallet tab button");
    await assertAuthToggle(page, name);

    if (checks && checks.wallet) {
      const mainPanelVisible = await page.evaluate(() => {
        const node = document.querySelector("#mainPanel");
        if (!node) return false;
        const cs = window.getComputedStyle(node);
        return (
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          cs.opacity !== "0"
        );
      });

      if (!mainPanelVisible) {
        recordNote(
          name,
          "Wallet checks skipped: mainPanel not visible (not authed)",
          null,
        );
      } else {
        await assertVisible(page, name, "#walletPanel", "Wallet panel");
        await assertWalletCarousel(page, name);
        await maybeScrollWallet(page, name);
        await assertWalletDeckEffectApplied(page, name);
      }
    }

    if (checks && checks.history) {
      const mainPanelVisible = await page.evaluate(() => {
        const node = document.querySelector("#mainPanel");
        if (!node) return false;
        const cs = window.getComputedStyle(node);
        return (
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          cs.opacity !== "0"
        );
      });

      if (!mainPanelVisible) {
        recordNote(
          name,
          "History checks skipped: mainPanel not visible (not authed)",
          null,
        );
      } else {
        await assertVisible(page, name, "#historyPanel", "History panel");
        await assertExists(page, name, "#historyList", "History list");
      }
    }

    if (strict && hadConsoleError) {
      recordFailure(name, "Console error(s) detected", null);
    }

    await page.screenshot({
      path: path.join(outDir, `${name}.png`),
      fullPage: true,
    });

    await context.close();
    await browser.close();
  }

  const desktopContext = {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  };

  const iPhone = devices["iPhone 14"] ?? {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  };

  const seedSession = {
    sessionKey: "customer_session_v1",
    favoritesKey: "customer_favorites_v1",
    session: {
      address: "0x0000000000000000000000000000000000000001",
      email: "ui-check@example.invalid",
      username: "UI Check",
    },
    favorites: [
      "0x00000000000000000000000000000000000000c1",
      "0x00000000000000000000000000000000000000c2",
      "0x00000000000000000000000000000000000000c3",
    ],
  };

  await capture("desktop-home", desktopContext, null, {
    wallet: false,
    startPath: "/customer-wallet",
  });

  await capture(
    "desktop-auth-login",
    desktopContext,
    async (page) => {
      const loginBtn = page.locator("#modeLogin");
      if (await loginBtn.count()) {
        try {
          await loginBtn.tap({ timeout: 2_000 });
        } catch {
          await loginBtn.click({ timeout: 2_000 });
        }
      }
      await page.waitForTimeout(250);
    },
    { wallet: false, startPath: "/customer-wallet" },
  );

  await capture(
    "desktop-wallet",
    desktopContext,
    null,
    { wallet: true, startPath: "/customer-wallet" },
  );

  await capture(
    "desktop-authed-wallet",
    desktopContext,
    null,
    { wallet: true, seedSession, startPath: "/customer-wallet" },
  );

  await capture(
    "desktop-authed-history",
    desktopContext,
    null,
    { history: true, seedSession, startPath: "/customer-history" },
  );

  await capture("mobile-home", { ...iPhone, colorScheme: "dark" }, null, {
    wallet: false,
    startPath: "/customer-wallet",
  });

  await capture(
    "mobile-auth-login",
    { ...iPhone, colorScheme: "dark" },
    async (page) => {
      const loginBtn = page.locator("#modeLogin");
      if (await loginBtn.count()) {
        try {
          await loginBtn.tap({ timeout: 2_000 });
        } catch {
          await loginBtn.click({ timeout: 2_000 });
        }
      }
      await page.waitForTimeout(250);
    },
    { wallet: false, startPath: "/customer-wallet" },
  );

  await capture(
    "mobile-wallet",
    { ...iPhone, colorScheme: "dark" },
    null,
    { wallet: true, startPath: "/customer-wallet" },
  );

  await capture(
    "mobile-authed-wallet",
    { ...iPhone, colorScheme: "dark" },
    null,
    { wallet: true, seedSession, startPath: "/customer-wallet" },
  );

  await writeFile(
    path.join(outDir, "console.txt"),
    logs.join("\n") + (logs.length ? "\n" : ""),
    "utf8",
  );

  await writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(
      {
        baseUrl,
        strict,
        at: new Date().toISOString(),
        failures,
        notes,
        consoleErrors,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  if (appsServer && startedByScript) {
    // If we successfully started a server, close it.
    // If it failed due to EADDRINUSE, this likely isn't our process.
    const out = appsServer.getOutput();
    const looksLikeAddrInUse = /EADDRINUSE|already in use/i.test(out);
    if (!looksLikeAddrInUse) {
      appsServer.child.kill("SIGTERM");
    }
  }

  console.log(`Screenshots written to: ${outDir}`);
  if (failures.length) {
    console.error(
      `UI check failed (${failures.length} issues). See report.json`,
    );
    process.exitCode = 1;
  }
}

await main();
