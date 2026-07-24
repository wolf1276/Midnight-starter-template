# Multi-stage Dockerfile for the web/ Next.js frontend.
# Build context is the repo root (npm workspaces span contracts/, api/, cli/, web/).
#
# Targets:
#   dev   - hot-reload dev server (docker compose --profile dev / `docker:start`)
#   prod  - minimal standalone production image
#
# Usage:
#   docker build --target dev  -t bboard-web:dev  .
#   docker build --target prod -t bboard-web:prod .

FROM node:24-slim AS base
WORKDIR /repo
RUN corepack enable
ENV npm_config_ignore_scripts=false

# --- deps: install all workspace dependencies (cached unless lockfiles change) ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY api/package.json api/package.json
COPY cli/package.json cli/package.json
COPY web/package.json web/package.json
COPY infra/patches ./infra/patches
RUN npm ci

# --- dev: full source, run the Next.js dev server with hot reload -----------
FROM deps AS dev
COPY . .
WORKDIR /repo/web
EXPOSE 3000
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dev"]

# --- builder: production build of web + its workspace deps ------------------
FROM deps AS builder
COPY . .
RUN npm run build:contract || true
RUN npm run build -w @midnight-ntwrk/bboard-api
RUN npm run build -w @midnight-ntwrk/bboard-web

# --- prod: minimal runtime image using Next.js standalone output ------------
FROM node:24-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /repo/web/.next/standalone ./
COPY --from=builder /repo/web/.next/static ./web/.next/static
COPY --from=builder /repo/web/public ./web/public
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "web/server.js"]
