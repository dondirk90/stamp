# CI/CD Setup

This repo now has three GitHub Actions workflows:

- `CI`
  - runs on push and pull request for `test` and `main`
  - checks core Node files with `node --check`
  - builds the `api` and `apps` Docker images

- `Deploy Staging`
  - runs automatically on push to `test`
  - deploys to the staging VPS

- `Deploy Production`
  - runs manually or on tags like `v1.0.0`
  - intended only after merge to `main`

## Recommended branch flow

- `test`
  - active development
  - auto deploys to staging

- `main`
  - reviewed and stable
  - production releases only from here

## What you need in GitHub Secrets

Repository secrets:

- `STAMP_SSH_HOST`
- `STAMP_SSH_PORT`
- `STAMP_SSH_USER`
- `STAMP_SSH_KEY`

Staging:

- `STAGING_APPS_PORT`
- `STAGING_APPS_BASE_URL`
- `STAGING_DOMAIN`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_SECURE`
- `EMAIL_USER`
- `EMAIL_PASS`

Production:

- `PROD_APPS_PORT`
- `PROD_APPS_BASE_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`

## Recommended current values

Staging:

- `STAMP_SSH_HOST=87.106.60.49`
- `STAMP_SSH_PORT=22`
- `STAMP_SSH_USER=root`
- `STAGING_APPS_PORT=8081`
- `STAGING_APPS_BASE_URL=https://staging.kaffeekarte.app`
- `STAGING_DOMAIN=staging.kaffeekarte.app`

## SSH key setup

Do not keep CI/CD on a root password.

Recommended:

1. Generate a dedicated deploy key locally:
   - `ssh-keygen -t ed25519 -C "github-actions-stamp" -f ~/.ssh/stamp_actions`
2. Add the public key to the server:
   - append contents of `stamp_actions.pub` to `/root/.ssh/authorized_keys`
3. Add the private key to GitHub secret:
   - `STAMP_SSH_KEY`

## Server prerequisites

The VPS should already have:

- Docker
- Docker Compose plugin
- ports `80`, `443`, and `8081` reachable as needed

## Release behavior

Staging:

- push to `test`
- GitHub uploads the repo to `/opt/stamp`
- staging stack rebuilds and restarts automatically

Production:

- merge approved changes to `main`
- optionally create a version tag like `v1.0.0`
- run manual deploy or push tag

## Notes

- The workflows upload the repo archive from GitHub Actions to the server.
- This avoids the server needing GitHub clone credentials for a private repo.
- Existing `.env.staging` and `.env.prod` files are preserved and then rewritten from GitHub secrets during deploy.
