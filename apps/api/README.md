# @repo/api

The HTTP API. Built with Hono, oRPC, Better Auth and BullMQ. The same package also defines the background jobs that `apps/worker` runs.

## Entry points

- `src/index.ts`: starts the server under `API_V1_PREFIX` (default `/api/v1`), initializes the DB, model pricing and the super admin, and handles graceful shutdown.
- `src/router/index.ts`: the oRPC router. Exported as `@repo/api/orpc` so the frontend gets its types.
- `src/jobs/index.ts`: queues and worker factories. Exported as `@repo/api/jobs` for the worker app.

## Key files

| Path | Purpose |
| --- | --- |
| `src/router/middleware.ts` | Procedures: `authProcedure`, `sessionProcedure`, `adminProcedure`, `orgProcedure`, `orgManagerProcedure`, `creditsProcedure` |
| `src/router/routes/*.routes.ts` | Routes for users, organizations, documents, profiles, chat, conversations, credits, usage, API keys |
| `src/services` | Business logic: RAG, credits, usage, chunking, Qdrant access, email |
| `src/config/auth.ts` | Better Auth setup (email and password, OTP, organizations, admin, API keys) |
| `src/config/env.schema.ts` | Env validation. Production rejects `CHANGE_ME` values. |
| `src/jobs/document` | Document indexing, reindex and delete jobs |
| `src/jobs/email` | Email job queue and worker |
| `src/plugins` | CORS, body limit, oRPC handlers, Scalar docs, auth, health, Bull Board |

## HTTP surface

All under `/api/v1`: `/rpc` (oRPC, used by the frontend), REST routes described in `/spec.json`, docs at `/scalar`, Better Auth at `/auth/*`, `/health`, `/health/ready`, and the Bull Board queue dashboard at `/admin/queues` (admin session only). Chat answers stream from `/chat/query/stream`. Uploads are capped at 10 MB per file and 11 MB per request.

## Commands

```bash
pnpm --filter @repo/api dev        # tsx watch
pnpm --filter @repo/api build
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api test       # node:test through tsx
pnpm --filter @repo/api lint
pnpm --filter @repo/api start      # node dist/index.js
```

## Environment

Read from the root `.env` in development: `NODE_ENV`, `PORT`, `HOST`, `API_V1_PREFIX`, `APP_URL`, `BETTER_AUTH_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `DB_URL`, `REDIS_URL`, `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION_NAME`, `OPENROUTER_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. See [.env.example](../../.env.example).
