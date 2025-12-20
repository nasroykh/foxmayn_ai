# FoxMayn AI - Full-Stack RAG Application

This is a full-stack, AI-powered application built with a modern technology stack. It's architected as a monorepo using pnpm workspaces, featuring a React/Vite frontend and a Hono backend, with a complete RAG (Retrieval-Augmented Generation) pipeline for advanced AI capabilities.

---

## Technology Stack

### Core Technologies

*   **Monorepo:** pnpm Workspaces
*   **Runtime:** Node.js
*   **Language:** TypeScript

### Frontend (`apps/app`)

*   **Framework:** React 19
*   **Build Tool:** Vite
*   **Routing:** TanStack Router
*   **Data Fetching:** TanStack Query
*   **API Client:** oRPC Client (for type-safe API calls)
*   **State Management:** Jotai
*   **Styling:** Tailwind CSS 4
*   **UI Components:** Radix UI, Lucide React, Sonner (notifications)
*   **Authentication:** Better Auth

### Backend (`apps/api`)

*   **Framework:** Hono
*   **API Protocol:** oRPC (Open RPC) with OpenAPI generation
*   **Database:** PostgreSQL with Drizzle ORM
*   **Vector Database:** Qdrant for RAG
*   **Background Jobs:** BullMQ (Redis)
*   **Authentication:** Better Auth
*   **Payments:** Stripe Integration
*   **AI/RAG:** OpenAI SDK, LangChain.js

### Shared Packages

*   `@repo/db`: Manages database schema (Drizzle), connections, and migrations.
*   `@repo/qdrant`: Provides a configured client for interacting with the Qdrant vector database.

---

## Getting Started

### Prerequisites

*   **Node.js**: Version 20 or higher recommended.
*   **pnpm**: Version 9 or higher.
*   **Docker**: Required for running local instances of PostgreSQL, Redis, and Qdrant.

### 1. Installation

Clone the repository and install all dependencies using pnpm.

```bash
git clone <repository-url>
cd foxmayn_ai
pnpm install
```

### 2. Environment Setup

The project uses `.env` files for managing environment variables. Examples are provided in each app and package.

1.  Navigate to `apps/api`, `apps/app`, `packages/db`, and `packages/qdrant`.
2.  In each directory, copy the `.env.example` file to a new `.env` file:
    ```bash
    cp .env.example .env
    ```
3.  Review and update the variables in each `.env` file to match your local setup (e.g., database credentials, API keys for OpenAI/Stripe, etc.).

### 3. Start Local Services

If you have Docker installed, you can start the required services (PostgreSQL, Redis, Qdrant). A `docker-compose.yml` file should be present in the root of the project or will need to be created.

```bash
# (Assuming a docker-compose.yml is available)
docker compose up -d
```

### 4. Database Migrations

Before starting the application, run the database migrations to set up your PostgreSQL schema.

```bash
# Push schema directly (for initial development)
pnpm --filter=@repo/db db:push

# Or, to generate and run migration files:
pnpm --filter=@repo/db db:generate
pnpm --filter=@repo/db db:migrate
```

### 5. Run in Development Mode

Start the frontend and backend servers concurrently.

```bash
pnpm dev
```

This will start:
*   **Backend API** on `http://localhost:3000` (or the port specified in `apps/api/.env`).
*   **Frontend App** on `http://localhost:33460` (or the port specified in `apps/app/package.json`).

---

## Monorepo Structure

The project is organized into `apps` and `packages` to maintain a clean separation of concerns.

*   `apps/`: Contains the deployable applications.
    *   `api/`: The Hono backend server, handling all business logic, AI processing, and database interactions.
    *   `app/`: The React frontend, providing the user interface.
*   `packages/`: Contains shared code and configurations used across different apps.
    *   `db/`: Drizzle ORM schemas, database client, and migration scripts.
    *   `qdrant/`: Client and helper functions for the Qdrant vector database.