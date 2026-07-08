# Production Release Plan for Cafe Stamp

This document defines how `Cafe OS` should move from staging to a real production deployment.

The goal is a repeatable release process with clear promotion gates:

- develop on `test`
- validate on staging
- merge to `main`
- deploy to production

## Production Principles

Production should optimize for:

- reliability
- recoverability
- predictable deploys
- safe data storage
- secure HTTPS access

Production should not be the place where PWA behavior is discovered for the first time.

## Recommended Production Stack

- one VPS to start
- Docker Compose
- Postgres
- Apps Server container
- API container
- reverse proxy with HTTPS
- persistent DB backup strategy

This aligns with the existing production compose setup already present in the repo.

Existing files:

- [infra/docker/docker-compose.prod.yml](/abs/path/d:/stamp/infra/docker/docker-compose.prod.yml:1)
- [infra/docker/prod.env.example](/abs/path/d:/stamp/infra/docker/prod.env.example:1)
- [infra/docker/DEPLOY.md](/abs/path/d:/stamp/infra/docker/DEPLOY.md:1)

## Promotion Flow

1. work lands on `test`
2. staging deploy is updated
3. product and technical checks pass
4. branch is merged to `main`
5. production deploy is triggered
6. smoke tests confirm release health

## Release Gates

A release is allowed only if all of these are true:

- staging app is healthy
- key flows were tested on phone
- PWA install/reopen works if PWA code changed
- database migrations were reviewed
- rollback path is known

## Database Strategy

Use Postgres in production.

Why:

- more robust than SQLite under concurrent real usage
- safer growth path
- better operational discipline

Before every production release:

- know whether the release contains schema changes
- run migrations explicitly
- confirm DB connectivity before app rollout

## Environment and Secrets

Production needs a stable `.env.prod` with:

- database credentials
- base URLs
- email credentials
- any auth or operational secrets

Rules:

- never edit secrets ad hoc during rollout unless required
- keep a secure source of truth for the values
- document owner and rotation process

## Reverse Proxy and HTTPS

Production should use:

- a real domain
- automatic TLS renewal
- reverse proxy in front of the Apps Server

Recommended public URL shape:

- `https://app.cafestamp.app`

If staging and production share one VPS, plan the public edge carefully:

- only one reverse proxy stack can own ports `80` and `443`
- either production gets its own VPS
- or one shared edge proxy must route both `staging` and `production` domains
- do not assume the staging Caddy container and production Caddy container can both bind the same public ports at once

This is especially important because:

- scanner camera support is more reliable over HTTPS
- PWA installability expects secure context
- user trust is much higher

## Production Deployment Sequence

1. confirm latest tested commit on `main`
2. create backup or confirm recent backup availability
3. deploy DB container if needed
4. run migrations
5. deploy API and Apps containers
6. verify health endpoints
7. run smoke tests
8. monitor logs for a short release window

Reference shape from the existing repo:

```bash
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod up -d --build db
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod run --rm migrate
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod up -d --build api apps
```

## Smoke Tests After Deploy

Infrastructure:

- `/__ping`
- `/api/health`

Product:

- customer login
- cafe login
- scanner open
- wallet open
- stamp issuance
- reward redemption

PWA:

- manifest resolves
- service worker registers
- installed app still launches after update

## Rollback Plan

The rollback plan should always exist before release.

Minimum rollback options:

- redeploy previous image/build
- redeploy previous git commit
- restore DB backup only if absolutely required

Important:

Application rollback is easy.
Database rollback is harder.
Schema-changing releases should be treated carefully and preferably be backward-compatible for one release window.

## Backups

Minimum production backup policy:

- daily Postgres backup
- retain multiple restore points
- test restore procedure at least once

A backup is only real if restore has been tested.

## Monitoring

Minimum production monitoring:

- uptime check on `/api/health`
- reverse proxy/TLS expiry awareness
- container restart monitoring
- disk usage monitoring
- DB volume capacity monitoring

Nice to have:

- release markers in logs
- error aggregation
- structured request logging

## Change Management

Changes that should trigger extra caution:

- auth/session changes
- scanner/camera changes
- service worker changes
- migrations
- reward/stamp business logic

For these releases, do an explicit manual smoke test on a real phone after deploy.

## First Production Milestones

### Milestone 1

- deploy current app to production with HTTPS
- no PWA yet
- validate stable real-world hosting

### Milestone 2

- deploy first PWA shell
- manifest + icons + conservative service worker
- validate install and reopen

### Milestone 3

- refine update strategy
- improve monitoring
- consider web push later

## Definition of Production Ready

The app is production ready when:

- staging and production are clearly separated
- production uses Postgres
- HTTPS is mandatory
- backups and rollback are documented
- release gates are followed
- core cafe and customer flows are smoke-tested per release
