import type { CapacitorConfig } from "@capacitor/cli";

// Remote-URL mode: the native shell loads the live deployed web app instead of
// a locally bundled copy, so every web deploy updates the app instantly with
// no store re-submission. Override via CAP_SERVER_URL for release (prod) CI
// builds; defaults to staging so local/dev builds are safe by default.
const serverOrigin = process.env.CAP_SERVER_URL || "https://staging.kaffeekarte.app";

const config: CapacitorConfig = {
  appId: "app.kaffeekarte.customer",
  appName: "Kaffeekarte",
  webDir: "www",
  server: {
    // Bare origin, no path: Capacitor's WKWebView navigation policy only
    // reliably keeps same-host navigation in-app when server.url is just
    // the origin - a full URL with a path here made every other in-app
    // page (profile, cafe profile, ...) get kicked out to Safari. Landing
    // on /wallet instead of the marketing page is handled client-side.
    url: serverOrigin,
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
  },
  plugins: {
    // @capacitor/splash-screen's own Android default is FIT_XY (see
    // SplashScreenConfig.java), which stretches non-uniformly instead of
    // preserving aspect ratio - that's what made the logo look distorted
    // on launch. CENTER_CROP fills the screen without stretching.
    SplashScreen: {
      androidScaleType: "CENTER_CROP",
    },
  },
};

export default config;
