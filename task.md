# AI Usage Tracking & Credits System

## Phase 0: Analysis

- [x] Analyze project structure (monorepo, apps/api, apps/app, packages/db, packages/llm, packages/qdrant)
- [x] Analyze DB schemas (auth: user/org/member/apikey; rag: ragProfile/document/chunk/conversation/message)
- [x] Analyze LLM wrapper (`@repo/llm` — OpenRouterQuery, OpenRouterEmbed, model prices)
- [x] Analyze services (rag.service, conversation.service, organization.service)
- [x] Analyze routes (chat, document, conversation, organization, user, apikey, profile, health)
- [x] Analyze BullMQ document worker (embedding jobs)
- [x] Analyze auth config (Better Auth with org plugin, auto-org creation)
- [x] Check for existing tests (none found)

## Phase 1: Planning

- [x] Write implementation plan
- [x] Get user approval

## Phase 2: Database Schema

- [x] Create `ai_usage_log` table (tracks every AI API call)
- [x] Add `credits_balance` column to `organization` table (or dedicated `organization_credits` table)
- [x] Create `credit_transaction` table (audit log for credit changes)
- [x] Generate and run Drizzle migration

## Phase 3: LLM Wrapper Enhancement

- [/] Modify [OpenRouterQuery](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openai.ts#83-157) to return token usage alongside response
- [ ] Modify [OpenRouterEmbed](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openai.ts#158-188) to return token usage alongside embeddings
- [ ] Create cost calculation utility using model prices from [openrouter_models.ts](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/data/openrouter_models.ts)

## Phase 4: Credits Service

- [ ] Create `credits.service.ts` (balance check, deduction, top-up, transaction history)
- [ ] Create credits-checking middleware for org-scoped routes

## Phase 5: Usage Tracking Service

- [ ] Create `usage.service.ts` (log AI calls, aggregate stats)
- [ ] Integrate tracking into [OpenRouterQuery](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openai.ts#83-157) / [OpenRouterEmbed](file:///home/nas/personal_projects/foxmayn_ai/packages/llm/src/openai.ts#158-188) at the service layer

## Phase 6: Route Integration

- [ ] Add credits check before chat query/stream
- [ ] Add credits check before document indexing
- [ ] Deduct credits after successful AI calls
- [ ] Create new `credits.routes.ts` (balance, transactions, top-up)
- [ ] Create new `usage.routes.ts` (stats, history)

## Phase 7: Verification

- [ ] Manual testing of credit deduction flow
- [ ] Manual testing of insufficient credits rejection
- [ ] Verify usage logs are created correctly
