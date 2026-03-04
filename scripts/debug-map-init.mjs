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
  favorites: ["0x00000000000000000000000000000000000000c1"],
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
      localStorage.setItem(
        seedData.sessionKey,
        JSON.stringify(seedData.session),
      );
      localStorage.setItem(
        seedData.favoritesKey,
        JSON.stringify(seedData.favorites),
      );
    } catch {
      // ignore
    }
  }, seedSession);

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(String(e && e.message ? e.message : e)),
  );

  await page.goto(`${baseUrl}/customer-map`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => !!window.__STAMP_BOOT_OK, { timeout: 1400 })
    .catch(() => null);
  await page
    .waitForFunction(
      () => {
        const mapEl = document.querySelector("#cafeMap");
        const leafletAttached = !!(
          mapEl &&
          mapEl.classList &&
          mapEl.classList.contains("leaflet-container")
        );
        const listHasLinks = !!document.querySelector("#mapList a");
        const resultsHasLinks = !!document.querySelector("#cafeResults a");
        return leafletAttached || listHasLinks || resultsHasLinks;
      },
      { timeout: 1400 },
    )
    .catch(() => null);

  const result = await page.evaluate(() => {
    const mapEl = document.querySelector("#cafeMap");
    const listEl = document.querySelector("#mapList");
    const leafletAttached = !!(
      mapEl &&
      mapEl.classList &&
      mapEl.classList.contains("leaflet-container")
    );
    const listLinks = listEl ? listEl.querySelectorAll("a").length : 0;

    const searchEl = document.querySelector("#cafeSearch");
    const resultsEl = document.querySelector("#cafeResults");
    const resultLinks = resultsEl ? resultsEl.querySelectorAll("a").length : 0;
    const firstHref =
      resultsEl && resultsEl.querySelector("a")
        ? resultsEl.querySelector("a").getAttribute("href")
        : null;
    return {
      leafletAttached,
      listLinks,
      hasCafeSearch: !!searchEl,
      resultLinks,
      firstResultHref: firstHref,
      hasLeafletGlobal: !!(window.L && window.L.map),
    };
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ label, result, errors: errors.slice(0, 5) }, null, 2),
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
