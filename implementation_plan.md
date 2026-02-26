# AI Usage Tracking, Stats & Credits System

A system where each organization has a credits balance (1 credit = 1 USD) that is consumed by embedding (document indexing) and chatting with AI. Every AI API call is logged with token counts and cost for analytics.

## User Review Required

> [!IMPORTANT]
> **Org-scoping the entire data model**: Currently, all RAG data (`ragProfile`, `document`, `conversation`, `message`) is scoped to `userId` only — organizations are not referenced anywhere in the RAG pipeline. This plan **does NOT refactor all existing tables to be org-scoped**. Instead, the credits system determines the org from `session.activeOrganizationId` at request time and charges it. If you want documents/conversations to also be org-owned (so members share data), that's a separate migration.

> [!WARNING]
> **Model prices are per-million-tokens** in [openrouter_models.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/data/openrouter_models.ts) (e.g. `inputPrice: 0.3` means \$0.30/M tokens). The cost formula is: `cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000`. These prices are your own lookup table, NOT live from OpenRouter. If OpenRouter changes prices, you need to update this file.

> [!CAUTION]
> **Credits deduction timing**: Credits are deducted **after** the AI call succeeds, not before. This means a race condition is possible where an org slightly overdraws. We use a pre-check (`balance > estimated_cost`) as a gate, but the actual deduction uses the real token count. For streaming responses, deduction happens after stream completion. If you need strict pre-payment, we'd need a "hold" mechanism — which adds significant complexity.

---

## Proposed Changes

### Database Schema ([packages/db](file:///home/nas/personal_projects/foxmayn_ai/packages/db))

---

#### [NEW] [usage-schema.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/db/src/models/usage/schema.ts)

New `packages/db/src/models/usage/` directory with the following tables:

**`ai_usage_log`** — Every AI API call gets a row:

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `organization_id` | text FK→organization | Org that was charged |
| `user_id` | text FK→user | User who triggered it |
| `operation_type` | enum(`chat`, `embedding`) | What kind of AI call |
| `model` | text | Model ID used (e.g. `google/gemini-2.5-flash-lite`) |
| `input_tokens` | integer | Tokens in the prompt/input |
| `output_tokens` | integer | Tokens in the response |
| `total_tokens` | integer | input + output |
| `cost_credits` | real | Actual USD cost deducted |
| `metadata` | jsonb | Extra context (conversationId, documentId, etc.) |
| `created_at` | timestamp | When the call happened |

Indexes: `organization_id`, `user_id`, `created_at`, `operation_type`.

**`credit_transaction`** — Audit log for every credit balance change:

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `organization_id` | text FK→organization | Which org |
| `type` | enum(`topup`, `usage`, `refund`, `adjustment`) | Transaction type |
| `amount` | real | Positive for additions, negative for deductions |
| `balance_after` | real | Balance snapshot after this transaction |
| `description` | text | Human-readable reason |
| `reference_id` | text nullable | Links to `ai_usage_log.id` for usage, or Stripe payment ID for topups |
| `created_by` | text FK→user nullable | Who performed the action |
| `created_at` | timestamp | When |

Index: `organization_id`, `created_at`.

---

#### [MODIFY] [auth/schema.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/db/src/models/auth/schema.ts)

Add `credits_balance` column to the `organization` table:

```diff
 export const organization = pgTable("organization", {
   id: text("id").primaryKey(),
   name: text("name").notNull(),
   slug: text("slug").notNull().unique(),
   logo: text("logo"),
   createdAt: timestamp("created_at").notNull(),
   metadata: text("metadata"),
+  creditsBalance: real("credits_balance").default(0).notNull(),
 });
```

> [!IMPORTANT]
> Better Auth's organization plugin manages the `organization` table. Adding a custom column requires that Drizzle migration runs **after** Better Auth is set up. Better Auth should not overwrite custom columns on existing tables, but verify this during testing.

---

#### [MODIFY] [schema.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/db/src/models/schema.ts)

```diff
 export * from "./auth/schema";
 export * from "./rag/schema";
+export * from "./usage/schema";
```

---

#### [NEW] [usage/types.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/db/src/models/usage/types.ts)

Drizzle infer types for usage tables.

---

#### [MODIFY] [types.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/db/src/models/types.ts)

Re-export usage types.

---

### LLM Package ([packages/llm](file:///home/nas/personal_projects/foxmayn_ai/packages/llm))

---

#### [MODIFY] [openrouter.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openrouter.ts)

The current [OpenRouterQuery](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openrouter.ts#40-98) returns `string | AsyncIterable<string>` — it discards token usage. The change:

1. **Non-streaming**: use `getResponse()` instead of `getText()` to access `response.usage` (inputTokens, outputTokens).
2. **Streaming**: after stream completes, call `getResponse()` to get final usage stats.
3. **Return type becomes a wrapper**: `{ text: string, usage: { inputTokens, outputTokens } }` for non-streaming, and `{ stream: AsyncIterable<string>, getUsage: () => Promise<Usage> }` for streaming.

For [OpenRouterEmbed](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openrouter.ts#99-156): The OpenRouter embeddings API response includes `usage.prompt_tokens`. Extract and return it.

```typescript
// New return types
export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type QueryResult = {
  text: string;
  usage: AIUsage;
};

export type StreamQueryResult = {
  stream: AsyncIterable<string>;
  getUsage: () => Promise<AIUsage>;
};

export type EmbedResult = {
  embeddings: number[][];
  usage: { totalTokens: number };
};
```

---

### API Services (`apps/api/src/services`)

---

#### [NEW] [credits.service.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/services/credits.service.ts)

Functions:
- `getBalance(orgId)` → `number`
- `hasEnoughCredits(orgId, estimatedCost)` → `boolean`
- `deductCredits(orgId, amount, referenceId, description)` → `{ newBalance, transactionId }` (atomic UPDATE + INSERT in a transaction)
- `addCredits(orgId, amount, userId, description, referenceId?)` → `{ newBalance, transactionId }`
- `getTransactionHistory(orgId, { limit, offset, type? })` → paginated list
- `estimateCost(model, inputTokens, outputTokens)` → uses model prices from `openrouter_models.ts`

The `deductCredits` function uses a **single SQL transaction** with `UPDATE organization SET credits_balance = credits_balance - $amount WHERE id = $orgId AND credits_balance >= $amount RETURNING credits_balance` to prevent negative balances atomically.

---

#### [NEW] [usage.service.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/services/usage.service.ts)

Functions:
- `logUsage(data)` → inserts into `ai_usage_log`, deducts credits, creates credit_transaction
- `getUsageStats(orgId, { from, to, groupBy? })` → aggregated stats (total cost, total tokens, by model, by operation type, by user)
- `getUsageHistory(orgId, { limit, offset, operationType?, userId? })` → paginated log

---

#### [MODIFY] [rag.service.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/services/rag.service.ts)

- In `queryRAG`: after `OpenRouterQuery` returns, log usage and deduct credits.
- In `queryRAGStream`: after stream completes, log usage and deduct credits.
- In `searchChunks`: after `OpenRouterEmbed` returns, log embedding usage and deduct credits.
- All functions need `organizationId` parameter added.

---

### API Routes (`apps/api/src/router`)

---

#### [MODIFY] [middleware.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/middleware.ts)

Add `orgProcedure` — extends `authProcedure` to require `activeOrganizationId` on the session and inject it into context:

```typescript
export const orgProcedure = authProcedure.use(async ({ context, next }) => {
  const orgId = context.session.activeOrganizationId;
  if (!orgId) {
    throw new ORPCError("BAD_REQUEST", { message: "No active organization" });
  }
  return next({ context: { ...context, organizationId: orgId } });
});
```

Add `creditsProcedure` — extends `orgProcedure` to check credits balance > 0:

```typescript
export const creditsProcedure = orgProcedure.use(async ({ context, next }) => {
  const { hasEnough } = await hasEnoughCredits(context.organizationId, 0.001); // minimum threshold
  if (!hasEnough) {
    throw new ORPCError("PAYMENT_REQUIRED", { message: "Insufficient credits" });
  }
  return next({ context });
});
```

---

#### [MODIFY] [chat.routes.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/routes/chat.routes.ts)

- Change `authProcedure` → `creditsProcedure` for `query`, `queryStream`, `search`.
- Pass `organizationId` from context to RAG service calls.

---

#### [MODIFY] [document.routes.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/routes/document.routes.ts)

- Change `authProcedure` → `creditsProcedure` for document upload/indexing.
- Pass `organizationId` to indexing service.

---

#### [NEW] [credits.routes.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/routes/credits.routes.ts)

Endpoints:
- `GET /credits/balance` — returns org credits balance
- `GET /credits/transactions` — paginated transaction history
- `POST /credits/topup` — admin-only; adds credits to org (manual for now, Stripe later)

---

#### [NEW] [usage.routes.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/routes/usage.routes.ts)

Endpoints:
- `GET /usage/stats` — aggregated usage stats for org (total cost, by model, by operation, by date range)
- `GET /usage/history` — paginated usage log

---

#### [MODIFY] [index.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/router/index.ts)

Register new route groups:

```diff
 export const router = {
   health: healthRoutes,
   users: userRoutes,
   organization: organizationRoutes,
   documents: documentRoutes,
   chat: chatRoutes,
   profiles: profileRoutes,
   apikeys: apiKeyRoutes,
   conversations: conversationRoutes,
+  credits: creditsRoutes,
+  usage: usageRoutes,
 };
```

---

### BullMQ Worker (`apps/api/src/jobs`)

---

#### [MODIFY] [document.worker.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/jobs/document/document.worker.ts)

- `processIndexDocument` needs `organizationId` in job data.
- After embedding batches complete, log total embedding token usage via `usage.service`.
- Deduct credits for the total embedding cost.

---

#### [MODIFY] [types.ts](file:///home/nas/personal_projects/foxmayn_ai/apps/api/src/jobs/document/types.ts)

Add `organizationId` to `IndexDocumentJobData` and `ReindexDocumentJobData`.

---

## Verification Plan

### Manual Verification

Since there are no existing tests in the codebase, verification is manual.

**1. Database Migration**
```bash
cd /home/nas/personal_projects/foxmayn_ai
pnpm --filter=@repo/db db:generate
pnpm --filter=@repo/db db:migrate
```
Verify: connect to PostgreSQL and confirm `ai_usage_log`, `credit_transaction` tables exist, and `organization.credits_balance` column exists.

**2. Credits Top-Up Flow**
- Start dev server: `pnpm dev`
- Use API client (curl/httpie) to call `POST /api/v1/credits/topup` as admin with `{ "amount": 10 }` for an org
- Call `GET /api/v1/credits/balance` → should show `10.0`
- Call `GET /api/v1/credits/transactions` → should show 1 topup transaction

**3. Chat Credit Deduction**
- With credits loaded, call `POST /api/v1/chat/query` with a valid query
- Call `GET /api/v1/credits/balance` → should be less than 10.0
- Call `GET /api/v1/usage/history` → should show 1 entry with model, tokens, cost
- Call `GET /api/v1/credits/transactions` → should show a `usage` type transaction

**4. Insufficient Credits Rejection**
- Set an org's balance to 0 (via direct DB update or spend all credits)
- Call `POST /api/v1/chat/query` → should return 402 (PAYMENT_REQUIRED)

**5. Document Indexing Credits**
- Top up credits, upload a document via `POST /api/v1/documents`
- Wait for indexing to complete (check job status)
- Verify credits were deducted and usage log shows `embedding` operation

**6. Usage Stats**
- After several chat and embedding calls, call `GET /api/v1/usage/stats`
- Verify aggregated totals match individual usage log entries
