# API Service

This is the backend service for the application, built with **Hono** and **ORPC**.

## Technologies

- **Framework**: [Hono](https://hono.dev/) running on Node.js.
- **API Engine**: [ORPC](https://orpc.run/) for type-safe procedures.
- **Authentication**: [Better Auth](https://www.better-auth.com/) with Stripe integration.
- **Database ORM**: [Drizzle ORM](https://orm.drizzle.team/) (using `@repo/db` package).
- **Payments**: [Stripe](https://stripe.com/).
- **Email**: [Nodemailer](https://nodemailer.com/).
- **Validation**: [Zod](https://zod.dev/).

## Getting Started

### Environment Variables

Ensure you have a `.env` file with the following:

- `PORT`: Port the server will listen on (default 33450).
- `DB_URL`: PostgreSQL connection string.
- `BETTER_AUTH_SECRET`: Secret for auth sessions.
- `STRIPE_SECRET_KEY`: Stripe API key.
- `SMTP_*`: SMTP configuration for emails.

### Development

```bash
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

## Directory Structure

- `src/index.ts`: Entry point of the server.
- `src/config`: Environment and service configurations (auth, stripe, etc.).
- `src/plugins`: Hono middleware and ORPC integration.
- `src/router`: ORPC routers and procedures definition.
- `src/services`: Business logic and external service integrations.
- `src/utils`: Helper functions.

## API Documentation

When running in development, you can access the Swagger UI at `http://localhost:33450/docs`.
