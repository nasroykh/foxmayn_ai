# API Package

Hono-based Node.js backend with oRPC for type-safe API routes.

## Tech Stack

- **Framework**: Hono + @hono/node-server
- **API**: oRPC with OpenAPI generation
- **Auth**: Better Auth (email/password, API keys, organizations)
- **Queue**: BullMQ + Redis for document processing
- **Payments**: Stripe subscriptions

## Key Directories

- `src/router/routes/` - oRPC route handlers
- `src/services/` - Business logic
- `src/jobs/` - BullMQ workers
- `src/config/` - Environment and auth config
- `src/plugins/` - Hono middleware

## Scripts

```bash
pnpm dev        # Start API server with hot reload
pnpm dev:worker # Start document processing worker
pnpm build      # Build for production
```

## RAG Pipeline

1. Document upload → `indexDocument()` → BullMQ job
2. Worker chunks text → generates embeddings → Qdrant upsert
3. Query → vector search → LLM generation with context
