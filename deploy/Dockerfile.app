# syntax=docker/dockerfile:1
# Pendular app: builds the site, runs the API (which also serves the site) on :8787.
# Build context: the repository root (docker compose does this, see compose.yml).

FROM node:22-bookworm-slim AS base
ENV CI=true
RUN corepack enable
WORKDIR /app

# --- dependencies (cached until a manifest or the lockfile changes) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build the site ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN pnpm --filter @pendular/web build

# --- runtime: API sources run with tsx (the engine has no build step) ---
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
# Root dev dependencies are kept on purpose: tsx (declared there) is what runs the API.
# The web workspace's own dependencies (react, vite...) are left out.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    NODE_ENV=development pnpm install --frozen-lockfile --filter "@pendular/api..." --filter "."
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
# server.ts serves '../web/dist' relative to the working directory, so the cwd must be apps/api.
WORKDIR /app/apps/api
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
