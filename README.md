# Foxmayn AI

Multi-tenant RAG (Retrieval-Augmented Generation) platform: organizations upload documents, which are chunked, embedded and indexed, then queried through a chat interface. TypeScript end to end.

## Architecture

- Monorepo (pnpm workspaces + Turborepo): `apps/api`, `apps/app`, `apps/worker`, `packages/*`.
- [`apps/api`](apps/api/README.md): Hono server exposing oRPC routes (OpenAPI docs at `/docs`), with Better Auth for users, organizations and API keys.
- `apps/app`: React 19 + Vite frontend (TanStack Router and Query, Jotai), talks to the API through the oRPC client.
- `apps/worker`: separate process running the BullMQ workers (document ingestion, email) defined in `apps/api`.
- [`packages/db`](packages/db/README.md): Drizzle ORM schema for PostgreSQL (auth, RAG, usage and credits).
- [`packages/llm`](packages/llm/README.md): OpenRouter/OpenAI wrapper for chat and embeddings.
- [`packages/qdrant`](packages/qdrant/README.md): Qdrant client; document chunks are embedded and stored per tenant for retrieval.
- Redis backs the job queues. Organizations hold a credits balance charged per AI call.

## Run locally

Requirements: Node.js 24+, pnpm 10, Docker.

All apps read a single root `.env`:

```bash
cp .env.example .env      # fill in secrets, OPENROUTER_API_KEY, SMTP settings
pnpm install
docker compose up -d postgres redis qdrant
pnpm db:migrate           # or: pnpm db:push
pnpm dev                  # API on :33450, app on :33460
```

Run the background worker in a second terminal: `pnpm --filter worker dev`.

### Full stack in Docker

```bash
make up                   # docker compose up -d (postgres, redis, qdrant, api, worker, app)
make help                 # other targets
```

See [DOCKER.md](DOCKER.md) for details.

## License

[MIT](LICENSE)
