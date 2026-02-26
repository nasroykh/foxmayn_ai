
# ============================================
# Stage 1: Build - Build shared packages and API
# ============================================
FROM node:24-alpine AS build

RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@10.30.1 turbo@2.8.10

WORKDIR /app

# Copy source code
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# Install dependencies using cached pnpm store
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Build workspace packages in dependency order
RUN pnpm --filter @repo/db build
RUN pnpm --filter @repo/llm build
RUN pnpm --filter @repo/qdrant build

# Generate migrations from schema (drizzle-kit generate doesn't connect to DB;
# all DB_* vars are only needed to satisfy env validation, not for generation itself)
RUN DB_URL=postgresql://build:build@localhost:5432/build \
    DB_USER=build DB_PASSWORD=build DB_HOST=localhost DB_PORT=5432 \
    DB_NAME=build DB_SSL_MODE=disable \
    pnpm --filter @repo/db db:generate

# Build the API
RUN pnpm --filter api build

# Prune dev dependencies for production
RUN pnpm --filter api --prod deploy --legacy /app/pruned

# Inject built dist into the deployed workspace packages
RUN cp -r /app/packages/db/dist /app/pruned/node_modules/@repo/db/dist 2>/dev/null; \
    cp -r /app/packages/llm/dist /app/pruned/node_modules/@repo/llm/dist 2>/dev/null; \
    cp -r /app/packages/qdrant/dist /app/pruned/node_modules/@repo/qdrant/dist 2>/dev/null; \
    true

# ============================================
# Stage 3: Production - Minimal runtime image
# ============================================
FROM node:24-alpine AS production

# Install PostgreSQL client for pg_isready and pnpm for migrations
RUN apk add --no-cache postgresql-client && \
    npm install -g pnpm@10.30.1

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S apiuser -u 1001 -G nodejs

WORKDIR /app

# Copy workspace configuration for migration support
COPY --chown=apiuser:nodejs pnpm-workspace.yaml package.json ./
COPY --chown=apiuser:nodejs packages/db/package.json ./packages/db/package.json

# Copy built application from build stage
COPY --from=build --chown=apiuser:nodejs /app/pruned/node_modules ./node_modules
COPY --from=build --chown=apiuser:nodejs /app/pruned/package.json ./apps/api/package.json
COPY --from=build --chown=apiuser:nodejs /app/apps/api/dist ./dist
# DB source and drizzle config needed for migrations
COPY --from=build --chown=apiuser:nodejs /app/packages/db/src ./packages/db/src
COPY --from=build --chown=apiuser:nodejs /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build --chown=apiuser:nodejs /app/packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts

# Copy entrypoint script
COPY --chown=apiuser:nodejs apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Switch to non-root user
USER apiuser

# Expose API port
EXPOSE 33450

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:33450/api/v1/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Use entrypoint script to run migrations before starting
ENTRYPOINT ["/app/docker-entrypoint.sh"]


