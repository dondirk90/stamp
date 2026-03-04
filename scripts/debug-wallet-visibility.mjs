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
  const http404 = new Set();

  page.on("response", (res) => {
    try {
      if (res.status() === 404) {
        http404.add(res.url());
      }
    } catch {
      // ignore
    }
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
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
    .waitForFunction(() => !!window.__STAMP_BOOT_OK, { timeout: 1400 })
    .catch(() => null);
  await page.waitForTimeout(150);

  const info = await page.evaluate(() => {
    const getJson = (key) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };

    const sessionV1 = getJson("customer_session_v1");
    const sessionV2 = getJson("customer_session_v2");
    const fav = getJson("customer_favorites_v1");

    const authPanel = document.querySelector("#authPanel");
    const mainPanel = document.querySelector("#mainPanel");
    const isVisible = (node) => {
      if (!node) return null;
      const cs = window.getComputedStyle(node);
      return cs.display !== "none" && cs.visibility !== "hidden";
    };

    const scroller = document.querySelector("#walletList");
    if (!scroller) return { ok: false, reason: "missing #walletList" };

    const cards = Array.from(scroller.querySelectorAll(".passCard"));
    const children = Array.from(scroller.children || [])
      .slice(0, 8)
      .map((n) => {
        try {
          return {
            tag: n.tagName ? n.tagName.toLowerCase() : null,
            id: n.id || null,
            className: n.className || null,
          };
        } catch {
          return { tag: null, id: null, className: null };
        }
      });
    const cardInfos = cards.map((card, idx) => {
      const r = card.getBoundingClientRect();
      const cs = window.getComputedStyle(card);
      return {
        idx,
        w: Math.round(r.width),
        h: Math.round(r.height),
        left: Math.round(r.left),
        top: Math.round(r.top),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        wheelOpacityVar: String(
          card.style.getPropertyValue("--wheel-opacity") || "",
        ).trim(),
        wheelTxVar: String(
          card.style.getPropertyValue("--wheel-tx") || "",
        ).trim(),
        zIndex: cs.zIndex,
      };
    });

    return {
      ok: true,
      sessionV1Ok: !!(sessionV1 && sessionV1.address),
      sessionV2Ok: !!(sessionV2 && sessionV2.address),
      favoritesCount: Array.isArray(fav) ? fav.length : 0,
      authPanelVisible: isVisible(authPanel),
      mainPanelVisible: isVisible(mainPanel),
      isStack: scroller.classList.contains("isStack"),
      childElementCount: scroller.childElementCount,
      childSample: children,
      cardCount: cards.length,
      scrollerDisplay: window.getComputedStyle(scroller).display,
      cardInfos,
    };
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        label,
        info,
        http404: Array.from(http404).slice(0, 20),
      },
      null,
      2,
    ),
  );

  await context.close();
  await browser.close();
}

await run("desktop", {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});

await run("iphone", iPhone);
