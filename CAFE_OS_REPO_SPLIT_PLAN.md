# Cafe OS Repo Split Plan

## Goal

Create the first dedicated product repo:

- `stamp-cafe-os`

This repo should become the focused continuation of the current project's loyalty and cafe operations platform.

It should explicitly avoid becoming a hybrid discovery guide.

## Source Branch

Recommended source:
- current `test` branch

Reason:
- latest working fixes already included
- current cleanup already started
- product split planning documents already available

## Repo Creation Strategy

### Preferred Approach

1. create new GitHub repo `stamp-cafe-os`
2. copy current project state from `test`
3. remove clearly non-`Cafe OS` assets in small batches
4. stabilize routes, docs, and startup flow

### Why Not Over-Optimize First

Do not wait for a perfect architecture before splitting.

The fastest safe path is:
- split first
- clean second
- refactor third

## Product Definition

`Cafe OS` is the product for one cafe to run:

- loyalty
- rewards
- scanner flows
- customer engagement
- operational profile management
- promotions / popups

It is not the specialty coffee discovery guide.

## Initial Keep Set

### Web Frontend

Keep these files as first-class `Cafe OS` surfaces:

- `apps/cafe-onboarding.html`
- `apps/cafe-scanner-new.html`
- `apps/cafe-profile.html`
- `apps/cafe-dashboard.html`
- `apps/cafe-logout.html`
- `apps/cafe-issuer-web.html`
- `apps/customer-qr-modern.html`
- `apps/customer-qr-modern.js`
- `apps/customer-profile.html`
- `apps/customer-profile.js`
- `apps/server.cjs`
- `apps/theme.css`
- `apps/ui.js`
- `apps/index.html` only temporarily until replaced with product-specific landing

### Mobile

Keep:
- `apps/cafe-ios-new`
- `apps/customer-ios-new`

### Backend

Keep:
- `api/server.cjs`
- `api/db.cjs`
- `api/migrate.cjs`
- `api/migrations`
- `api/package.json`
- `api/Dockerfile`

### Dev / Ops Scripts

Keep:
- `scripts/share-ios.mjs`
- `scripts/start-mobile-dev.ps1`
- `scripts/setup-firewall.ps1`
- `scripts/stop-all.ps1`
- `scripts/restart-all.ps1`
- `scripts/check-status.ps1`
- `scripts/ui-screenshots.mjs`
- `scripts/issue-qr.cjs`
- `scripts/verify-cross-cafe-stamp.cjs`
- `scripts/exportEventsCsv.cjs`
- `scripts/reportTransactions.cjs`
- `scripts/reset-cafes.cjs`

### Root / Infra

Keep:
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `initate_session`
- `infra/docker/DEPLOY.md`
- `infra/docker/prod.env.example`
- `infra/docker/staging.env.example`

## Remove Early

These are good first removal candidates inside `stamp-cafe-os`:

- `apps/customer-home.html`
- `apps/customer-start.html`
- `apps/customer-register.html`
- `apps/customer-qr.html`

Already identified as obsolete redirect wrappers.

## Remove After Quick Verification

### Likely Legacy / Duplicate

- `apps/customer-qr.js`
- `scripts/show-events.js`
- `apps/cafe-ios`

### Strong Review Candidates

- `apps/cafe-public.html`
- `apps/cafe/index.html`
- `scripts/debug-map-init.mjs`

Reason:
- they may still provide useful support for public loyalty-facing cafe pages
- but they should not steer the product toward guide-first discovery

## Keep Temporarily, Simplify Later

The following likely stay short-term but should be narrowed in product scope:

- map-related code inside `apps/customer-qr-modern.*`
- public cafe information in support of loyalty users
- customer-facing content that explains cafes beyond reward usage

The rule is:
- support loyalty
- avoid becoming the guide

## Route Strategy

### Short-Term Keep

Keep these routes:
- `/cafe-onboarding`
- `/cafe-scanner`
- `/cafe-profile`
- `/cafe-dashboard`
- `/customer-wallet`
- `/customer-profile`

### Medium-Term Cleanup

Reduce alias clutter and keep canonical routes only:
- `/customer-wallet`
- `/customer-profile`
- `/cafe-onboarding`
- `/cafe-scanner`
- `/cafe-profile`
- `/cafe-dashboard`

## Backend Refactor Targets

### Keep Domains

Inside `api/server.cjs`, keep and later modularize:

- cafe registration/login
- customer registration/login for loyalty wallet
- stamp tracking
- reward redemption
- reset-card flows
- event streaming
- cafe profile management

### Extract Later

Refactor `api/server.cjs` into modules such as:
- `api/routes/cafe-auth`
- `api/routes/customer-wallet`
- `api/routes/rewards`
- `api/routes/scanner`
- `api/routes/public-cafe`

## Documentation Cleanup

After repo creation, replace generic docs with product-specific ones:

### Add / Rewrite

- `README.md` for Cafe OS only
- quickstart instructions for cafe demo
- mobile demo instructions
- deployment guide for Cafe OS

### Archive / Remove

- guide-like wording
- mixed-product messaging
- stale references to replaced customer entry pages

## Branding / Messaging Changes

As soon as the new repo exists, adjust messaging toward:

- loyalty platform
- customer retention
- reward operations
- cafe team tooling

Avoid messaging that suggests:

- city exploration
- coffee guide
- ratings platform
- consumer discovery as primary use case

## Execution Plan

### Step 1

Create `stamp-cafe-os` from current `test` state.

### Step 2

Commit product docs and cleanup baseline.

### Step 3

Delete obvious obsolete wrappers and logs.

### Step 4

Audit `customer-qr-modern.*` and remove guide-leading UX copy.

### Step 5

Refocus landing page and navigation around:
- cafes
- rewards
- scanner
- customer wallet

### Step 6

Refactor backend by domain once product boundaries are stable.

## Definition of Done for First Split

The first `Cafe OS` repo split is good enough when:

1. the app runs independently
2. scanner + wallet + reward flows work
3. the repo no longer contains obvious dead wrappers
4. the product reads as loyalty/operations first
5. guide-first ambitions are no longer the dominant narrative

## Immediate Next Action

After this plan, the next practical move should be:

1. create the `stamp-cafe-os` GitHub repo
2. push the current `test` state into it
3. perform the next cleanup batch there, not in the mixed parent project
