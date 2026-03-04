import { chromium, devices } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8080";
const url = `${base}/customer-qr`;

async function run(name, contextOptions) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const consoleMsgs = [];
  const pageErrors = [];
  const scriptResponses = [];
  const reqFailed = [];

  page.on("console", (msg) => {
    try {
      consoleMsgs.push({
        type: msg.type(),
        text: msg.text(),
      });
    } catch {}
  });

  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  page.on("response", (res) => {
    try {
      const u = res.url();
      if (/\/customer-qr\.js(\?|$)/.test(u)) {
        scriptResponses.push({
          url: u,
          status: res.status(),
          contentType: res.headers()["content-type"] || null,
        });
      }
    } catch {}
  });

  page.on("requestfailed", (req) => {
    reqFailed.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || "(unknown)",
      resourceType: req.resourceType(),
    });
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });

  const snap = async () =>
    page.evaluate(() => {
      const t = (id) => document.getElementById(id);
      const login = t("modeLogin");
      const reg = t("modeRegister");
      const rf = t("registerFields");
      const cp = t("confirmPasswordWrap");
      const submit = t("authSubmit");
      const build = t("buildBadge");
      const cs = (el) => (el ? getComputedStyle(el).display : null);
      return {
        build: (build?.textContent || "").trim(),
        loginActive: !!login?.classList.contains("active"),
        regActive: !!reg?.classList.contains("active"),
        registerDisplay: cs(rf),
        confirmDisplay: cs(cp),
        submitText: (submit?.textContent || "").trim(),
      };
    });

  const before = await snap();

  const loginBtn = page.locator("#modeLogin");
  try {
    await loginBtn.tap({ timeout: 2000 });
  } catch {
    await loginBtn.click({ timeout: 2000 });
  }

  await page.waitForTimeout(150);
  const after = await snap();

  console.log(`\n[${name}] ${url}`);
  console.log("before:", before);
  console.log("after :", after);
  if (scriptResponses.length) {
    console.log("scriptResponses:", scriptResponses);
  } else {
    console.log("scriptResponses:", "(none)");
  }
  if (reqFailed.length) {
    console.log("requestfailed:", reqFailed.slice(0, 15));
  }
  if (pageErrors.length) {
    console.log("pageErrors:", pageErrors.slice(0, 10));
  }
  const errs = consoleMsgs.filter((m) => m.type === "error");
  if (errs.length) {
    console.log("consoleErrors:", errs.slice(0, 10));
  }

  await context.close();
  await browser.close();
}

const desktop = {
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

await run("desktop", desktop);
await run("iphone", { ...iPhone, colorScheme: "dark" });
