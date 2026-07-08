# Product File Inventory

## Purpose

This file maps the current repository into:

- `Cafe OS`
- `Coffee Guide`
- `Shared`
- `Delete Candidate`

It is intended to support:

- the product split
- repo cleanup
- removal of obsolete files
- safer forking

## Classification Rules

### Cafe OS

Anything directly related to:
- stamp cards
- rewards
- scanner flows
- operational cafe tooling
- staff / cafe owner workflows

### Coffee Guide

Anything directly related to:
- map-first discovery
- public cafe browsing
- cafe information
- specialty coffee metadata
- ratings and collections

### Shared

Anything that is still useful for both products:
- generic server plumbing
- base cafe profile handling
- image/media primitives
- low-level UI helpers
- deployment/infrastructure templates

### Delete Candidate

Anything that is likely obsolete, duplicated, transitional, or should not survive unchanged into the product-specific repos.

## Top-Level Recommendation

### Repo Strategy

Use this inventory to create:

1. `stamp-cafe-os`
2. `stamp-coffee-guide`

Keep deletion conservative at first:
- remove only clearly obsolete files immediately
- move ambiguous files into a `needs-review` bucket before deleting

## Current Inventory

### Core App Files

`apps/server.cjs`
- Classification: `Shared`
- Reason: static app server and API proxy used by both products
- Future: may later diverge into separate product-specific servers

`apps/theme.css`
- Classification: `Shared`
- Reason: current shared styling base
- Future: likely fork into two visual systems

`apps/ui.js`
- Classification: `Shared`
- Reason: generic user-safe error mapping and UI helpers

`apps/index.html`
- Classification: `Delete Candidate`
- Reason: current mixed landing page likely does not fit either product cleanly
- Action: replace with product-specific landing pages in each fork

`apps/lan-setup.html`
- Classification: `Cafe OS`
- Reason: operational local/mobile testing helper

`apps/README.md`
- Classification: `Shared`
- Reason: useful during split, but should later become product-specific

`apps/MOBILE-TESTING.md`
- Classification: `Cafe OS`
- Reason: heavily tied to testing scanner / wallet flows

`apps/WEB_SOLUTION.md`
- Classification: `Cafe OS`
- Reason: current web solution centers on operational stamp flows

## Cafe OS App Surface

`apps/cafe-onboarding.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-scanner-new.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-profile.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-dashboard.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-logout.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-issuer-web.html`
- Classification: `Cafe OS`
- Keep

`apps/cafe-register.js`
- Classification: `Cafe OS`
- Keep, but likely rename later to clearer onboarding/auth naming

`apps/admin-dashboard.html`
- Classification: `Cafe OS`
- Keep only if it is still actively used as an operational/admin tool
- Otherwise move to `Delete Candidate`

## Coffee Guide App Surface

`apps/cafe-public.html`
- Classification: `Coffee Guide`
- Strong keep
- Reason: natural starting point for rich public cafe detail pages

`apps/cafe/index.html`
- Classification: `Coffee Guide`
- Keep if it is only a public-facing cafe route shell
- Review if redundant with `cafe-public.html`

`apps/customer-home.html`
- Classification: `Delete Candidate`
- Reason: redirect shell around customer wallet route, likely obsolete in split

`apps/customer-start.html`
- Classification: `Delete Candidate`
- Reason: redirect shell around wallet experience

`apps/customer-register.html`
- Classification: `Delete Candidate`
- Reason: redirect wrapper around old customer flow

## Customer Wallet / Loyalty Surface

`apps/customer-qr-modern.html`
- Classification: `Cafe OS`
- Reason: this is effectively the consumer-side loyalty wallet, not the future guide
- Keep in `Cafe OS`

`apps/customer-qr-modern.js`
- Classification: `Cafe OS`
- Keep

`apps/customer-qr.html`
- Classification: `Delete Candidate`
- Reason: appears to be legacy redirect/entry surface

`apps/customer-qr.js`
- Classification: `Delete Candidate`
- Reason: appears to be older implementation next to `customer-qr-modern.js`
- Action: verify no remaining route depends on it, then remove

`apps/customer-profile.html`
- Classification: `Cafe OS`
- Reason: tied to current loyalty customer account

`apps/customer-profile.js`
- Classification: `Cafe OS`
- Keep

## Native / Mobile App Folders

`apps/cafe-ios`
- Classification: `Delete Candidate`
- Reason: legacy mobile app folder, likely superseded by newer app
- Action: verify unused, then remove

`apps/cafe-ios-new`
- Classification: `Cafe OS`
- Keep
- Reason: modern mobile surface for cafe operations

`apps/customer-ios-new`
- Classification: `Cafe OS`
- Reason: current mobile customer wallet belongs with loyalty product, not guide
- Keep for `Cafe OS`

`apps/customer`
- Classification: `Delete Candidate`
- Reason: likely legacy customer web artifacts
- Action: inspect before deletion

`apps/cafe`
- Classification: `Coffee Guide`
- Reason: public cafe route namespace likely useful for guide-facing pages
- Review exact contents during fork

## Assets / Vendor

`apps/assets`
- Classification: `Shared`
- Keep for now

`apps/vendor`
- Classification: `Shared`
- Keep for now

`apps/.apps-server.err.log`
- Classification: `Delete Candidate`
- Reason: generated runtime log

`apps/.apps-server.out.log`
- Classification: `Delete Candidate`
- Reason: generated runtime log

## API Layer

`api/server.cjs`
- Classification: `Shared`
- Reason: currently contains logic for both future products
- Action: split by route domain over time

`api/db.cjs`
- Classification: `Shared`
- Keep

`api/migrate.cjs`
- Classification: `Shared`
- Keep

`api/migrations`
- Classification: `Shared`
- Keep, but expect later domain split

`api/Dockerfile`
- Classification: `Shared`
- Keep

`api/package.json`
- Classification: `Shared`
- Keep

`api/.api.err.log`
- Classification: `Delete Candidate`
- Reason: generated runtime log

`api/.api.out.log`
- Classification: `Delete Candidate`
- Reason: generated runtime log

## Script Inventory

### Keep for Cafe OS

`scripts/share-ios.mjs`
- Classification: `Cafe OS`
- Reason: demo/mobile sharing flow for operational app

`scripts/setup-firewall.ps1`
- Classification: `Cafe OS`

`scripts/start-mobile-dev.ps1`
- Classification: `Cafe OS`

`scripts/stop-all.ps1`
- Classification: `Shared`

`scripts/restart-all.ps1`
- Classification: `Shared`

`scripts/check-status.ps1`
- Classification: `Shared`

`scripts/ui-screenshots.mjs`
- Classification: `Shared`

### Likely Cafe OS Specific

`scripts/issue-qr.cjs`
- Classification: `Cafe OS`

`scripts/verify-cross-cafe-stamp.cjs`
- Classification: `Cafe OS`

`scripts/debug-wallet-visibility.mjs`
- Classification: `Cafe OS`

`scripts/debug-wallet-webkit.mjs`
- Classification: `Cafe OS`

`scripts/debug-auth-toggle.mjs`
- Classification: `Cafe OS`

### Likely Coffee Guide Relevant

`scripts/debug-map-init.mjs`
- Classification: `Coffee Guide`
- Reason: map-related debugging may still matter in guide fork

### Migration / DB Maintenance

`scripts/fix-db.cjs`
- Classification: `Shared`

`scripts/migrate-db-schema.cjs`
- Classification: `Shared`

`scripts/migrate-sqlite-to-postgres.cjs`
- Classification: `Shared`

`scripts/migrate-cafe-auth.cjs`
- Classification: `Cafe OS`

### Needs Review / Possible Deletion

`scripts/add-address-column.cjs`
- Classification: `Delete Candidate`
- Reason: one-off migration helper likely obsolete after migration is complete

`scripts/add-award-logging.cjs`
- Classification: `Delete Candidate`
- Reason: one-off maintenance helper

`scripts/fix-cafes-route.cjs`
- Classification: `Delete Candidate`
- Reason: sounds transitional

`scripts/check-cafe.cjs`
- Classification: `Needs Review`

`scripts/list-cafes.cjs`
- Classification: `Needs Review`

`scripts/show-events.cjs`
- Classification: `Cafe OS`

`scripts/show-events.js`
- Classification: `Delete Candidate`
- Reason: duplicate-looking script next to `.cjs` version

`scripts/reportTransactions.cjs`
- Classification: `Cafe OS`

`scripts/exportEventsCsv.cjs`
- Classification: `Cafe OS`

`scripts/reset-cafes.cjs`
- Classification: `Cafe OS`

## Infra / Docs

`infra/docker/DEPLOY.md`
- Classification: `Shared`
- Keep during split

`infra/docker/prod.env.example`
- Classification: `Shared`

`infra/docker/staging.env.example`
- Classification: `Shared`

## Root-Level Working Files

`initate_session`
- Classification: `Shared`
- Keep during split
- Later: probably replace with product-specific startup scripts

`pnpm-workspace.yaml`
- Classification: `Shared`
- Keep until repos are split

`package.json`
- Classification: `Shared`
- Keep until repos are split

`pnpm-lock.yaml`
- Classification: `Shared`
- Keep until repos are split

## Immediate Cleanup Candidates

These are the safest early deletion/review targets:

1. generated logs
   - `apps/.apps-server.err.log`
   - `apps/.apps-server.out.log`
   - `api/.api.err.log`
   - `api/.api.out.log`

2. legacy customer wrappers
   - `apps/customer-home.html`
   - `apps/customer-start.html`
   - `apps/customer-register.html`
   - `apps/customer-qr.html`

3. likely legacy duplicate implementations
   - `apps/customer-qr.js`
   - `scripts/show-events.js`

4. likely obsolete mobile legacy folder
   - `apps/cafe-ios`

## Safe Cleanup Strategy

Recommended order:

1. remove generated log files first
2. remove obvious legacy wrappers with route verification
3. compare old/new duplicate implementations before deletion
4. only then remove larger legacy folders like `apps/cafe-ios`

Do not delete these yet without a quick verification pass:
- `apps/cafe/index.html`
- `apps/customer`
- `scripts/check-cafe.cjs`
- `scripts/list-cafes.cjs`
- any migration helper that may still be used in setup docs

## Suggested Next Step

Create two follow-up documents:

1. `CAFE_OS_MIGRATION_PLAN.md`
2. `COFFEE_GUIDE_MIGRATION_PLAN.md`

Then perform cleanup in small batches:

- Batch 1: logs and obvious dead wrappers
- Batch 2: legacy duplicate customer files
- Batch 3: old mobile app folders
- Batch 4: route and API split
