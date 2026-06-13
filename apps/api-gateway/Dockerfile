# syntax=docker/dockerfile:1.7
# ============================================================================
# MedFlow API Gateway — multi-stage build
#
#   base   → pnpm + workspace dependencies (cached)
#   dev    → hot-reload target (`nest start --watch` via pnpm start:dev)
#   build  → compiles TypeScript to dist/
#   prod   → slim runtime image, production deps only
#
# Build the dev target:   docker build --target dev  -t medflow/api-gateway:dev .
# Build the prod target:  docker build --target prod -t medflow/api-gateway .
# ============================================================================

# ── base ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

# Copy the workspace manifests first for dependency-layer caching.
COPY package.json pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/fhir-types/package.json packages/fhir-types/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile

# Bring in the full source for the workspace packages the gateway depends on.
COPY packages/shared-types packages/shared-types
COPY packages/fhir-types packages/fhir-types
COPY apps/api-gateway apps/api-gateway

# ── dev (hot reload) ─────────────────────────────────────────────────────────
FROM base AS dev
ENV NODE_ENV=development
WORKDIR /app/apps/api-gateway
EXPOSE 4000
# package.json defines `dev` (ts-node). Use Nest watch mode if present, else dev.
CMD ["pnpm", "run", "dev"]

# ── build ────────────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app/apps/api-gateway
RUN pnpm run build

# ── prod (slim runtime) ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS prod
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/fhir-types/package.json packages/fhir-types/

# Production-only dependency install.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --prod

# Workspace package sources (consumed via the TS path aliases at runtime are
# not needed in prod because they are bundled into dist/, but the compiled
# gateway output is copied below).
COPY --from=build /app/apps/api-gateway/dist apps/api-gateway/dist

WORKDIR /app/apps/api-gateway
EXPOSE 4000
USER node
CMD ["node", "dist/main.js"]
