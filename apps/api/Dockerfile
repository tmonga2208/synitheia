# syntax=docker/dockerfile:1
#
# Synítheia API.
#
# Built from the REPO ROOT, not from apps/api — the API imports @synitheia/shared, which is a
# workspace package that must be compiled before the API can run. A Dockerfile scoped to
# apps/api cannot see it, which is the classic way a pnpm monorepo deploy fails.
#
#   docker build -f apps/api/Dockerfile -t synitheia-api .

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable

# pnpm refuses to rewrite node_modules non-interactively without this — the --prod prune
# below aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. It is not a CI flag so much
# as pnpm's way of asking "are you sure nobody is watching".
ENV CI=true

WORKDIR /repo

# Manifests first, so a code change does not invalidate the dependency layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/api/ apps/api/

# shared FIRST. The API's `default` export condition resolves to packages/shared/dist —
# without this, the compiled server boots into a module-not-found and dies.
RUN pnpm --filter @synitheia/shared build
RUN pnpm --filter @synitheia/api build

# Re-resolve with dev dependencies stripped. The runtime image carries no TypeScript,
# no eslint, and no vitest.
RUN pnpm install --frozen-lockfile --prod

# ── Run ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable
ENV NODE_ENV=production

WORKDIR /repo

COPY --from=build /repo/node_modules node_modules/
COPY --from=build /repo/package.json ./

COPY --from=build /repo/packages/shared/node_modules packages/shared/node_modules/
COPY --from=build /repo/packages/shared/dist packages/shared/dist/
COPY --from=build /repo/packages/shared/package.json packages/shared/

COPY --from=build /repo/apps/api/node_modules apps/api/node_modules/
COPY --from=build /repo/apps/api/dist apps/api/dist/
COPY --from=build /repo/apps/api/package.json apps/api/

# Never root. A container escape should not begin with a process that already owns the box.
USER node

# Railway injects PORT; the app binds 0.0.0.0 so the platform can reach it.
EXPOSE 4000

# Straight to node — no pnpm, no shell wrapper. The process must be PID 1 so that a SIGTERM
# from the platform reaches Fastify and it can close connections instead of being killed.
CMD ["node", "apps/api/dist/index.js"]
