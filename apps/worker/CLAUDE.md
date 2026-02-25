# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This app is a standalone BullMQ worker process. It is intentionally minimal — `src/index.ts` only handles process lifecycle (init, graceful shutdown, signal handlers). All job processing logic lives in `@repo/api/jobs` and is imported here.

## Commands

```bash
pnpm dev     # Run with tsx watch (hot reload)
pnpm build   # Compile TypeScript to dist/
pnpm start   # Run compiled dist/index.js (production)
```

## Architecture

### Entry point: `src/index.ts`

- Calls `initDB()` from `@repo/db` on startup
- Calls `createDocumentWorker()` and `createEmailWorker()` from `@repo/api/jobs`
- Registers SIGTERM/SIGINT handlers that call `worker.close()` (waits for active jobs), `closeQueues()`, then `disconnectDB()` before exiting
- `unhandledRejection` is logged but does NOT exit — BullMQ handles job-level retries internally

### Job processors (defined in `@repo/api/jobs`, not here)

- **document:index** — chunks text, generates embeddings in batches of 20, upserts vectors to Qdrant, writes chunks to PostgreSQL, updates document status
- **document:delete** — deletes Qdrant vectors by `documentId` filter, cascades DB row deletion
- **document:reindex** — deletes old vectors/chunks, re-runs the index pipeline
- **email:send** — sends via Nodemailer, returns accepted/rejected recipients

All queues use 3 retry attempts with exponential backoff (1s → 2s → 4s). Completed jobs are removed after 24h or when 1000+ exist; failed jobs are kept for 7 days.

### Concurrency

| Worker   | Concurrency | Reason                           |
| -------- | ----------- | -------------------------------- |
| document | 2           | Embedding API is rate-limited    |
| email    | 10          | Network I/O, cheap to parallelize |

### Adding a new job type

1. Define the job payload interface and processor in `apps/api/src/jobs/`
2. Export a `createXxxWorker()` factory from `@repo/api/jobs`
3. Import and call it in `src/index.ts`, push the returned worker to `workers[]`

## Key Dependencies

- `@repo/api` — job processor factories (`createDocumentWorker`, `createEmailWorker`, `closeQueues`)
- `@repo/db` — database init/disconnect (`initDB`, `disconnectDB`)
- `bullmq` (via `@repo/api`) — job queue, Redis-backed
- `tsx` — dev-mode TypeScript execution with watch mode
