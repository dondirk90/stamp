# Deploy: Staging + Production (single VPS)

Ziel: Auf einem Ubuntu-VPS zwei Umgebungen betreiben:

- **staging**: SQLite (persistiert in Docker Volume)
- **prod**: Postgres (persistiert in Docker Volume) + Migrationen via `api/migrate.cjs`

Beide laufen über den Apps-Server (statisch) und rufen die API **same-origin** über `/api/*` auf.

## Minimal-Setup (günstig & gut): 1 VPS, keine Domain, nur IP:Port

Wenn es einfach nur **extern erreichbar** sein soll (ohne Domain/HTTPS), ist das der schnellste Weg.
Du brauchst nur einen Ubuntu-VPS + Port-Freigabe.

### Empfehlung

- **Am simpelsten**: `staging` (SQLite, 2 Container: apps+api)
- **Am „production-nahesten“**: `prod` (Postgres + Migrationen, 3–4 Container)

In beiden Fällen erreichst du alles über **eine** Base-URL (z.B. `http://<SERVER_IP>:8080`) und mehrere Pfade:

- `/` (Start)
- `/customer-wallet`
- `/cafe-scanner`
- `/__diag` zum Debuggen

### VPS: Ports öffnen

Beim Provider/Firewall mindestens öffnen:

- TCP `22` (SSH)
- TCP `8080` (Apps)

Optional für parallel:

- TCP `8081` (staging neben prod)

Wenn du `ufw` nutzt (optional):

```bash
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
# optional
sudo ufw allow 8081/tcp
sudo ufw enable
sudo ufw status
```

### Minimal: Staging deployen (SQLite, empfohlen fürs schnelle Loslegen)

```bash
sudo mkdir -p /opt/stamp
sudo chown -R "$USER":"$USER" /opt/stamp
cd /opt/stamp

# 1x
git clone <DEIN_REPO_URL> .

# Updates
git pull

# Env anlegen (Beispiel kopieren und anpassen)
cp infra/docker/staging.env.example .env.staging

docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml --env-file .env.staging ps
```

Check (auf dem VPS):

```bash
curl -fsS http://127.0.0.1:8081/__ping
curl -fsS http://127.0.0.1:8081/api/health
```

Extern im Browser:

- `http://<SERVER_IP>:8081/__diag`
- `http://<SERVER_IP>:8081/customer-wallet`

### Minimal: Prod deployen (Postgres + Migrationen)

```bash
sudo mkdir -p /opt/stamp
sudo chown -R "$USER":"$USER" /opt/stamp
cd /opt/stamp

git clone <DEIN_REPO_URL> .
git pull

cp infra/docker/prod.env.example .env.prod

docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod up -d --build db
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod run --rm migrate
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod up -d --build api apps

docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml --env-file .env.prod ps
```

Check (auf dem VPS):

```bash
curl -fsS http://127.0.0.1:8080/__ping
curl -fsS http://127.0.0.1:8080/api/health
```

Extern im Browser:

- `http://<SERVER_IP>:8080/__diag`
- `http://<SERVER_IP>:8080/customer-wallet`

### Updates (ohne GitHub Actions)

- `staging`: `git pull` → `docker compose ... up -d --build`
- `prod`: `git pull` → `docker compose ... up -d --build db` → `docker compose ... run --rm migrate` → `docker compose ... up -d --build api apps`

Hinweis: Verwende auf dem VPS **nicht** `infra/docker/docker-compose.yml` (das ist für lokale DB/Redis).

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
- `PROD_DOMAIN` (z.B. `app.cafestamp.app`)
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL` (muss in Docker erreichbar sein, z.B. `postgres://USER:PASS@db:5432/DBNAME`)
- `ADMIN_TOKEN`
- `ADMIN_BASIC_USER`
- `ADMIN_BASIC_HASH`

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
