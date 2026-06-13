# syntax=docker/dockerfile:1.7
# Multi-stage build for @medflow/audit-service.
#
# IMPORTANT: build context is the REPO ROOT so the pnpm workspace and the
# @medflow/* packages resolve. docker-compose.yml sets:
#   build: { context: ., dockerfile: apps/audit-service/Dockerfile }

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY apps/audit-service/package.json apps/audit-service/
COPY packages/shared-types/package.json packages/shared-types/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/audit-service apps/audit-service

# ---- dev -------------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
WORKDIR /app/apps/audit-service
EXPOSE 8095
CMD ["pnpm", "dev"]

# ---- build -----------------------------------------------------------------
FROM base AS build
RUN pnpm --filter @medflow/shared-types build || true
WORKDIR /app/apps/audit-service
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
COPY --from=build /app/apps/audit-service/dist ./apps/audit-service/dist
COPY --from=build /app/apps/audit-service/package.json ./apps/audit-service/
USER medflow
WORKDIR /app/apps/audit-service
EXPOSE 8095
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.HTTP_PORT||8095)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
