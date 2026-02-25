# GEMINI.md

## Project Overview

This is a full-stack web application built with a monorepo architecture using pnpm workspaces. The project consists of a React frontend, a Hono (Node.js) backend, and shared database/utility packages.

**Technologies:**

- **Frontend (`apps/app`):**
  - **Framework:** React 19
  - **Build Tool:** Vite
  - **Language:** TypeScript
  - **Routing:** TanStack Router
  - **Data Fetching:** TanStack Query + oRPC Client
  - **State Management:** Jotai
  - **Auth:** Better Auth (Client)
  - **Styling:** Tailwind CSS 4
  - **UI Components:** Radix UI, Lucide React, Sonner, Vaul
- **Backend (`apps/api`):**
  - **Runtime:** Node.js
  - **Framework:** Hono
  - **Language:** TypeScript
  - **API Protocol:** oRPC (Open RPC) + OpenAPI
  - **Database:** PostgreSQL + Drizzle ORM
  - **Vector DB:** Qdrant
  - **Queues:** BullMQ (Redis)
  - **Auth:** Better Auth
  - **Payments:** Stripe
  - **AI/RAG:** OpenAI SDK, LangChain Text Splitters
- **Packages:**
  - `@repo/db`: PostgreSQL configuration, Drizzle ORM schemas, and migrations.
  - `@repo/qdrant`: Qdrant vector database client and configuration.

## Building and Running

### Prerequisites

- Node.js (>=20)
- pnpm (>=9.0.0)
- Docker (for local PostgreSQL, Qdrant, Redis)

### Development

1.  **Install dependencies:**

    ```bash
    pnpm install
    ```

2.  **Set up environment variables:**
    - Copy `.env.example` to `.env` in `apps/api`, `apps/app`, `packages/db`, and `packages/qdrant`.
    - Update the `.env` files with your local configuration (DB credentials, API keys, etc.).

3.  **Start the development servers:**
    ```bash
    pnpm dev
    ```
    This will likely start the frontend and backend in parallel.
    - **Frontend:** `http://localhost:33460` (or similar, check console)
    - **Backend:** `http://localhost:3000` (or defined port)

### Database & Migrations

- **Generate migrations:**

  ```bash
  pnpm --filter=@repo/db db:generate
  ```

- **Run migrations:**

  ```bash
  pnpm --filter=@repo/db db:migrate
  ```

- **Push schema changes (dev only):**
  ```bash
  pnpm --filter=@repo/db db:push
  ```

## Development Conventions

- **Monorepo Structure:**
  - `apps/`: Deployable applications (api, app).
  - `packages/`: Shared libraries (db, qdrant).
- **API Communication:** The project uses **oRPC** for type-safe communication between frontend and backend.
- **Authentication:** implemented using **Better Auth**.
- **Styling:** Tailwind CSS v4 is used.
- **Strictness:** Follow the "100% honest, strict, unbiased and harsh" persona. Do not make assumptions. Verify against the codebase.
