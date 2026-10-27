# syntax=docker/dockerfile:1
# Build context: repository root.
#   docker build -f apps/worker/Dockerfile --target production .

ARG NODE_IMAGE=node:24.22.1-alpine3.24
ARG PNPM_VERSION=10.34.9

# ============================================
# Build: install workspace dependencies, build packages, API and worker
# ============================================
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ENV TURBO_TELEMETRY_DISABLED=1 \
    CI=true
RUN apk add --no-cache libc6-compat && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
# The worker imports its job processors from the API package
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Builds @repo/db, @repo/llm, @repo/qdrant, @repo/api, then the worker
RUN pnpm exec turbo run build --filter=worker...

RUN pnpm --filter worker --prod deploy --legacy /out/worker

# `pnpm deploy` copies workspace packages without their build output
# (dist is gitignored); copy the API's compiled jobs in, then fail the build
# if any workspace package is still missing its dist.
RUN rm -rf /out/worker/node_modules/@repo/api/dist \
    && cp -r /app/apps/api/dist /out/worker/node_modules/@repo/api/dist
RUN test -f /out/worker/node_modules/@repo/api/dist/jobs/index.js \
    && cd /out/worker/node_modules/@repo/api \
    && node -e "for (const m of ['@repo/db','@repo/llm/openrouter','@repo/qdrant']) require.resolve(m)"

# ============================================
# Production: worker process
# ============================================
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /out/worker/node_modules ./node_modules
COPY --from=build --chown=node:node /out/worker/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/worker/dist ./dist

USER node

# The worker touches /tmp/worker-heartbeat every 15s while its queues and Redis
# respond (apps/worker/src/index.ts); unhealthy if the file is older than 60s.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "-e", "try{process.exit(Date.now()-require('fs').statSync(process.env.WORKER_HEARTBEAT_FILE||'/tmp/worker-heartbeat').mtimeMs<60000?0:1)}catch{process.exit(1)}"]

CMD ["node", "dist/index.js"]
