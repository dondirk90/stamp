# Quick Start — Customer Flow (off-chain)

Dieses Projekt läuft vollständig **off-chain** (SQLite Ledger + SSE). Kein API-Key, keine Wallet/Private Keys.

## Voraussetzungen

- Computer und Smartphone im gleichen Wi‑Fi
- 2 Terminals: API + Apps

## Starten

### Terminal 0 (optional): Postgres (recommended)

If you are using Postgres locally (recommended for cloud-only parity):

```powershell
cd D:\stamp
docker compose -f infra/docker/docker-compose.yml up -d
```

Set `DATABASE_URL` (PowerShell example):

```powershell
$env:DATABASE_URL = "postgres://stempel:stempel@127.0.0.1:5432/stempel"
pnpm run db:migrate
```

### Terminal 1: API

```powershell
cd D:\stamp
pnpm run dev
# alternativ:
# node api/server.cjs
```

Erwartet: API auf `http://127.0.0.1:3000`

### Terminal 2: Apps

```powershell
cd D:\stamp
node apps/server.cjs
```

Erwartet: Apps auf `http://localhost:8080`

### LAN-IP (für Smartphone-URL)

```powershell
ipconfig | Select-String -Pattern 'IPv4'
```

## URLs

- Computer: `http://localhost:8080`
- Smartphone: `http://<LAN_IP>:8080`

## Test (End-to-End)

1. Computer: Café anlegen / einloggen

- `http://localhost:8080/cafe-onboarding.html`

2. Computer: Café Scanner öffnen

- `http://localhost:8080/cafe-scanner-new.html`

3. Smartphone: Customer öffnen

- `http://<LAN_IP>:8080/customer-qr.html`
- Registrieren oder Login
- Café auswählen
- Auf die Stempelkarte tippen (QR anzeigen)

4. Stempel setzen

- Im Café Scanner den QR scannen → es sollte ein "Stempel erhalten" Toast kommen

5. Einlösen (nur wenn Karte voll)

- Im Customer-QR: QR-Modus "Einlösen" auswählen und QR scannen
- Erwartet: "Eingelöst" Toast
- Beim erneuten Scannen derselben Einlöse-QR: klare Meldung "bereits benutzt" (single-use)

## Troubleshooting

- Smartphone lädt Seite nicht: Windows-Firewall → eingehend `node.exe` für Port 8080 erlauben
- Customer zeigt keine Cafés: erst ein Café anlegen und prüfen, ob es im Public Listing ist
- Kein Live-Update: Seite neu laden (SSE verbindet dann neu)
