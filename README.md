# Foxmayn AI

Multi-tenant RAG (retrieval-augmented generation) platform.

- Organizations with members, roles and email invitations.
- Knowledge bases per user: each RAG profile is one knowledge base, with its documents and its model, embedding, chunking, retrieval and prompt settings. Chat searches only the profile's documents.
- Documents by file upload, raw text or https URL. An import can replace older documents with the same source once the new one is indexed.
- Streaming chat that returns the sources it used. Answers follow the language of the question by default.
- Credits per organization, with an optional monthly spending cap. Every AI call is billed to the organization's balance.
- API keys, each bound to one organization. A key can also be limited to chatting with one knowledge base.
- Admin console: users, bans, credit top-ups, job queue dashboard.

## Stack

| Part | Technology |
| --- | --- |
| Monorepo | pnpm 10 workspaces, Turborepo 2, Node.js 24 or newer, TypeScript 6 |
| API | Hono 4, oRPC 1 (RPC and OpenAPI), Better Auth 1.7, Zod 4 |
| Background jobs | BullMQ 6 on Redis 8 |
| Frontend | React 19, Vite 8, TanStack Router 1 and Query 5, Tailwind CSS 4, Jotai 3 |
| Database | PostgreSQL 18 with Drizzle ORM 0.45 |
| Vector store | Qdrant 1.20 |
| LLM provider | OpenRouter (`@openrouter/sdk`) |
| Production web server | Caddy 2 |

## Architecture

The browser talks to one origin. Caddy in the `app` container serves the built SPA and proxies `/api/*` to the API. The API handles requests and enqueues jobs. The worker runs document indexing and email jobs from the queues. Postgres holds relational data, Redis holds queues and caches, Qdrant holds vectors. Chat and embedding calls go to OpenRouter.

```
browser -> TLS proxy -> app (Caddy) -> api ----> postgres
                          |            |  \----> qdrant
                          |            |   \---> OpenRouter
                          |            v
                          |          redis <---- worker ----> postgres, qdrant, OpenRouter
                          \-- serves the SPA
```

In production only `app` is published to the host. See [DOCKER.md](DOCKER.md).

## Layout

| Path | Contents |
| --- | --- |
| `apps/api` | Hono API, oRPC routes, Better Auth, job definitions ([README](apps/api/README.md)) |
| `apps/worker` | Process that runs the BullMQ workers ([README](apps/worker/README.md)) |
| `apps/app` | React frontend ([README](apps/app/README.md)) |
| `packages/db` | Drizzle schema, migrations, DB client ([README](packages/db/README.md)) |
| `packages/llm` | OpenRouter wrapper and static model list ([README](packages/llm/README.md)) |
| `packages/qdrant` | Qdrant client helpers ([README](packages/qdrant/README.md)) |

## Quick start (local development)

Needs Node.js 24 or newer, pnpm and Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis qdrant
pnpm db:migrate
pnpm dev
```

Before the first run, edit `.env`: replace every `CHANGE_ME` value, keep the passwords inside `DB_URL` and `REDIS_URL` equal to `POSTGRES_PASSWORD` and `REDIS_PASSWORD`, and set `SUPER_ADMIN_PASSWORD` to at least 12 characters. `docker compose` refuses to start without these values. Document indexing and chat need a real `OPENROUTER_API_KEY`. Sign-up and invitation emails need working `SMTP_*` settings.

`pnpm dev` starts the API (port 33450), the worker and the Vite dev server (port 33460). Open `http://localhost:33460`. Vite proxies `/api` to the API, so the browser sees one origin. The super admin from `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` is created on the first API start.

## Scripts

Run from the repository root.

| Script | What it does |
| --- | --- |
| `pnpm dev` | Run all workspaces in watch mode |
| `pnpm build` | Build all workspaces |
| `pnpm start` | Run the built apps |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm test` | Run tests (currently the API tests) |
| `pnpm lint` | Run ESLint in all workspaces |
| `pnpm clean` | Delete `node_modules`, `dist` and `.turbo` folders |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply committed migrations |
| `pnpm db:push` | Push the schema without a migration (local experiments only) |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm auth:generate` | Regenerate the Better Auth tables in `packages/db` |
| `pnpm models:generate` | Refresh prices in the static model list in `packages/llm` |
| `pnpm models:eval-multilingual` | Rank the embedding models on Arabic questions against English text (needs `OPENROUTER_API_KEY`) |

## API documentation

With the API running, under the prefix `/api/v1`:

- Interactive docs (Scalar): `/api/v1/scalar`
- OpenAPI spec: `/api/v1/spec.json`
- Liveness: `/api/v1/health`. Readiness (Postgres, Redis, Qdrant): `/api/v1/health/ready`.

In development open them on `http://localhost:33460` (through Vite) or `http://localhost:33450`.

Browser users sign in with a session cookie. Programmatic clients send an API key in the `x-api-key` header. A key is bound to one organization and cannot manage keys or call admin routes.

A chat-only key is bound to one knowledge base (choose "Chat only" when creating it). It can call `POST /chat/query`, `POST /chat/query/stream` and `POST /chat/search`, always with that profile, and every other route refuses it. It reads only the documents in that profile and continues only the conversations it started. A document uploaded without a profile goes to the default profile at upload time. Keep it on a server: a key in browser code can be copied and spend the organization's credits. Each key is rate limited to 100 requests per 5 minutes.

To keep a knowledge base in sync with a published file (for example `llms-full.txt`), call `POST /documents/import` with a full-access key and `{ "url": "https://...", "profileId": "...", "replace": true }`. The new document is indexed first. Older documents with the same source (the URL by default) in the same profile are deleted only after that succeeds. URL imports accept public https URLs only.

## Supported upload types

Documents up to 10 MB with these MIME types: `text/plain`, `text/markdown`, `text/html`, `application/pdf`, and DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`). The file signature must match the declared type. PDFs are limited to 500 pages and extracted text to 5,000,000 characters.

## License

MIT. See [LICENSE](LICENSE).
