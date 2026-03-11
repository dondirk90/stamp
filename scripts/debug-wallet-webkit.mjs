import process from "node:process";

const baseUrl = process.argv[2] || "http://127.0.0.1:8080";

const { webkit, devices } = await import("playwright");

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

const iPhone = devices["iPhone 14"] ?? {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

async function run(label, contextOptions) {
  const browser = await webkit.launch();
  const context = await browser.newContext(contextOptions);

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
  }, seedSession);

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      // eslint-disable-next-line no-console
      console.log(`[${label}] console.${msg.type()}: ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    // eslint-disable-next-line no-console
    console.log(
      `[${label}] pageerror: ${String(err && err.message ? err.message : err)}`,
    );
  });

  await page.goto(`${baseUrl}/customer-wallet`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .waitForFunction(() => !!window.__STAMP_BOOT_OK, { timeout: 1200 })
    .catch(() => null);
  await page.waitForTimeout(150);

  const state = await page.evaluate(() => {
    const overlay = document.querySelector("#bootOverlay");
    const authPanel = document.querySelector("#authPanel");
    const mainPanel = document.querySelector("#mainPanel");

    const visible = (node) => {
      if (!node) return null;
      const cs = window.getComputedStyle(node);
      return (
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        cs.opacity !== "0"
      );
    };

    return {
      bootOk: !!window.__STAMP_BOOT_OK,
      overlayVisible: visible(overlay),
      authPanelVisible: visible(authPanel),
      mainPanelVisible: visible(mainPanel),
      walletCardCount: document.querySelectorAll("#walletList .passCard")
        .length,
    };
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ label, state }, null, 2));

  await context.close();
  await browser.close();
}

await run("webkit-desktop", {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});

await run("webkit-iphone", iPhone);
