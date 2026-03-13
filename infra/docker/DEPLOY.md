# Deploy: Staging + Production (single VPS)

Ziel: Auf einem Ubuntu-VPS zwei Umgebungen betreiben:

- **staging**: SQLite (persistiert in Docker Volume)
- **prod**: Postgres (persistiert in Docker Volume) + Migrationen via `api/migrate.cjs`

Beide laufen über den Apps-Server (statisch) und rufen die API **same-origin** über `/api/*` auf.

## 1) VPS vorbereiten (Ubuntu)

1. Docker installieren (inkl. Compose Plugin):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2. User in die Docker-Gruppe:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

3. Ports öffnen (mindestens):
- `8080` (prod apps)
- `8081` (staging apps)

(Je nach Provider: Firewall/Security-Group.)

## 2) GitHub Secrets anlegen

Repository → Settings → Secrets and variables → Actions → **New repository secret**

SSH:
- `STAMP_SSH_HOST`
- `STAMP_SSH_USER`
- `STAMP_SSH_KEY` (private key)
- optional: `STAMP_SSH_PORT`

Staging:
- `STAGING_APPS_PORT` (z.B. `8081`)
- `STAGING_APPS_BASE_URL` (später Domain; aktuell z.B. `http://<SERVER_IP>:8081`)

Prod:
- `PROD_APPS_PORT` (z.B. `8080`)
- `PROD_APPS_BASE_URL` (später Domain; aktuell z.B. `http://<SERVER_IP>:8080`)
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL` (muss in Docker erreichbar sein, z.B. `postgres://USER:PASS@db:5432/DBNAME`)

Email (optional, sonst wird Email-Inhalt nur geloggt):
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`

## 3) Deploy auslösen

- **Staging**: automatisch bei Push auf `main` oder manuell via Actions → "Deploy (staging)"
- **Prod**: manuell via Actions → "Deploy (prod)" oder per Tag `v*`

## 4) Lokal testen (ohne GitHub)

Staging (SQLite):

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml up -d --build
```

Prod (Postgres):

```bash
export POSTGRES_USER=stempel
export POSTGRES_PASSWORD=stempel
export POSTGRES_DB=stempel
export DATABASE_URL=postgres://stempel:stempel@db:5432/stempel

docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml up -d --build db
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml run --rm migrate
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml up -d --build api apps
```

## 5) Betrieb (VPS Cheatsheet)

Status:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml ps
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml ps
```

Logs:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml logs -f --tail=200
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml logs -f --tail=200
```

Neustart:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml restart
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml restart
```

## Domains/HTTPS (später)

Wenn Domains da sind, stellst du `*_APPS_BASE_URL` auf die echte URL um.
Für HTTPS kannst du davor einen Reverse Proxy (Caddy/Nginx) setzen. (Kann ich dir als nächsten Schritt auch vorbereiten.)
