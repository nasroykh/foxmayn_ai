# FoxMayn AI - Enterprise RAG Monorepo

Foxmayn AI is a professional, full-stack application designed for managing knowledge bases through a complete RAG (Retrieval-Augmented Generation) pipeline. It provides a robust, type-safe architecture for indexing documents and generating AI responses with high precision.

## 🏗️ Architecture & Stack

### Core Hubs

- **[API Service](file:///Users/nas/Desktop/Foxmayn/foxmayn_ai/apps/api/README.md)**: Hono backend powering the ORPC engine, auth, and background jobs.
- **Frontend App**: Modern React 19 interface (TanStack Router, Query, Jotai).

### Shared Intelligence (`packages/`)

- **[@repo/db](file:///Users/nas/Desktop/Foxmayn/foxmayn_ai/packages/db/README.md)**: Drizzle ORM models for Auth and RAG modules.
- **[@repo/llm](file:///Users/nas/Desktop/Foxmayn/foxmayn_ai/packages/llm/README.md)**: OpenRouter SDK wrapper for chat and batch embeddings.
- **[@repo/qdrant](file:///Users/nas/Desktop/Foxmayn/foxmayn_ai/packages/qdrant/README.md)**: High-performance vector database client and utilities.

## 🚀 Key Features

- **End-to-End Type Safety**: Shared types across the entire stack using ORPC.
- **Flexible RAG Pipeline**: Multiple strategy supports via customizable RAG Profiles.
- **Multi-Tenant Auth**: Advanced user management with Better Auth (API Keys, Orgs, Admin).
- **Background Processing**: BullMQ-powered document ingestion and email services.
- **Serverless Ready**: Hono core adaptable to multiple environments.

## 🛠️ Getting Started

### 1. Prerequisites

- **Node.js**: v20+
- **pnpm**: v9+
- **Docker**: For PostgreSQL, Redis, and Qdrant local instances.

### 2. Installation

```bash
pnpm install
```

### 3. Environment Setup

Create `.env` files in:

- `apps/api`
- `apps/app`
- `packages/db`
- `packages/qdrant`
- `packages/llm`

### 4. Database Setup

```bash
# Push schema to local DB
pnpm --filter=@repo/db db:push
```

### 5. Running

```bash
# Start both API and Frontend
pnpm dev

# Start background jobs worker
pnpm --filter=api run dev:worker
```

---

_Designed & Developed by Foxmayn AI Team_
