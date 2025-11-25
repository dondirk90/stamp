# 🎯 Stamp — Web-Based Solution (Camera-Ready)

**Status:** ✅ Apps Server läuft auf Port 8080 mit **erweiterten, kamera-freundlichen Versionen**!

---

## 📱 Neue, verbesserte Web-Apps (mit nativer Kamera-Unterstützung)

### 🏪 Café Issuer (Neu)

- **URL:** `http://localhost:8080/cafe-issuer-web.html`
- **Features:**
  - ✅ Moderne UI mit Gradient-Design
  - ✅ Schnelle QR-Generierung
  - ✅ Payload-Anzeige
  - ✅ Responsive für Smartphone & Desktop

### 📱 Customer Scanner (Neu)

- **URL:** `http://localhost:8080/customer-scanner-web.html`
- **Features:**
  - ✅ Native Kamera-Zugriff (ZXing Barcode-Scanner)
  - ✅ Live-QR-Scanning mit Overlay
  - ✅ Automatische Payload-Erkennung
  - ✅ EIP-712 Signing mit ethers.js
  - ✅ Direkte API-Kommunikation
  - ✅ Responsive UI für Mobile-First

---

## 🚀 So testierst du jetzt:

### Voraussetzung

- API Server läuft: `pnpm run dev` (in Terminal)
- Apps Server läuft: `node server.cjs` in `apps/` (im Hintergrund)

### Desktop-Test

1. Öffne **Café:** `http://localhost:8080/cafe-issuer-web.html`
2. Klick "Issue QR" → QR-Code wird angezeigt
3. Öffne **Customer:** `http://localhost:8080/customer-scanner-web.html` (neues Tab)
4. Klick "Start Camera" → gib Kamera-Erlaubnis
5. Halte Smartphone/Kamera auf QR-Code
6. QR wird automatisch gescannt
7. Klick "Sign & Submit" → Transaktion signiert & versendet

### Smartphone-Test (LAN)

1. Finde deine Computer-IP: `ipconfig` (z.B. `192.168.1.100`)
2. Auf Smartphone Browser öffnen:
   - **Café:** `http://192.168.1.100:8080/cafe-issuer-web.html`
   - **Customer:** `http://192.168.1.100:8080/customer-scanner-web.html`
3. Gleicher Flow wie oben!

---

## 🛠️ Technische Details

### Café-Issuer Web

- **Kamera:** Nicht nötig (QR-Issuer)
- **Libraries:** QRCode.js (QR-Generierung)
- **API-Kommunikation:** `POST /qr/issue`

### Customer Scanner Web

- **Kamera:** ✅ Ja! (ZXing JavaScript Barcode Scanner)
- **Libraries:**
  - `zxing-library` — Barcode-Scanning (schneller als html5-qrcode)
  - `ethers.js` — EIP-712 Signing
- **API-Kommunikation:** `POST /stamp`
- **Features:**
  - Live-Kamera-Feed
  - QR-Overlay mit grüner Box
  - Automatische Payload-Parsing
  - Fehlerbehandlung

---

## 🎯 Unterschied zu den alten Browser-Apps

| Feature          | Alt (`cafe/`)    | Neu (`cafe-issuer-web.html`) |
| ---------------- | ---------------- | ---------------------------- |
| Design           | Minimal          | Modern, Gradient             |
| Mobile-Ready     | Ja, aber einfach | ✅ Optimiert                 |
| Fehlerbehandlung | Basis            | ✅ Detailliert               |

| Feature        | Alt (`customer/`) | Neu (`customer-scanner-web.html`) |
| -------------- | ----------------- | --------------------------------- |
| Kamera-Library | html5-qrcode      | ✅ ZXing (schneller)              |
| Kamera-Overlay | Nein              | ✅ Ja (grüne Box)                 |
| Live Feedback  | Einfach           | ✅ Status-Updates                 |
| Mobile-UX      | Standard          | ✅ Optimiert                      |

---

## 🔗 URLs Übersicht

```
📱 Apps Server: http://localhost:8080

🏪 Café Apps:
   - Original: http://localhost:8080/cafe/
   - Enhanced: http://localhost:8080/cafe-issuer-web.html ← Empfohlen!

📱 Customer Apps:
   - Original: http://localhost:8080/customer/
   - Enhanced: http://localhost:8080/customer-scanner-web.html ← Empfohlen!

🔧 Tools:
   - LAN Setup: http://localhost:8080/lan-setup.html
   - API Health: http://127.0.0.1:3000/health
```

---

## ✅ Nächster Schritt (Optional)

Falls du später **echte iOS App** willst:

- **Option 1:** Expo Go (schnell, temporär)
- **Option 2:** EAS Build (echte App, professionell)

Siehe: `QUICK_START.md` im Repo-Root

---

**Du bist bereit! 🎉 Öffne `http://localhost:8080/cafe-issuer-web.html` im Browser und teste!**
