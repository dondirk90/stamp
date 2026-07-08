# Server Monitoring Checklist

This checklist is for the first VPS setup of `Cafe Stamp`.

The goal is not enterprise monitoring.
The goal is to detect early when the server is becoming too small or unstable.

## What Matters Most

For this app, the most important warning signals are:

- scanner gets slow
- wallet loads slowly
- logins take longer
- stamp/redeem actions feel delayed
- containers restart unexpectedly
- RAM or disk gets tight

## Quick Daily Check

Run these commands on the server:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml ps
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml logs --tail=100
free -h
df -h
top
```

If production is live:

```bash
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml ps
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml logs --tail=100
```

## Health Endpoints

Check:

```bash
curl -fsS http://127.0.0.1:8081/__ping
curl -fsS http://127.0.0.1:8081/api/health
```

For production:

```bash
curl -fsS http://127.0.0.1:8080/__ping
curl -fsS http://127.0.0.1:8080/api/health
```

Healthy means:

- fast response
- no timeout
- no 5xx errors

## RAM

Check:

```bash
free -h
```

Watch for:

- memory usage often above `80%`
- swap usage no longer `0`

Warning level:

- RAM regularly above `85%`
- swap starts growing during normal use

Action:

- inspect logs
- restart only if necessary
- plan server upgrade if this becomes normal

## CPU

Check:

```bash
top
```

Or install later:

```bash
htop
```

Watch for:

- CPU briefly high during deploys is okay
- CPU staying high for long periods is not okay

Warning level:

- CPU often near full load during normal usage
- API and scanner feel slow at the same time

Action:

- inspect which process is busy
- check if many open connections or heavy image work is happening
- plan larger VPS if sustained

## Disk Space

Check:

```bash
df -h
```

Watch for:

- root disk over `80%`
- Docker images and logs growing
- uploaded images or DB files growing too much

Warning level:

- disk above `85%`

Critical:

- disk above `90%`

Action:

- remove unused Docker images
- rotate logs if needed
- inspect uploads and DB growth
- expand server if needed

## Container Status

Check:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml ps
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml ps
```

Watch for:

- containers restarting
- unhealthy state
- app or api not running

Action:

- inspect logs immediately
- confirm health endpoints

## Logs

Check:

```bash
docker compose -p stamp-staging -f infra/docker/docker-compose.staging.yml logs -f --tail=200
docker compose -p stamp-prod -f infra/docker/docker-compose.prod.yml logs -f --tail=200
```

Watch for:

- repeated `502`
- DB connection failures
- out-of-memory errors
- restart loops
- stack traces during normal usage

## App-Level Symptoms

These are often the first real signs of trouble:

- scanner opens slowly
- camera page freezes or reacts late
- login takes noticeably longer
- stamp issue/redeem takes several seconds
- wallet cards take too long to load
- SSE/live updates disconnect frequently

If users notice these repeatedly, treat that as a real signal even if the server still “looks up”.

## Warning Thresholds

### Observe

- RAM above `75%`
- disk above `70%`
- occasional slow page loads

### Plan Upgrade

- RAM often above `85%`
- swap active under normal traffic
- disk above `85%`
- users report recurring slowness
- containers restart unexpectedly more than once

### Upgrade Soon

- health checks become slow or flaky
- 5xx errors appear during normal use
- scanner/redeem flow lags noticeably
- DB activity feels bottlenecked

## When Migration Is Worth It

Move to a larger server or split staging/prod when one or more of these become true:

- staging and production together noticeably affect each other
- RAM pressure becomes common
- customer-facing latency is visible
- deploys are disruptive
- backups and DB size start to feel heavy

## Good Early Upgrade Path

First upgrade options:

- move from one VPS to a larger VPS
- split staging and production onto separate servers
- keep Docker setup the same

This is the nice part:

- with Docker and a domain, migration is usually manageable
- the app does not need to be redesigned just because the server changes

## Recommended First Habits

- check health endpoints after every deploy
- check `free -h` and `df -h` regularly
- read logs when something feels slow
- do not wait for a total outage before upgrading

## Minimum Weekly Routine

1. Check container status
2. Check RAM
3. Check disk
4. Check logs
5. Open scanner and wallet once yourself

If all five feel normal, the server is probably still fine.
