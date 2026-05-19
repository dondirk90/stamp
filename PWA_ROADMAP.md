# PWA Roadmap for Cafe Stamp

This document defines the first practical path from the current mobile web app to a production-ready Progressive Web App for `Cafe OS`.

The goal is not to build a pseudo-native app all at once.
The goal is to make the existing browser app:

- installable
- reliable on mobile
- HTTPS-ready
- faster to reopen
- safer to deploy incrementally

## Product Scope

The first PWA scope should be intentionally narrow.

Primary installable surfaces:

- `/customer-wallet`
- `/cafe-scanner`

Secondary surfaces:

- `/cafe-dashboard`
- `/cafe-profile`

Not part of the first PWA milestone:

- true offline stamping
- background sync of business-critical actions
- native app store packaging
- push notifications

## Why Start Here

These two routes provide the highest product value:

- `customer-wallet` becomes a homescreen loyalty card app
- `cafe-scanner` becomes a faster operational tool for staff

This gives the strongest UX improvement with the least infrastructure risk.

## Current Baseline

Current strengths:

- mobile-friendly browser app already exists
- app routes are served from the Apps Server
- same-origin API proxy already exists via `/api/*`
- Docker staging and production setup already exists

Current gaps:

- no `manifest.webmanifest`
- no service worker
- no install prompt strategy
- no offline shell
- no app icons / splash-ready metadata
- no HTTPS-first deployment path documented for PWA use

## Architecture Decision

Use the existing Apps Server as the PWA host.

This means:

- the Apps Server continues serving HTML/CSS/JS
- the PWA manifest is served from the same origin
- the service worker is registered on the same origin
- API calls remain same-origin via `/api/*`

This is preferable to introducing a separate static hosting layer right now.

## Phase 1: App Identity

Deliverables:

- `manifest.webmanifest`
- app name and short name
- theme color and background color
- app icons in multiple sizes
- Apple touch icon
- meta tags on key pages

Suggested initial identity:

- name: `Cafe Stamp`
- short name: `Stamp`
- display: `standalone`
- orientation: `portrait`
- start URL: `/customer-wallet`
- scope: `/`

Acceptance criteria:

- Android Chrome offers “Install app”
- iPhone Safari supports “Add to Home Screen”
- installed app launches without browser chrome

## Phase 2: Service Worker Foundation

Deliverables:

- `service-worker.js`
- registration script loaded by app pages
- versioned cache name
- static asset pre-cache for app shell
- offline fallback page

Caching strategy for first release:

- HTML shell: `network-first`
- CSS/JS/icons: `stale-while-revalidate` or `cache-first`
- API requests: `network-first`
- scanner-critical flows: no optimistic offline writes

Important rule:

Do not cache stamp mutation requests in a way that can create duplicate or delayed business actions.

Acceptance criteria:

- reopening the app feels faster after first load
- static shell works with weak connectivity
- a friendly offline screen is shown instead of a blank failure

## Phase 3: Mobile App Behavior

Deliverables:

- install prompt handling for supported browsers
- app launch polish
- standalone-mode testing
- viewport and safe-area checks

Areas to validate carefully:

- iPhone Safari standalone mode
- camera permissions for scanner
- QR flow after install
- session persistence after reopen

Acceptance criteria:

- scanner can still access camera over HTTPS
- wallet can be reopened from homescreen without breaking auth flow
- layout works in standalone mode on iPhone and Android

## Phase 4: Production Hardening

Deliverables:

- cache versioning and invalidation plan
- rollback-safe service worker update behavior
- basic telemetry/logging for service worker failures
- cache busting for app assets

Key concern:

PWA bugs can feel “sticky” because browsers cache old assets.
We should keep the first service worker conservative and easy to invalidate.

Acceptance criteria:

- new deploys can replace old assets reliably
- stale service worker behavior has a documented recovery path

## HTTPS Requirements

PWA features and camera usage both strongly benefit from HTTPS.

For staging and production:

- use a real domain
- terminate TLS at a reverse proxy
- route traffic to the Apps Server

Without HTTPS:

- install behavior is weaker
- camera access may fail on mobile
- production-like testing is less trustworthy

## Risks

### High Risk

- caching API responses too aggressively
- breaking QR scanner camera permissions
- sticky old assets after deploy

### Medium Risk

- route-specific HTML shells not loading correctly when installed
- iPhone standalone quirks around auth/session/localStorage

### Low Risk

- manifest and icons
- homescreen installation basics

## Recommended Implementation Order

1. Add manifest and icons
2. Add meta tags to `customer-wallet` and `cafe-scanner`
3. Add minimal service worker with conservative caching
4. Test locally over browser
5. Test on staging over HTTPS
6. Only then extend to more routes

## Definition of Done for First PWA Release

The first PWA release is complete when:

- wallet and scanner are installable
- app opens in standalone mode
- scanner still works over HTTPS on mobile
- app shell loads reliably after first visit
- offline state degrades gracefully
- deploy/update behavior is documented

## After the First Release

Possible second-wave features:

- web push notifications
- campaign reminders as true push instead of only in-app popups
- “open to scanner” shortcuts
- richer offline read mode for wallet/history

These should only come after the first installable shell is stable.
