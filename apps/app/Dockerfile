# syntax=docker/dockerfile:1
# Build context: repository root.
#   docker build -f apps/app/Dockerfile --target production .

ARG NODE_IMAGE=node:24.22.1-alpine3.24
ARG CADDY_IMAGE=caddy:2.11.7-alpine
ARG PNPM_VERSION=10.34.9

# ============================================
# Build: compile the frontend (type-checks against the API package types)
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
COPY apps/app ./apps/app

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Vite bakes this into the bundle. Same-origin by default: Caddy proxies /api/*.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

# Builds the packages and the API (for its types), then the frontend
RUN pnpm exec turbo run build --filter=@repo/app...

# ============================================
# Production: Caddy serves the SPA and proxies /api/* to the API
# ============================================
FROM ${CADDY_IMAGE} AS production

COPY apps/app/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/app/dist /srv

# Non-root user; Caddy only needs write access to /config and /data
RUN addgroup -g 1001 -S appuser \
    && adduser -S appuser -u 1001 -G appuser \
    && chown -R appuser:appuser /config /data

USER appuser
EXPOSE 33460

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:33460/health || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
