# Smartphone Scanning — Quick Checklist

## Was du brauchst

- API Server läuft (`pnpm run dev` in Terminal 1)
- Apps Server läuft (`node server.cjs` in Terminal 2)
- Smartphone im **gleichen WLAN** wie dein Computer
- Deine Rechner-**LAN-IP** (z.B. `192.168.1.100`)

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

Erwartet: `API listening on http://127.0.0.1:3000`

### 2b. Apps Server starten (Terminal 2)

```powershell
cd C:\Users\dirkb\Documents\GitHub\stamp\apps
node server.cjs
```

Erwartet: `Apps Server running on http://localhost:8080`

### 3. Café-App (Computer ODER Smartphone)

- **URL Computer:** `http://localhost:8080/cafe-onboarding`
- **URL Smartphone:** `http://192.168.1.100:8080/cafe-onboarding` (deine LAN-IP!)
- Registriere dein Café und logge dich mit **E-Mail + Passwort** ein.
- Danach: `http://localhost:8080/cafe-scanner` (oder LAN-IP) öffnen und einloggen.

### 4. Customer-App (Smartphone)

- **URL:** `http://192.168.1.100:8080/customer-wallet` (deine LAN-IP!)
- Registrieren oder einloggen (E-Mail + Passwort).
- Öffne den QR-Code, damit das Café ihn scannen kann.

### 5. Erfolg

- Du siehst Stempel/Belohnungen in der Customer-App, und der Café-Scanner zeigt die aktualisierte Anzahl.

---

## Häufige Probleme

| Problem                 | Lösung                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| "Cannot connect to API" | API läuft? (`pnpm run dev`). Port 3000 offen in Firewall?          |
| "Camera not working"    | Browser-Erlaubnis für Kamera geben. Manche Browser brauchen HTTPS. |
| "Invalid QR code"       | QR muss mit `STAMP:` anfangen (wird automatisch hinzugefügt).      |
| "API Base URL falsch"   | Nicht `127.0.0.1` auf Smartphone! Deine LAN-IP verwenden.          |

---

## Automatische Hilfe

Öffne `apps/lan-setup.html` im Browser — zeigt dir alle IPs und URLs automatisch an.

---

Viel Spaß!
