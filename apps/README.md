# Stamp Card Apps

Two implementations of the Café QR Issuer and Customer Scanner apps:

- **Browser apps** (instant, no build required)
- **Expo React Native apps** (iOS/Android via Expo, under development)

---

## Browser Apps (Recommended for Quick Testing)

### Quick Start: Mobile + Desktop Flow

1. **📍 Find your Computer's LAN IP (Windows PowerShell):**

   ```powershell
   ipconfig
   ```

   Look for "IPv4-Adresse" under your WiFi adapter (e.g., `192.168.1.100`).

2. **Start the API server (on your Computer):**

   ```powershell
   cd C:\Users\dirkb\Documents\GitHub\stamp
   pnpm run dev
   ```

   Expected: `🚀 API listening on http://127.0.0.1:3000`

3. **Start the Apps Server (in a second terminal):**

   ```powershell
   cd C:\Users\dirkb\Documents\GitHub\stamp\apps
   node server.cjs
   ```

   Expected: `📱 Apps Server running on http://localhost:8080`

4. **Open the Apps:**
   - **On your Computer (Desktop):**
     - Café: `http://localhost:8080/cafe/`
     - Customer: `http://localhost:8080/customer/`
   - **On your Smartphone (same WiFi network):**
     - Café: `http://192.168.1.100:8080/cafe/` (replace `192.168.1.100` with your LAN IP)
     - Customer: `http://192.168.1.100:8080/customer/` (replace IP with yours)

### How to Use

#### Café Issuer (`apps/cafe/index.html`)

1. Set **API Base:**
   - Desktop/Localhost: `http://127.0.0.1:3000` (default).
   - Smartphone/LAN: Replace with your LAN IP, e.g., `http://192.168.1.100:3000`.
2. Verify **API Key:** `supersecret-dev-key` (default, must match your .env.local).
3. Optionally set **Café ID** (default: `cafetest-01`).
4. Set **TTL** (time-to-live in seconds, e.g., 60 or 300).
5. Click **"Issue QR"** — a QR code will be displayed with cafeId, nonce, expires.

#### Customer Scanner (`apps/customer/index.html`)

1. Set **API Base:** (same as Café, use LAN IP if on smartphone).
2. Enter **Customer Private Key** (test account: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`).
3. Click **"Start Camera"** — camera permission required.
4. **Scan the QR code** from the Café Issuer. The payload auto-populates.
5. Click **"Sign & Send"** — signature is created and posted to the API. Result shown.
6. Click **"Sign & Send"** — the app will:
   - Sign the payload using your private key (EIP‑712 StampRequest).
   - POST the signature and request to the API at `/stamp`.
   - Display the transaction result.

---

## End-to-End Flow (Browser)

### Desktop-Only Flow

1. Start the API server (`pnpm run dev`).
2. Open Café app in Browser Tab 1.
3. Open Customer app in Browser Tab 2.
4. In Tab 1: Click "Issue QR" and get a QR code.
5. In Tab 2: Enter customer private key, click "Start Camera", scan the QR from Tab 1.
6. In Tab 2: Click "Sign & Send" and verify the transaction succeeded.

### Mobile + Desktop Flow (Smartphone Testing)

1. **Computer:** Start API server (`pnpm run dev`).
2. **Computer:** Get LAN IP (`ipconfig` → IPv4-Adresse, e.g., `192.168.1.100`).
3. **Computer:** Open Café app in browser locally (e.g., `file:///C:/Users/dirkb/.../apps/cafe/index.html`).
   - Change API Base from `127.0.0.1:3000` to `192.168.1.100:3000`.
4. **Smartphone:** Open Café app in browser using `http://192.168.1.100` (same WiFi).
   - Click "Issue QR" and display the QR code on screen.
5. **Smartphone (second tab or device):** Open Customer app using same LAN IP.
   - Enter test private key.
   - Click "Start Camera" → scan the QR from step 4.
6. **Smartphone:** Click "Sign & Send" → transaction confirmed.

**💡 Tip:** Use `apps/lan-setup.html` for automatic IP detection and setup guidance.

---

## Expo React Native Apps

### Why Expo Apps?

- **iOS/Android support** without needing a full Mac setup (Expo Go for instant testing).
- **Native camera** and barcode scanning.
- Testable on physical iPhone via Expo Go or EAS Build.

### Current Status

- **Café iOS App** (`apps/cafe-ios/`): React Native UI to issue QRs.
- **Customer iOS App** (`apps/customer-ios/`): React Native UI with barcode scanner and signing.
- **Issue:** npm/pnpm registry errors and disk space constraints prevented local installs. Workaround: browser apps recommended for now.

### Future: Running Expo Apps Locally

Once disk space is available and npm registry is stable:

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp\apps\cafe-ios
npx expo start

# In another terminal:
cd C:\Users\dirkb\Documents\GitHub\stamp\apps\customer-ios
npx expo start
```

Then:

- **iOS Simulator:** Press `i` in the Expo CLI.
- **Expo Go on Physical iPhone:** Scan the QR code from Expo CLI with Expo Go app (https://expo.dev/go).
- **Web:** Press `w` in Expo CLI.

### Configuration for Physical iPhone

If running on a physical iPhone on the same WiFi:

- Get your machine's LAN IP: `ipconfig getifaddr en0` (Mac) or via Settings (Windows).
- Update the API Base in the app from `http://127.0.0.1:3000` to `http://<YOUR_LAN_IP>:3000`.
- Ensure the API server is accessible from your phone on the same network.

---

## Environment Variables

Both apps expect:

- **API Base URL:** `http://127.0.0.1:3000` (default in browser apps; change for LAN).
- **API Key:** `supersecret-dev-key` (set in your `.env.local` for the backend).
- **Contract Address:** `0x5FbDB2315678afecb367f032d93F642f64180aa3` (deployed StampCard contract).
- **Private Keys (Customer App):** Use Hardhat test account keys (see `scripts/` for examples).

---

## Test Accounts (Hardhat)

For local testing, use these Hardhat accounts:

- **Account #0 (Café):** Private Key = `0xac0974bec39a17e36ba4a6b4d238ff944bacb476caded54eafb0f85fb6fe5e0c`
- **Account #1 (Customer):** Private Key = `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- See Hardhat node output for all 20 accounts.

---

## Recommended Flow for Development

1. **Short-term (today):** Use browser apps (`apps/cafe/` & `apps/customer/`) — fastest, no build steps.
2. **Medium-term:** Fix npm registry issues and test Expo apps locally (`apps/cafe-ios/` & `apps/customer-ios/`).
3. **Long-term:** Build & deploy via EAS (Expo Application Services) for production iOS/Android TestFlight/PlayStore.

---

## Troubleshooting

### Browser Apps Not Connecting to API

- Ensure `pnpm run dev` is running and the API is listening on `http://127.0.0.1:3000`.
- Check browser console (F12) for CORS errors or network failures.
- Verify the API Key matches (`supersecret-dev-key`).

### Camera Not Working in Customer App

- Some browsers require HTTPS for camera access. Use `http://localhost` (not IP) or deploy with HTTPS.
- Check browser permissions for camera access.

### QR Scan Not Parsing Correctly

- Ensure the QR payload includes the `STAMP:` prefix (added by Café app automatically).
- If manual QR: format must be valid JSON like `{"cafeId":"0x...","nonce":"0x...","expires":12345}`.

### Expo Start Fails

- Clean cache: `npm cache clean --force` and `pnpm store prune`.
- Ensure Node.js version is >= 18: `node --version`.
- Free up disk space if ENOSPC errors appear.

---

## Next Steps

1. **Test the browser apps end-to-end** (recommended today).
2. **For production iPhone:** Investigate EAS Build or native iOS development (Xcode).
3. **For team testing:** Deploy web apps to a public URL (Vercel, Netlify, GitHub Pages).

Enjoy! 🚀
