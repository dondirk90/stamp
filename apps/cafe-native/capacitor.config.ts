import type { CapacitorConfig } from "@capacitor/cli";

// Remote-URL mode: the native shell loads the live deployed web app instead
// of a locally bundled copy, so every web deploy updates the app instantly
// with no store re-submission (same setup as apps/customer-native). Override
// via CAP_SERVER_URL for release (prod) CI builds; defaults to staging so
// local/dev builds are safe by default.
const serverOrigin = process.env.CAP_SERVER_URL || "https://staging.kaffeekarte.app";

const config: CapacitorConfig = {
  appId: "app.kaffeekarte.cafe",
  appName: "Kaffeekarte Barista",
  webDir: "www",
  server: {
    // Bare origin, no path: Capacitor's WKWebView navigation policy only
    // reliably keeps same-host navigation in-app when server.url is just
    // the origin - a full URL with a path here made every other in-app
    // page get kicked out to Safari (same finding as the customer app).
    // Landing on /cafe-scanner instead of the guest marketing page is
    // handled natively in MainViewController instead of client-side, since
    // both native apps load this exact same origin and JS alone can't tell
    // them apart.
    url: serverOrigin,
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
