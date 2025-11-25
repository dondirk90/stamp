# 📱 Smartphone Scanning — Quick Checklist

## Was du brauchst

- ✅ API Server läuft (`pnpm run dev` in Terminal 1)
- ✅ Apps Server läuft (`node server.cjs` in Terminal 2)
- ✅ Smartphone im **gleichen WLAN** wie dein Computer
- ✅ Deine Rechner-**LAN-IP** (z.B. `192.168.1.100`)

## Schritt-für-Schritt

### 1. IP herausfinden

```powershell
ipconfig
```

Suche nach **"IPv4-Adresse"** unter deinem WiFi-Adapter.
Beispiel: `192.168.1.100`

### 2. API starten (Terminal 1)

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp
pnpm run dev
```

Erwartet: `🚀 API listening on http://127.0.0.1:3000`

### 2b. Apps Server starten (Terminal 2)

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp\apps
node server.cjs
```

Erwartet: `📱 Apps Server running on http://localhost:8080`

### 3. Café-App (Computer ODER Smartphone)

- **URL Computer:** `http://localhost:8080/cafe/`
- **URL Smartphone:** `http://192.168.1.100:8080/cafe/` (deine LAN-IP!)
- **API Base:** `http://127.0.0.1:3000` (Computer) oder `http://192.168.1.100:3000` (Smartphone)
- **Klick:** "Issue QR" → QR-Code wird angezeigt

### 4. Customer-App (Smartphone)

- **URL:** `http://192.168.1.100:8080/customer/` (deine LAN-IP!)
- **API Base:** `http://192.168.1.100:3000` (deine LAN-IP!)
- **Private Key:** `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- **Klick:** "Start Camera" → Kamera fordert Erlaubnis an
- **Aktion:** QR-Code von Café-App scannen
- **Klick:** "Sign & Send" → Transaktion wird abgesendet

### 5. Erfolg ✅

- Result-Feld auf Smartphone zeigt: `{"success":true,"txHash":"0x..."}`
- Fertig! Transaktoin wurde auf der Blockchain gespeichert

---

## Häufige Probleme

| Problem                 | Lösung                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| "Cannot connect to API" | API läuft? (`pnpm run dev`). Port 3000 offen in Firewall?          |
| "Camera not working"    | Browser-Erlaubnis für Kamera geben. Manche Browser brauchen HTTPS. |
| "Invalid QR code"       | QR muss mit `STAMP:` anfangen (wird automatisch hinzugefügt).      |
| "API Base URL falsch"   | Nicht `127.0.0.1` auf Smartphone! Deine LAN-IP verwenden.          |
| "Private Key rejected"  | Format muss `0x` + 64 hex Zeichen sein.                            |

---

## Test-Konten

Für lokales Testen (Hardhat):

- **Café:** `0xac0974bec39a17e36ba4a6b4d238ff944bacb476caded54eafb0f85fb6fe5e0c`
- **Customer:** `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` ← Dieser!

---

## Automatische Hilfe

Öffne `apps/lan-setup.html` im Browser — zeigt dir alle IPs und URLs automatisch an.

---

Viel Spaß! 🎉
