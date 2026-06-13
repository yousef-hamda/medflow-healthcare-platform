# syntax=docker/dockerfile:1.7
# Multi-stage build for @medflow/clinician-dashboard (Next.js standalone).
# Targets:
#   --target dev      hot-reloading dev server on :3000
#   (default)         production "runner" image
#
# Build context MUST be the monorepo root so workspace packages are available:
#   docker build -f apps/clinician-dashboard/Dockerfile --target dev -t cd:dev .

# ───────────────────────────── base ─────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ───────────────────────────── deps ─────────────────────────────
# Install the full workspace dependency graph (cached on lockfile changes).
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/clinician-dashboard/package.json ./apps/clinician-dashboard/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile

# ───────────────────────────── dev ─────────────────────────────
FROM deps AS dev
COPY packages ./packages
COPY apps/clinician-dashboard ./apps/clinician-dashboard
EXPOSE 3000
WORKDIR /app/apps/clinician-dashboard
CMD ["pnpm", "dev"]

# ───────────────────────────── builder ─────────────────────────────
FROM deps AS builder
COPY packages ./packages
COPY apps/clinician-dashboard ./apps/clinician-dashboard
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @medflow/clinician-dashboard build

# ───────────────────────────── runner ─────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles a minimal server + traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/apps/clinician-dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/clinician-dashboard/.next/static ./apps/clinician-dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/clinician-dashboard/public ./apps/clinician-dashboard/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/clinician-dashboard/server.js"]
