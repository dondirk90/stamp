# Project Documentation

## Purpose

`stamp` is the main repository for `Kaffeekarte`, a digital loyalty and café wallet product.

The current product focus is:

- customer wallet for collecting digital stamps
- café onboarding and profile management
- café scanner for stamping and redeeming
- admin overview and operational tooling
- PWA delivery for phone-friendly usage

The project currently runs fully off-chain. Earlier blockchain-style concepts were replaced by a simpler server-backed event ledger and QR-driven redemption flow.

## Product Areas

There are two product directions in the broader project history:

1. `Kaffeekarte / Cafe OS`
   This is the actively maintained main app in this repository.
   It covers café operations, customer loyalty, scanning, rewards and customer wallet flows.

2. `Coffee Guide`
   This was explored as a separate direction for discovery, maps, café information and specialty coffee content.
   That direction should live separately and not be mixed into the main loyalty product.

This repository should currently be treated as the operational `Kaffeekarte` / `Cafe OS` codebase.

## High-Level Architecture

The app is split into two runtime parts:

1. `API server`
   Path: [api/server.cjs](/abs/path/d:/stamp/api/server.cjs:1)

   Responsibilities:
   - customer registration and login
   - café registration and login
   - email verification and password reset
   - public café listing
   - stamp event history
   - QR redemption token handling
   - admin endpoints

2. `Apps server`
   Path: [apps/server.cjs](/abs/path/d:/stamp/apps/server.cjs:1)

   Responsibilities:
   - serves HTML, CSS, JS and PWA assets
   - rewrites friendly routes like `/wallet`, `/cafe-scanner`, `/cafe-profile`
   - proxies `/api/*` requests to the API server
   - provides simple diagnostics endpoints like `/__ping`

The frontend is mostly server-served HTML plus vanilla JS, not a large SPA framework.

## Main User-Facing Surfaces

### Customer Wallet

- entry page: [apps/customer-qr-modern.html](/abs/path/d:/stamp/apps/customer-qr-modern.html:1)
- main client logic: [apps/customer-qr-modern.js](/abs/path/d:/stamp/apps/customer-qr-modern.js:1)

Responsibilities:
- registration and login
- email verification flow
- card and wallet experience
- café discovery and favorite cafés
- QR display for stamp and redeem flows
- customer history view

### Customer Profile

- page: [apps/customer-profile.html](/abs/path/d:/stamp/apps/customer-profile.html:1)
- logic: [apps/customer-profile.js](/abs/path/d:/stamp/apps/customer-profile.js:1)

Responsibilities:
- session-based profile view
- password reset initiation
- account details display

### Café Onboarding

- page: [apps/cafe-onboarding.html](/abs/path/d:/stamp/apps/cafe-onboarding.html:1)

Responsibilities:
- café registration
- location and address capture
- password-based onboarding
- email verification trigger

### Café Scanner

- page: [apps/cafe-scanner-new.html](/abs/path/d:/stamp/apps/cafe-scanner-new.html:1)

Responsibilities:
- scan customer QR
- stamp cards
- redeem rewards
- quick in-shift usage

### Café Profile

- page: [apps/cafe-profile.html](/abs/path/d:/stamp/apps/cafe-profile.html:1)

Responsibilities:
- edit café profile
- branding
- reward rules
- public card details

### Café Dashboard

- page: [apps/cafe-dashboard.html](/abs/path/d:/stamp/apps/cafe-dashboard.html:1)

Responsibilities:
- café-level overview
- operational stats and profile access

### Admin Dashboard

- page: [apps/admin-dashboard.html](/abs/path/d:/stamp/apps/admin-dashboard.html:1)

Responsibilities:
- administrative visibility into cafés and accounts
- privileged management views

## Routing Model

The apps server maps friendly routes to concrete HTML files.

Examples:

- `/wallet` -> customer wallet
- `/customer-wallet` -> customer wallet
- `/customer-profile` -> customer profile
- `/cafe-onboarding` -> café onboarding
- `/cafe-scanner` -> scanner
- `/cafe-profile` -> café profile
- `/cafe-dashboard` -> café dashboard

This logic lives in [apps/server.cjs](/abs/path/d:/stamp/apps/server.cjs:1).

## Data Model Overview

The API stores data for:

- cafés
- customers
- stamp events
- café images
- email verification tokens
- password reset tokens
- session-like records for cafés
- public café metadata and reward configuration

Important runtime tables and concepts:

- `cafes`
- `customers`
- `stamp_events`
- `customer_email_verifications`
- `cafe_email_verifications`
- `customer_password_resets`
- `cafe_password_resets`

Newer work also adds social-login related tables for customer auth grants and provider identities.

## Authentication Model

### Current Auth

Customers currently support:

- email + password
- email verification
- password reset

Cafés currently support:

- email + password
- email verification
- session token for protected café endpoints

### Google Login

Google sign-in support is being introduced for customers.

Relevant backend changes:

- Google OAuth start endpoint
- Google callback endpoint
- short-lived auth grant handoff back to the wallet
- provider identity linking to existing customers by verified email

Relevant env vars:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_STATE_SECRET`

These values belong in local or server env files and never in committed secrets files.

## Database Modes

The codebase supports two database modes:

### SQLite

Used mainly for local/dev fallback.

Behavior:
- schema bootstrapped directly from [api/server.cjs](/abs/path/d:/stamp/api/server.cjs:1)
- legacy columns are added with SQLite-only `ALTER TABLE` guards

### Postgres

Used for cloud, staging and production parity.

Behavior:
- schema is migrated explicitly with [api/migrate.cjs](/abs/path/d:/stamp/api/migrate.cjs:1)
- SQL migrations live in [api/migrations](/abs/path/d:/stamp/api/migrations)

Important:
- staging/prod schema changes must always be reflected in migration files
- deploy issues often come from code being newer than the migrated database schema

## PWA / App Icon System

The project ships as a PWA and uses several icon formats:

- browser tab favicon
- apple touch icon
- PWA `192x192`
- PWA `512x512`
- `favicon.ico`

Current icon source:

- [apps/assets/stamp-bean.png](/abs/path/d:/stamp/apps/assets/stamp-bean.png:1)

Derived output files include:

- [apps/favicon.ico](/abs/path/d:/stamp/apps/favicon.ico:1)
- [apps/favicon-32x32.png](/abs/path/d:/stamp/apps/favicon-32x32.png:1)
- [apps/apple-touch-icon.png](/abs/path/d:/stamp/apps/apple-touch-icon.png:1)
- [apps/pwa/icons/icon-192.png](/abs/path/d:/stamp/apps/pwa/icons/icon-192.png:1)
- [apps/pwa/icons/icon-512.png](/abs/path/d:/stamp/apps/pwa/icons/icon-512.png:1)
- customer and café variants under [apps/pwa/icons](/abs/path/d:/stamp/apps/pwa/icons)

PWA manifests:

- [apps/pwa/manifest.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest.webmanifest:1)
- [apps/pwa/manifest-customer.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest-customer.webmanifest:1)
- [apps/pwa/manifest-cafe.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest-cafe.webmanifest:1)

Service worker:

- [apps/pwa/service-worker.js](/abs/path/d:/stamp/apps/pwa/service-worker.js:1)
- [apps/pwa/sw-register.js](/abs/path/d:/stamp/apps/pwa/sw-register.js:1)

If an icon appears stale in browser tabs or on the phone home screen, the usual causes are:

- favicon cache
- stale manifest cache
- stale service worker cache
- an old installed home-screen shortcut still pointing at older assets

## Environment Files

### Should `.env` files go to GitHub?

No, real `.env` files with secrets should not be pushed to GitHub.

Do not commit:

- `.env`
- `.env.local`
- `.env.staging`
- `.env.prod`

These files may contain:

- database passwords
- SMTP credentials
- admin tokens
- OAuth secrets

What should be committed:

- example files only

Examples:

- [infra/docker/staging.env.example](/abs/path/d:/stamp/infra/docker/staging.env.example:1)
- [infra/docker/prod.env.example](/abs/path/d:/stamp/infra/docker/prod.env.example:1)
- [\.env.example](/abs/path/d:/stamp/.env.example:1) if present and scrubbed

Rule of thumb:

- commit templates
- never commit real secrets

### Typical env file roles

- `.env.local`
  Local developer convenience values

- `.env.staging`
  Values used on staging server

- `.env.prod`
  Values used on production server

## Deployment Model

Deployment docs already exist in:

- [CI_CD_SETUP.md](/abs/path/d:/stamp/CI_CD_SETUP.md:1)
- [PROD_RELEASE_PLAN.md](/abs/path/d:/stamp/PROD_RELEASE_PLAN.md:1)
- [STAGING_RUNBOOK.md](/abs/path/d:/stamp/STAGING_RUNBOOK.md:1)
- [infra/docker/DEPLOY.md](/abs/path/d:/stamp/infra/docker/DEPLOY.md:1)

Current deploy shape:

- GitHub Actions
- Docker Compose
- reverse proxy via Caddy
- Postgres in production

Important operational lesson from recent work:

- migrations must be present in the built image before `migrate` runs
- otherwise production can serve newer app code against an older schema

## Branch Strategy

Preferred workflow:

- `test` for ongoing work
- `main` only after verification

Typical flow:

1. implement on `test`
2. validate on staging
3. merge or promote to `main`
4. deploy production from `main`

Because this repo often contains unrelated local work in progress, selective commits are important.

## Local Development

Minimal local start:

1. API
   - `pnpm run dev`
   - or `node api/server.cjs`

2. Apps server
   - `node apps/server.cjs`

Typical ports:

- API: `3000`
- Apps: `8080`

Useful docs:

- [QUICK_START.md](/abs/path/d:/stamp/QUICK_START.md:1)
- [apps/MOBILE-TESTING.md](/abs/path/d:/stamp/apps/MOBILE-TESTING.md:1)

## Important Files At A Glance

Core runtime:

- [api/server.cjs](/abs/path/d:/stamp/api/server.cjs:1)
- [api/db.cjs](/abs/path/d:/stamp/api/db.cjs:1)
- [api/migrate.cjs](/abs/path/d:/stamp/api/migrate.cjs:1)
- [apps/server.cjs](/abs/path/d:/stamp/apps/server.cjs:1)

Customer:

- [apps/customer-qr-modern.html](/abs/path/d:/stamp/apps/customer-qr-modern.html:1)
- [apps/customer-qr-modern.js](/abs/path/d:/stamp/apps/customer-qr-modern.js:1)
- [apps/customer-profile.html](/abs/path/d:/stamp/apps/customer-profile.html:1)
- [apps/customer-profile.js](/abs/path/d:/stamp/apps/customer-profile.js:1)

Café:

- [apps/cafe-onboarding.html](/abs/path/d:/stamp/apps/cafe-onboarding.html:1)
- [apps/cafe-scanner-new.html](/abs/path/d:/stamp/apps/cafe-scanner-new.html:1)
- [apps/cafe-profile.html](/abs/path/d:/stamp/apps/cafe-profile.html:1)
- [apps/cafe-dashboard.html](/abs/path/d:/stamp/apps/cafe-dashboard.html:1)

PWA:

- [apps/pwa/manifest.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest.webmanifest:1)
- [apps/pwa/manifest-customer.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest-customer.webmanifest:1)
- [apps/pwa/manifest-cafe.webmanifest](/abs/path/d:/stamp/apps/pwa/manifest-cafe.webmanifest:1)
- [apps/pwa/service-worker.js](/abs/path/d:/stamp/apps/pwa/service-worker.js:1)

Infra:

- [infra/docker/docker-compose.yml](/abs/path/d:/stamp/infra/docker/docker-compose.yml:1)
- [infra/docker/docker-compose.prod.yml](/abs/path/d:/stamp/infra/docker/docker-compose.prod.yml:1)
- [infra/caddy/Caddyfile.prod](/abs/path/d:/stamp/infra/caddy/Caddyfile.prod:1)

## Recommended Next Documentation Steps

This file is the central overview.

Good next additions would be:

- a dedicated `AUTHENTICATION.md`
- a dedicated `ICON_PIPELINE.md`
- a dedicated `DATA_MODEL.md`
- a short `OPERATIONS.md` with the 10 most common production checks
