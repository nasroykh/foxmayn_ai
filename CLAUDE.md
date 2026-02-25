# Foxmayn AI

Full-stack RAG (Retrieval-Augmented Generation) monorepo using pnpm workspaces.

## Quick Start

```bash
pnpm install
docker-compose up -d  # PostgreSQL, Redis, Qdrant
pnpm db:migrate
pnpm dev
```

## Structure

- `apps/api` - Hono backend with oRPC, BullMQ workers
- `apps/app` - React 19 + Vite frontend
- `packages/db` - Drizzle ORM + PostgreSQL
- `packages/llm` - OpenRouter SDK wrapper
- `packages/qdrant` - Vector database client

## Scripts

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `pnpm dev`        | Start all services (API, worker, frontend) |
| `pnpm build`      | Build all packages                         |
| `pnpm db:migrate` | Run database migrations                    |
| `pnpm lint`       | Run ESLint                                 |
| `pnpm format`     | Format with Prettier                       |

## Environment

Copy `.env.example` to `.env` in:

- `apps/api/`
- `apps/app/`
- `packages/db/`
- `packages/qdrant/`
