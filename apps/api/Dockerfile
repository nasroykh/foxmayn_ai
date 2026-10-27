# syntax=docker/dockerfile:1
# Build context: repository root.
#   docker build -f apps/api/Dockerfile --target production .
# Targets: production (API server), migrate (one-shot database migrations)

ARG NODE_IMAGE=node:24.22.1-alpine3.24
ARG PNPM_VERSION=10.34.9

# ============================================
# Build: install workspace dependencies, build packages and the API
# ============================================
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ENV TURBO_TELEMETRY_DISABLED=1 \
    CI=true
RUN apk add --no-cache libc6-compat && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Builds @repo/db, @repo/llm, @repo/qdrant, then the API (turbo orders them)
RUN pnpm exec turbo run build --filter=@repo/api...

# Production-only dependency trees (no devDependencies, no drizzle-kit, no tsx)
RUN pnpm --filter @repo/api --prod deploy --legacy /out/api \
    && pnpm --filter @repo/db --prod deploy --legacy /out/migrate

# Fail the build if a workspace package was deployed without its compiled output
RUN test -f /out/api/node_modules/@repo/db/dist/index.js \
    && test -f /out/api/node_modules/@repo/llm/dist/openrouter.js \
    && test -f /out/api/node_modules/@repo/qdrant/dist/index.js \
    && test -f /out/migrate/dist/migrate.js \
    && test -f /out/migrate/drizzle/meta/_journal.json

# ============================================
# Migrate: one-shot job, applies packages/db/drizzle then exits
# ============================================
FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/migrate ./
USER node
CMD ["node", "dist/migrate.js"]

# ============================================
# Production: API server
# ============================================
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist

USER node
EXPOSE 33450

# Liveness only (no dependency checks): {API_V1_PREFIX}/health
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||33450)+(process.env.API_V1_PREFIX||'/api/v1')+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
