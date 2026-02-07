# Foxmayn AI Monorepo - Complete Analysis Report

## Context

This is an API-focused pnpm monorepo for a RAG (Retrieval-Augmented Generation) system. Stack: Hono + ORPC, Drizzle ORM + PostgreSQL, BullMQ + Redis, Qdrant vector DB, OpenRouter LLM, Better Auth, Stripe. The `@apps/app` frontend is excluded from this analysis.

---

## CRITICAL ISSUES (Bugs / Security / Data Integrity)

### 1. Logic Bug in `@repo/llm` - openrouter.ts:45
```typescript
if (!prompt && !prompt?.trim()) throw new Error("Prompt is required");
```
**Problem:** `&&` should be `||`. Currently, if `prompt` is `""` (empty string), `!prompt` is `true` but `!prompt?.trim()` is also `true`, so it accidentally works for empty string. But if `prompt` is `undefined`, `!prompt` is `true` and `!prompt?.trim()` is `true` (because `undefined?.trim()` is `undefined`, and `!undefined` is `true`). However, the real issue is on line 51: `messages.push({ role: "user", content: prompt })` will push `undefined` content. The guard is broken logically even if it happens to catch some cases.

**File:** `packages/llm/src/openrouter.ts:45`

### 2. `as any` Type Casts Everywhere - Bypasses Type Safety
Multiple critical `as any` casts that hide real type mismatches:
- `rag.service.ts:211` - `embeddingModelId as any` on OpenRouterEmbed call
- `rag.service.ts:268,279-283,339,350-354` - Profile fields cast to `as any` for tone, responseLength, model
- `document.worker.ts:118` - `embeddingModelId as any`
- `profile.routes.ts:102` - `input.data as any`
- `conversation.routes.ts:182,365` - `input.data as any`

**Problem:** These casts exist because the DB schema types don't align with the function signatures. The `ragProfile` table stores `model`, `tone`, `responseLength` etc. as plain `text` columns, but the consuming functions expect specific union types. This is a design flaw in the schema/type boundary.

### 3. No Multi-Tenancy / User Scoping on Data
**This is the single biggest architectural problem.** None of the data routes filter by the authenticated user:
- `document.routes.ts` - Any authenticated user can see/delete ALL documents
- `conversation.routes.ts` - Any authenticated user can see/delete ALL conversations
- `profile.routes.ts` - ALL profile routes use `publicProcedure` (no auth at all!)
- `chat.routes.ts` - Queries against all documents regardless of user

**Files:** All route files in `apps/api/src/router/routes/`

**Impact:** User A can read/delete User B's documents, conversations, and profiles. Profile creation/modification requires zero authentication.

### 4. Unsafe JSON.parse Without Try-Catch
`document.routes.ts:52`:
```typescript
metadata: metadata ? JSON.parse(metadata) : undefined,
```
If `metadata` is malformed JSON, this throws an unhandled exception instead of returning a proper BAD_REQUEST error.

### 5. Auth Config Uses `process.env` Instead of Validated `env`
`apps/api/src/config/auth.ts`:
- Line 18: `process.env.STRIPE_SECRET_KEY!` (non-null assertion on raw env)
- Line 40: `process.env.APP_URL` (unvalidated)
- Line 75: `process.env.STRIPE_WEBHOOK_SECRET!` (non-null assertion)
- Line 89: `process.env.APP_URL!` (non-null assertion)

**Problem:** The whole point of the Zod env validation is to ensure these exist. Using `process.env` directly bypasses that validation and could crash at runtime with cryptic errors. Should use the validated `env` object consistently.

### 6. Document Worker Partial Failure Leaves Orphaned Data
`document.worker.ts` - The indexing pipeline does:
1. Chunk text
2. Generate embeddings
3. Insert chunk records into PostgreSQL (step 4, line 173)
4. Upsert vectors into Qdrant (step 5, line 180)

If step 5 fails after step 4 succeeds, you have DB chunk records pointing to non-existent Qdrant vectors. The catch block only sets `status: "failed"` but doesn't clean up the chunk records.

### 7. Super Admin Init Swallows Errors
`plugins/auth.ts:43-45`:
```typescript
} catch (error) {
    console.error("Failed to initialize super admin:", error);
}
```
If super admin creation fails, the server continues running without admin access. This should either retry or fail the startup.

---

## ARCHITECTURAL ISSUES (Need Rework)

### 8. No Build Orchestration Tool (Turbo/Nx Missing)
Root `package.json` manually chains builds:
```
"build": "pnpm --filter=db build && pnpm --filter=qdrant build && pnpm --filter=api build && pnpm --filter=app build"
```
**Problems:**
- No build caching - every build rebuilds everything
- No parallel execution of independent packages
- Build order manually maintained, will break as packages grow
- Dev script also sequentially builds all packages before starting

**Recommendation:** Add Turborepo with proper `turbo.json` pipeline definitions.

### 9. Module System Mismatch (ESM vs CJS)
- `apps/api/tsconfig.json` - Module: `NodeNext` (ESM)
- `packages/*/tsconfig.json` - Module: `CommonJS`

The API imports CJS packages via ESM, which works through Node.js interop but creates friction:
- Can't use ESM-only features in packages
- `module: "node10"` resolution in packages is legacy
- Inconsistent `type` field handling across package.json files

### 10. Duplicated Code Between rag.service.ts and document.worker.ts
Both files contain identical copies of:
- `ensureCollection()` function (rag.service.ts:46-65 and document.worker.ts:37-56)
- `VectorPayload` interface (rag.service.ts:68-75 and document.worker.ts:59-66)
- `initializedCollections` Set (rag.service.ts:44 and document.worker.ts:35)
- Qdrant client initialization (rag.service.ts:41 and document.worker.ts:32)
- `COLLECTION_NAME` constant (rag.service.ts:38 and document.worker.ts:28)

These should be extracted to a shared module.

### 11. Token Counting Uses Hardcoded String Matching
`document.worker.ts:160-163`:
```typescript
tokenCount: calculateTokens(
    chunk.content,
    embeddingModelId.includes("large")
        ? "text-embedding-3-large"
        : "text-embedding-3-small"
),
```
This assumes all embedding models are either "large" or "small" OpenAI models. It will produce incorrect token counts for Google, Qwen, or BAAI models listed in `openrouter_models.ts`.

### 12. Database Connection Pool Not Configured
`packages/db/src/index.ts:12-14`:
```typescript
const pool = new Pool({ connectionString });
```
No pool configuration (min/max connections, idle timeout, connection timeout). Under load, this could exhaust connections or leave them idle. The `initDB()` function also calls `pool.connect()` which acquires a client but never releases it back to the pool.

### 13. No Shared TypeScript Configuration
Each package has its own `tsconfig.json` with duplicated settings. There's no root `tsconfig.base.json` for shared compiler options. This leads to inconsistencies and maintenance burden.

### 14. Environment Config Is Scattered and Duplicated
Three separate env validation schemas exist:
- `apps/api/src/config/env.ts` - API env (includes DB_*, QDRANT_*, OPENROUTER_*)
- `packages/db/src/config/env.ts` - DB env (duplicates DB_*)
- `packages/llm/src/config/env.ts` - LLM env (duplicates OPENROUTER_*)
- `packages/qdrant/src/config/env.ts` - Qdrant env (duplicates QDRANT_*)

Each package loads `dotenv/config` independently. The API also validates the same variables its packages validate.

---

## DESIGN ISSUES (Should Be Refactored)

### 15. Profile Routes Are Completely Public
`profile.routes.ts` - Every single route uses `publicProcedure`:
- Creating, updating, deleting RAG profiles requires zero authentication
- Anyone can modify the default profile's model, temperature, system prompt

### 16. No Pagination Count in listDocuments
`document.routes.ts:197`:
```typescript
total: docs.length,  // This returns the count of the current page, NOT total documents
```
The `total` field should be the total count of all documents, not just the current page size. Compare with `conversation.routes.ts` which correctly does `countConversations()` in parallel.

### 17. Email Sending Is Fire-and-Forget (No Await)
`config/auth.ts:41-46`:
```typescript
sendInvitationEmail(data.email, data.inviter.user.name, ...);  // no await
```
And line 52:
```typescript
sendOTPEmail(email, otp);  // no await
```
These are async functions called without `await`. If they fail, the error is silently lost and the user gets a success response but no email.

### 18. Streaming Response Doesn't Handle Non-Stream Case
`rag.service.ts:363`:
```typescript
if (typeof stream !== "string" && Symbol.asyncIterator in stream) {
```
If `OpenRouterQuery` returns a plain string despite `stream: true`, the function silently yields nothing and emits `done`. The user gets sources but no answer, with no error.

### 19. No Rate Limiting on Public/Auth Endpoints
Better Auth's API key rate limiting (100 req/5min) only applies to API key authentication. There's no rate limiting on:
- Login endpoint (brute force vulnerable)
- Password reset / email OTP
- Document upload (resource exhaustion)
- Chat queries (LLM cost exhaustion)

### 20. `listDocuments` Has No User/Profile Filtering
`rag.service.ts:399-402`:
```typescript
export const listDocuments = async (limit = 20, offset = 0) => {
    const docs = await db.select().from(document).limit(limit).offset(offset);
    return docs;
};
```
No way to filter by profileId, status, or any other criteria. Every list call returns all documents across all users/profiles.

### 21. Conversation History Loads Fixed 50 Messages
`chat.routes.ts:89`:
```typescript
const existingMessages = await listMessages(input.conversationId, 50, 0);
```
Hardcoded to 50 messages. For long conversations, this means:
- Always sending 50 messages as context (token waste)
- For conversations with >50 messages, older context is silently dropped
- No sliding window or summarization strategy

### 22. `app_template` as Project Name
Root `package.json`:
```json
"name": "app_template"
```
Still using the template name. Should be `foxmayn-ai` or similar.

### 23. Auth Route Path Mismatch
`plugins/auth.ts:11`:
```typescript
app.on(["POST", "GET"], `/auth/*`, (c) => { ... });
```
But the Hono app is created with `basePath(env.API_V1_PREFIX)` in `index.ts:7`. So the actual path is `/api/v1/auth/*`. Meanwhile, Better Auth is configured with `basePath: \`${env.API_V1_PREFIX}/auth\`` which would make it expect `/api/v1/auth/api/v1/auth/*`. This seems like it might work due to how Hono basePath interacts with route matching, but the path configuration is confusing and fragile.

### 24. Worker Process Doesn't Run in Dev Script
Root `package.json` dev script:
```
"dev": "... concurrently ... \"pnpm --filter=api dev\" \"pnpm --filter=app dev\""
```
The worker (`src/worker.ts`) is not started. Document indexing and email sending won't work in development unless manually started with `pnpm --filter=api dev:worker`. There's also no `dev:worker` script defined in the root package.json.

### 25. No Graceful Shutdown on API Server
`apps/api/src/index.ts` - The server has no SIGTERM/SIGINT handlers. Compare with `worker.ts` which has proper graceful shutdown. If the API process is killed, in-flight requests are dropped and the DB pool isn't properly closed.

---

## MISSING INFRASTRUCTURE

### 26. Zero Test Coverage
- No test files exist anywhere
- No test framework installed
- No test scripts (only `echo "Error: no test specified"`)
- No CI/CD pipeline to enforce tests

### 27. No Docker / Containerization
- No Dockerfile for API or worker
- No docker-compose for local dev (PostgreSQL, Redis, Qdrant)
- Developers must manually install and configure 3 external services

### 28. No Linting / Formatting
- No ESLint configuration
- No Prettier configuration
- No pre-commit hooks (husky/lint-staged)
- Code style inconsistencies (e.g., emoji in console.log vs plain text)

### 29. No Logging Framework
All logging is `console.log` / `console.error` with emoji prefixes. No:
- Structured logging (JSON format)
- Log levels (debug, info, warn, error)
- Request ID tracking
- External log aggregation

### 30. No Error Monitoring
No Sentry, Datadog, or similar error tracking. Production errors will only appear in stdout.

### 31. No API Versioning Strategy
Routes hardcode `/api/v1/` via `env.API_V1_PREFIX`. There's no mechanism to run v1 and v2 simultaneously, and the prefix is set as the Hono basePath which affects ALL routes.

### 32. No Health Check Endpoint
No `/health` or `/readiness` endpoint for container orchestration, load balancers, or monitoring.

---

## SUMMARY BY PRIORITY

**P0 - Fix Immediately (Security/Data Integrity):**
1. Add user scoping to all data routes (#3)
2. Protect profile routes with authentication (#15)
3. Fix `process.env` usage in auth.ts (#5)
4. Fix JSON.parse without try-catch (#4)

**P1 - Fix Soon (Bugs/Correctness):**
5. Fix `&&`/`||` logic bug in openrouter.ts (#1)
6. Fix listDocuments returning page count as total (#16)
7. Handle document worker partial failures (#6)
8. Add `await` to email sending (#17)
9. Handle streaming non-stream fallback (#18)

**P2 - Refactor (Architecture):**
10. Extract duplicated Qdrant code to shared module (#10)
11. Fix `as any` casts with proper type boundaries (#2)
12. Add Turborepo for build orchestration (#8)
13. Unify module system (all ESM) (#9)
14. Add shared tsconfig.base.json (#13)
15. Consolidate environment configuration (#14)
16. Fix token counting for non-OpenAI models (#11)
17. Configure DB connection pool (#12)

**P3 - Add Missing Infrastructure:**
18. Add test framework and write tests (#26)
19. Add Docker/docker-compose (#27)
20. Add ESLint + Prettier + pre-commit hooks (#28)
21. Add structured logging (#29)
22. Add health check endpoint (#32)
23. Add rate limiting on auth/upload endpoints (#19)
24. Add graceful shutdown to API server (#25)
25. Start worker in dev script (#24)

---

## FILES REQUIRING CHANGES

| File | Issues |
|------|--------|
| `packages/llm/src/openrouter.ts` | #1 logic bug |
| `apps/api/src/services/rag.service.ts` | #2, #10, #18, #20 |
| `apps/api/src/router/routes/*` | #3, #15, #16 |
| `apps/api/src/config/auth.ts` | #5, #17 |
| `apps/api/src/router/routes/document.routes.ts` | #4, #16 |
| `apps/api/src/jobs/document/document.worker.ts` | #2, #6, #10, #11 |
| `apps/api/src/plugins/auth.ts` | #7, #23 |
| `apps/api/src/index.ts` | #25 |
| `apps/api/src/worker.ts` | (already well-done) |
| `packages/db/src/index.ts` | #12 |
| `package.json` (root) | #8, #22, #24 |
| `packages/*/tsconfig.json` | #9, #13 |
| (new) `turbo.json` | #8 |
| (new) `tsconfig.base.json` | #13 |
| (new) `docker-compose.yml` | #27 |
| (new) `.eslintrc` / `prettier.config` | #28 |

---

## WHAT'S DONE WELL

- **Worker process** (`worker.ts`) - Proper graceful shutdown, signal handling, error boundaries
- **ORPC + Zod validation** - Input validation on all routes, OpenAPI generation
- **Background job architecture** - BullMQ with proper queue/worker separation, progress tracking
- **Qdrant package** - Clean abstraction, well-typed, covers all common operations
- **Database schema** - Good use of Drizzle relations, cascading deletes, proper indexes
- **Streaming chat** - AsyncGenerator pattern with source/token/done protocol
- **File parsing** - Supports PDF, DOCX, HTML, XLSX with proper library choices
