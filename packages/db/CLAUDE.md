# Database Package

PostgreSQL database layer using Drizzle ORM.

## Tech Stack

- **ORM**: Drizzle ORM
- **Database**: PostgreSQL 17
- **Migrations**: drizzle-kit

## Structure

- `src/models/auth/` - Better Auth tables (user, session, account, etc.)
- `src/models/rag/` - RAG tables (ragProfile, document, documentChunk, conversation, message)
- `src/config/env.ts` - Database connection config

## Scripts

```bash
pnpm db:generate  # Generate migrations from schema changes
pnpm db:migrate   # Run pending migrations
pnpm db:push      # Push schema directly (dev only)
```

## Key Exports

```typescript
import { db } from "@repo/db"; // Drizzle instance
import { user, document } from "@repo/db"; // Schema tables
import { eq, and } from "@repo/db/drizzle-orm"; // Query helpers
```
