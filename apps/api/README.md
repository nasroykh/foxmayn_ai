# Foxmayn API Service

The core backend service for Foxmayn AI, built with **Hono**, **ORPC**, and **Better Auth**. It provides a type-safe, high-performance API for document management, RAG processing, and AI chat interactions.

## Core Pillars

- **Type-Safety**: End-to-end types using ORPC and Zod.
- **Unified Auth**: Personal API keys and session-based authentication via Better Auth.
- **Advanced RAG**: Customizable pipeline with profiles, chunking, and vector retrieval.
- **Background Processing**: Reliable job execution using BullMQ and Redis.

## Getting Started

### Prerequisites

| Service    | Version | Purpose             |
| ---------- | ------- | ------------------- |
| Node.js    | >=20    | Runtime environment |
| Redis      | >=7.0   | Queue management    |
| PostgreSQL | >=15    | Primary database    |
| Qdrant     | Latest  | Vector database     |

### Environment Variables

Copy `.env.example` to `.env` and configure:

- `DB_URL`: PostgreSQL connection
- `REDIS_URL`: Redis connection (e.g., `redis://localhost:6379`)
- `OPENROUTER_API_KEY`: For LLM and embeddings
- `BETTER_AUTH_SECRET`: Random string for encryption
- `QDRANT_URL`: Vector database endpoint

### Installation & Development

```bash
# Install dependencies (managed via root)
pnpm install

# Start the API server
pnpm dev

# Start the worker process (required for document indexing)
pnpm dev:worker
```

## API Route Summary

### 🔐 Authentication

- `/api/v1/auth/*`: Better Auth endpoints (login, signup, session, etc.)
- Supports `Bearer` token (API Key) or Cookie-based sessions.

### 👥 User & Admin (`/api/v1/admin/users`)

- Full user management for admins.
- Roles, banning, session revocation, and impersonation.

### 🔑 API Keys (`/api/v1/api-keys`)

- Create, list, rotate, and delete personal API keys.
- Configurable rate limits and permissions.

### ⚙️ RAG Profiles (`/api/v1/profiles`)

- Manage RAG configurations.
- Define models, chunk size, temperature, and personality traits.

### 📄 Documents (`/api/v1/documents`)

- Upload and index documents.
- Supported formats: `.txt`, `.md`, `.pdf`, `.docx`, `.xlsx`.
- Background indexing with progress tracking.

### 💬 Chat & Conversations (`/api/v1/chat`, `/api/v1/conversations`)

- **Query**: Direct RAG query with optional streaming.
- **Search**: Semantic search for document chunks.
- **Flexible History**:
  - **Client-Managed**: Provide a `messages` array in the request.
  - **Server-Managed**: Provide a `conversationId` to persist history on the server.

## Monitoring

- **Swagger/OpenAPI**: Available at `/docs` in development.
- **Queue Dashboard**: Access BullMQ status at `/api/v1/queues` (Admin only).

---

_Last Updated: January 2026_
