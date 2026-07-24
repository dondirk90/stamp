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
    url: `${serverOrigin}/wallet`,
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
