# worker

A small process that runs the BullMQ workers defined in `@repo/api/jobs`:

- document worker (concurrency 2): extracts text, chunks, embeds, and writes chunks to Postgres and vectors to Qdrant. Also handles reindex and delete jobs.
- email worker (concurrency 10): sends OTP and invitation emails. Jobs retry 5 times.

Credits for indexing are reserved before the job and settled on the tokens actually embedded.

## Entry point

`src/index.ts`. It connects to Postgres, starts both workers, writes a heartbeat file every 15 seconds while the workers run and Redis answers, and shuts down gracefully on `SIGTERM` and `SIGINT` (forced exit after 100 seconds).

## Commands

```bash
pnpm --filter worker dev        # tsx watch
pnpm --filter worker build
pnpm --filter worker typecheck
pnpm --filter worker lint
pnpm --filter worker start      # node dist/index.js
```

`pnpm dev` at the repository root starts the worker together with the API and frontend.

## Environment

The worker imports the API env schema, so it needs the same variables as the API. See [apps/api/README.md](../api/README.md) and [.env.example](../../.env.example). One extra optional variable: `WORKER_HEARTBEAT_FILE` (default `/tmp/worker-heartbeat`), used by the Docker healthcheck.

## Docker

`apps/worker/Dockerfile`. Compose gives it a 120 second stop grace period so running jobs can finish. See [DOCKER.md](../../DOCKER.md).
