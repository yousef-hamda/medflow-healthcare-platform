# syntax=docker/dockerfile:1.7

# ---------- deps: install workspace dependencies ----------
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /repo

# Copy lockfile + workspace manifests for cached installs.
COPY pnpm-workspace.yaml package.json ./
COPY apps/patient-portal/package.json apps/patient-portal/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/fhir-types/package.json packages/fhir-types/package.json
RUN pnpm install --no-frozen-lockfile

# ---------- builder: build the standalone Next output ----------
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/patient-portal/node_modules ./apps/patient-portal/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @medflow/patient-portal build

# ---------- runner: minimal standalone runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /repo/apps/patient-portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/patient-portal/.next/static ./apps/patient-portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/patient-portal/public ./apps/patient-portal/public

USER nextjs
EXPOSE 3001
CMD ["node", "apps/patient-portal/server.js"]

# ---------- dev: hot-reloading development target ----------
FROM node:20-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --no-frozen-lockfile
EXPOSE 3001
WORKDIR /repo/apps/patient-portal
CMD ["pnpm", "dev"]
