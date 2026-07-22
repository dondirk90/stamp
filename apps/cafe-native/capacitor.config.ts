import type { CapacitorConfig } from "@capacitor/cli";

// Spike only (see native-apps plan, Phase A step 2): de-risk whether the
// cafe scanner's existing getUserMedia()-based QR scanning actually gets
// camera permission and works inside Capacitor's WebView bridge, on a real
// device, before building out full CI/store tooling for this app.
const serverUrl = process.env.CAP_SERVER_URL || "https://staging.kaffeekarte.app/cafe";

const config: CapacitorConfig = {
  appId: "app.kaffeekarte.cafe",
  appName: "Kaffeekarte Cafe (Spike)",
  webDir: "www",
  server: {
    url: serverUrl,
    cleartext: false,
  },
};

export default config;
