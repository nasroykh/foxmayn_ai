# Worker

Background job processing service for the Foxmayn AI monorepo. Runs as a separate Node.js process from the API server, consuming jobs from BullMQ queues backed by Redis.

## What It Does

The worker handles two types of asynchronous jobs:

- **Document jobs** — text chunking, embedding generation (via OpenRouter), and vector upsert into Qdrant for RAG indexing
- **Email jobs** — transactional email delivery via Nodemailer/SMTP

## Architecture

All job processor logic lives in `@repo/api/jobs` and is imported here. This app is intentionally thin — it only handles process lifecycle (startup, graceful shutdown, signal handling).

```
API server
  └─► Redis queues (BullMQ)
          └─► Worker process (this app)
                  ├─► PostgreSQL (@repo/db)
                  ├─► Qdrant (via @repo/api/jobs)
                  └─► OpenRouter API (via @repo/llm)
```

### Job types

| Queue      | Job name            | Concurrency | Description                              |
| ---------- | ------------------- | ----------- | ---------------------------------------- |
| `document` | `document:index`    | 2           | Chunk → embed → upsert to Qdrant         |
| `document` | `document:delete`   | 2           | Remove vectors from Qdrant + DB rows     |
| `document` | `document:reindex`  | 2           | Delete old vectors, re-run index         |
| `email`    | `email:send`        | 10          | Send via SMTP, returns accepted/rejected |

Document jobs run at concurrency 2 (embedding API is rate-limited and expensive). Email jobs run at concurrency 10 (network I/O bound).

## Development

```bash
pnpm dev     # tsx watch — hot reload
pnpm build   # rimraf dist && tsc
pnpm start   # node dist/index.js (production)
```

## Environment Variables

Copy `.env.example` to `.env`:

| Variable               | Required | Description                              |
| ---------------------- | -------- | ---------------------------------------- |
| `DB_URL`               | Yes      | PostgreSQL connection string             |
| `REDIS_URL`            | Yes      | Redis URL (default: `redis://localhost:6379`) |
| `OPENROUTER_API_KEY`   | Yes      | Used by job processors for embeddings    |
| `QDRANT_URL`           | Yes      | Qdrant server URL                        |
| `QDRANT_COLLECTION_NAME` | Yes    | Collection prefix (dimensions appended)  |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | Yes | Email transport config       |

## Docker

The Dockerfile is a multi-stage build:

1. **Build stage** — installs workspace deps, builds all packages in dependency order, prunes to production deps
2. **Production stage** — minimal Alpine image with non-root user (`workeruser`), includes `pg_isready` and `netcat` for health checks

`docker-entrypoint.sh` waits for PostgreSQL and Redis to be ready before starting the worker.
