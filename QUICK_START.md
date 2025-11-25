# 🚀 Quick Start — Smartphone QR Scanning

## Was du brauchst (vor dem Start)

- Computer und Smartphone im gleichen WiFi
- Terminal-Fenster(1): API Server
- Terminal-Fenster 2: Apps Server
- Browser auf Computer und Smartphone

---

## ⚡ 3-Schritt Setup

### Terminal 1: API starten

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp
pnpm run dev
```

**Erwartet:** `🚀 API listening on http://127.0.0.1:3000`

### Terminal 2: Apps Server starten

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp\apps
node server.cjs
```

**Erwartet:** `📱 Apps Server running on http://localhost:8080`

### Deine LAN-IP herausfinden

```powershell
ipconfig
```

**Suche:** "IPv4-Adresse" unter WiFi (z.B. `192.168.1.100`)

---

## 🌐 URLs

| Geräte         | API                         | Apps                        |
| -------------- | --------------------------- | --------------------------- |
| **Computer**   | `http://127.0.0.1:3000`     | `http://localhost:8080`     |
| **Smartphone** | `http://192.168.1.100:3000` | `http://192.168.1.100:8080` |

_Ersetze `192.168.1.100` mit deiner tatsächlichen LAN-IP_

---

## ✅ Test durchführen

### 1️⃣ Cafe-App (Computer)

- Öffne: **`http://localhost:8080/cafe/`**
- API Base: `http://127.0.0.1:3000`
- Klick: **"Issue QR"**
- ➜ QR-Code wird auf Bildschirm angezeigt

### 2️⃣ Customer-App (Smartphone)

- Öffne: **`http://192.168.1.100:8080/customer/`**
- API Base: `http://192.168.1.100:3000`
- Private Key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- Klick: **"Start Camera"**
- ➜ Gib Smartphone-Kamera-Erlaubnis

### 3️⃣ QR Scannen

- Smartphone-Kamera auf Computer-Bildschirm richten (wo QR-Code angezeigt)
- QR wird automatisch gescannt
- Payload wird im Customer-App angezeigt

### 4️⃣ Sign & Send

- Klick: **"Sign & Send"**
- ➜ Signatur wird erstellt, API wird aufgerufen
- Result: `{"success": true, "txHash": "0x..."}`
- ✅ Transaktion erfolgreich!

---

## 🔧 Troubleshooting

| Problem                         | Lösung                                                |
| ------------------------------- | ----------------------------------------------------- |
| "Cannot GET" auf Smartphone     | Apps Server läuft? (`node server.cjs`)                |
| "Cannot connect to API"         | API läuft? (`pnpm run dev`) Firewall Port 3000 offen? |
| "Camera permission denied"      | Browser-Erlaubnis geben (Browser-Einstellungen)       |
| Smartphone sieht Computer nicht | Beide im gleichen WiFi? LAN-IP korrekt?               |
| QR-Code wird nicht gescannt     | QR muss groß genug sein, gute Lichtverhältnisse       |

---

## 📱 Fortgeschrittene Tipps

- **Web-Server nicht erreichbar?** Firewall prüfen: Port 3000 (API) & Port 8080 (Apps) erlauben
- **IP ändert sich?** Statische IP im Router setzen oder DynDNS verwenden
- **Mehrere Smartphones?** Jedes kann die gleiche URL `192.168.1.100:8080` nutzen
- **Von außerhalb testen?** Ngrok oder Tailscale verwenden (siehe README)

---

## 🎉 Fertig!

Du kannst jetzt QR-Codes auf deinem Smartphone scannen und Transaktionen signieren. Genießen!
