# Stamp Card Apps

Browser-based apps served by the Apps Server (`apps/server.cjs`).

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

   Expected: `API listening on http://127.0.0.1:3000`

3. **Start the Apps Server (in a second terminal):**

   ```powershell
   cd C:\Users\dirkb\Documents\GitHub\stamp\apps
   node server.cjs
   ```

   Expected: `Apps Server running on http://localhost:8080`

4. **Open the Apps:**
   - **On your Computer (Desktop):**
     - Café Onboarding: `http://localhost:8080/cafe-onboarding`
     - Café Scanner: `http://localhost:8080/cafe-scanner`
     - Customer Register: `http://localhost:8080/customer-register`
   - Customer Wallet: `http://localhost:8080/customer-wallet`
   - **On your Smartphone (same WiFi network):**
     - Café Onboarding: `http://192.168.1.100:8080/cafe-onboarding` (replace `192.168.1.100` with your LAN IP)
     - Café Scanner: `http://192.168.1.100:8080/cafe-scanner`
   - Customer Wallet: `http://192.168.1.100:8080/customer-wallet`

### How to Use

#### Café

1. Open `http://localhost:8080/cafe-onboarding` and register your café.
2. Log in with **E-Mail + Passwort**.
3. Open `http://localhost:8080/cafe-scanner` and log in with E-Mail + Passwort.

#### Customer

1. Open `http://localhost:8080/customer-wallet`.
2. Register or log in (email + password).
3. Show the QR code to the café; the café opens the scanned link and can stamp/redeem.

---

## End-to-End Flow (Browser)

### Desktop-Only Flow

1. Start the API server (`pnpm run dev`).
2. Register a café: `http://localhost:8080/cafe-onboarding`.
3. Open Café scanner: `http://localhost:8080/cafe-scanner` and log in.
4. Open customer wallet: `http://localhost:8080/customer-wallet` and log in.
5. Show the customer QR to the café and stamp/redeem.

### Mobile + Desktop Flow (Smartphone Testing)

1. **Computer:** Start API server (`pnpm run dev`).
2. **Computer:** Get LAN IP (`ipconfig` → IPv4-Adresse, e.g., `192.168.1.100`).
3. **Computer:** Open Café onboarding: `http://localhost:8080/cafe-onboarding`.
   - Registriere dein Café und logge dich mit **E-Mail + Passwort** ein.
4. **Computer oder Smartphone:** Öffne den Café Scanner: `http://192.168.1.100:8080/cafe-scanner`.
   - Logge dich mit E-Mail + Passwort ein.
5. **Smartphone (Customer):** Öffne `http://192.168.1.100:8080/customer-wallet`.
   - Registrieren oder einloggen (E-Mail + Passwort) und QR anzeigen.
6. **Café:** Öffne/scannt den QR-Link und vergibt Stempel.

Tip: Use `apps/lan-setup.html` for automatic IP detection and setup guidance.

---

## Environment Variables

Both apps expect:

- **API Base URL:** `http://127.0.0.1:3000` (default in browser apps; change for LAN).
- **Café Login:** erfolgt über **E-Mail + Passwort** (Onboarding).

---

## Recommended Flow for Development

1. Use the browser apps (`/cafe-onboarding`, `/cafe-scanner`, `/customer-wallet`).
2. For mobile testing, use the same URLs via your LAN IP (see `/lan-setup.html`).

---

## Troubleshooting

### Browser Apps Not Connecting to API

- Ensure `pnpm run dev` is running and the API is listening on `http://127.0.0.1:3000`.
- Check browser console (F12) for CORS errors or network failures.
- If login fails, verify your E-Mail/Passwort and check the API logs.

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

Enjoy!
