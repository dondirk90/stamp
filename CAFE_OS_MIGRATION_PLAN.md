# Cafe OS Migration Plan

## Purpose

`Cafe OS` should become the focused product for a single cafe's operations and customer retention.

It continues the strongest part of the current project:
- stamp cards
- rewards
- scanner flows
- customer wallet
- promotions / popups
- cafe onboarding and management

## Product Scope

### Keep in Cafe OS

- cafe onboarding
- cafe login / profile
- scanner and redeem flows
- reward program setup
- customer wallet tied to rewards
- customer profile tied to loyalty
- QR issuance and verification
- live event updates for stamp/redeem state
- operational demo/mobile scripts

### Remove from Cafe OS

- map-first guest discovery as the main app identity
- public consumer rating system
- specialty coffee guide logic
- bean encyclopedia / roaster catalog as first-class product features

These may still exist as small supporting public profile pages, but not as the core product.

## Initial File Set

### Primary Web Surfaces

- `apps/cafe-onboarding.html`
- `apps/cafe-scanner-new.html`
- `apps/cafe-profile.html`
- `apps/cafe-dashboard.html`
- `apps/cafe-issuer-web.html`
- `apps/customer-qr-modern.html`
- `apps/customer-qr-modern.js`
- `apps/customer-profile.html`
- `apps/customer-profile.js`
- `apps/ui.js`
- `apps/theme.css`
- `apps/server.cjs`

### Mobile Surfaces

- `apps/cafe-ios-new`
- `apps/customer-ios-new`

### Backend Areas

Keep and later isolate these domains in `api/server.cjs`:
- cafe auth
- customer loyalty auth
- stamps
- rewards
- redeem/reset
- scanner actions
- customer password reset for loyalty accounts

## Route Groups To Keep

### Cafe OS Routes

- `/cafe-onboarding`
- `/cafe-scanner`
- `/cafe-profile`
- `/cafe-dashboard`
- `/customer-wallet`
- `/customer-profile`

### Cafe OS API Domains

- cafe auth routes
- customer auth routes used by loyalty wallet
- stamp history
- stamps by customer/cafe
- redeem / reset-card
- live event stream

## First Cleanup Inside Cafe OS

### Remove Early

- old redirect wrappers already removed
- legacy customer web implementation if unused
- legacy mobile folders after verification
- guide-facing discovery ambitions that do not support rewards

### Review Before Removing

- `apps/cafe-public.html`
- map-related code that may still support finding nearby loyalty cafes

## Refactor Goals

### Backend

Split `api/server.cjs` by feature modules:
- `cafe-auth`
- `customer-auth`
- `rewards`
- `scanner`
- `customer-wallet`

### Frontend

Reshape navigation around operations:
- Dashboard
- Scanner
- Rewards
- Customers
- Profile
- Promotions

## Suggested Repo Outcome

Target repo:
- `stamp-cafe-os`

This repo should feel operational and business-focused, not discovery-first.

## Immediate Next Work

1. identify all guide-only code paths inside `customer-qr-modern.*`
2. keep wallet/reward functionality but remove guide ambitions from product messaging
3. isolate cafe public profile concerns that are only needed for loyalty support
4. trim unused legacy files after route verification

## Success Criteria

`Cafe OS` is successful when:
- a cafe can onboard and manage its reward system
- staff can scan and redeem reliably
- customers can manage their loyalty wallet
- the product no longer feels like a hybrid discovery app
