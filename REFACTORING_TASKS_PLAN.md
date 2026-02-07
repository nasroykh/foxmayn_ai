# Foxmayn AI - Complete Refactoring Plan

> Generated 2026-02-07. Status: **Complete - 100% implemented.**

---

## Table of Contents

- [P0 - Fix Immediately (Security/Data Integrity)](#p0---fix-immediately)
- [P1 - Fix Soon (Bugs/Correctness)](#p1---fix-soon)
- [P2 - Refactor (Architecture)](#p2---refactor)
- [P3 - Add Missing Infrastructure](#p3---add-missing-infrastructure)
- [Files Requiring Changes](#files-requiring-changes)

---

## P0 - Fix Immediately

### Task 1: Fix logic bug in `@repo/llm` openrouter.ts:45 [DONE]

**File:** `packages/llm/src/openrouter.ts:45`

```typescript
// CURRENT (broken):
if (!prompt && !prompt?.trim()) throw new Error("Prompt is required");

// FIX:
if (!prompt || !prompt.trim()) throw new Error("Prompt is required");
```

`&&` should be `||`. The guard is logically broken - it can pass `undefined` through to `messages.push()`.

---

### Task 2: Fix `process.env` usage in auth.ts - use validated `env` [DONE]

**File:** `apps/api/src/config/auth.ts`

Replace all raw `process.env` references with the validated `env` object:

| Line | Current                              | Fix                         |
| ---- | ------------------------------------ | --------------------------- |
| 18   | `process.env.STRIPE_SECRET_KEY!`     | `env.STRIPE_SECRET_KEY`     |
| 40   | `process.env.APP_URL`                | `env.APP_URL`               |
| 75   | `process.env.STRIPE_WEBHOOK_SECRET!` | `env.STRIPE_WEBHOOK_SECRET` |
| 89   | `process.env.APP_URL!`               | `env.APP_URL`               |

The whole point of Zod env validation is to guarantee these exist. Using `process.env` directly bypasses that and can crash with cryptic errors at runtime.

---

### Task 3: Fix unsafe `JSON.parse` without try-catch [DONE]

**File:** `apps/api/src/router/routes/document.routes.ts:52`

```typescript
// CURRENT:
metadata: metadata ? JSON.parse(metadata) : undefined,

// FIX:
metadata: metadata ? (() => {
  try {
    return JSON.parse(metadata);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid metadata JSON" });
  }
})() : undefined,
```

Or extract to a helper. Malformed JSON currently throws an unhandled exception.

---

### Task 4: Protect profile routes with authentication [DONE]

**File:** `apps/api/src/router/routes/profile.routes.ts`

Every route uses `publicProcedure`. Change all to `authProcedure`:

```typescript
// CURRENT:
import { publicProcedure } from "../middleware";

// FIX:
import { authProcedure } from "../middleware";
// Replace every publicProcedure reference with authProcedure
```

Currently anyone can create, update, delete RAG profiles (including the default profile's model, temperature, system prompt) with zero authentication.

---

### Task 5: Add user scoping to all data routes [DONE]

**This is the single biggest architectural problem.**

Currently, any authenticated user can see/delete ALL documents, conversations, and profiles belonging to any other user.

#### 5a. Add `userId` column to schema tables [DONE]

**File:** `packages/db/src/models/rag/schema.ts`

Add `userId` column (referencing `user.id`) to:

- `ragProfile` table
- `document` table
- `conversation` table

```typescript
userId: text("user_id").references(() => user.id).notNull(),
```

Add indexes on `userId` for each table. Generate and run a new migration.

#### 5b. Update service functions to accept and filter by `userId` [DONE]

**Files:**

- `apps/api/src/services/profile.service.ts` - Add `userId` param to all functions, filter queries with `.where(eq(ragProfile.userId, userId))`
- `apps/api/src/services/conversation.service.ts` - Same pattern
- `apps/api/src/services/rag.service.ts` - `listDocuments`, `getDocument`, `deleteDocument`, `indexDocument` all need userId scoping

#### 5c. Update route handlers to pass `context.user.id` [DONE]

**Files:**

- `apps/api/src/router/routes/document.routes.ts` - Pass `context.user.id` to service calls
- `apps/api/src/router/routes/conversation.routes.ts` - Same
- `apps/api/src/router/routes/profile.routes.ts` - Same
- `apps/api/src/router/routes/chat.routes.ts` - Same

All handlers using `authProcedure` have access to `context.user` via the middleware. Use `context.user.id` to scope every query.

#### 5d. Update document worker [DONE]

**File:** `apps/api/src/jobs/document/document.worker.ts`

The worker receives job data - no auth context. The `userId` should be stored in the document record at creation time and used for scoping within the worker if needed.

---

## P1 - Fix Soon

### Task 6: Fix `listDocuments` returning page count as total [DONE]

**File:** `apps/api/src/router/routes/document.routes.ts:197`

```typescript
// CURRENT:
total: docs.length,  // Returns count of current page, NOT total documents

// FIX: Add countDocuments() function to rag.service.ts and call in parallel
const [docs, total] = await Promise.all([
  listDocuments(limit, offset),
  countDocuments(),
]);
return { documents: ..., total };
```

Add a `countDocuments` function to `rag.service.ts`:

```typescript
export const countDocuments = async () => {
	const [result] = await db.select({ count: count() }).from(document);
	return result?.count ?? 0;
};
```

---

### Task 7: Handle document worker partial failures (cleanup orphaned data) [DONE]

**File:** `apps/api/src/jobs/document/document.worker.ts`

The catch block currently only sets `status: "failed"` but doesn't clean up chunk records inserted in Step 4 if Step 5 (Qdrant upsert) fails:

```typescript
// In the catch block, add cleanup:
catch (error) {
  // Clean up any chunk records that were inserted
  await db.delete(documentChunk).where(eq(documentChunk.documentId, documentId));

  await db
    .update(document)
    .set({ status: "failed" })
    .where(eq(document.id, documentId));
  throw error;
}
```

---

### Task 8: Add `await` to email sending in auth.ts [DONE]

**File:** `apps/api/src/config/auth.ts`

```typescript
// Line 42 - CURRENT:
sendInvitationEmail(data.email, data.inviter.user.name, ...);

// FIX:
await sendInvitationEmail(data.email, data.inviter.user.name, ...);

// Line 52 - CURRENT:
sendOTPEmail(email, otp);

// FIX:
await sendOTPEmail(email, otp);
```

These are async functions called without `await`. If they fail, the error is silently lost.

---

### Task 9: Handle streaming non-stream fallback in rag.service.ts [DONE]

**File:** `apps/api/src/services/rag.service.ts:363`

```typescript
// CURRENT:
if (typeof stream !== "string" && Symbol.asyncIterator in stream) {
  for await (const delta of stream) { ... }
}
yield { type: "done" };

// FIX:
if (typeof stream === "string") {
  yield { type: "token", data: stream };
} else if (Symbol.asyncIterator in stream) {
  for await (const delta of stream) {
    if (delta) {
      yield { type: "token", data: delta };
    }
  }
}
yield { type: "done" };
```

If `OpenRouterQuery` returns a string despite `stream: true`, the user currently gets sources but no answer with no error.

---

### Task 10: Fix super admin init error handling [DONE]

**File:** `apps/api/src/plugins/auth.ts:43-45`

```typescript
// CURRENT:
} catch (error) {
  console.error("Failed to initialize super admin:", error);
}

// FIX: Re-throw to prevent server from starting without admin access
} catch (error) {
  console.error("Failed to initialize super admin:", error);
  throw error; // This will propagate to registerPlugins -> start() -> process.exit(1)
}
```

---

## P2 - Refactor

### Task 11: Extract duplicated Qdrant code to shared module [DONE]

**Files affected:**

- `apps/api/src/services/rag.service.ts` (lines 38-75)
- `apps/api/src/jobs/document/document.worker.ts` (lines 28-66)

Both files contain identical copies of:

- `COLLECTION_NAME` constant
- `qdrant` client initialization
- `initializedCollections` Set
- `ensureCollection()` function
- `VectorPayload` interface

**Fix:** Create `apps/api/src/services/qdrant.shared.ts`: [DONE]

```typescript
import { createQdrantClient, createCollection } from "@repo/qdrant";
import { OPENROUTER_EMBEDDING_MODELS } from "@repo/llm/openrouter/models";
import { env } from "../config/env";

export const COLLECTION_NAME = env.QDRANT_COLLECTION_NAME || "foxmayn_ai";
export const qdrant = createQdrantClient({ url: env.QDRANT_URL });

const initializedCollections = new Set<string>();

export const ensureCollection = async (modelId: string) => {
	const model = OPENROUTER_EMBEDDING_MODELS.find((m) => m.id === modelId);
	if (!model) throw new Error(`Embedding model not found: ${modelId}`);
	const collectionName = `${COLLECTION_NAME}_${model.dimensions}`;
	if (initializedCollections.has(collectionName)) return collectionName;
	await createCollection(qdrant, collectionName, {
		size: model.dimensions,
		distance: "Cosine",
		keywordFields: ["documentId", "source"],
		textFields: ["content"],
	});
	initializedCollections.add(collectionName);
	return collectionName;
};

export interface VectorPayload extends Record<string, unknown> {
	documentId: string;
	chunkId: string;
	content: string;
	chunkIndex: number;
	source?: string;
	metadata?: Record<string, unknown>;
}
```

Then update both consuming files to import from this shared module.

---

### Task 12: Fix `as any` casts with proper type boundaries [DONE]

**Files:**

- `apps/api/src/services/rag.service.ts` - Lines 211, 268, 279-283, 339, 350-354
- `apps/api/src/jobs/document/document.worker.ts` - Line 118
- `apps/api/src/router/routes/profile.routes.ts` - Line 102
- `apps/api/src/router/routes/conversation.routes.ts` - Lines 182, 365

**Root cause:** DB schema stores `model`, `tone`, `responseLength`, `embeddingModel` as plain `text` columns, but consuming functions expect specific union types.

**Fix:** Create type assertion helpers or widen the function parameter types: [DONE - Widened types in SystemPromptParams]

```typescript
// For embedding model:
type EmbeddingModelId = (typeof OPENROUTER_EMBEDDING_MODELS)[number]["id"];
const embeddingModelId = (profile?.embeddingModel ||
	"openai/text-embedding-3-small") as EmbeddingModelId;

// For tone, responseLength: widen SystemPromptParams to accept string
// Or create a validated cast:
const validTones = ["casual", "professional", "friendly", "formal"] as const;
type Tone = (typeof validTones)[number];
const safeTone = (value: string): Tone =>
	validTones.includes(value as Tone) ? (value as Tone) : "friendly";
```

For route `as any` casts on `input.data`, the issue is that `omit()` on drizzle-zod schemas produces a type that doesn't perfectly align with the service function params. Fix by explicitly typing or using `Partial<>`.

---

### Task 13: Add Turborepo for build orchestration [DONE]

**New file:** `turbo.json`

```json
{
	"$schema": "https://turbo.build/schema.json",
	"tasks": {
		"build": {
			"dependsOn": ["^build"],
			"outputs": ["dist/**"]
		},
		"dev": {
			"cache": false,
			"persistent": true
		},
		"lint": {},
		"test": {
			"dependsOn": ["build"]
		}
	}
}
```

**Update `package.json` (root):**

```json
{
	"scripts": {
		"build": "turbo run build",
		"dev": "turbo run dev",
		"lint": "turbo run lint",
		"test": "turbo run test"
	},
	"devDependencies": {
		"turbo": "^2"
	}
}
```

---

### Task 14: Add shared `tsconfig.base.json` [DONE]

**New file:** `tsconfig.base.json` (root)

```json
{
	"compilerOptions": {
		"target": "esnext",
		"lib": ["ESNext"],
		"allowSyntheticDefaultImports": true,
		"esModuleInterop": true,
		"resolveJsonModule": true,
		"isolatedModules": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"strict": true,
		"noImplicitAny": true,
		"strictNullChecks": true,
		"strictFunctionTypes": true,
		"noImplicitReturns": true,
		"noFallthroughCasesInSwitch": true,
		"noImplicitOverride": true,
		"useUnknownInCatchVariables": true,
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true
	}
}
```

Then update each `tsconfig.json` to extend it:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "dist",
		"rootDir": "src",
		"module": "CommonJS",
		"moduleResolution": "node10"
	}
}
```

---

### Task 15: Configure DB connection pool [DONE]

**File:** `packages/db/src/index.ts`

```typescript
// CURRENT:
const pool = new Pool({ connectionString });

// FIX:
const pool = new Pool({
	connectionString,
	max: 20,
	min: 2,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
});

// Also fix initDB() - pool.connect() acquires a client but never releases it:
export async function initDB() {
	try {
		const client = await pool.connect();
		client.release(); // Release back to pool
		console.log("Database connected successfully");
	} catch (error) {
		console.error("Database connection failed:", error);
		process.exit(1);
	}
}
```

---

### Task 16: Fix token counting for non-OpenAI models [DONE]

**File:** `apps/api/src/jobs/document/document.worker.ts:160-163`

```typescript
// CURRENT (only works for OpenAI models):
tokenCount: calculateTokens(
  chunk.content,
  embeddingModelId.includes("large")
    ? "text-embedding-3-large"
    : "text-embedding-3-small"
),

// FIX: Use a safe fallback for non-OpenAI models
tokenCount: calculateTokens(
  chunk.content,
  "text-embedding-3-small" // Use as approximation for all models
),
```

For accurate counts across providers, a future enhancement would be to use model-specific tokenizers. For now, using a consistent approximation is better than the broken string matching.

---

## P3 - Add Missing Infrastructure

### Task 17: Add Docker/docker-compose for local dev [DONE]

**New file:** `docker-compose.yml`

```yaml
services:
    postgres:
        image: postgres:17-alpine
        ports:
            - "5432:5432"
        environment:
            POSTGRES_USER: foxmayn
            POSTGRES_PASSWORD: foxmayn
            POSTGRES_DB: foxmayn_ai
        volumes:
            - postgres_data:/var/lib/postgresql/data

    redis:
        image: redis:7-alpine
        ports:
            - "6379:6379"
        volumes:
            - redis_data:/data

    qdrant:
        image: qdrant/qdrant:latest
        ports:
            - "6333:6333"
            - "6334:6334"
        volumes:
            - qdrant_data:/qdrant/storage

volumes:
    postgres_data:
    redis_data:
    qdrant_data:
```

---

### Task 18: Add health check endpoint [DONE]

**File:** `apps/api/src/plugins/index.ts` (or new file `apps/api/src/plugins/health.ts`)

```typescript
export const registerHealth = (app: Hono) => {
	app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));
};
```

Note: This should be outside `basePath` so it's accessible at `/health` directly.

---

### Task 19: Add graceful shutdown to API server [DONE]

**File:** `apps/api/src/index.ts`

```typescript
const start = async () => {
	// ... existing setup ...

	const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
		console.log(`Server running on http://${info.address}:${info.port}`);
	});

	const gracefulShutdown = async (signal: string) => {
		console.log(`Received ${signal}. Shutting down...`);
		server.close();
		await disconnectDB();
		await closeQueues();
		process.exit(0);
	};

	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));
};
```

---

### Task 20: Add worker to dev script and fix project name [DONE]

**File:** `package.json` (root)

```json
{
	"name": "foxmayn-ai",
	"scripts": {
		"dev": "... concurrently -n api,app,worker -c blue,green,yellow \"pnpm --filter=api dev\" \"pnpm --filter=app dev\" \"pnpm --filter=api dev:worker\"",
		"dev:worker": "pnpm --filter=api dev:worker"
	}
}
```

---

### Task 21: Add ESLint + Prettier configuration [DONE]

**New files:**

- `eslint.config.js` (root) - [DONE]
- `prettier.config.js` (root) - [DONE]
- `.prettierignore` - [DONE]

**Install:** [DONE]

```bash
pnpm add -Dw eslint @eslint/js typescript-eslint prettier eslint-config-prettier
```

**Add scripts to root `package.json`:** [DONE]

```json
{
	"scripts": {
		"lint": "eslint .",
		"format": "prettier --write .",
		"format:check": "prettier --check ."
	}
}
```

---

### Task 22: Generate CLAUDE.md files [DONE]

Create `CLAUDE.md` at:

- `/` (monorepo root)
- `apps/api/`
- `packages/db/`
- `packages/llm/`
- `packages/qdrant/`

Each containing package-specific context for Claude Code.

---

## Files Requiring Changes

| File                                                | Tasks                 | Status |
| --------------------------------------------------- | --------------------- | ------ |
| `packages/llm/src/openrouter.ts`                    | #1                    | DONE   |
| `apps/api/src/config/auth.ts`                       | #2, #8                | DONE   |
| `apps/api/src/router/routes/document.routes.ts`     | #3, #6                | DONE   |
| `apps/api/src/router/routes/profile.routes.ts`      | #4, #5c, #12          | DONE   |
| `packages/db/src/models/rag/schema.ts`              | #5a                   | DONE   |
| `apps/api/src/services/profile.service.ts`          | #5b                   | DONE   |
| `apps/api/src/services/conversation.service.ts`     | #5b                   | DONE   |
| `apps/api/src/services/rag.service.ts`              | #5b, #6, #9, #11, #12 | DONE   |
| `apps/api/src/router/routes/conversation.routes.ts` | #5c, #12              | DONE   |
| `apps/api/src/router/routes/chat.routes.ts`         | #5c                   | DONE   |
| `apps/api/src/jobs/document/document.worker.ts`     | #7, #11, #12, #16     | DONE   |
| `apps/api/src/plugins/auth.ts`                      | #10                   | DONE   |
| **(new)** `apps/api/src/services/qdrant.shared.ts`  | #11                   | DONE   |
| **(new)** `turbo.json`                              | #13                   | DONE   |
| **(new)** `tsconfig.base.json`                      | #14                   | DONE   |
| `packages/db/src/index.ts`                          | #15                   | DONE   |
| **(new)** `docker-compose.yml`                      | #17                   | DONE   |
| **(new)** `apps/api/src/plugins/health.ts`          | #18                   | DONE   |
| `apps/api/src/index.ts`                             | #19                   | DONE   |
| `package.json` (root)                               | #13, #20, #21         | DONE   |
| **(new)** `eslint.config.js`                        | #21                   | DONE   |
| **(new)** `prettier.config.js`                      | #21                   | DONE   |
| `packages/db/tsconfig.json`                         | #14                   | DONE   |
| `packages/llm/tsconfig.json`                        | #14                   | DONE   |
| `packages/qdrant/tsconfig.json`                     | #14                   | DONE   |
| `apps/api/tsconfig.json`                            | #14                   | DONE   |

---

## What's Already Done Well

- **Worker process** (`worker.ts`) - Proper graceful shutdown, signal handling, error boundaries
- **ORPC + Zod validation** - Input validation on all routes, OpenAPI generation
- **Background job architecture** - BullMQ with proper queue/worker separation, progress tracking
- **Qdrant package** - Clean abstraction, well-typed, covers all common operations
- **Database schema** - Good use of Drizzle relations, cascading deletes, proper indexes
- **Streaming chat** - AsyncGenerator pattern with source/token/done protocol
- **File parsing** - Supports PDF, DOCX, HTML, XLSX with proper library choices
