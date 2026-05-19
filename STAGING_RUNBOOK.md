# Staging Runbook for Cafe Stamp

This runbook describes the recommended staging setup for `Cafe OS`.

The purpose of staging is:

- test from the `test` branch
- verify PWA behavior under HTTPS
- validate deploys before `main`
- test on real phones without local tunnels

## Staging Principles

Staging should be:

- public but access-controlled if needed
- close to production in routing
- simpler than production in data storage
- disposable enough for rapid iteration

Recommended first version:

- one VPS
- Docker Compose
- SQLite
- reverse proxy with HTTPS
- one domain or subdomain such as `staging.cafestamp.app`

## Branch Policy

Staging deploys from:

- `test`

Production deploys from:

- `main`

This keeps staging aligned with active feature work and protects production from unfinished changes.

## Recommended Topology

- reverse proxy: Caddy or Nginx
- apps container
- api container
- SQLite volume

Traffic flow:

1. phone/browser requests `https://staging...`
2. reverse proxy terminates TLS
3. proxy forwards to Apps Server
4. Apps Server proxies `/api/*` to API container

## Existing Repo Assets

Use the existing staging files:

- [infra/docker/docker-compose.staging.yml](/abs/path/d:/stamp/infra/docker/docker-compose.staging.yml:1)
- [infra/docker/staging.env.example](/abs/path/d:/stamp/infra/docker/staging.env.example:1)
- [infra/docker/DEPLOY.md](/abs/path/d:/stamp/infra/docker/DEPLOY.md:1)

## Staging Environment Variables

Base starting point:

- copy `infra/docker/staging.env.example` to `.env.staging`

Important values to define:

- external base URL
- app port
- email configuration if needed
- any feature flags required for testing

For PWA validation, the base URL must use HTTPS.

## Server Setup

Recommended directory:

```bash
/opt/stamp
```

Recommended services:

- Docker Engine
- Docker Compose plugin
- reverse proxy

Recommended DNS:

- `staging.cafestamp.app` -> VPS IP

## Staging Deployment Steps

1. Pull latest `test`
2. Update `.env.staging` if needed
3. Rebuild and start staging containers
4. Verify health endpoints
5. Verify wallet and scanner routes
6. Verify installed PWA behavior on phone

Reference compose command from the existing setup:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml --env-file .env.staging up -d --build
```

## Staging Verification Checklist

Infrastructure:

- `https://staging.../__ping`
- `https://staging.../api/health`
- containers running without restart loops

Product:

- cafe onboarding loads
- cafe scanner login works
- customer wallet login works
- card stamping works end-to-end
- reward redemption works end-to-end

PWA:

- browser sees manifest
- service worker registers
- install prompt works where supported
- homescreen launch works
- scanner camera still works in installed mode

## Suggested Access Protection

Early staging options:

- HTTP Basic Auth at the reverse proxy
- secret staging URL
- limited tester group

Do not protect `/api/*` in a way that breaks the app’s own requests.

## Logging and Monitoring

Minimum staging observability:

- Docker container logs
- disk space monitoring
- `/api/health`
- TLS certificate status

Nice to have:

- uptime monitor on `/api/health`
- simple alert if staging is down

## Test Scenarios Before Merge

Every branch intended for merge to `main` should pass:

1. fresh login on phone
2. return visit with saved session
3. scanner camera permission flow
4. stamp issuance
5. reward redemption
6. PWA install and relaunch
7. weak-network reopen behavior

## Rollback Strategy

If a staging deploy is broken:

1. identify the last known good commit on `test`
2. redeploy that commit
3. verify `/api/health`
4. retest wallet and scanner

Keep rollback simple.
Staging should favor speed and confidence over perfect automation.
