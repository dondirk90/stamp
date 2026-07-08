# Product Split Plan

## Goal

The current project should be split into two clearly separated products:

1. `Cafe OS`
2. `Coffee Guide`

The split should reduce product complexity, improve positioning, and prevent loyalty tooling from bleeding into the guest discovery experience.

## Product Direction

### Cafe OS

`Cafe OS` is the operating system for a single cafe.

Primary focus:
- stamp cards
- rewards
- scanner flows
- customer retention
- promo popups
- cafe account management
- cafe-specific settings and operations

Core user:
- cafe owners
- cafe staff

### Coffee Guide

`Coffee Guide` is the guest-facing discovery product for specialty coffee places.

Primary focus:
- map-first browsing
- rich cafe profiles
- bean and roastery information
- brew methods and coffee offerings
- ratings across multiple criteria
- favorites, collections, and discovery

Core user:
- guests
- coffee enthusiasts
- people exploring cafes across cities

## High-Level Principle

This should not remain one app with multiple modes.

Recommendation:
- derive `Cafe OS` from the current project because most existing operational logic already lives there
- create `Coffee Guide` as a focused fork/product so it does not carry legacy loyalty logic

## Domain Split

### Shared Domain

These concepts likely remain shared or compatible across both products:

- cafe base profile
- name
- address
- geo coordinates
- opening hours
- contact links
- images
- public branding

### Cafe OS Domain

These concepts belong only in `Cafe OS`:

- stamp balances
- rewards
- redeem/reset flows
- QR logic
- scanner
- customer reward history
- event streams for live cafe actions
- cafe session management for operations
- promo popups and operational notices

### Coffee Guide Domain

These concepts belong only in `Coffee Guide`:

- map discovery
- cafe tags and categories
- specialty coffee metadata
- roaster information
- bean origin / processing / varietals
- brew methods
- menus and featured drinks
- guest ratings
- review criteria
- favorites
- collections
- ranking and recommendations

## Proposed Information Architecture

### Cafe OS

Suggested main sections:
- Dashboard
- Scanner
- Rewards
- Customers
- Promotions
- Cafe Profile
- Settings

### Coffee Guide

Suggested main sections:
- Map
- Cafe Detail
- Search / Filters
- Ratings
- Collections
- Favorites
- Profile

Map should be the central entry point in `Coffee Guide`.

## Data Model Recommendations

Introduce a clearer separation between base cafe data and product-specific data.

### Base Cafe Entity

Shared base entity:
- `Cafe`
- `CafeLocation`
- `CafeMedia`

Suggested fields:
- id
- name
- address
- city
- country
- lat
- lng
- logo
- gallery
- openingHours
- website
- instagram
- shortDescription

### Cafe OS Entities

Examples:
- `CafeRewardProgram`
- `CafeRewardRule`
- `CustomerStampCard`
- `RewardRedemption`
- `CafePromotion`
- `CafeSession`

### Coffee Guide Entities

Examples:
- `CafeGuideProfile`
- `CafeBeanOffering`
- `CafeRoaster`
- `CafeBrewMethod`
- `CafeRating`
- `CafeReview`
- `UserFavoriteCafe`
- `UserCollection`

## Current Codebase Mapping

Initial functional mapping based on the current project:

### Move Toward Cafe OS

- `apps/cafe-onboarding.html`
- `apps/cafe-scanner-new.html`
- `apps/cafe-profile.html`
- `apps/cafe-dashboard.html`
- reward, redeem, reset, QR, and stamp logic in API and frontend
- customer wallet logic tied to stamp redemption

### Move Toward Coffee Guide

- public cafe pages
- map-related customer experience
- cafe discovery flows
- rich public cafe metadata
- future ratings and specialty coffee details

### Shared / Needs Refactor

- `api/server.cjs`
- `apps/server.cjs`
- public cafe model
- media upload / image handling
- location and map helpers

## Recommended Repo Strategy

### Preferred Approach

Create two repos:

- `stamp-cafe-os`
- `stamp-coffee-guide`

Optional later:
- shared package or third repo for common domain models and utilities

### Why

Benefits:
- cleaner branding
- simpler deploys
- less accidental coupling
- faster product iteration
- lower UX confusion

## Recommended Execution Order

### Phase 1: Planning

1. Freeze the product boundary.
2. Agree on which features belong to `Cafe OS` vs `Coffee Guide`.
3. Define the shared cafe data shape.

### Phase 2: Inventory

1. Tag existing files as:
   - `Cafe OS`
   - `Coffee Guide`
   - `Shared`
2. Identify which API routes must be split.
3. Identify which frontend assets should be removed from each product.

### Phase 3: First Fork

1. Fork current project into `stamp-cafe-os`.
2. Remove map/discovery ambitions that do not serve cafe operations.
3. Stabilize loyalty, scanner, rewards, and onboarding.

### Phase 4: Guide Fork

1. Fork current project into `stamp-coffee-guide`.
2. Remove loyalty, scanner, wallet, and stamp-specific flows.
3. Keep map, public cafe pages, and base cafe profiles.
4. Build richer specialty coffee information architecture.

### Phase 5: Shared Model Cleanup

1. Normalize shared cafe entities.
2. Remove hidden dependencies between products.
3. Decide whether to share backend pieces or fully separate APIs.

## First Practical Next Steps

The next concrete tasks should be:

1. create a file inventory grouped by `Cafe OS`, `Coffee Guide`, and `Shared`
2. define the target data model for rich cafe/bean information
3. decide whether authentication is shared or separated
4. prepare the first `Cafe OS` fork from the current `test` branch
5. prepare a trimmed `Coffee Guide` fork with map-first UX

## Suggested Decision Defaults

If fast execution matters, default to:

- separate repos
- separate frontends
- separate product branding
- shared cafe import/export shape only where helpful
- no reward logic inside `Coffee Guide`
- no discovery/rating logic inside `Cafe OS`

## Open Questions

These decisions should be clarified before the actual split:

1. Does one cafe profile exist in both products, or are they independently managed?
2. Can a cafe appear in `Coffee Guide` without using `Cafe OS`?
3. Are guest accounts in `Coffee Guide` separate from loyalty customers in `Cafe OS`?
4. Should ratings be public, moderated, or invite-only?
5. Should bean and offering data be manually entered by cafes or curated centrally?

## Recommendation

Proceed with:

- `Cafe OS` as the continuation of the current loyalty/scanner platform
- `Coffee Guide` as a distinct, map-first specialty coffee discovery product

This is the cleanest way to preserve the working business logic while giving the guest-facing product room to become something much stronger.
