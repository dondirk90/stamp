# Coffee Guide Migration Plan

## Purpose

`Coffee Guide` should become a separate consumer-facing product centered around discovering and understanding specialty coffee cafes.

Its core identity is not loyalty.
Its core identity is discovery, information, and community judgment.

## Product Scope

### Keep in Coffee Guide

- map as the primary navigation surface
- public cafe profiles
- rich cafe metadata
- coffee offerings
- bean / roaster / brew information
- favorites and collections
- ratings across multiple criteria
- discovery flows

### Remove from Coffee Guide

- stamp balances
- rewards
- redeem/reset flows
- scanner
- loyalty wallet
- operational cafe management flows
- reward popups

## Product Model

### Core User Journey

1. open the map
2. discover nearby cafes
3. inspect a detailed cafe profile
4. see bean / roaster / drink information
5. rate the cafe across multiple dimensions
6. save to favorites or collections

### Proposed Rating Dimensions

Examples:
- coffee quality
- espresso
- filter coffee
- milk drinks
- atmosphere
- service
- value
- workspace friendliness

## Initial File Set

### Likely Starting Files

- `apps/cafe-public.html`
- `apps/cafe/index.html`
- map-related parts of `apps/customer-qr-modern.html`
- map-related parts of `apps/customer-qr-modern.js`
- shared styling and UI helpers
- shared cafe/public API support

### Shared Files To Copy Then Trim

- `apps/server.cjs`
- `apps/theme.css`
- `apps/ui.js`
- `api/server.cjs`
- `api/db.cjs`

## Major Refactor Requirement

The current map/discovery experience is embedded inside a loyalty-oriented customer app.

That means `Coffee Guide` should not just rename the current customer wallet.
Instead it should extract and rebuild around:
- map
- search
- filters
- public profiles
- ratings

## Route Groups To Create

Suggested public routes:
- `/`
- `/map`
- `/cafes/:id`
- `/collections`
- `/favorites`
- `/profile`

Short-term static route equivalent:
- `/coffee-guide-map`
- `/coffee-guide-cafe`

## Backend Domains To Introduce

### New Guide Domains

- guide cafe profile enrichment
- bean offerings
- roasters
- brew methods
- user ratings
- user favorites
- collections

### Shared Existing Domains

- base cafe profile
- media
- geo coordinates

### Remove From Guide Backend

- loyalty-specific customer wallet endpoints
- redeem token flows
- scanner/reward APIs

## Data Enrichment Needed

Each cafe should be able to store much richer information than today.

Suggested fields:
- short concept description
- long description
- house beans
- guest roasters
- espresso bean
- filter options
- decaf availability
- roast styles
- processing methods
- origin countries
- brewing equipment
- oat milk / alt milk support
- pastries / food offering
- wifi / laptop friendliness
- dog friendly
- outdoor seating

## Suggested Repo Outcome

Target repo:
- `stamp-coffee-guide`

The product should feel editorial, discoverable, and city-exploration oriented.

## Immediate Next Work

1. extract map logic from `customer-qr-modern.js`
2. define a dedicated guide landing page
3. create a richer `CafeGuideProfile` data shape
4. strip reward and wallet flows from the main consumer experience
5. design the cafe detail page around information, not redemption

## Success Criteria

`Coffee Guide` is successful when:
- a guest can explore cafes through the map first
- cafe detail pages feel rich and informative
- ratings and discovery are first-class
- no stamp/reward logic remains in the primary user experience
