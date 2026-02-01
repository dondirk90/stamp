# Kaffee Stempelkarte (Monorepo)

## Struktur

- apps/api — Relayer API (später)
- apps/cafe-scanner — PWA (später)
- infra/docker — DB/Redis via Docker Compose
- packages — Shared configs (tsconfig/eslint) (später)

> Hinweis: Das Projekt läuft mittlerweile vollständig **off-chain** (SQLite Ledger + SSE). Es gibt keine Hardhat/Solidity-Komponenten mehr.

## Setup

- Node >= 18, pnpm 9
- VS Code + empfohlene Extensions
