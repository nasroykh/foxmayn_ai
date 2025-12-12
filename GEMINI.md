# GEMINI.md

## Project Overview

This is a full-stack web application built with a monorepo architecture using pnpm workspaces. The project consists of a React frontend, a Node.js backend, and a shared database package.

**Technologies:**

*   **Frontend:**
    *   React
    *   Vite
    *   TypeScript
    *   TanStack Router (for routing)
    *   TanStack React Query (for data fetching)
    *   tRPC Client
    *   Radix UI
    *   Tailwind CSS
*   **Backend:**
    *   Node.js
    *   Fastify
    *   TypeScript
    *   tRPC
    *   PostgreSQL
    *   Drizzle ORM
*   **Database:**
    *   PostgreSQL
    *   Drizzle ORM
    *   drizzle-zod

## Building and Running

### Prerequisites

*   Node.js (>=18)
*   pnpm (>=10.0.0)
*   Docker (for running a local PostgreSQL database)

### Development

1.  **Install dependencies:**
    ```bash
    pnpm install
    ```

2.  **Set up environment variables:**
    *   Create a `.env` file in the `apps/api` directory by copying the `.env.example` file.
    *   Update the `.env` file with your database connection details.

3.  **Start the development servers:**
    ```bash
    pnpm dev
    ```
    This will start the frontend, backend, and database services concurrently.

    *   Frontend: `http://localhost:5173`
    *   Backend: `http://localhost:3001`
    *   Swagger UI: `http://localhost:3001/docs`

### Database Migrations

*   **Generate migrations:**
    ```bash
    pnpm --filter=db db:generate
    ```

*   **Run migrations:**
    ```bash
    pnpm --filter=db db:migrate
    ```

*   **Push schema changes (for development):**
    ```bash
    pnpm --filter=db db:push
    ```

### Building for Production

```bash
pnpm build
```

### Starting in Production

```bash
pnpm start
```

## Development Conventions

*   **Monorepo:** The project is organized as a monorepo with `apps` and `packages` directories.
*   **tRPC:** tRPC is used for communication between the frontend and backend, providing type-safe APIs.
*   **Database:** Drizzle ORM is used for database access. The database schema is defined in the `packages/db` package.
*   **Styling:** Tailwind CSS is used for styling the frontend.
*   **Routing:** TanStack Router is used for routing in the frontend.
*   **State Management:** TanStack React Query is used for server-side state management.
