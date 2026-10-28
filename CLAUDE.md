# Foxmayn AI: contributor guide

Multi-tenant RAG monorepo (pnpm workspaces, Turborepo). Read [README.md](README.md) first for the product and quick start.

## Layout

- `apps/api`: Hono + oRPC API, Better Auth, BullMQ job code (`src/jobs`), routes in `src/router/routes`, business logic in `src/services`.
- `apps/worker`: thin process that starts the workers defined in `@repo/api/jobs`. It imports the API env schema, so it needs the full API env.
- `apps/app`: React 19 + Vite SPA. File-based routes in `src/routes` (`_auth` = signed in, `_notauth` = public).
- `packages/db`: Drizzle schema (`src/models`), committed migrations (`drizzle/`), migrate script (`src/migrate.ts`).
- `packages/llm`: OpenRouter client and the static model list (`src/data/openrouter_models.ts`), the fallback for chat models and the allow-list for embedding models.
- `packages/qdrant`: Qdrant helpers.
- `packages/rag-eval`: RAG evaluation harness, an HTTP client of a deployed API (`src/cli.ts`). No DB, Redis or Qdrant access.
- `packages/eslint-config`, `packages/tsconfig`: shared lint and TS config.

## Commands

Run from the repository root.

| Command | Use |
| --- | --- |
| `pnpm install` | Install dependencies |
| `docker compose up -d postgres redis qdrant` | Local data stores (needs `.env`) |
| `pnpm dev` | API (33450), worker, Vite (33460) |
| `pnpm build` | Build everything |
| `pnpm typecheck` | `tsc` in every workspace |
| `pnpm test` | API tests (`tsx --test`, files named `*.test.ts`) |
| `pnpm lint` | ESLint, flat config from `packages/eslint-config` |
| `pnpm db:generate` | New migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm auth:generate` | Regenerate Better Auth tables |
| `pnpm models:generate` | Refresh prices in the static model list |
| `pnpm rag:eval --file cases.jsonl` | Retrieval metrics of a deployed API; `--answers` also judges answers (spends credits) |

Run one workspace: `pnpm --filter @repo/api test`. There is no format script. Match the existing style.

## Conventions

- Tabs for indentation. TypeScript strict, Zod 4 for validation.
- oRPC routes live in `apps/api/src/router/routes/*.routes.ts`. Pick the procedure from `apps/api/src/router/middleware.ts`:
  - `publicProcedure` (the `base`): no auth.
  - `authProcedure`: signed-in user or full-access API key. Every procedure except `chatProcedure` rejects chat-only keys (bound to one knowledge base).
  - `sessionProcedure`: browser session only, API keys rejected.
  - `adminProcedure`: session plus global admin role.
  - `orgProcedure`: active organization (session) or the key's organization, and the user must be a member. Adds `organizationId` and `memberRole`.
  - `orgManagerProcedure`: `orgProcedure` for org owner or admin.
  - `creditsProcedure`: `orgProcedure` plus a minimum balance and the monthly cap. Use it for anything that calls an AI model.
  - `chatProcedure`: `creditsProcedure` that also accepts chat-only keys. Only the chat routes use it, and they force `context.apiKeyProfileId` as the profile (`resolveKnowledgeBase` in `chat.routes.ts`).
- Throw `ORPCError` for errors a client can cause. A plain `Error` becomes a 500.
- Business logic goes in `src/services`. Routes validate input and call services.
- The frontend calls the API through the typed oRPC client in `apps/app/src/lib/orpc.ts` and the Better Auth client in `apps/app/src/lib/auth.ts`.
- The API is same-origin: the browser always calls `/api/v1` on the app's own origin. Vite proxies it in dev, Caddy in production. Do not add absolute API URLs or rely on CORS.

## Tenancy and billing rules

- Documents, RAG profiles and conversations belong to a user. Every service query that reads or writes them must filter by `userId`. Check profile ownership before using a `profileId` from a client.
- A RAG profile is a knowledge base. Retrieval searches only the profile's documents; documents without a profile belong to the user's default profile.
- Credits belong to an organization. API keys are bound to one organization through key metadata (`organizationId`, plus `profileId` for a chat-only key). The service writes these keys; never copy them from client input.
- Membership is checked on every `orgProcedure` request. Do not trust the session's active organization alone.
- Billing is reserve then settle: reserve an estimate before the AI call, settle the real cost in `finally`, and refund the rest. A shortfall is still collected. The optional monthly cap is checked inside `reserveCredits` under a row lock; month-to-date spend counts `usage` and `refund` transactions only. See `apps/api/src/services/credits.service.ts` and `apps/api/src/utils/cost.ts`.
- Chat models come from the OpenRouter `/models` list (`apps/api/src/services/model-catalog.service.ts`): fetched at most daily, last good copy in Redis, static list as the last fallback. Only priced text models are kept. Embedding models are the static allow-list in `packages/llm/src/data/openrouter_models.ts`. An unknown or unpriced model must fail, never fall back to a default price or bill 0.
- Embeddings use one Qdrant collection per embedding model: `<QDRANT_COLLECTION_NAME>_<model slug>`.

## Schema changes

1. Edit `packages/db/src/models`.
2. Run `pnpm db:generate`.
3. Read the generated SQL in `packages/db/drizzle`.
4. Commit the schema change and the SQL together.
5. Apply with `pnpm db:migrate`. Production applies them through the `migrate` compose service.

Never use `pnpm db:push` against production. Better Auth tables in `packages/db/src/models/auth/schema.ts` are generated: change the Better Auth config in `apps/api/src/config/auth.ts`, run `pnpm auth:generate`, then follow the steps above. The generator drops `organization.credits_balance` and `organization.credits_monthly_cap`: put both back before `pnpm db:generate`.

## Gotchas

- `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (3 days in minutes). A freshly published package version will not install.
- TypeScript is pinned to `~6.0`. Do not upgrade to 7.
- The worker needs the same env as the API. Missing or placeholder values fail at start.
- In production the API rejects any env value containing `CHANGE_ME`.
- Never add a `.env` value containing `$` or `"`: Docker Compose interpolates them.
- `apps/app/src/routeTree.gen.ts` is generated by the router plugin. Do not edit it.
- Deploy and operations: [DOCKER.md](DOCKER.md).
