# Deploying with Docker Compose

This guide covers a single-VPS production deploy behind a TLS-terminating proxy (for example Cloudflare plus Traefik or Pangolin). For local development see the quick start in [README.md](README.md).

## What runs

| Service | Image | Role |
| --- | --- | --- |
| `app` | built from `apps/app/Dockerfile` (Caddy) | Serves the SPA, proxies `/api/*` to `api`. The only published service. |
| `api` | built from `apps/api/Dockerfile` | HTTP API on port 33450 (internal) |
| `worker` | built from `apps/worker/Dockerfile` | Document indexing and email jobs |
| `migrate` | built from `apps/api/Dockerfile`, target `migrate` | One-shot: applies migrations, then exits |
| `postgres`, `redis`, `qdrant` | official images | Data stores, internal network only |

`api` and `worker` wait for `migrate` to finish successfully, and for Redis and Qdrant to be healthy. `migrate` waits for Postgres.

## Network exposure

- Only `app` is published: `${BIND}:${APP_PORT}` on the host, default `127.0.0.1:33460`. Caddy speaks plain HTTP. Your TLS proxy must forward to it.
- Set `BIND=0.0.0.0` only if the proxy runs on another machine or network. That exposes plain HTTP to that network, so firewall it.
- Postgres, Redis and Qdrant also bind a host port, but on `127.0.0.1` only (`POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `QDRANT_HOST_PORT`). Use them for `psql` over SSH or local tools. Never open them in a firewall.
- Caddy trusts `X-Forwarded-For` from private address ranges only. The API takes the client IP from `cf-connecting-ip` or `x-forwarded-for` for rate limiting. Keep the API reachable only through `app`, or those headers can be spoofed.
- The proxy must pass `/api/*` through without stripping the path, and must not buffer streamed responses.

## Environment

```bash
make env-setup      # copies .env.example to .env if missing
```

Edit `.env`:

- Replace every `CHANGE_ME`. `make up` and `make deploy` refuse to run while any remain. The API also refuses to start in production with such values.
- Generate secrets with `openssl rand -base64 48` (for `BETTER_AUTH_SECRET`) and `openssl rand -hex 24` (for passwords).
- Do not use `$` or `"` in values. Compose interpolates them.
- `APP_URL` is the public origin users type, for example `https://ai.example.com`, without a trailing slash.
- Compose builds `DB_URL`, `REDIS_URL` and `QDRANT_URL` for the containers. The `DB_URL`, `REDIS_URL` and `QDRANT_URL` lines in `.env` are used only by `pnpm dev` and `pnpm db:migrate` on the host.

| Variable | Read by | Notes |
| --- | --- | --- |
| `NODE_ENV` | api, worker | Compose forces `production` |
| `APP_URL` | api, worker | Public origin. Required. |
| `BETTER_AUTH_SECRET` | api, worker | At least 32 characters |
| `SUPER_ADMIN_EMAIL` | api, worker | Super admin created on first API start |
| `SUPER_ADMIN_PASSWORD` | api, worker | At least 12 characters. Used only when the account does not exist. |
| `PORT`, `HOST`, `API_V1_PREFIX` | api, worker | Optional. Defaults 33450, `0.0.0.0`, `/api/v1`. Compose sets them. |
| `VITE_API_URL` | `app` image build | Default `/api/v1`. Leave it. The API must stay same-origin. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | postgres, migrate, api, worker | Compose builds `DB_URL` from them |
| `DB_URL` | host tools only | For `pnpm dev` and `pnpm db:migrate` |
| `REDIS_PASSWORD` | redis, api, worker | Compose builds `REDIS_URL` from it |
| `REDIS_URL` | host tools only | For `pnpm dev` |
| `QDRANT_API_KEY` | qdrant, api, worker | Qdrant enforces it. Compose requires it. |
| `QDRANT_URL` | host tools only | Compose uses `http://qdrant:6333` |
| `QDRANT_COLLECTION_NAME` | api, worker | Collection name prefix, default `documents` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | api, worker | OTP and invitation email. The worker sends it. Port 465 uses TLS, other ports require STARTTLS. |
| `OPENROUTER_API_KEY` | api, worker | Chat and embeddings |
| `BIND`, `APP_PORT` | compose | Published address of `app`. Defaults `127.0.0.1`, `33460`. |
| `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `QDRANT_HOST_PORT` | compose | Loopback host ports. Defaults 5432, 6379, 6333. |
| `IMAGE_TAG` | compose | Tag of the built images, default `latest` |

## First deploy

```bash
git clone <repository-url> foxmayn_ai && cd foxmayn_ai
make env-setup
# edit .env
make build
make up
make ps
```

`make up` starts the stack. Compose runs `migrate` first, then `api` and `worker`. Sign in with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`. The super admin is created only if no account with that email exists. An existing account is never promoted.

## Migrations

Migrations are committed SQL files in `packages/db/drizzle`. The `migrate` service applies them under a Postgres advisory lock, so concurrent runs are safe. It runs on every `make up` and `make deploy`. To run it alone:

```bash
make migrate
```

Migrations only move forward. Take a database backup before upgrading (see below).

## Health checks

- API liveness: `GET /api/v1/health`. No dependency checks.
- API readiness: `GET /api/v1/health/ready`. Checks Postgres, Redis and Qdrant, answers 200 or 503.
- App (Caddy): `GET /health` on port 33460 inside the container.
- Worker: Docker healthcheck on a heartbeat file that is refreshed only while the workers run and Redis answers.

```bash
curl -fsS http://127.0.0.1:33460/api/v1/health
curl -fsS http://127.0.0.1:33460/api/v1/health/ready
make ps
```

## Logs and shells

```bash
make logs           # all services
make logs-api
make logs-worker
make logs-app
make logs-db
make shell-db       # psql
make shell-api
```

Logs are JSON files capped at 10 MB, 3 files per service. `make stats` shows container resource usage. `make scan` runs Docker Scout on the built images if it is installed.

## Backups

Data lives in three named volumes: `postgres_data`, `redis_data`, `qdrant_data`. Compose prefixes them with the project name (see `docker volume ls`). Back up Postgres and Qdrant. Redis holds only queue state and caches.

Postgres:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > foxmayn-$(date +%F).dump
```

Restore into an empty database:

```bash
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < foxmayn-YYYY-MM-DD.dump
```

Qdrant. Use the snapshot API on the loopback port. There is one collection per embedding model, named `<QDRANT_COLLECTION_NAME>_<model slug>`:

```bash
curl -s -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections
curl -s -X POST -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections/<collection>/snapshots
```

Snapshots are stored inside the Qdrant container volume. Download them with `GET /collections/<collection>/snapshots/<snapshot-name>` and keep them off the host. Vectors can also be rebuilt from Postgres by reindexing documents, which costs credits.

Back up `.env` separately and keep it private.

## Upgrade

```bash
make deploy
```

`make deploy` runs `git pull --ff-only`, rebuilds all images and runs `docker compose up -d --remove-orphans`. Migrations run as part of `up`. Check `make ps` and `/api/v1/health/ready` afterwards.

## Rollback

1. Note the commit you are on: `git rev-parse HEAD`.
2. Check out the previous commit: `git checkout <previous-commit>`.
3. Rebuild and restart: `make build && make up`.

If the newer release applied a migration that the older code cannot work with, restore the Postgres backup taken before the upgrade first. Migrations are not reversed automatically.

## Stop and clean up

- `make down` stops and removes containers. Volumes are kept.
- `make restart` restarts all services.
- `make clean` also removes built images, after a prompt. Volumes are kept.
- `make clean-all` also deletes all data volumes. It asks you to type `delete`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `make up` stops with "Replace the CHANGE_ME values" | Edit `.env` |
| Compose says `Set X in .env` | That variable is missing or empty in `.env` |
| `api` exits at start | `make logs-api`. The env validation error names the key. Common causes: secret too short, `CHANGE_ME` left in production values, password with `$`. |
| `migrate` fails | `docker compose logs migrate`. Check the Postgres password. If you changed `POSTGRES_PASSWORD` after the first start, the existing volume still has the old one. |
| Login works but cookies are lost, or redirects go to the wrong host | `APP_URL` must equal the public origin exactly, and the proxy must send the original `Host` and scheme. |
| Chat streams arrive all at once | The proxy in front of `app` is buffering. Turn buffering off for `/api/`. |
| No emails | `make logs-worker`. The worker sends mail and retries 5 times. Check the `SMTP_*` values. |
| Documents stay in "processing" | `make logs-worker`. Check Redis, Qdrant and `OPENROUTER_API_KEY`. The queue dashboard is at `/api/v1/admin/queues` for admin users. |
| `/api/v1/health/ready` returns 503 | The response names which dependency failed. Check that service in `make ps` and its logs. |
| 413 on upload | Uploads are limited to 10 MB per file. |
