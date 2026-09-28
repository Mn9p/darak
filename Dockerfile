# DARAK monorepo image (pnpm + Turborepo). Builds apps/web with @darak/db, runs Next standalone output.
# ---- base ----
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl && npm i -g pnpm@9.15.9
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY . .
# Provider is derived from DATABASE_URL at build; production images target PostgreSQL.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm db:generate && pnpm --filter web build

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl postgresql-client curl && addgroup -S darak && adduser -S darak -G darak
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Uploads live on the mounted volume (the standalone server changes directory, so the path must be absolute).
ENV UPLOAD_DIR=/app/uploads
# Next standalone output (monorepo-aware: contains apps/web/server.js + traced node_modules)
COPY --from=builder --chown=darak:darak /app/apps/web/.next/standalone ./
COPY --from=builder --chown=darak:darak /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=darak:darak /app/apps/web/public ./apps/web/public
# Prisma CLI + schema + migrations for `migrate deploy` at boot
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/scripts ./packages/db/scripts
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
RUN mkdir -p /app/uploads /app/backups && chown -R darak:darak /app/uploads /app/backups
USER darak
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
# Apply migrations, then start. A failed migration stops the container (never silently diverge with db push).
CMD ["sh", "-c", "cd packages/db && node scripts/prisma.mjs migrate deploy && cd /app && exec node apps/web/server.js"]
