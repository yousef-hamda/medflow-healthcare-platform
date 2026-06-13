# syntax=docker/dockerfile:1.7
# Multi-stage build for @medflow/realtime-gateway.
#
# IMPORTANT: build context is the REPO ROOT so the pnpm workspace and the
# @medflow/* packages resolve. docker-compose.yml sets:
#   build: { context: ., dockerfile: apps/realtime-gateway/Dockerfile }
#
# Targets:
#   dev   — full deps + source, hot reload via `pnpm dev` (tsx watch)
#   prod  — slim runtime, runs `node dist/main.js` as non-root

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

# Workspace manifests first for dependency-layer caching.
COPY package.json pnpm-workspace.yaml ./
COPY apps/realtime-gateway/package.json apps/realtime-gateway/
COPY packages/shared-types/package.json packages/shared-types/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/realtime-gateway apps/realtime-gateway

# ---- dev (hot reload) ------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
WORKDIR /app/apps/realtime-gateway
EXPOSE 4001
CMD ["pnpm", "dev"]

# ---- build -----------------------------------------------------------------
FROM base AS build
RUN pnpm --filter @medflow/shared-types build || true
WORKDIR /app/apps/realtime-gateway
RUN pnpm run build

# ---- prod ------------------------------------------------------------------
FROM node:20-bookworm-slim AS prod
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app
RUN groupadd -r medflow && useradd -r -g medflow medflow
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/realtime-gateway/dist ./apps/realtime-gateway/dist
COPY --from=build /app/apps/realtime-gateway/package.json ./apps/realtime-gateway/
USER medflow
WORKDIR /app/apps/realtime-gateway
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.HTTP_PORT||4001)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
