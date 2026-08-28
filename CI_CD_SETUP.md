# CI/CD Setup

This repo has **7** GitHub Actions workflows, in two groups: three deploy the
web app/API to a server, four build the native (Capacitor) apps for
TestFlight/Play internal testing.

| Workflow | File | Trigger | What it does |
| --- | --- | --- | --- |
| CI | `ci.yml` | push/PR to `test` or `main` | `node --check` + Docker image builds only, no deploy |
| Deploy Staging | `deploy-staging.yml` | **auto** on push to `test`, or manual | Deploys web app + API to `staging.kaffeekarte.app` |
| Deploy Production | `deploy-prod.yml` | **manual only**, or push tag `v*` | Deploys web app + API + runs DB migrations on `kaffeekarte.app` |
| Build Android Customer App | `build-android-customer.yml` | manual only | Builds + uploads the customer Android app to Play internal + closed testing |
| Build iOS Customer App | `build-ios-customer.yml` | manual only | Builds + uploads the customer iOS app to TestFlight |
| Build Android Cafe App | `build-android-cafe.yml` | manual only | Same as above, for the café/barista app |
| Build iOS Cafe App | `build-ios-cafe.yml` | manual only | Same as above, for the café/barista app |

## The single most important gotcha

**Every manual ("Run workflow") trigger has its own branch selector** in the
GitHub UI ("Use workflow from"), separate from any input fields on the form.
GitHub does not remember your last choice - it silently offers whatever the
repo's default branch is (normally `main`) unless you change it.

- `main` is **not** kept in sync automatically. Per the branch workflow this
  repo actually uses, `main` only updates via the user's own reviewed GitHub
  PR - `test` is where active development actually happens and gets pushed.
- Running a workflow with the branch selector left on `main` silently builds
  whatever old code happens to be there, with no error - this has actually
  happened (an Android build ran a Fastfile from before that day's fixes
  because `main` was selected instead of `test`).

**Rule of thumb: always explicitly select `test` in "Use workflow from"
before clicking "Run workflow", for every one of the 7 workflows, unless you
specifically mean to release whatever is currently on `main`.**

The 4 native build workflows have a **second** dropdown with the same kind of
foot-gun: **"Which deployed web app to point the build at"** (`target:
staging` / `prod`), defaulting to `staging`. This is unrelated to which
Play/TestFlight track the build goes to - a build can go to a public store
listing while still pointing at the staging backend if `prod` wasn't
explicitly picked. This exact mistake shipped an App Store build that loaded
`staging.kaffeekarte.app` (SQLite test data) instead of production, discovered
only after the build was already approved and live.

**Rule of thumb: for any build meant for real users (production App
Store/Play listing, or testing with real prod data), explicitly select
`target: prod`.** Staging is the safe default for everyday internal testing.

## Deploy Staging

- Trigger: automatic on every push to `test` (also has `workflow_dispatch` as
  a manual fallback).
- Runs SQLite (`# SQLite mode: omit DATABASE_URL` in
  `infra/docker/docker-compose.staging.yml`) - no Postgres, no migrations to
  run. Data lives in a Docker volume and self-heals its schema at server
  startup (`runSqliteOnlyAlter()` in `api/server.cjs`).
- Uploads the repo as a tarball over SSH to `/opt/stamp` on the VPS, then
  `docker compose ... up -d --build` rebuilds and restarts the staging stack.
- Web-only changes (HTML/CSS/JS in `apps/`, `api/server.cjs`, etc.) go live
  here automatically - **no native app rebuild needed**, since the native
  apps just load this URL at runtime ("remote-URL mode").

## Deploy Production

- Trigger: **manual only** (`workflow_dispatch`), or pushing a `v*` git tag.
  Does **not** run automatically on push, to either `test` or `main`.
- Runs Postgres. Before restarting the API, it:
  1. Starts the `db` service.
  2. Runs the `migrate` service (`api/migrate.cjs`), which re-applies every
     file in `api/migrations/` unconditionally (all are
     `IF NOT EXISTS`-guarded, so this is safe/idempotent every time - it's
     not just applying new ones, it's the safety net against schema drift).
  3. Runs a **schema sanity check**: a `psql` query asserting specific
     tables/columns exist. If it doesn't say `ok`, the deploy fails
     (`set -euo pipefail`) *before* the API/apps containers restart, rather
     than shipping a broken schema silently. This check exists because that
     silent-breakage already happened twice (see `api/migrations/`'s newest
     files and their commit messages for the incidents) - if you add a new
     column via `runSqliteOnlyAlter()` for local SQLite convenience, you
     **must** also write a real migration file for Postgres, and ideally add
     it to this sanity check too.
  4. Only then rebuilds/restarts `api`, `apps`, `caddy`.
- Same "no native rebuild needed for web-only changes" logic as staging
  applies here too - but remember the currently-live App Store/Play builds
  only pick up a new prod deploy if they were themselves built with
  `target: prod` (see the gotcha above).

## Native app builds (customer + cafe, Android + iOS)

All four follow the identical shape:

1. `target: staging|prod` picks `CAP_SERVER_URL`, baked into the app via
   `cap sync` - this is fixed at build time, the compiled app can't switch
   later.
2. Android: builds via `fastlane android beta`
   (`apps/*-native/fastlane/Fastfile`), which:
   - Computes the next Play `versionCode` from the highest one Play has
     already seen on any track (`google_play_track_version_codes`), retrying
     forward if Play rejects it as already-used (this happens even for
     versions never fully released, since Play burns the number on any
     upload attempt).
   - Writes that versionCode directly into `android/app/build.gradle` (no
     working fastlane action does this out of the box for this project - two
     different action names were tried and don't exist/apply here, see the
     Fastfile's own comments).
   - Uploads to the `internal` track, then promotes the same build (no
     re-upload) to the `geschlossener Test` closed-testing track via
     `track_promote_to` - Play requires an active closed test (12+ testers,
     14 days) before granting production access to newer developer accounts.
   - Also produces a signed, directly-sideloadable `.apk` as a workflow
     artifact (separate from the Play-uploaded `.aab`).
3. iOS: builds via `fastlane beta` (App target), which asks App Store
   Connect for the latest TestFlight build number and increments it (a
   static number would get every re-upload rejected), then uploads to
   TestFlight.
4. iOS builds fail with "Invalid Pre-Release Train...closed for new build
   submissions" once the current `MARKETING_VERSION` (in
   `App.xcodeproj/project.pbxproj`) has already been approved/released on the
   App Store - bump `MARKETING_VERSION` to a new version number (e.g.
   `1.0` → `1.1`) before rebuilding in that case.

None of the 4 build workflows deploy to the App Store/Play Store production
listing themselves - they only reach TestFlight / Play internal+closed
testing. Promoting to the public listing is a separate, manual step in App
Store Connect / Play Console (see `NATIVE_APP_PLAN.md`).

## CI

- Runs on every push/PR to `test` and `main`.
- `node --check` on the core server-side JS files, then builds the `api` and
  `apps` Docker images. No deploy, no tests beyond syntax + image build.

## What you need in GitHub Secrets

Staging and production use **different SSH secret names** (not shared) -
easy to miss if you're hunting for one set:

Staging SSH:

- `STAMP_SSH_HOST`
- `STAMP_SSH_USER`
- `STAMP_SSH_KEY`
- (`STAMP_SSH_PORT` is read with a default of `22` if unset)

Production SSH:

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USER`
- `SSH_KEY`

Staging (rest):

- `STAGING_APPS_BASE_URL`
- `STAGING_DOMAIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_STATE_SECRET`
- `ADMIN_TOKEN`
- `ADMIN_BASIC_USER`
- `ADMIN_BASIC_HASH`
- (email/Apple OAuth secrets are optional on staging - passed through with
  empty-string defaults in `docker-compose.staging.yml`)

Production (rest):

- `PROD_APPS_BASE_URL`
- `PROD_DOMAIN`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_STATE_SECRET`
- `APPLE_TEAM_ID`, `APPLE_SERVICES_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_BASE64`
  (used to write `.env.prod`, not validated as required by the workflow's own
  secret check, but needed for Sign in with Apple to work in prod)
- `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`
  (Google Wallet loyalty cards for Android - Issuer account from
  pay.google.com/business/console, service account JSON key base64-encoded)
- `ADMIN_TOKEN`, `ADMIN_BASIC_USER`, `ADMIN_BASIC_HASH`

Native app builds (Android, both apps share these):

- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- `PLAY_JSON_KEY`

Native app builds (iOS, both apps share these):

- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY`
- `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION`

## Recommended current values

Staging:

- `STAMP_SSH_HOST=87.106.60.49`
- `STAMP_SSH_PORT=22`
- `STAMP_SSH_USER=root`
- `STAGING_APPS_PORT=8081`
- `STAGING_APPS_BASE_URL=https://staging.kaffeekarte.app`
- `STAGING_DOMAIN=staging.kaffeekarte.app`
- `ADMIN_BASIC_USER=admin`

## SSH key setup

Do not keep CI/CD on a root password.

Recommended:

1. Generate a dedicated deploy key locally:
   - `ssh-keygen -t ed25519 -C "github-actions-stamp" -f ~/.ssh/stamp_actions`
2. Add the public key to the server:
   - append contents of `stamp_actions.pub` to `/root/.ssh/authorized_keys`
3. Add the private key to GitHub secret:
   - `STAMP_SSH_KEY` (staging) / `SSH_KEY` (production)

## Server prerequisites

The VPS should already have:

- Docker
- Docker Compose plugin
- ports `80`, `443`, and `8081` reachable as needed

Important:

- If staging and production run on the same VPS, only one stack can bind public `80/443`.
- The recommended setup is a dedicated production server or one shared edge proxy that routes both domains.
- Do not start the production Caddy service on the same host while staging Caddy is already bound to `80/443` unless you have planned that cutover.

## Notes

- The workflows upload the repo archive from GitHub Actions to the server.
- This avoids the server needing GitHub clone credentials for a private repo.
- Existing `.env.staging` and `.env.prod` files are preserved and then rewritten from GitHub secrets during deploy.
- For the admin dashboard, generate the Caddy hash with:
  - `docker run --rm caddy:2 caddy hash-password --plaintext 'DEIN_PASSWORT'`
- In GitHub Secrets, store the hash exactly as generated.
- In `.env.staging` files, dollar signs must be escaped as `$$`, but GitHub Secrets keep the normal `$` form.
