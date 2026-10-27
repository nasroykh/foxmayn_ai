# @repo/db

Drizzle ORM schema, migrations and the shared PostgreSQL client.

## Entry points

- `src/index.ts`: exports `db`, `initDB()`, `disconnectDB()` and the schema.
- `src/migrate.ts`: applies the committed migrations (`pnpm db:migrate`, and the `migrate` compose service).
- Subpath exports: `@repo/db/schema`, `@repo/db/types`, `@repo/db/drizzle-orm`.

## Key files

| Path | Purpose |
| --- | --- |
| `src/models/schema.ts` | Collects all tables |
| `src/models/auth/schema.ts` | Better Auth tables. Generated with `pnpm auth:generate`. |
| `src/models/rag/schema.ts` | RAG profiles, documents, chunks, conversations, messages |
| `src/models/usage/schema.ts` | AI usage log and credit transactions |
| `drizzle/` | Committed SQL migrations and drizzle-kit metadata |
| `drizzle.config.ts` | drizzle-kit config |

## Schema workflow

Edit `src/models`, run `pnpm db:generate`, read the new SQL in `drizzle/`, commit both. Do not use `db:push` on production.

## Commands (from the repository root)

```bash
pnpm db:generate   # create a migration
pnpm db:migrate    # apply migrations to DB_URL
pnpm db:studio     # Drizzle Studio
pnpm db:push       # local experiments only
pnpm --filter @repo/db build
pnpm --filter @repo/db typecheck
```

## Environment

`DB_URL`, read from the root `.env`. Timestamps are `timestamptz`.
