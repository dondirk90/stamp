# 🎯 Stamp — Web Solution (Off-Chain)

**Status:** ✅ Off-chain (Node/SQLite). Keine Wallets, kein Signing, keine Blockchain.

## 🔗 URLs (empfohlen)

- Apps Server: `http://localhost:8080`
- Café Onboarding (Registrierung): `http://localhost:8080/cafe-onboarding`
- Café Scanner (Stempeln/Redeem): `http://localhost:8080/cafe-scanner`
- Customer Registrierung: `http://localhost:8080/customer-register`
- Customer QR (modern): `http://localhost:8080/customer-qr`
- LAN Setup: `http://localhost:8080/lan-setup.html`

## 🚀 Quick Test Flow

1. API Server starten: `pnpm run dev`
2. Apps Server starten: `cd apps` → `node server.cjs`
3. Café registrieren (`/cafe-onboarding`) und mit **E-Mail + Passwort** einloggen
4. Café Scanner öffnen (`/cafe-scanner`), einloggen (E-Mail + Passwort)
5. Customer öffnet `/customer-qr`, erstellt Account, zeigt QR
6. Café scannt den QR-Link (öffnet Scanner-Ansicht automatisch) und vergibt Stempel

## 📱 Smartphone (LAN)

Nutze `/lan-setup.html`, um die richtigen LAN-URLs für dein Handy zu finden.
