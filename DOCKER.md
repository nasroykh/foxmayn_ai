# Docker Deployment Guide

This guide covers production deployment for the App Template monorepo using Docker.

## Quick Start (Production Only)

The easiest way to manage your Docker environment is using the **Makefile**.

```bash
# 1. Initialize environment
make env-setup

# 2. Validate configuration
make validate

# 3. Build and launch
make build
make up

# 4. Monitor automatic migrations
make logs-api
```

## Makefile Reference

| Target           | Description                                          |
| :--------------- | :--------------------------------------------------- |
| `make up`        | Start all services in detached mode                  |
| `make down`      | Stop all services                                    |
| `make logs`      | View logs from all services                          |
| `make logs-api`  | View logs for the API service (including migrations) |
| `make migrate`   | Run database migrations manually                     |
| `make validate`  | Run the pre-flight check script                      |
| `make clean`     | Stop and remove images from this project             |
| `make stats`     | View CPU/Memory usage of containers                  |
| `make shell-api` | Access the API container terminal                    |

## Automated Features

### 1. Pre-flight Validation

Run `make validate` to check if your system is ready for the build. It checks:

- Docker and Compose versions
- Existence of required Dockerfiles
- Presence and health of environment variables
- Monorepo workspace configuration

### 2. Automatic Migrations

Migration generation and application are fully automated — no manual steps required:

- **`make build`** — runs `pnpm db:generate` during the Docker build stage, producing fresh migration files from the schema.
- **`make up`** — the `docker-entrypoint.sh` script waits for PostgreSQL to be healthy, then automatically runs `pnpm db:migrate` before starting the API server.

### 3. Service Health Checks

All services have built-in health checks:

- **Postgres**: Uses `pg_isready`.
- **API**: Periodically hits `/api/v1/health`.
- **App**: Periodically hits the Nginx `/health` endpoint.

## Security & Reliability

### Resource Limits

Configured in `docker-compose.yml`:

- **Postgres**: 1 CPU, 512MB RAM
- **API**: Limits based on production needs
- **Nginx**: Optimized Alpine-based image

### Multi-Architecture Support

If you need to build for both Intel/AMD and Apple Silicon/ARM servers:

```bash
make buildx-setup
make buildx-build
```

### Security Scanning

Scan your images for vulnerabilities:

```bash
make scan
```

## Troubleshooting

### Migrations Fail on Startup

Check the API logs:

```bash
make logs-api
```

Usually caused by incorrect `DB_URL` or database credentials in `.env`.

### Performance Issues

Check container resource usage:

```bash
make stats
```

### Resetting the Environment

If things are in a broken state and you want to start fresh (WARNING: This removes the database volume):

```bash
make clean-all
make env-setup
make build
make up
```

---

## Technical Architecture

For detailed implementations (Nginx config, Dockerfile stages), see the source files or [docker/README.md](./docker/README.md).
