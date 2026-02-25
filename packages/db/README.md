# @repo/db

The database package for Foxmayn AI, powered by **PostgreSQL** and **Drizzle ORM**. It manages all data models, schemas, and migrations for the entire monorepo.

## Tech Stack

- **Database**: PostgreSQL
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
- **Migrations**: Drizzle Kit
- **Driver**: `node-postgres`

## Database Modules

### 1. Auth Module (`src/models/auth/`)

Managed by **Better Auth**, handles user identity and security.

- `user`: High-level user profile (name, email, image, role, ban status).
- `session`: Active user sessions.
- `account`: OAuth and provider-specific account details.
- `apikey`: Personal API keys with rate limiting and permissions.
- `organization`: Multi-tenant organization support.
- `member`: Organization membership and roles.
- `subscription`: Stripe subscription data.

### 2. RAG Module (`src/models/rag/`)

Handles all data related to the AI pipeline and context.

- `rag_profile`: Advanced pipeline configuration (models, chunking, retrieval settings, personality).
- `document`: Indexed document metadata and status.
- `document_chunk`: Individual text chunks with vector references.
- `conversation`: Chat sessions for server-managed history.
- `message`: Individual messages within conversations.

## Scripts

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `pnpm db:generate` | Generate migration files from schema changes |
| `pnpm db:migrate`  | Apply pending migrations to the database     |
| `pnpm db:push`     | Push schema changes directly (dev only)      |
| `pnpm db:studio`   | Launch Drizzle Studio UI                     |

## Configuration

### Environment Variables

| Variable      | Description                       |
| ------------- | --------------------------------- |
| `DB_URL`      | Full PostgreSQL connection string |
| `DB_HOST`     | Database host                     |
| `DB_PORT`     | Database port                     |
| `DB_USER`     | Database user                     |
| `DB_PASSWORD` | Database password                 |
| `DB_NAME`     | Database name                     |

## Usage

### Using the Database Client

```typescript
import { db, user } from "@repo/db";
import { eq } from "@repo/db/drizzle-orm";

const result = await db.select().from(user).where(eq(user.id, "123"));
```

### Accessing Types

```typescript
import { User, Message } from "@repo/db/types";

const myUser: User = { ... };
```

---

_Last Updated: January 2026_
